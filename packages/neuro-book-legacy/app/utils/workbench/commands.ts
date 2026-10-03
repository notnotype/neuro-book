/**
 * Workbench 命令注册表：具名可发现动作的单一身份与单一执行入口。
 *
 * 字段与语义取自 `docs/specs/workbench/commands.md`：注册与释放（含别名级联）、严格参数校验、
 * 上下文求值、agent 暴露与只读约束、确认闸门、单次审计。本文件是纯逻辑：不 import Vue、
 * 不弹 Toast、不写存储；可见错误与确认界面由触发宿主提供。
 *
 * 参数校验只做严格检查（`Value.Check`/`Value.Errors`），不做 Convert/default 填充——
 * 命令收到的就是调用方给的形状，缺字段就是失败，而不是被悄悄补齐。
 */
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {evaluateContextWhen, validateWhen, type ContextKey, type ContextValues, type WhenPredicate} from "nbook/app/utils/workbench/context-keys";

export type Release = () => void;

export type CommandFailureCode =
    | "unknown-command"
    | "unavailable"
    | "invalid-args"
    | "not-exposed"
    | "read-only"
    | "confirmation-required"
    | "denied"
    | "execution-error"
    | "stale-target";

export type CommandResult<T> = {ok: true; value: T} | {ok: false; code: CommandFailureCode; reason: string};

export type CommandInvocation = {source: "user"} | {source: "agent"; callerId: string};

export type CommandExposure = Readonly<{
    human?: boolean;
    agent?: "never" | "confirm" | "auto";
    hints?: Readonly<{readOnly?: boolean; destructive?: boolean; idempotent?: boolean}>;
}>;

export type CommandDescriptor<S extends TSchema, R> = Readonly<{
    id: string;
    /** i18n key：注册表只存 key，宿主渲染时解析。 */
    titleKey: string;
    /** 稳定英文语义说明，不参与 i18n。 */
    description: string;
    categoryKey?: string;
    icon?: string;
    argsSchema: S;
    /** 只读阻断的依据；`expose.hints.readOnly` 只作描述，不能替代它。 */
    effect: "read" | "write";
    when?: WhenPredicate;
    defaultKeybinding?: string;
    source?: "builtin";
    expose?: CommandExposure;
    run: (args: Static<S>) => CommandResult<R> | Promise<CommandResult<R>>;
}>;

/** 注册表对外给出的一律是元数据：`run` 不随枚举泄漏。 */
export type CommandMetadata = Omit<CommandDescriptor<TSchema, unknown>, "run">;

export type CommandExecutionEvent = Readonly<{
    /** 调用方输入的原样保留（可能是别名）。 */
    requestedId: string;
    /** 实际执行的 canonical id，审计只认它。 */
    id: string;
    invocation: CommandInvocation;
    args: unknown;
    result: CommandResult<unknown>;
    durationMs: number;
}>;

export type CommandConfirmationRequest = Readonly<{
    command: CommandMetadata;
    args: unknown;
    callerId: string;
}>;

export type CommandRegistryOptions = {
    context: () => ContextValues;
    agentMode: () => "normal" | "discuss" | "plan";
    confirm?: (request: CommandConfirmationRequest) => Promise<boolean>;
    development: boolean;
    report: (error: Error) => void;
};

export interface CommandRegistry {
    registerCommand<S extends TSchema, R>(descriptor: CommandDescriptor<S, R>): CommandResult<Release>;
    registerCommandAlias(alias: string, targetId: string): CommandResult<Release>;
    getCommand(id: string): CommandResult<CommandMetadata>;
    getAllCommands(): readonly CommandMetadata[];
    isCommandEnabled(id: string): CommandResult<boolean>;
    executeCommand(id: string, args?: unknown, invocation?: CommandInvocation): Promise<CommandResult<unknown>>;
    onDidChange(listener: () => void): Release;
    onDidExecuteCommand(listener: (event: CommandExecutionEvent) => void): Release;
}

type CommandEntry = {
    descriptor: CommandDescriptor<TSchema, unknown>;
    metadata: CommandMetadata;
    run: (args: unknown) => CommandResult<unknown> | Promise<CommandResult<unknown>>;
    release: Release;
};

type AliasEntry = {targetId: string; release: Release};

const COMMAND_DOMAINS: readonly string[] = ["view", "editor", "edit", "quick-open", "settings", "account", "project", "app", "help"];

/** 严格三段式：`nbook.<domain>.<action>`，段内小写 kebab-case。 */
const COMMAND_ID = /^nbook\.([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/u;

/** 别名与 canonical 共用名字表：至少两段的点分 kebab-case，不要求 `nbook` 前缀。 */
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

function now(): number {
    return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** 确认快照：确认界面与执行必须看到同一份内容，谁都不能通过改原对象影响对方。 */
function snapshotArguments(args: unknown): unknown {
    try {
        return typeof structuredClone === "function"
            ? structuredClone(args)
            : JSON.parse(JSON.stringify(args)) as unknown;
    } catch {
        return args;
    }
}

function whenProblems(owner: string, when: WhenPredicate | undefined): string[] {
    const problems: string[] = [];
    for (const key of (when?.requires ?? []) as readonly string[]) {
        if (!validateWhen({requires: [key as ContextKey]}).ok) {
            problems.push(`${owner} 的 when 取值未登记：${key}`);
        }
    }
    return problems;
}

function descriptorProblems(descriptor: CommandDescriptor<TSchema, unknown>): string[] {
    const problems: string[] = [];
    const id = String(descriptor.id);
    const match = COMMAND_ID.exec(id);
    if (!match) {
        problems.push(`命令 id 必须是三段式 kebab-case（nbook.<domain>.<action>）：${id}`);
    } else if (!COMMAND_DOMAINS.includes(match[1]!)) {
        problems.push(`未登记的命令域：${match[1]}`);
    }
    if (descriptor.titleKey.trim() === "") {
        problems.push(`命令 ${id} 的 titleKey 不能为空`);
    }
    if (descriptor.description.trim() === "") {
        problems.push(`命令 ${id} 的 description 不能为空`);
    }
    if (descriptor.effect !== "read" && descriptor.effect !== "write") {
        problems.push(`命令 ${id} 的 effect 必须是 read 或 write`);
    }
    if (descriptor.source !== undefined && descriptor.source !== "builtin") {
        problems.push(`命令 ${id} 的 source 只支持 builtin`);
    }
    const schema = descriptor.argsSchema as {type?: unknown; additionalProperties?: unknown};
    if (schema.type !== "object") {
        problems.push(`命令 ${id} 必须声明 object 参数 schema`);
    } else if (schema.additionalProperties !== false) {
        problems.push(`命令 ${id} 的参数 schema 必须关闭额外属性（additionalProperties: false）`);
    }
    if (descriptor.expose?.hints?.readOnly === true && descriptor.effect === "write") {
        problems.push(`命令 ${id} 的 readOnly 标注与 effect=write 冲突`);
    }
    if (typeof descriptor.run !== "function") {
        problems.push(`命令 ${id} 必须提供 run`);
    }
    problems.push(...whenProblems(`命令 ${id}`, descriptor.when));
    return problems;
}

/** `auto` 遇到 destructive 的有效投影是 `confirm`；`never` 不因任何标注被提升。 */
export function effectiveAgentExposure(exposure: CommandExposure | undefined): "never" | "confirm" | "auto" {
    const agent = exposure?.agent ?? "never";
    if (agent === "never") {
        return "never";
    }
    return agent === "auto" && exposure?.hints?.destructive === true ? "confirm" : agent;
}

function formatArgumentsErrors(schema: TSchema, value: unknown): string {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length === 0) {
        return "值不符合参数 schema";
    }
    return errors
        .map((error) => {
            const path = (error as {instancePath?: string; path?: string}).instancePath
                ?? (error as {path?: string}).path
                ?? "";
            return `${path === "" ? "/" : path}：${error.message}`;
        })
        .join("；");
}

export function createCommandRegistry(options: CommandRegistryOptions): CommandRegistry {
    const entries = new Map<string, CommandEntry>();
    const aliases = new Map<string, AliasEntry>();
    const changeListeners = new Set<() => void>();
    const executeListeners = new Set<(event: CommandExecutionEvent) => void>();
    const reportedConflicts = new Set<string>();

    function notifyChange(): void {
        for (const listener of [...changeListeners]) {
            try {
                listener();
            } catch (error) {
                options.report(asError(error));
            }
        }
    }

    function reportOnce(key: string, error: Error): void {
        if (reportedConflicts.has(key)) {
            return;
        }
        reportedConflicts.add(key);
        options.report(error);
    }

    function rejectRegistration(key: string, reason: string): CommandResult<Release> {
        if (options.development) {
            const error = new Error(reason);
            options.report(error);
            throw error;
        }
        reportOnce(key, new Error(reason));
        return {ok: false, code: "invalid-args", reason};
    }

    function resolveEntry(id: string): {canonicalId: string; entry: CommandEntry} | null {
        const canonical = entries.get(id);
        if (canonical) {
            return {canonicalId: id, entry: canonical};
        }
        const alias = aliases.get(id);
        const target = alias ? entries.get(alias.targetId) : undefined;
        return target ? {canonicalId: alias!.targetId, entry: target} : null;
    }

    function unavailableReasons(id: string): string[] | null {
        const entry = entries.get(id);
        if (!entry) {
            return null;
        }
        const evaluation = evaluateContextWhen(entry.descriptor.when, options.context());
        if (!evaluation.ok) {
            return [evaluation.reason];
        }
        return evaluation.value.reasons;
    }

    return {
        registerCommand<S extends TSchema, R>(descriptor: CommandDescriptor<S, R>): CommandResult<Release> {
            const problems = descriptorProblems(descriptor as CommandDescriptor<TSchema, unknown>);
            if (problems.length > 0) {
                return rejectRegistration(`descriptor:${descriptor.id}`, problems.join("；"));
            }

            const id = descriptor.id;
            const existing = entries.get(id);
            if (existing) {
                if (existing.descriptor === descriptor) {
                    return {ok: true, value: existing.release};
                }
                const reason = `Command '${id}' is already registered`;
                if (options.development) {
                    throw new Error(reason);
                }
                reportOnce(`duplicate:${id}`, new Error(reason));
                return {ok: false, code: "invalid-args", reason};
            }

            // 注册时用类型闭包把 schema → typed run 固定下来，调用方拿不到泛型控制权。
            const run = (args: unknown): CommandResult<unknown> | Promise<CommandResult<unknown>> =>
                descriptor.run(args as Static<S>);
            const {run: _run, ...metadata} = descriptor;
            const entry: CommandEntry = {
                descriptor: descriptor as CommandDescriptor<TSchema, unknown>,
                metadata: metadata as CommandMetadata,
                run,
                release: () => undefined,
            };
            entry.release = () => {
                // 旧释放闭包不能删掉后来复用同一 id 的新条目。
                if (entries.get(id) !== entry) {
                    return;
                }
                entries.delete(id);
                for (const [alias, record] of [...aliases]) {
                    if (record.targetId === id) {
                        aliases.delete(alias);
                    }
                }
                notifyChange();
            };
            entries.set(id, entry);
            notifyChange();
            return {ok: true, value: entry.release};
        },

        registerCommandAlias(alias: string, targetId: string): CommandResult<Release> {
            if (!ALIAS_ID.test(alias)) {
                return rejectRegistration(`alias:${alias}`, `别名必须是非空、无空白的点分 kebab-case：${alias}`);
            }
            if (!entries.has(targetId)) {
                return rejectRegistration(`alias-target:${alias}`, `别名目标未注册：${targetId}`);
            }
            if (entries.has(alias)) {
                return rejectRegistration(`alias-collision:${alias}`, `别名与已注册命令同名：${alias}`);
            }
            const existing = aliases.get(alias);
            if (existing) {
                if (existing.targetId === targetId) {
                    return {ok: true, value: existing.release};
                }
                return rejectRegistration(`alias-conflict:${alias}`, `别名已指向另一条命令：${alias} → ${existing.targetId}`);
            }

            const record: AliasEntry = {targetId, release: () => undefined};
            record.release = () => {
                if (aliases.get(alias) !== record) {
                    return;
                }
                aliases.delete(alias);
                notifyChange();
            };
            aliases.set(alias, record);
            notifyChange();
            return {ok: true, value: record.release};
        },

        getCommand(id: string): CommandResult<CommandMetadata> {
            const resolution = resolveEntry(id);
            if (!resolution) {
                return {ok: false, code: "unknown-command", reason: `未登记的命令：${id}`};
            }
            return {ok: true, value: resolution.entry.metadata};
        },

        getAllCommands(): readonly CommandMetadata[] {
            return [...entries.values()].map((entry) => entry.metadata);
        },

        isCommandEnabled(id: string): CommandResult<boolean> {
            const resolution = resolveEntry(id);
            if (!resolution) {
                return {ok: false, code: "unknown-command", reason: `未登记的命令：${id}`};
            }
            const reasons = unavailableReasons(resolution.canonicalId);
            if (reasons === null) {
                return {ok: false, code: "unknown-command", reason: `未登记的命令：${id}`};
            }
            if (reasons.length > 0) {
                return {ok: false, code: "unavailable", reason: reasons.join("；")};
            }
            return {ok: true, value: true};
        },

        async executeCommand(id: string, args?: unknown, invocation: CommandInvocation = {source: "user"}): Promise<CommandResult<unknown>> {
            const startedAt = now();
            const requestedId = id;
            let canonicalId = id;
            let auditedArgs: unknown = args;

            const finish = (result: CommandResult<unknown>): CommandResult<unknown> => {
                const event: CommandExecutionEvent = {
                    requestedId,
                    id: canonicalId,
                    invocation,
                    args: auditedArgs,
                    result,
                    durationMs: Math.max(0, Math.round((now() - startedAt) * 1000) / 1000),
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

            try {
                const resolution = resolveEntry(id);
                if (!resolution) {
                    return finish({ok: false, code: "unknown-command", reason: `未登记的命令：${id}`});
                }
                canonicalId = resolution.canonicalId;
                const {entry} = resolution;
                const descriptor = entry.descriptor;
                const agentCall = invocation.source === "agent";
                const exposure = effectiveAgentExposure(descriptor.expose);

                if (agentCall && exposure === "never") {
                    return finish({ok: false, code: "not-exposed", reason: `命令未对 agent 暴露：${canonicalId}`});
                }

                // 省略 args 才归一成 {}；null 与其它非对象一律校验失败，不做默认填充。
                const resolvedArgs: unknown = args === undefined ? {} : args;
                auditedArgs = resolvedArgs;
                if (!Value.Check(descriptor.argsSchema, resolvedArgs)) {
                    return finish({
                        ok: false,
                        code: "invalid-args",
                        reason: `参数校验失败：${formatArgumentsErrors(descriptor.argsSchema, resolvedArgs)}`,
                    });
                }

                const whenEvaluation = evaluateContextWhen(descriptor.when, options.context());
                if (!whenEvaluation.ok) {
                    return finish({ok: false, code: "unavailable", reason: whenEvaluation.reason});
                }
                if (!whenEvaluation.value.matches) {
                    return finish({ok: false, code: "unavailable", reason: whenEvaluation.value.reasons.join("；")});
                }

                const modeBeforeConfirm = options.agentMode();
                const readOnlyAgentCall = agentCall
                    && (descriptor.effect === "write" || descriptor.expose?.hints?.destructive === true);
                if (readOnlyAgentCall && (modeBeforeConfirm === "discuss" || modeBeforeConfirm === "plan")) {
                    return finish({
                        ok: false,
                        code: "read-only",
                        reason: `只读模式（${modeBeforeConfirm}）拒绝写入类 agent 调用：${canonicalId}`,
                    });
                }

                let runArgs: unknown = resolvedArgs;
                if (agentCall && exposure === "confirm") {
                    if (!options.confirm) {
                        return finish({
                            ok: false,
                            code: "confirmation-required",
                            reason: `命令需要确认，但宿主没有提供确认通道：${canonicalId}`,
                        });
                    }
                    // 确认界面与 run 各拿一份独立副本：两边都不能靠改自己的对象影响对方。
                    const confirmedContent = snapshotArguments(resolvedArgs);
                    const request: CommandConfirmationRequest = {
                        command: entry.metadata,
                        args: snapshotArguments(confirmedContent),
                        callerId: invocation.callerId,
                    };
                    auditedArgs = request.args;
                    let approved: boolean;
                    try {
                        approved = await options.confirm(request);
                    } catch (error) {
                        return finish({ok: false, code: "execution-error", reason: asError(error).message});
                    }
                    if (!approved) {
                        return finish({ok: false, code: "denied", reason: `用户拒绝了命令：${canonicalId}`});
                    }

                    // 等待期间条目身份、when 与只读模式都可能变：批准不等于放行旧请求。
                    if (entries.get(canonicalId) !== entry) {
                        return finish({ok: false, code: "stale-target", reason: `命令在确认期间被替换：${canonicalId}`});
                    }
                    const recheck = evaluateContextWhen(descriptor.when, options.context());
                    if (!recheck.ok) {
                        return finish({ok: false, code: "unavailable", reason: recheck.reason});
                    }
                    if (!recheck.value.matches) {
                        return finish({ok: false, code: "unavailable", reason: recheck.value.reasons.join("；")});
                    }
                    const modeAfterConfirm = options.agentMode();
                    if (readOnlyAgentCall && (modeAfterConfirm === "discuss" || modeAfterConfirm === "plan")) {
                        return finish({
                            ok: false,
                            code: "read-only",
                            reason: `只读模式（${modeAfterConfirm}）拒绝写入类 agent 调用：${canonicalId}`,
                        });
                    }
                    // run 用的是确认时内容的独立快照，调用方改原 args 不影响已批准的执行。
                    runArgs = snapshotArguments(confirmedContent);
                    auditedArgs = runArgs;
                }

                let outcome: CommandResult<unknown> | Promise<CommandResult<unknown>>;
                try {
                    outcome = entry.run(runArgs);
                } catch (error) {
                    return finish({ok: false, code: "execution-error", reason: asError(error).message});
                }
                let result: unknown;
                try {
                    result = await outcome;
                } catch (error) {
                    return finish({ok: false, code: "execution-error", reason: asError(error).message});
                }

                if (!result || typeof result !== "object" || typeof (result as {ok?: unknown}).ok !== "boolean") {
                    return finish({ok: false, code: "execution-error", reason: `命令没有返回结构化结果：${canonicalId}`});
                }
                const resolved = result as {ok: boolean; value?: unknown; code?: unknown; reason?: unknown};
                if (resolved.ok) {
                    return finish({ok: true, value: resolved.value === undefined ? null : resolved.value});
                }
                const code = typeof resolved.code === "string" && FAILURE_CODES.includes(resolved.code)
                    ? resolved.code as CommandFailureCode
                    : "execution-error";
                return finish({ok: false, code, reason: typeof resolved.reason === "string" ? resolved.reason : String(resolved.reason)});
            } catch (error) {
                return finish({ok: false, code: "execution-error", reason: asError(error).message});
            }
        },

        onDidChange(listener: () => void): Release {
            changeListeners.add(listener);
            return () => {
                changeListeners.delete(listener);
            };
        },

        onDidExecuteCommand(listener: (event: CommandExecutionEvent) => void): Release {
            executeListeners.add(listener);
            return () => {
                executeListeners.delete(listener);
            };
        },
    };
}
