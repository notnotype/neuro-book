/**
 * 审批钩子（docs/specs/agent/permissions.md）：把一次调用整理成规则要看的样子，算出规则结果与闸门分类，交给 `decide`。
 * 内核只知道“问钩子”，规则、判定对象与方言都在这里。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {Value} from "typebox/value";

import type {ApproveHook, ToolEffect, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import {RulesSchema} from "../../shared/permissions";
import type {Rule} from "../../shared/permissions";
import type {ToolSubject as Subject} from "../../shared/points";
import {joinAddress, workingAddress} from "../builtin/common";
import {sessionResources} from "../resources";
import type {CommandDialect, SimpleCommand} from "./bash-dialect";
import type {Dialects} from "./dialects";
import {decide} from "./judge";
import type {GateClass, ModeWriteAction} from "./judge";
import {layerResult, matchesTool, mergeLayers, needsSubjects} from "./rules";
import type {CallView, PathSubject, RuleHit} from "./rules";

export interface PermissionHookOptions {
    readonly files: WorkspaceFiles;
    readonly userRules: () => readonly Rule[];
    readonly dialects: Dialects;
    readonly modeWriteAction: () => ModeWriteAction;
    /** 工具交出的判定对象。`activate` 为真时提供方没激活就先激活；取不到（激活失败、抛错）交回 null。 */
    readonly subjectsOf: (tool: string, args: Readonly<Record<string, unknown>>, activate: boolean) => Promise<readonly Subject[] | null>;
    /** 当前 Agent 模式；`normal` 或没装扩展时没有闸门。 */
    readonly modeOf: (read: Parameters<ApproveHook>[2]["read"]) => string;
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
}

/** `.nbook/` 是控制目录，文件服务不给 Agent 看（`protected-path`）：规则是宿主自己读，从项目根的真实路径读。 */
async function readProjectRules(resources: ReturnType<typeof sessionResources>, project: string | undefined, signal: AbortSignal): Promise<readonly Rule[] | "invalid"> {
    if (project === undefined) return [];
    const root = await resources.readPath("project://", {signal});
    if (!root.ok) return "invalid";
    let text: string;
    try {
        text = await readFile(join(root.value.path, ".nbook", "permissions.json"), "utf8");
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : "invalid";
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return Value.Check(RulesSchema, parsed) ? parsed : "invalid";
    } catch {
        return "invalid";
    }
}

interface Scratch {
    readonly session: string | null;
    readonly temp: string | null;
}
const inside = (address: string, root: string | null): boolean => root !== null && (address === root || address.startsWith(root.endsWith("/") ? root : `${root}/`));

export function createPermissionHook(options: PermissionHookOptions): ApproveHook {
    return async (call, info, ctx) => {
        const context: ToolSessionContext = ctx.context;
        const resources = sessionResources(options.files, context, null);
        const expandGlob = (glob: string): string | null => {
            if (!glob.includes("://")) return glob;
            const expanded = resources.expand(glob);
            return expanded.ok ? expanded.address : null;
        };
        const reportRule = (rule: Rule): void => options.report("permission-rule-unevaluable", `a rule for ${rule.tool} could not be evaluated`, {tool: call.tool, rule: rule.tool});

        const mode = options.modeOf(ctx.read);
        const gated = mode !== "normal";
        const user = options.userRules();
        const project = await readProjectRules(resources, context.project, ctx.signal);
        if (project === "invalid") options.report("permission-rules-invalid", "the project's .nbook/permissions.json could not be read or is not a valid list of rules", {session: ctx.sessionId});
        const projectRules = project === "invalid" ? [] : project.filter((rule) => {
            if (rule.action !== "allow") return true;
            options.report("permission-allow-ignored", "allow rules in a project's permissions file have no effect", {rule: rule.tool});
            return false;
        });
        // 会话层先按整个工具：记住规则在“本会话都批准”那片接上。
        const session: readonly Rule[] = info.remembered.map((tool) => ({tool, action: "allow"}));

        const identity = {tool: call.tool, ...(info.tool.providerName === undefined ? {} : {toolName: info.tool.providerName})};
        const needed = gated && info.effect !== "read" || [...user, ...projectRules].some((rule) => matchesTool(rule.tool, identity) && rule.when !== undefined && needsSubjects(rule.when));
        const subjects = await options.subjectsOf(call.tool, call.args, needed);

        const views = buildViews(call.args, identity, subjects, options.dialects, context, resources);
        const hit = (rules: readonly Rule[]): RuleHit | null => (rules.length === 0 ? null : layerResult(rules, views.views, expandGlob, reportRule));
        let rules = mergeLayers({user: hit(user), project: hit(projectRules), session: hit(session)});
        // 项目规则文件坏了：拦不下来的拒绝规则可能就在里面，写与执行都问（输出 6）。
        if (project === "invalid" && info.effect !== "read" && rules?.action !== "deny") rules = {action: "ask"};
        // 地址分类为“写入要询问”的（`user://`，输出 7）：别的规则放行也要问，免得模型在放行写入下改掉自己的规则。
        if (rules?.action !== "deny" && views.views.some((view) => view.paths.some((path) => path.access === "write" && classifiedAsk(resources, path.address)))) rules = {action: "ask"};

        const scratch: Scratch = {session: address(resources, "session://"), temp: address(resources, "tmp://")};
        const gate: GateClass | null = gated ? classify(info.effect, views, scratch) : null;
        return decide({rules, gate, modeWriteAction: options.modeWriteAction(), effect: info.effect, approvalMode: info.mode});
    };
}

const address = (resources: ReturnType<typeof sessionResources>, text: string): string | null => {
    const expanded = resources.expand(text);
    return expanded.ok ? expanded.address : null;
};
const classifiedAsk = (resources: ReturnType<typeof sessionResources>, text: string): boolean => {
    const classified = resources.classify(text);
    return "write" in classified && classified.write === "ask";
};

interface Views {
    readonly views: readonly CallView[];
    /** 能确定的单条命令；有看不懂的或没有方言时 null。 */
    readonly commands: ReadonlyArray<{readonly dialect: CommandDialect; readonly command: SimpleCommand}> | null;
    readonly hasCommand: boolean;
}

/** 写重定向的目标换成全局地址。相对路径从工作目录算；磁盘路径没有地址，原样比对（不会落进草稿）。 */
function redirectTarget(target: string, context: ToolSessionContext, resources: ReturnType<typeof sessionResources>): string | null {
    if (target.startsWith("/")) return target;
    return address(resources, target.includes("://") ? target : joinAddress(workingAddress(context.project), target));
}

function buildViews(
    args: Readonly<Record<string, unknown>>,
    identity: Pick<CallView, "tool" | "toolName">,
    subjects: readonly Subject[] | null,
    dialects: PermissionHookOptions["dialects"],
    context: ToolSessionContext,
    resources: ReturnType<typeof sessionResources>,
): Views {
    const base = {...identity, args, others: [] as {kind: string; value: string}[], subjectsAvailable: subjects !== null};
    const paths: PathSubject[] = [];
    let unresolved = false;
    const commandSubjects: {dialect: string; text: string}[] = [];
    for (const subject of subjects ?? []) {
        if (subject.kind === "path") {
            const {access, address: raw} = subject as Extract<Subject, {kind: "path"}>;
            const expanded = address(resources, raw);
            if (expanded === null) unresolved = true;
            else paths.push({access, address: expanded});
        } else if (subject.kind === "command") {
            commandSubjects.push(subject as Extract<Subject, {kind: "command"}>);
        } else {
            base.others.push(subject as {kind: string; value: string});
        }
    }
    if (commandSubjects.length === 0) return {views: [{...base, paths, unresolvedPaths: unresolved, argv: null, opaqueText: null}], commands: [], hasCommand: false};

    const views: CallView[] = [];
    const known: {dialect: CommandDialect; command: SimpleCommand}[] = [];
    let opaque = false;
    for (const {dialect: id, text} of commandSubjects) {
        const dialect = dialects(id);
        const parsed = (() => {
            if (dialect === undefined) return null;
            try {
                const result = dialect.parse(text);
                return "opaque" in result ? null : result;
            } catch {
                return null;
            }
        })();
        if (parsed === null) {
            opaque = true;
            views.push({...base, paths, unresolvedPaths: unresolved, argv: null, opaqueText: text});
            continue;
        }
        const list = parsed.commands.length === 0 ? [{argv: [], redirects: [], assignments: [], hasExpansion: false}] : parsed.commands;
        for (const command of list) {
            known.push({dialect: dialect!, command});
            let viewUnresolved = unresolved;
            const redirects = command.redirects.filter((item) => item.write).flatMap((item): PathSubject[] => {
                const target = item.literal ? redirectTarget(item.target, context, resources) : null;
                if (target === null) {
                    viewUnresolved = true;
                    return [];
                }
                return [{access: "write", address: target}];
            });
            views.push({...base, paths: [...paths, ...redirects], unresolvedPaths: viewUnresolved, argv: command.argv, opaqueText: null});
        }
    }
    return {views, commands: opaque ? null : known, hasCommand: true};
}

/** 闸门分类（agent/modes.md 输出 1）：只读；写路径全部落在草稿、命令都只读（不看重定向）算只写草稿；其余算写。 */
function classify(effect: ToolEffect, views: Views, scratch: Scratch): GateClass {
    if (effect === "read") return "read";
    if (views.commands === null) return "write";
    if (views.views.some((view) => view.unresolvedPaths || !view.subjectsAvailable)) return "write";
    const writes = views.views.flatMap((view) => view.paths.filter((path) => path.access === "write"));
    if (writes.length === 0 || !writes.every((path) => inside(path.address, scratch.session) || inside(path.address, scratch.temp))) return "write";
    if (views.hasCommand && !views.commands.every(({dialect, command}) => dialect.readOnly({...command, redirects: []}))) return "write";
    // 不是命令的工具（`write`、`edit`）只凭路径；`exec` 的非命令工具说不清它还做了什么。
    return !views.hasCommand && effect === "exec" ? "write" : "scratch";
}
