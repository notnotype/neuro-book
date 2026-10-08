/**
 * `nbook.commands` 对其它插件公开的合同：命令贡献点、命令的声明与实现、命令服务。行为见
 * [`workbench.commands`](../../../../../../docs/specs/workbench/commands.md)。
 *
 * 其它插件在运行时只引用本文件（docs/adr/0025-service-keys-by-id.md）；例外是只在开发模式加载的 Lab 场景，
 * 它在运行时引用本目录的其它模块建自己的命令表。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {LocalizedTextSchema} from "nbook/shared/localized-text";

import type {WhenPredicate} from "./context-keys";

/** 贡献点 id：贡献 id 写命令 id。 */
export const COMMANDS_POINT = "commands.definitions";

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

/** Agent 所在会话的模式：discuss、plan 下拒绝 Agent 发起的写入类命令。 */
export type AgentMode = "normal" | "discuss" | "plan";

const AgentExposureSchema = Type.Union([Type.Literal("never"), Type.Literal("confirm"), Type.Literal("auto")]);

/**
 * 命令声明的结构。声明可以来自代码，也可以来自以后的清单 JSON，所以登记时按这份 schema 整体校验；
 * 语义检查（id 规则、`when` 的键是否登记、标注与 `effect` 是否冲突）见 `registry.ts`。
 */
export const CommandDeclarationSchema = Type.Object({
    title: LocalizedTextSchema,
    category: Type.Optional(LocalizedTextSchema),
    /** 稳定的英文语义说明，给 Agent 看，不随界面语言变化。 */
    description: Type.String({pattern: "\\S"}),
    /** 参数的 JSON Schema：必须是对象且关闭额外属性，执行前严格校验，不转换、不补默认值。 */
    args: Type.Object({type: Type.Literal("object"), additionalProperties: Type.Literal(false)}),
    /** 只读模式拦截 Agent 调用的唯一依据；`expose.hints.readOnly` 只作描述。 */
    effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    when: Type.Optional(Type.Object({requires: Type.Optional(Type.Array(Type.String()))}, {additionalProperties: false})),
    /** 默认键位，例如 `Mod+Shift+P`；由各运行位置的界面解析与分发，命令系统不解释它。 */
    keybinding: Type.Optional(Type.String({pattern: "\\S"})),
    expose: Type.Optional(Type.Object({
        /** 为 false 时不出现在命令面板等人类入口。 */
        human: Type.Optional(Type.Boolean()),
        agent: Type.Optional(AgentExposureSchema),
        hints: Type.Optional(Type.Object({
            readOnly: Type.Optional(Type.Boolean()),
            destructive: Type.Optional(Type.Boolean()),
            idempotent: Type.Optional(Type.Boolean()),
        }, {additionalProperties: false})),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

/** 写声明时 `args` 直接给 TypeBox schema；校验只要求它是关闭额外属性的对象 schema。 */
export type CommandDeclaration = Omit<Static<typeof CommandDeclarationSchema>, "args" | "when"> & {
    readonly args: TSchema;
    readonly when?: WhenPredicate;
};

export type CommandExposure = NonNullable<CommandDeclaration["expose"]>;

/** 命令的实现：随贡献方入口激活交出。返回结构化结果；抛出的异常按 `execution-error` 结算。 */
export interface CommandImplementation {
    run(args: unknown): CommandResult<unknown> | Promise<CommandResult<unknown>>;
}

/** 对外给出的命令描述：声明加上 id 与贡献方，不含实现。 */
export type CommandMetadata = CommandDeclaration & {
    readonly id: string;
    /** 贡献方插件 id。 */
    readonly source: string;
};

export interface CommandExecutionEvent {
    /** 调用方给的原样（可能是别名）。 */
    readonly requestedId: string;
    /** 实际执行的 canonical id，审计只认它。 */
    readonly id: string;
    readonly invocation: CommandInvocation;
    readonly args: unknown;
    readonly result: CommandResult<unknown>;
    readonly durationMs: number;
}

/**
 * 命令服务：一个运行实例的命令表。`nbook.commands` 的入口提供它，Lab 场景的本地命令表也满足它，
 * 所以命令面板与键位分发只依赖这个接口。
 */
export interface CommandService {
    get(id: string): CommandResult<CommandMetadata>;
    /** 全部 canonical 命令，按登记顺序；别名不出现。 */
    list(): readonly CommandMetadata[];
    /** 不可用时给出 `unavailable` 与原因，而不是 `{ok: true, value: false}`。 */
    isEnabled(id: string): CommandResult<boolean>;
    execute(id: string, args?: unknown, invocation?: CommandInvocation): Promise<CommandResult<unknown>>;
    /** 命令增减时通知；可用性随上下文变化不通知，界面在需要时重新求值。 */
    onDidChange(listener: () => void): Release;
    /** 每次执行恰好一条审计事件，含未知 id、拒绝与异常。 */
    onDidExecute(listener: (event: CommandExecutionEvent) => void): Release;
}

export const commandServiceKey: ServiceKey<CommandService> = defineServiceKey<CommandService>("nbook.commands/service");
