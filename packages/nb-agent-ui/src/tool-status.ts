/**
 * 工具调用的状态归成三段：在跑、出错、结束。分轮统计、步骤行、原始视图与任务清单都按它判断，新增一种调用状态时只改这里。
 */
import type {ToolCallStatus} from "./types";

export type ToolCallPhase = "running" | "error" | "done";

export function toolCallPhase(status: ToolCallStatus): ToolCallPhase {
    switch (status) {
        case "streaming":
        case "running": return "running";
        case "error":
        case "invalid":
        case "unknown": return "error";
        // 没执行不算出错：拒绝是用户或规则的决定。
        case "denied":
        case "success": return "done";
    }
}
