/**
 * 会话的资源视图（docs/specs/agent/resources.md）：工具工厂 `create(context, services)` 的 `services.resources`。只由
 * `nbook.agent` 按内核给的会话上下文构造，不经共享服务交出。这里只有类型，不拖实现。
 */

import type {ServerFilesResult, WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

/** 地址的分类（输出 2）：算不算作品内容；Agent 写它是放行、要询问还是拒绝。审批按它判断。 */
export interface ResourceClass {
    readonly content: boolean;
    readonly write: "allowed" | "ask" | "denied";
}

export type Expanded = {readonly ok: true; readonly address: string} | {readonly ok: false; readonly code: "invalid-address" | "no-project"; readonly detail: string};

export type ResourceResult<T> = ServerFilesResult<T> | {readonly ok: false; readonly code: "no-project"; readonly detail: string};

/** 写入接口的方法，结果多一种 `no-project`（单数地址 `project://` 在没有主项目的会话里）。 */
type Bound<F> = {[K in keyof F]: F[K] extends (...args: infer A) => Promise<ServerFilesResult<infer R>> ? (...args: A) => Promise<ResourceResult<R>> : never};

/** 按会话绑定的写入接口（输出 10）：方法同 `WorkspaceFiles`，地址先改写，来源是这个会话。 */
export interface SessionCalls extends Bound<Omit<WorkspaceFiles, "group">> {
    group<T>(info: {readonly title: string; readonly note?: string}, run: (scoped: SessionCalls) => Promise<T>): Promise<T>;
}

/** 一次工具调用：条目 id 与终止信号（`ToolContext` 的 `callId`、`signal`）。 */
export interface ToolCall {
    readonly callId: string;
    readonly signal: AbortSignal;
}

export interface SessionResources extends SessionCalls {
    /** 单数地址改写成全局地址，全局地址原样通过（输出 1）。 */
    expand(address: string): Expanded;
    /** 按改写后的全局地址分类：单数与全局写法结果相同。 */
    classify(address: string): ResourceClass | Extract<Expanded, {ok: false}>;
    /**
     * 绑定一次工具调用（输出 10）：来源另带这次调用的条目 id，调用的 `signal` 合进每次调用，经它的写入与文件操作成一个
     * 操作分组，标题缺省为工具 id。
     */
    call(call: ToolCall, info?: {readonly title?: string; readonly note?: string}): SessionCalls;
}

/** 工具工厂的第二个参数（docs/specs/agent/contributions.md）。 */
export interface AgentToolServices {
    readonly resources: SessionResources;
}
