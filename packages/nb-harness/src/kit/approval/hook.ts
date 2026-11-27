/**
 * 审批钩子（docs/specs/agent/permissions.md）：把一次调用整理成规则要看的样子，算出规则结果与闸门分类，交给 `decide`；判出
 * “交给审批者”的交给宿主给的审批者，要问人的交给宿主给的转问。内核只认 `ApproveHook`，这是它的一种实现；规则、判定对象与方言都在这里。
 *
 * 地址只经宿主给的文件访问改写与分类（docs/specs/harness/host-kit.md），哪些根是草稿、哪些写不问审批者由布局给。
 */

import {Value} from "typebox/value";

import type {ApprovalCtx, ApprovalVerdict, ApproveHook, JsonValue, ToolEffect, ToolSessionContext} from "../../kernel/contracts.js";
import type {CommandDialect, Dialects, SimpleCommand} from "../commands/index.js";
import {joinAddress} from "../files/index.js";
import type {SessionFiles, SessionFilesFactory} from "../files/index.js";
import {RulesSchema} from "../shapes.js";
import type {Rule, ToolSubject as Subject} from "../shapes.js";
import {decide} from "./judge.js";
import type {GateClass, GateTexts, ModeWriteAction} from "./judge.js";
import {layerResult, matchesTool, mergeLayers, needsSubjects} from "./rules.js";
import type {CallView, PathSubject, RuleHit} from "./rules.js";
import type {Escalate, EscalationSource, Reviewer} from "./types.js";

export interface ApprovalHookOptions {
    readonly files: SessionFilesFactory;
    readonly userRules: () => readonly Rule[];
    /** 宿主的项目层规则；没有项目为 `[]`，读不了为 `"invalid"`。 */
    readonly projectRules: (context: ToolSessionContext, signal: AbortSignal) => Promise<readonly Rule[] | "invalid">;
    /** 项目规则读不了时诊断 `permission-rules-invalid` 的消息（进日志，宿主定）。 */
    readonly projectRulesInvalidMessage: string;
    readonly dialects: Dialects;
    /** 这一刻有没有模式闸门（例如 Agent 处在只读的模式里）。 */
    readonly gated: (read: ApprovalCtx["read"]) => boolean;
    readonly modeWriteAction: () => ModeWriteAction;
    /** 闸门的文字：转问时的原因串、拒绝时给模型的话（都进日志，宿主定）。 */
    readonly gate: GateTexts;
    /** 工具交出的判定对象。`activate` 为真时提供方没激活就先激活；取不到（激活失败、抛错）交回 null。 */
    readonly subjectsOf: (tool: string, args: Readonly<Record<string, unknown>>, activate: boolean) => Promise<readonly Subject[] | null>;
    /** `auto` 下判出“交给审批者”的调用交给它。 */
    readonly review: Reviewer;
    /** 要问人的调用交给它；缺省原样交回询问，由内核问用户。 */
    readonly escalate?: Escalate;
    /**
     * 这个工具的询问能不能记成“本会话都批准”“以后都允许”（permissions.md 输出 18、25）；缺省都能。执行任意代码的工具
     * （eval）交回 false：没有可判定的对象，记下来等于以后的任何代码都不问。
     */
    readonly rememberable?: (tool: string) => boolean;
    readonly report: (code: string, message: string, params?: Record<string, unknown>) => void;
}

const inside = (address: string, root: string | null): boolean => root !== null && (address === root || address.startsWith(root.endsWith("/") ? root : `${root}/`));

/** 缺省的转问：原样交回询问，原因串照旧（审批记录与界面按它显示）。 */
const askUser: Escalate = async (escalation) => ({verdict: "ask", ...(escalation.reason === undefined ? {} : {reason: escalation.reason})});

export function createApprovalHook(options: ApprovalHookOptions): ApproveHook {
    const escalate = options.escalate ?? askUser;
    return async (call, info, ctx) => {
        const context: ToolSessionContext = ctx.context;
        const files = options.files(context, null);
        const expandGlob = (glob: string): string | null => {
            if (!glob.includes("://")) return glob;
            const expanded = files.expand(glob);
            return expanded.ok ? expanded.address : null;
        };
        const reportRule = (rule: Rule): void => options.report("permission-rule-unevaluable", `a rule for ${rule.tool} could not be evaluated`, {tool: call.tool, rule: rule.tool});

        const gated = options.gated(ctx.read);
        const user = options.userRules();
        const project = await options.projectRules(context, ctx.signal);
        if (project === "invalid") options.report("permission-rules-invalid", options.projectRulesInvalidMessage, {session: ctx.sessionId});
        const projectRules = project === "invalid" ? [] : project.filter((rule) => {
            if (rule.action !== "allow") return true;
            options.report("permission-allow-ignored", "allow rules in a project's permissions file have no effect", {rule: rule.tool});
            return false;
        });
        // 记整个工具的是旧日志与不看命令的工具；记规则的来自 `remember`。
        const session: readonly Rule[] = [
            ...info.remembered.map((tool): Rule => ({tool, action: "allow"})),
            ...info.rememberedRules.flatMap((item) => {
                const rules = (item as {rules?: unknown} | null)?.rules;
                return Value.Check(RulesSchema, rules) ? rules : [];
            }),
        ];

        const identity = {tool: call.tool, ...(info.tool.providerName === undefined ? {} : {toolName: info.tool.providerName})};
        const needed = (gated || info.mode === "auto") && info.effect !== "read" || [...user, ...projectRules].some((rule) => matchesTool(rule.tool, identity) && rule.when !== undefined && needsSubjects(rule.when));
        const subjects = await options.subjectsOf(call.tool, call.args, needed);

        const views = buildViews(call.args, identity, subjects, options.dialects, files);
        const hit = (rules: readonly Rule[]): RuleHit | null => (rules.length === 0 ? null : layerResult(rules, views.views, expandGlob, reportRule));
        let rules = mergeLayers({user: hit(user), project: hit(projectRules), session: hit(session)});
        // 是谁把规则结果改成了 ask：两处都成立时记后改的那个。`decide` 交回规则来源的询问时换成它。
        let forcedBy: EscalationSource | null = null;
        // 项目规则文件坏了：拦不下来的拒绝规则可能就在里面，写与执行都问（输出 6）。
        if (project === "invalid" && info.effect !== "read" && rules?.action !== "deny") {
            rules = {action: "ask"};
            forcedBy = "rules-invalid";
        }
        // 地址分类为“写入要询问”的（输出 7）：别的规则放行也要问，免得模型在放行写入下改掉自己的规则。
        if (rules?.action !== "deny" && views.views.some((view) => view.paths.some((path) => path.access === "write" && classifiedAsk(files, path.address)))) {
            rules = {action: "ask"};
            forcedBy = "address";
        }

        const scratch = files.layout.scratch.map((root) => address(files, root));
        const gate: GateClass | null = gated ? classify(info.effect, views, scratch) : null;
        const decided = decide({rules, gate, gateTexts: options.gate, modeWriteAction: options.modeWriteAction(), effect: info.effect, approvalMode: info.mode, localWrite: isLocalWrite(info.effect, views, files.layout.localWrites.map((root) => address(files, root)))});
        // `others` 各视图共用一份（只有路径与命令按视图分）。
        const request = {call, effect: info.effect, paths: views.views.flatMap((view) => view.paths), subjects: views.views[0]?.others ?? []};
        let verdict: ApprovalVerdict;
        if (decided.verdict === "review") {
            const reviewed = await options.review(request, ctx);
            verdict = reviewed.verdict === "ask" ? await escalate({...request, source: "reviewer", ...(reviewed.reason === undefined ? {} : {reason: reviewed.reason})}, ctx) : reviewed;
        } else if (decided.verdict === "ask") {
            const source: EscalationSource = decided.source === "rule" && forcedBy !== null ? forcedBy : decided.source;
            verdict = await escalate({...request, source, ...(decided.reason === undefined ? {} : {reason: decided.reason})}, ctx);
        } else {
            verdict = decided;
        }
        if (verdict.verdict !== "ask") return verdict;
        if (options.rememberable?.(call.tool) === false) return {...verdict, remember: false};
        if (!views.hasCommand) return verdict;
        return {...verdict, remember: rememberFor(call.tool, views) as unknown as JsonValue};
    };
}

const address = (files: SessionFiles, text: string): string | null => {
    const expanded = files.expand(text);
    return expanded.ok ? expanded.address : null;
};
const classifiedAsk = (files: SessionFiles, text: string): boolean => {
    const classified = files.classify(text);
    return "write" in classified && classified.write === "ask";
};

interface Views {
    readonly views: readonly CallView[];
    /** 能确定的单条命令；有看不懂的或没有方言时 null。 */
    readonly commands: ReadonlyArray<{readonly dialect: CommandDialect; readonly command: SimpleCommand}> | null;
    readonly hasCommand: boolean;
}

/** 写重定向的目标换成全局地址。相对路径从布局的工作目录算；磁盘路径没有地址，原样比对（不会落进草稿）。 */
function redirectTarget(target: string, files: SessionFiles): string | null {
    if (target.startsWith("/")) return target;
    return address(files, target.includes("://") ? target : joinAddress(files.layout.working, target));
}

function buildViews(
    args: Readonly<Record<string, unknown>>,
    identity: Pick<CallView, "tool" | "toolName">,
    subjects: readonly Subject[] | null,
    dialects: Dialects,
    files: SessionFiles,
): Views {
    const base = {...identity, args, others: [] as {kind: string; value: string}[], subjectsAvailable: subjects !== null};
    const paths: PathSubject[] = [];
    let unresolved = false;
    const commandSubjects: {dialect: string; text: string}[] = [];
    for (const subject of subjects ?? []) {
        if (subject.kind === "path") {
            const {access, address: raw} = subject as Extract<Subject, {kind: "path"}>;
            const expanded = address(files, raw);
            if (expanded === null) unresolved = true;
            else paths.push({access, address: expanded});
        } else if (subject.kind === "command") {
            commandSubjects.push(subject as Extract<Subject, {kind: "command"}>);
        } else {
            base.others.push(subject as {kind: string; value: string});
        }
    }
    if (commandSubjects.length === 0) return {views: [{...base, paths, unresolvedPaths: unresolved, argv: null, opaqueText: null, readOnly: false, redirectWrites: false}], commands: [], hasCommand: false};

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
            views.push({...base, paths, unresolvedPaths: unresolved, argv: null, opaqueText: text, readOnly: false, redirectWrites: false});
            continue;
        }
        const list = parsed.commands.length === 0 ? [{argv: [], redirects: [], assignments: [], hasExpansion: false}] : parsed.commands;
        for (const command of list) {
            known.push({dialect: dialect!, command});
            let viewUnresolved = unresolved;
            const redirects = command.redirects.filter((item) => item.write).flatMap((item): PathSubject[] => {
                const target = item.literal ? redirectTarget(item.target, files) : null;
                if (target === null) {
                    viewUnresolved = true;
                    return [];
                }
                return [{access: "write", address: target}];
            });
            views.push({...base, paths: [...paths, ...redirects], unresolvedPaths: viewUnresolved, argv: command.argv, opaqueText: null, readOnly: dialect!.readOnly(command), redirectWrites: command.redirects.some((item) => item.write)});
        }
    }
    return {views, commands: opaque ? null : known, hasCommand: true};
}

/** 这些记成前缀等于放开任意代码或任意删除，不给“本会话都批准”（名单参照 Codex）。 */
const TOO_WIDE = new Set(["bash", "sh", "dash", "zsh", "fish", "pwsh", "powershell", "python", "python3", "node", "bun", "deno", "perl", "ruby", "php", "lua", "osascript", "sudo", "su", "doas", "rm", "dd", "chmod", "chown", "ssh", "scp", "curl", "wget", "env", "exec"]);
/** 第二个词是子命令的：前缀到子命令；没有子命令（`git --help`）不记。 */
const HAS_SUBCOMMAND = new Set(["git", "npm", "pnpm", "yarn", "cargo", "go", "docker", "kubectl", "gh", "uv", "pip", "pip3"]);

function commandPrefix(argv: readonly string[]): string | null {
    const [name, sub] = argv;
    if (name === undefined || TOO_WIDE.has(name)) return null;
    if (!HAS_SUBCOMMAND.has(name)) return `${name} *`;
    return sub === undefined || sub.startsWith("-") || sub.includes("$") ? null : `${name} ${sub} *`;
}

/**
 * “本会话都批准”要记的规则（permissions.md 输出 18）：要拦的每条命令一条前缀。看不懂、有写重定向、前缀太宽时不能记。
 * 全是只读命令（询问规则问的）时按全部算。
 */
function rememberFor(tool: string, views: Views): {readonly label: string; readonly rules: readonly Rule[]} | false {
    if (views.commands === null) return false;
    const pending = views.views.filter((view) => !view.readOnly);
    const list = pending.length > 0 ? pending : views.views;
    if (list.some((view) => view.redirectWrites)) return false;
    const prefixes = list.map((view) => commandPrefix(view.argv ?? []));
    if (prefixes.length === 0 || prefixes.some((prefix) => prefix === null)) return false;
    const unique = [...new Set(prefixes as string[])];
    return {label: unique.join("、"), rules: unique.map((pattern) => ({tool, when: {type: "command", pattern}, action: "allow"}))};
}

/** `auto` 不问审批者的写（输出 19）：写工具，每个写路径都认得出、都落在布局的 `localWrites` 里。命令与没交出路径的工具（第三方、MCP）不算。 */
function isLocalWrite(effect: ToolEffect, views: Views, roots: readonly (string | null)[]): boolean {
    if (effect !== "write" || views.hasCommand || views.views.some((view) => view.unresolvedPaths || !view.subjectsAvailable)) return false;
    const writes = views.views.flatMap((view) => view.paths.filter((path) => path.access === "write"));
    return writes.length > 0 && writes.every((path) => roots.some((root) => inside(path.address, root)));
}

/** 闸门分类（agent/modes.md 输出 1）：只读；写路径全部落在布局的草稿根、命令都只读（不看重定向）算只写草稿；其余算写。 */
function classify(effect: ToolEffect, views: Views, scratch: readonly (string | null)[]): GateClass {
    if (effect === "read") return "read";
    if (views.commands === null) return "write";
    if (views.views.some((view) => view.unresolvedPaths || !view.subjectsAvailable)) return "write";
    const writes = views.views.flatMap((view) => view.paths.filter((path) => path.access === "write"));
    if (writes.length === 0 || !writes.every((path) => scratch.some((root) => inside(path.address, root)))) return "write";
    if (views.hasCommand && !views.commands.every(({dialect, command}) => dialect.readOnly({...command, redirects: []}))) return "write";
    // 不是命令的工具（`write`、`edit`）只凭路径；`exec` 的非命令工具说不清它还做了什么。
    return !views.hasCommand && effect === "exec" ? "write" : "scratch";
}
