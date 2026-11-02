/**
 * 会话的资源视图（docs/specs/agent/resources.md）：工具工厂 `create(context, services)` 的 `services.resources`。只由
 * `nbook.agent` 按内核给的会话上下文构造，不经共享服务交出。这里只有类型，不拖实现。
 */

import type {Baseline, FileText, Listing, OperationDone, SavedText, ServerFilesResult, VirtualListing} from "nbook/plugins/files/shared/contracts";

/** 地址的分类（输出 2）：算不算作品内容；Agent 写它是放行、要询问还是拒绝。审批按它判断。 */
export interface ResourceClass {
    readonly content: boolean;
    readonly write: "allowed" | "ask" | "denied";
}

export type Expanded = {readonly ok: true; readonly address: string} | {readonly ok: false; readonly code: "invalid-address" | "no-project"; readonly detail: string};

export type ResourceResult<T> = ServerFilesResult<T> | {readonly ok: false; readonly code: "no-project"; readonly detail: string};

export interface ResourceCallOptions {
    /** 工具执行的终止信号（`ToolContext.signal`）。 */
    readonly signal?: AbortSignal;
}

export interface SessionResources {
    /** 单数地址改写成全局地址，全局地址原样通过（输出 1）。 */
    expand(address: string): Expanded;
    /** 按改写后的全局地址分类：单数与全局写法结果相同。 */
    classify(address: string): ResourceClass | Extract<Expanded, {ok: false}>;
    list(address: string, options?: ResourceCallOptions): Promise<ResourceResult<Listing | VirtualListing>>;
    read(address: string, options?: ResourceCallOptions): Promise<ResourceResult<FileText>>;
    write(address: string, text: string, baseline: Baseline, options?: ResourceCallOptions): Promise<ResourceResult<SavedText>>;
    create(address: string, kind: "file" | "directory", options?: ResourceCallOptions): Promise<ResourceResult<OperationDone>>;
    realPath(address: string, options?: ResourceCallOptions): Promise<ResourceResult<{readonly path: string}>>;
}

/** 工具工厂的第二个参数（docs/specs/agent/contributions.md）。 */
export interface AgentToolServices {
    readonly resources: SessionResources;
}
