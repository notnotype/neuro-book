/**
 * `nbook.tasks` 对其它插件公开的合同（docs/specs/workbench/background-tasks.md）：服务端的登记服务 `tasksKey`（自己的任务与
 * 提供方）与给窗口的远程服务 `tasksContract`。行为规则在 Spec 的“输出与可观察行为”，这里只写类型与 schema。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import type {Static} from "typebox";

import type {Text} from "@notnotype/nb-ui/text";

import {TextSchema} from "nbook/shared/text";

/** 一件任务属于谁（输出 22）：应用、某个项目或某个根会话。标题规则同任务标题。 */
export type OwnTaskOwner =
    | {readonly kind: "app"}
    | {readonly kind: "project"; readonly project: string; readonly title: Text}
    | {readonly kind: "session"; readonly session: string; readonly title: Text};

/** 行上“打开”执行的命令：命令 id 以提供方插件 id 加 "." 开头；至多 4 个参数，值至多 200 个字符。 */
export interface RowOpen {
    readonly command: string;
    readonly args?: Readonly<Record<string, string>>;
}

/** 提供方的行的归属：会话的可以带会话块组头的“打开”（自己的任务不能带，输出 26）。 */
export type RowOwner = OwnTaskOwner | {readonly kind: "session"; readonly session: string; readonly title: Text; readonly open?: RowOpen};

export type RowState = "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";

/** 提供方交出的一行（“输入与前置条件”）：编码后至多 2 KiB；一家至多 100 行。 */
export interface ProvidedRow {
    /** 这家里唯一，至多 200 个字符。 */
    readonly id: string;
    readonly title: Text;
    readonly message?: Text | null;
    readonly progress?: number | null;
    /** `waiting` 是等用户处理，算在跑。 */
    readonly state: RowState;
    /** 小写字母开头，只含小写字母、数字与 -，至多 40 个字符；清单盖成 `<提供方插件>.<kind>`。 */
    readonly kind: string;
    readonly kindLabel: Text;
    readonly form: "once";
    readonly owner: RowOwner;
    /** 根会话自己的运行：画成会话块的组头。 */
    readonly head?: boolean;
    /** 对话里正在进行的工作：状态栏不数（输出 27）。 */
    readonly foreground?: boolean;
    /** 毫秒时刻。 */
    readonly startedAt: number;
    readonly endedAt?: number | null;
    readonly stoppable?: boolean;
    readonly open?: RowOpen;
}

export type StopOutcome = {readonly kind: "accepted"} | {readonly kind: "rejected"; readonly reason: Text} | {readonly kind: "unknown"};

/** 拥有状态的插件交出行（输出 18–21）。`rows()` 同步、不做 I/O，抛错时这一家的行清空。 */
export interface TaskProvider {
    rows(): readonly ProvidedRow[];
    /** 行有变化时调 `notify`；交回退订。撤回之后旧的 `notify` 不起作用。 */
    subscribe(notify: () => void): () => void;
    /** 用户停一行。`signal` 在撤回、服务停止或清单不再等（10 秒）时 abort，之后的结果丢弃。 */
    stop(rowId: string, signal: AbortSignal): Promise<StopOutcome>;
}

export interface TaskInput {
    /** 一行：做什么。字面字符串至多 200 个码元，超出截掉；文字引用要带命名空间。 */
    readonly title: Text;
    /** 一行进展；字面字符串至多 500 个码元。 */
    readonly message?: Text;
    /** 0 到 100；`null` 或不给是不确定进度。 */
    readonly progress?: number | null;
    /** 缺省 false。 */
    readonly cancellable?: boolean;
    /** 给了才能重试（输出 6）；抛错或返回的 Promise 失败只记诊断。 */
    readonly retry?: () => void | Promise<void>;
    /** 缺省应用（输出 22）。 */
    readonly owner?: OwnTaskOwner;
}

export interface TaskFailure {
    /** 失败的原因，进展一列显示它；字面字符串至多 500 个码元。 */
    readonly message: Text;
    /** 开发诊断原文，必须已脱敏；至多留 8000 个码元。 */
    readonly detail?: string;
}

/**
 * 一件任务的句柄：只有登记它的发起方拿得到。任务结束或发起方入口停止之后，方法调用不起作用、不抛错（输出 3、5）。
 * `signal` 在用户取消（reason `"cancelled"`）或发起方入口停止之后（reason `"interrupted"`）abort：入口停止时它在发起方
 * 自己的停止步骤做完以后才到，发起方停自己的工作要用入口的停止信号。
 */
export interface TaskHandle {
    readonly id: string;
    readonly signal: AbortSignal;
    /** 给了的字段才改；`message: null` 去掉进展。 */
    report(patch: {readonly message?: Text | null; readonly progress?: number | null}): void;
    succeed(message?: Text): void;
    fail(failure: TaskFailure): void;
    cancelled(message?: Text): void;
}

/** 服务端入口依赖它登记任务与登记成提供方；按调用方提供，入口停止时它名下的任务按输出 5 收尾、提供方撤回。 */
export interface BackgroundTasks {
    /** 输入不合格时同步抛 `TypeError`，不登记。 */
    start(input: TaskInput): TaskHandle;
    /** 每个调用方同一时刻一个，已有在用的再调用同步抛 `TypeError`。交回撤回函数：只第一次起作用，清单关闭之后是空操作（输出 18）。 */
    provide(provider: TaskProvider): () => void;
}

export const tasksKey: ServiceKey<BackgroundTasks> = defineServiceKey<BackgroundTasks>("nbook.tasks/tasks");

export const TaskStateSchema = Type.Union([
    Type.Literal("running"),
    Type.Literal("succeeded"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
    Type.Literal("interrupted"),
]);
export type TaskState = Static<typeof TaskStateSchema>;

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);

export const RowOpenSchema = Type.Object({
    command: Type.String({minLength: 1}),
    args: Type.Optional(Type.Record(Type.String(), Type.String({maxLength: 200}), {maxProperties: 4})),
}, {additionalProperties: false});

export const TaskOwnerSchema = Type.Union([
    Type.Object({kind: Type.Literal("app")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("project"), project: Type.String({minLength: 1, maxLength: 200}), title: TextSchema}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("session"), session: Type.String({minLength: 1, maxLength: 200}), title: TextSchema, open: Type.Optional(RowOpenSchema)}, {additionalProperties: false}),
]);

export const TaskItemSchema = Type.Object({
    id: Type.String(),
    title: TextSchema,
    message: Nullable(TextSchema),
    state: TaskStateSchema,
    /** 只对在跑的有意义：数字是确定进度，`null` 是不确定进度；结束的为 `null`。 */
    progress: Nullable(Type.Number({minimum: 0, maximum: 100})),
    cancellable: Type.Boolean(),
    cancelRequested: Type.Boolean(),
    retryable: Type.Boolean(),
    hasDetail: Type.Boolean(),
    /** ISO 8601。 */
    startedAt: Type.String(),
    endedAt: Nullable(Type.String()),
    owner: TaskOwnerSchema,
}, {additionalProperties: false});
export type TaskItem = Static<typeof TaskItemSchema>;

const RowStateSchema = Type.Union([Type.Literal("running"), Type.Literal("waiting"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("interrupted")]);

/** 状态栏用的后台一次性工作（输出 23、27）：不分范围。 */
export const BackgroundSummarySchema = Type.Object({
    count: Type.Integer({minimum: 0}),
    items: Type.Array(Type.Object({title: TextSchema, message: Nullable(TextSchema), progress: Nullable(Type.Number({minimum: 0, maximum: 100}))}, {additionalProperties: false})),
}, {additionalProperties: false});
export type BackgroundSummary = Static<typeof BackgroundSummarySchema>;

export const OwnPayloadSchema = Type.Object({tasks: Type.Array(TaskItemSchema), background: BackgroundSummarySchema}, {additionalProperties: false});
export type OwnPayload = Static<typeof OwnPayloadSchema>;

/**
 * 视图里的一行（输出 23）：自己的任务（`source.kind` 为 `own`，操作照版本 1 的方法，`own` 是它的那一项）或提供方的行（键带代次，
 * 停止走 `stop`）。
 */
export const ListedRowSchema = Type.Object({
    key: Type.String(),
    source: Type.Union([Type.Object({kind: Type.Literal("own"), id: Type.String()}, {additionalProperties: false}), Type.Object({kind: Type.Literal("provider"), plugin: Type.String()}, {additionalProperties: false})]),
    kind: Type.String(),
    kindLabel: Nullable(TextSchema),
    title: TextSchema,
    message: Nullable(TextSchema),
    state: RowStateSchema,
    progress: Nullable(Type.Number({minimum: 0, maximum: 100})),
    startedAt: Type.String(),
    endedAt: Nullable(Type.String()),
    foreground: Type.Boolean(),
    stoppable: Type.Boolean(),
    open: Nullable(RowOpenSchema),
    own: Nullable(TaskItemSchema),
}, {additionalProperties: false});
export type ListedRow = Static<typeof ListedRowSchema>;

export const RowGroupSchema = Type.Union([
    Type.Object({kind: Type.Literal("session"), session: Type.String(), title: TextSchema, open: Nullable(RowOpenSchema), head: Nullable(ListedRowSchema), waiting: Type.Boolean(), rows: Type.Array(ListedRowSchema)}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("project"), project: Type.String(), title: TextSchema, current: Type.Boolean(), rows: Type.Array(ListedRowSchema)}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("app"), rows: Type.Array(ListedRowSchema)}, {additionalProperties: false}),
]);
export type RowGroup = Static<typeof RowGroupSchema>;

/** 窗口的范围（输出 22）：`project` 是窗口的当前项目（没有时为 null），`all` 为真时取全部项目、当前项目仍排在前面。 */
export const RowsFilterSchema = Type.Object({project: Nullable(Type.String({minLength: 1})), all: Type.Boolean()}, {additionalProperties: false});

export const RowsPayloadSchema = Type.Object({
    version: Type.Integer({minimum: 0}),
    groups: Type.Array(RowGroupSchema),
    more: Type.Integer({minimum: 0}),
    elsewhere: Type.Integer({minimum: 0}),
}, {additionalProperties: false});
export type RowsPayload = Static<typeof RowsPayloadSchema>;

export const TaskDetailSchema = Type.Object({text: Type.String(), truncated: Type.Boolean()}, {additionalProperties: false});
export type TaskDetail = Static<typeof TaskDetailSchema>;

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const IdInput = Type.Object({id: Type.String()}, {additionalProperties: false});
const NoInput = Type.Object({}, {additionalProperties: false});

const methods = {
    own: {input: NoInput, output: OwnPayloadSchema, effect: "read", errors: {"too-large": Detail}},
    rows: {input: RowsFilterSchema, output: RowsPayloadSchema, effect: "read"},
    detail: {input: IdInput, output: Nullable(TaskDetailSchema), effect: "read", errors: {"unknown-task": Detail}},
    cancel: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "not-cancellable": Detail, "not-running": Detail}},
    retry: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "not-retryable": Detail}},
    remove: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "running": Detail}},
    clearFinished: {input: NoInput, output: Type.Object({removed: Type.Integer({minimum: 0})}, {additionalProperties: false}), effect: "write"},
    stop: {input: Type.Object({key: Type.String()}, {additionalProperties: false}), output: Type.Object({outcome: Type.Union([Type.Literal("accepted"), Type.Literal("rejected"), Type.Literal("unknown")]), reason: Type.Optional(TextSchema)}, {additionalProperties: false}), effect: "write", errors: {"row-gone": Detail, "not-stoppable": Detail}},
} as const;

const events = {
    ownChanged: {filter: NoInput, payload: OwnPayloadSchema},
    rowsChanged: {filter: RowsFilterSchema, payload: RowsPayloadSchema},
} as const;

/** 窗口看自己的任务与分好组的行、取消、重试、移除与停止（输出 9、23）。版本 1 的窗口连上得 `version-changed`。 */
export const tasksContract = defineRemoteService({id: "nbook.tasks/tasks", version: 2, provider: "server", callers: ["browser"], methods, events});
