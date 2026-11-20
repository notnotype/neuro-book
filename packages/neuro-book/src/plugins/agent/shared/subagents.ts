/**
 * 子代理与任务的远程视图类型（docs/specs/agent/subagents.md 输出 21、25，jobs.md 输出 9、10）：服务端算、浏览器画，两边共用。
 */

import type {IndexedRun, JsonValue, SessionOwner} from "@notnotype/nb-harness/kernel/contracts";

/** `running` 在跑；`waiting` 等用户；`question` 等派它的 Agent 答；`idle` 空闲。 */
export type TreeState = "running" | "waiting" | "question" | "idle";

/** 后代等用户的事项（审批、交给用户的提问、模式切换请求）：祖先的停靠区按它画。 */
export interface TreePending {
    readonly id: string;
    readonly kind: "approval" | "question";
    readonly callId: string;
    readonly request: JsonValue;
}

/** `tree` 的一项：一个后代会话。 */
export interface TreeItem {
    readonly id: string;
    readonly parent: string;
    readonly callId: string | null;
    readonly invocation: string | null;
    /** fork 出来的：派它的那次调用的卡片不跟它。 */
    readonly forked: boolean;
    readonly profile: string | null;
    readonly name: string | null;
    readonly profileIcon?: string;
    readonly state: TreeState;
    /** 最近 20 次运行的收口，旧的在前。 */
    readonly runs: readonly IndexedRun[];
    readonly runId?: string;
    /** 让这次运行登记成任务的那次工具调用的 `invocation`。 */
    readonly runInvocation?: string;
    readonly startedAt?: number;
    readonly tools?: number;
    readonly step?: {readonly tool: string; readonly target?: string};
    readonly question?: {readonly id: string; readonly text: string};
    readonly pending?: readonly TreePending[];
}

/** `ancestors` 的一项，从父会话起。读不到索引的只有 id。 */
export interface AncestorItem {
    readonly id: string;
    readonly title: string | null;
    readonly profile: string | null;
    readonly icon?: string;
    readonly archived: boolean;
    /**
     * 会话头的归属（只有树根可能有：子会话没有归属，sessions.md 输出 23）。浏览器据此判断一个子会话属于谁的树，打开到哪里、根写谁的名字
     * （conversation.md 输出 53）；没有归属的不写。
     */
    readonly owner?: SessionOwner;
}

/** `jobs` 的一项（jobs.md 输出 9）。 */
export interface JobItem {
    readonly id: string;
    readonly kind: "agent" | "shell";
    readonly state: "running" | "question" | "completed" | "failed" | "aborted" | "interrupted";
    readonly summary: string;
    /** 启动它的那次工具调用。 */
    readonly invocation: string;
    /** 正被前台的调用等着。 */
    readonly foreground: boolean;
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly lastLine?: string;
    readonly exitCode?: number;
    readonly lines?: number;
    /** 子代理任务：子会话与这次运行。 */
    readonly sessionId?: string;
    readonly runId?: string;
}

/** 后台命令结束时写的 `status.json`（jobs.md 输出 7）。 */
export interface CommandStatus {
    readonly state: "completed" | "failed" | "aborted" | "interrupted";
    readonly exitCode: number | null;
    readonly lines: number;
    readonly bytes: number;
    readonly truncated: boolean;
    readonly timedOut: boolean;
    readonly endedAt: number;
}
