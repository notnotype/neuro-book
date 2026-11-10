/**
 * `nbook.commands` 对其它插件公开的合同：命令贡献点、命令的声明与实现、命令服务。行为见
 * [`workbench.commands`](../../../../../../docs/specs/workbench/commands.md)。
 *
 * 其它插件在运行时只引用本文件（docs/adr/0025-service-keys-by-id.md）；例外是只在开发模式加载的 Lab 场景，
 * 它在运行时引用本目录的其它模块建自己的命令表。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {Text} from "@notnotype/nb-ui/text";

import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";

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

/**
 * 失败的 `reason` 是给人看的文字值（docs/specs/workbench/commands.md 的“结果合同”）：浏览器里的命令交目录里的文字引用，
 * 显示的一方（命令面板、失败通知、菜单）按当前语言翻，切换语言后随之换文字；服务端没有翻译端口，那里产生的原因写字符串或
 * 语言映射。交给服务端的远程结果在窗口里先翻成字符串（`plugin.ts` 的 `remoteCommands`）。
 */
export type CommandResult<T> = {ok: true; value: T} | ({ok: false} & CommandFailure);

/**
 * 失败的结果里调用方要读的几项。`reason` 不放诊断原文；异常的 message、服务端原文放在 `detail`：已脱敏的开发诊断原文，
 * 不翻译，只进通知的“详情”。跨实例的结果不带 `detail`（`remoteCommands` 只交 `code` 与 `reason`）。
 */
export interface CommandFailure {
    readonly code: CommandFailureCode;
    readonly reason: Text;
    readonly detail?: string;
}

/**
 * 不带参数执行时参数能通过校验：命令面板、快捷键与状态栏条目都以 `{}` 执行（执行入口把省略的参数归一成 `{}`）。
 * 按校验结果判断而不是只看 `required`：`Union`、`Intersect`、`minProperties` 这类写法没有 `required` 也收不下 `{}`。
 */
export function runsWithoutArgs(args: TSchema): boolean {
    return Value.Check(args, {});
}

export type CommandInvocation = {source: "user"} | {source: "agent"; callerId: string};

/** Agent 所在会话的模式：discuss、plan 下拒绝 Agent 发起的写入类命令。 */
export type AgentMode = "normal" | "discuss" | "plan";

const AgentExposureSchema = Type.Union([Type.Literal("never"), Type.Literal("confirm"), Type.Literal("auto")]);

/**
 * 命令声明的结构。声明可以来自代码，也可以来自以后的清单 JSON，所以登记时按这份 schema 整体校验；
 * 语义检查（id 规则、`when` 的键是否登记、标注与 `effect` 是否冲突）见 `registry.ts`。
 */
export const CommandDeclarationSchema = Type.Object({
    /** 没写时登记处补成约定键 `commands.<本地 id>.title`（docs/specs/workbench/commands.md 的“约定键”）。 */
    title: TextSchema,
    category: Type.Optional(TextSchema),
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

/** 作者写下的命令声明：`title` 可以省略，登记时由贡献点补成约定键（docs/specs/workbench/commands.md 的“约定键”）。 */
export type WrittenCommandDeclaration = Omit<CommandDeclaration, "title"> & {readonly title?: CommandDeclaration["title"]};

/** `nbook.commands` 贡献点的补全：给文字引用补命名空间，没写 `title` 时补约定键 `commands.<本地 id>.title`。 */
export const completeCommandDeclaration = conventionCompleter({name: "commands", fields: ["title"]});

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
 *
 * `get`、`list`、`isEnabled` 是同步的：这是同一实例内的内部服务，任何插件都可以依赖（ADR 0027，
 * docs/specs/workbench/commands.md）。
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

/** 远程列出的一条命令：元数据加上此刻在那个窗口里按它的公开状态求出的可用性。 */
const RemoteCommandSchema = Type.Object({
    id: Type.String(),
    source: Type.String(),
    /** 原样转发声明里的文字：`TextRef` 带着贡献方的命名空间，服务端不翻译，交给能翻译的一方。 */
    title: TextSchema,
    /** 没写分类为 null。 */
    category: Type.Union([TextSchema, Type.Null()]),
    description: Type.String(),
    /** 参数的 JSON Schema。 */
    args: Type.Unknown(),
    effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    /** 对 Agent 的实际暴露级别；`never` 的不列出。 */
    agent: Type.Union([Type.Literal("confirm"), Type.Literal("auto")]),
    available: Type.Boolean(),
    /** 不可用时的原因；可用为 null。 */
    reason: Type.Union([Type.String(), Type.Null()]),
}, {additionalProperties: false});

export type RemoteCommand = Static<typeof RemoteCommandSchema>;

const RemoteCommandResultSchema = Type.Union([
    Type.Object({ok: Type.Literal(true), value: Type.Unknown()}, {additionalProperties: false}),
    Type.Object({ok: Type.Literal(false), code: Type.String(), reason: Type.String()}, {additionalProperties: false}),
]);

/**
 * 跨实例列出与执行某个窗口里的命令（docs/specs/workbench/commands.md 的“跨实例列出与执行”）：浏览器的
 * `nbook.commands` 入口提供，第一版只允许服务端调用，服务端插件以 `.at({client: 窗口实例 id})` 选定窗口。
 * `when` 只在命令所在的窗口求值：服务端问到的是那个窗口此刻的状态，不保存窗口状态的副本。
 *
 * 版本 2：`list` 的 `title` 从中英两份放宽为文字值（含文字引用），并加上 `category`。
 */
export const commandsRemoteContract = defineRemoteService({
    id: "nbook.commands/remote",
    version: 2,
    provider: "client",
    callers: ["server"],
    methods: {
        list: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(RemoteCommandSchema), effect: "read"},
        execute: {
            input: Type.Object({id: Type.String({minLength: 1}), args: Type.Optional(Type.Unknown())}, {additionalProperties: false}),
            output: RemoteCommandResultSchema,
            effect: "write",
        },
    },
});

export {currentKeyPlatform, formatKeybinding, parseKeybinding} from "./keybinding";
export {arrangeMenu, completeMenuItemDeclaration, matchesExtensions, MENU_BUTTON, MENU_EXTENSIONS, menuImplementations, MenuItemRegistry, menuItemValidator, menuLocation} from "./menus";
export type {MenuCurrentFiles, MenuEntry, MenuFacts, MenuItemDeclaration, MenuItemImplementation, MenuLocation} from "./menus";
export type {KeyModifiers, KeyPlatform, ParsedKeybinding} from "./keybinding";
