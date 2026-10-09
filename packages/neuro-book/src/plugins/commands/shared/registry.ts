/**
 * 命令表：具名可发现动作的单一身份与单一执行入口。行为见
 * [`workbench.commands`](../../../../../../docs/specs/workbench/commands.md)。
 *
 * 一个运行实例一份（`nbook.commands` 的入口各建一份），Lab 的命令场景另建自己的。与运行位置无关：
 * 不碰 DOM、不弹提示、不写存储，可见错误与确认界面由调用方提供。
 *
 * 参数只做严格检查，不转换、不补默认值：命令收到的就是调用方给的形状，缺字段就是失败。
 */

import type {TSchema} from "typebox";
import {Value} from "typebox/value";

import {evaluateContextWhen} from "./context-keys";
import type {ContextKeySource} from "./context-keys";
import {CommandDeclarationSchema} from "./contracts";
import type {
    AgentMode,
    CommandDeclaration,
    CommandExecutionEvent,
    CommandExposure,
    CommandFailureCode,
    CommandInvocation,
    CommandMetadata,
    CommandResult,
    CommandService,
    Release,
} from "./contracts";

/** 登记一条命令：声明、id、贡献方与处理函数。 */
export interface CommandDefinition {
    readonly id: string;
    /** 贡献方插件 id；`nbook.` 开头的插件按内置命令的 id 规则校验。 */
    readonly source: string;
    readonly declaration: CommandDeclaration;
    readonly run: (args: unknown) => CommandResult<unknown> | Promise<CommandResult<unknown>>;
}

export interface CommandConfirmationRequest {
    readonly command: CommandMetadata;
    readonly args: unknown;
    readonly callerId: string;
}

export interface CommandRegistryOptions {
    /** 本命令表的上下文键来源：求值时问它键能不能用、此刻的值；它不认的键使命令不可用。 */
    readonly contextKeys: ContextKeySource;
    /** 缺省为 normal。 */
    readonly agentMode?: () => AgentMode;
    /** Agent 调用 `confirm` 命令时的确认通道；缺省时这类调用得到 `confirmation-required`。 */
    readonly confirm?: (request: CommandConfirmationRequest) => Promise<boolean>;
    /** 登记被拒绝、`when` 引用了不能用的键、监听器抛错时报告；同一原因只报告一次。 */
    readonly report: (error: Error) => void;
}

export interface CommandRegistry extends CommandService {
    register(definition: CommandDefinition): CommandResult<Release>;
    /** 把外部已有的 id 映射到 canonical 命令；别名只解析，不产生第二份实现。 */
    registerAlias(alias: string, targetId: string): CommandResult<Release>;
}

interface CommandEntry {
    readonly definition: CommandDefinition;
    readonly metadata: CommandMetadata;
    release: Release;
}

interface AliasEntry {
    readonly targetId: string;
    release: Release;
}

/** 内置命令的域词表（`nbook.<domain>.<action>`）。 */
const COMMAND_DOMAINS: readonly string[] = ["view", "editor", "edit", "quick-open", "settings", "account", "project", "app", "help", "files"];

const BUILTIN_COMMAND_ID = /^nbook\.([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/u;

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/u;

/** 别名与 canonical 共用名字表：至少两段的点分 kebab-case。 */
const ALIAS_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/u;

const FAILURE_CODES: readonly string[] = [
    "unknown-command",
    "unavailable",
    "invalid-args",
    "not-exposed",
    "read-only",
    "confirmation-required",
    "denied",
    "execution-error",
    "stale-target",
];

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/** 确认界面与执行各拿一份独立副本：谁都不能靠改自己的对象影响对方。参数要求可结构化克隆。 */
function snapshot(args: unknown): unknown {
    return structuredClone(args);
}

function schemaProblems(declaration: unknown): string[] {
    return [...Value.Errors(CommandDeclarationSchema, declaration)].map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`);
}

/**
 * 一条命令声明的全部问题；空数组表示可以登记。贡献点的校验与命令表的登记共用这一份，规则只有一处。
 *
 * id 规则：`nbook.` 开头的插件写 `nbook.<域>.<动作>`，域在词表内；其它插件的命令 id 以自己的插件 id 开头，
 * 再接一段动作，避免第三方占用内置命名空间或彼此撞名。
 */
export function commandDeclarationProblems(id: string, source: string, declaration: unknown): string[] {
    const problems: string[] = [];
    if (source.startsWith("nbook.")) {
        const match = BUILTIN_COMMAND_ID.exec(id);
        if (match === null) problems.push(`内置命令的 id 必须是 nbook.<domain>.<action>：${id}`);
        else if (!COMMAND_DOMAINS.includes(match[1] as string)) problems.push(`未登记的命令域：${match[1]}`);
    } else {
        const action = id.startsWith(`${source}.`) ? id.slice(source.length + 1) : null;
        if (action === null || !SEGMENT.test(action)) problems.push(`插件 ${source} 的命令 id 必须是 ${source}.<action>：${id}`);
    }
    const shape = schemaProblems(declaration);
    if (shape.length > 0) return [...problems, ...shape.map((problem) => `命令 ${id} 的声明不合格：${problem}`)];
    const valid = declaration as CommandDeclaration;
    if (valid.expose?.hints?.readOnly === true && valid.effect === "write") problems.push(`命令 ${id} 的 readOnly 标注与 effect=write 冲突`);
    return problems;
}

/** `auto` 遇到 destructive 的实际投影是 `confirm`；`never` 不因任何标注被提升。 */
export function effectiveAgentExposure(exposure: CommandExposure | undefined): "never" | "confirm" | "auto" {
    const agent = exposure?.agent ?? "never";
    if (agent === "never") return "never";
    return agent === "auto" && exposure?.hints?.destructive === true ? "confirm" : agent;
}

function argumentErrors(schema: TSchema, value: unknown): string {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length === 0) return "值不符合参数 schema";
    return errors.map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`).join("；");
}

export function createCommandRegistry(options: CommandRegistryOptions): CommandRegistry {
    const entries = new Map<string, CommandEntry>();
    const aliases = new Map<string, AliasEntry>();
    const changeListeners = new Set<() => void>();
    const executeListeners = new Set<(event: CommandExecutionEvent) => void>();
    const reported = new Set<string>();
    const agentMode = options.agentMode ?? (() => "normal");

    function notifyChange(): void {
        for (const listener of [...changeListeners]) {
            try {
                listener();
            } catch (error) {
                options.report(asError(error));
            }
        }
    }

    /** 后来者被拒绝、首个保留；同一原因只报告一次，反复登记不刷屏。 */
    function reject(key: string, reason: string): CommandResult<Release> {
        if (!reported.has(key)) {
            reported.add(key);
            options.report(new Error(reason));
        }
        return {ok: false, code: "invalid-args", reason};
    }

    function resolve(id: string): {canonicalId: string; entry: CommandEntry} | null {
        const canonical = entries.get(id);
        if (canonical !== undefined) return {canonicalId: id, entry: canonical};
        const alias = aliases.get(id);
        const target = alias === undefined ? undefined : entries.get(alias.targetId);
        return alias === undefined || target === undefined ? null : {canonicalId: alias.targetId, entry: target};
    }

    function availability(entry: CommandEntry): {ok: true} | {ok: false; reason: string} {
        const evaluation = evaluateContextWhen(options.contextKeys, entry.metadata.when);
        if (!evaluation.ok) {
            // 键不能用是写命令的人的问题：每次求值都给出原因，诊断按命令与键只记一次。
            for (const item of evaluation.invalid) {
                const key = JSON.stringify(["when", entry.metadata.id, item.key]);
                if (!reported.has(key)) {
                    reported.add(key);
                    options.report(new Error(`命令 ${entry.metadata.id} 的 ${item.reason}`));
                }
            }
            return {ok: false, reason: evaluation.reason};
        }
        return evaluation.value.matches ? {ok: true} : {ok: false, reason: evaluation.value.reasons.join("；")};
    }

    function isReadOnlyMode(): AgentMode | null {
        const mode = agentMode();
        return mode === "discuss" || mode === "plan" ? mode : null;
    }

    return {
        register(definition) {
            const problems = commandDeclarationProblems(definition.id, definition.source, definition.declaration);
            if (typeof definition.run !== "function") problems.push(`命令 ${definition.id} 必须提供 run`);
            if (problems.length > 0) return reject(`definition:${definition.id}`, problems.join("；"));
            const id = definition.id;
            const existing = entries.get(id);
            if (existing !== undefined) {
                if (existing.definition === definition) return {ok: true, value: existing.release};
                return reject(`duplicate:${id}`, `命令 ${id} 已登记`);
            }
            const alias = aliases.get(id);
            if (alias !== undefined) return reject(`alias-collision:${id}`, `命令与已登记的别名同名：${id} → ${alias.targetId}`);
            const entry: CommandEntry = {definition, metadata: {...definition.declaration, id, source: definition.source}, release: () => undefined};
            entry.release = () => {
                // 旧的释放函数不能删掉后来复用同一 id 的新条目。
                if (entries.get(id) !== entry) return;
                entries.delete(id);
                for (const [alias, record] of [...aliases]) {
                    if (record.targetId === id) aliases.delete(alias);
                }
                notifyChange();
            };
            entries.set(id, entry);
            notifyChange();
            return {ok: true, value: entry.release};
        },

        registerAlias(alias, targetId) {
            if (!ALIAS_ID.test(alias)) return reject(`alias:${alias}`, `别名必须是非空、无空白的点分 kebab-case：${alias}`);
            if (!entries.has(targetId)) return reject(`alias-target:${alias}`, `别名目标未登记：${targetId}`);
            if (entries.has(alias)) return reject(`alias-collision:${alias}`, `别名与已登记的命令同名：${alias}`);
            const existing = aliases.get(alias);
            if (existing !== undefined) {
                if (existing.targetId === targetId) return {ok: true, value: existing.release};
                return reject(`alias-conflict:${alias}`, `别名已指向另一条命令：${alias} → ${existing.targetId}`);
            }
            const record: AliasEntry = {targetId, release: () => undefined};
            record.release = () => {
                if (aliases.get(alias) !== record) return;
                aliases.delete(alias);
                notifyChange();
            };
            aliases.set(alias, record);
            notifyChange();
            return {ok: true, value: record.release};
        },

        get(id) {
            const resolution = resolve(id);
            return resolution === null ? {ok: false, code: "unknown-command", reason: `未登记的命令：${id}`} : {ok: true, value: resolution.entry.metadata};
        },

        list() {
            return [...entries.values()].map((entry) => entry.metadata);
        },

        isEnabled(id) {
            const resolution = resolve(id);
            if (resolution === null) return {ok: false, code: "unknown-command", reason: `未登记的命令：${id}`};
            const available = availability(resolution.entry);
            return available.ok ? {ok: true, value: true} : {ok: false, code: "unavailable", reason: available.reason};
        },

        async execute(id, args, invocation = {source: "user"}) {
            const startedAt = performance.now();
            let canonicalId = id;
            let auditedArgs: unknown = args;

            const finish = (result: CommandResult<unknown>): CommandResult<unknown> => {
                const event: CommandExecutionEvent = {
                    requestedId: id,
                    id: canonicalId,
                    invocation,
                    args: auditedArgs,
                    result,
                    durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000),
                };
                for (const listener of [...executeListeners]) {
                    try {
                        listener(event);
                    } catch (error) {
                        options.report(asError(error));
                    }
                }
                return result;
            };
            const fail = (code: CommandFailureCode, reason: string): CommandResult<unknown> => finish({ok: false, code, reason});

            try {
                const resolution = resolve(id);
                if (resolution === null) return fail("unknown-command", `未登记的命令：${id}`);
                canonicalId = resolution.canonicalId;
                const {entry} = resolution;
                const declaration = entry.metadata;
                const agentCall = invocation.source === "agent";
                const exposure = effectiveAgentExposure(declaration.expose);

                if (agentCall && exposure === "never") return fail("not-exposed", `命令未对 Agent 开放：${canonicalId}`);

                // 只有省略参数才归一成 {}；null 与其它非对象一律校验失败。
                const resolvedArgs: unknown = args === undefined ? {} : args;
                auditedArgs = resolvedArgs;
                if (!Value.Check(declaration.args, resolvedArgs)) return fail("invalid-args", `参数校验失败：${argumentErrors(declaration.args, resolvedArgs)}`);

                const available = availability(entry);
                if (!available.ok) return fail("unavailable", available.reason);

                const writes = agentCall && (declaration.effect === "write" || declaration.expose?.hints?.destructive === true);
                const modeBefore = writes ? isReadOnlyMode() : null;
                if (modeBefore !== null) return fail("read-only", `只读模式（${modeBefore}）拒绝写入类的 Agent 调用：${canonicalId}`);

                let runArgs: unknown = resolvedArgs;
                if (invocation.source === "agent" && exposure === "confirm") {
                    if (options.confirm === undefined) return fail("confirmation-required", `命令需要确认，但没有确认通道：${canonicalId}`);
                    const confirmed = snapshot(resolvedArgs);
                    const request: CommandConfirmationRequest = {command: declaration, args: snapshot(confirmed), callerId: invocation.callerId};
                    auditedArgs = request.args;
                    let approved: boolean;
                    try {
                        approved = await options.confirm(request);
                    } catch (error) {
                        return fail("execution-error", asError(error).message);
                    }
                    if (!approved) return fail("denied", `用户拒绝了命令：${canonicalId}`);
                    // 等待期间条目、when 与只读模式都可能变了：批准不等于放行旧请求。
                    if (entries.get(canonicalId) !== entry) return fail("stale-target", `命令在确认期间被替换：${canonicalId}`);
                    const recheck = availability(entry);
                    if (!recheck.ok) return fail("unavailable", recheck.reason);
                    const modeAfter = writes ? isReadOnlyMode() : null;
                    if (modeAfter !== null) return fail("read-only", `只读模式（${modeAfter}）拒绝写入类的 Agent 调用：${canonicalId}`);
                    runArgs = snapshot(confirmed);
                    auditedArgs = runArgs;
                }

                let result: unknown;
                try {
                    result = await entry.definition.run(runArgs);
                } catch (error) {
                    return fail("execution-error", asError(error).message);
                }
                if (result === null || typeof result !== "object" || typeof (result as {ok?: unknown}).ok !== "boolean") {
                    return fail("execution-error", `命令没有返回结构化结果：${canonicalId}`);
                }
                const settled = result as {ok: boolean; value?: unknown; code?: unknown; reason?: unknown};
                if (settled.ok) return finish({ok: true, value: settled.value === undefined ? null : settled.value});
                const code = typeof settled.code === "string" && FAILURE_CODES.includes(settled.code) ? settled.code as CommandFailureCode : "execution-error";
                return fail(code, typeof settled.reason === "string" ? settled.reason : String(settled.reason));
            } catch (error) {
                return fail("execution-error", asError(error).message);
            }
        },

        onDidChange(listener) {
            changeListeners.add(listener);
            return () => {
                changeListeners.delete(listener);
            };
        },

        onDidExecute(listener) {
            executeListeners.add(listener);
            return () => {
                executeListeners.delete(listener);
            };
        },
    };
}
