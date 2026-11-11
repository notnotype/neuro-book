/**
 * `nbook.tasks` 对其它插件公开的合同（docs/specs/workbench/background-tasks.md）：服务端的登记服务 `tasksKey` 与给窗口的
 * 远程服务 `tasksContract`。行为规则在 Spec 的“输出与可观察行为”，这里只写类型与 schema。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import type {Static} from "typebox";

import type {Text} from "@notnotype/nb-ui/text";

import {TextSchema} from "nbook/shared/text";

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

/** 服务端入口依赖它登记任务；按调用方提供，发起方入口停止时它名下的任务按输出 5 收尾。 */
export interface BackgroundTasks {
    /** 输入不合格时同步抛 `TypeError`，不登记。 */
    start(input: TaskInput): TaskHandle;
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
}, {additionalProperties: false});
export type TaskItem = Static<typeof TaskItemSchema>;

export const TaskDetailSchema = Type.Object({text: Type.String(), truncated: Type.Boolean()}, {additionalProperties: false});
export type TaskDetail = Static<typeof TaskDetailSchema>;

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const IdInput = Type.Object({id: Type.String()}, {additionalProperties: false});
const NoInput = Type.Object({}, {additionalProperties: false});

const methods = {
    list: {input: NoInput, output: Type.Array(TaskItemSchema), effect: "read", errors: {"too-large": Detail}},
    detail: {input: IdInput, output: Nullable(TaskDetailSchema), effect: "read", errors: {"unknown-task": Detail}},
    cancel: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "not-cancellable": Detail, "not-running": Detail}},
    retry: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "not-retryable": Detail}},
    remove: {input: IdInput, output: Type.Null(), effect: "write", errors: {"unknown-task": Detail, "running": Detail}},
    clearFinished: {input: NoInput, output: Type.Object({removed: Type.Integer({minimum: 0})}, {additionalProperties: false}), effect: "write"},
} as const;

const events = {changed: {filter: NoInput, payload: Type.Array(TaskItemSchema)}} as const;

/** 窗口看清单、取消、重试与移除；推送整份清单（输出 9）。 */
export const tasksContract = defineRemoteService({id: "nbook.tasks/tasks", version: 1, provider: "server", callers: ["browser"], methods, events});
