/**
 * 任务清单工具（`task_create`、`task_set_status`）的结果解析与前后版本比对。
 *
 * 每次调用的结果都是整张清单（服务端 `task-tools.ts` 把清单放在 `details`），
 * 所以某次调用“改了什么”要和它之前最近一次成功的任务清单调用比。
 */
import type {JsonValue, MessageView, ToolCallView} from "./agent-view.types";

export const TASK_TOOL_NAMES: readonly string[] = ["task_create", "task_set_status"];

export type TaskStatus = "pending" | "in_progress" | "completed";

export type TaskItemView = {id: string; text: string; status: TaskStatus; note: string | null};

export type TaskListView = {title: string | null; items: TaskItemView[]};

/** 相对上一版清单的一处变化；上一版没有这一项时 `from` 为 null。 */
export type TaskChange = {id: string; text: string; from: TaskStatus | null; to: TaskStatus};

function isRecord(value: JsonValue | undefined): value is {[key: string]: JsonValue} {
    return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function isTaskStatus(value: JsonValue | undefined): value is TaskStatus {
    return value === "pending" || value === "in_progress" || value === "completed";
}

/** 从调用结果解析整张清单；结果缺失或形状不对时返回 null。 */
export function parseTaskList(call: ToolCallView): TaskListView | null {
    const details = call.result?.details;
    if (!isRecord(details) || !Array.isArray(details.steps)) {
        return null;
    }
    const items: TaskItemView[] = [];
    for (const step of details.steps) {
        if (!isRecord(step) || typeof step.id !== "string" || typeof step.text !== "string" || !isTaskStatus(step.status)) {
            return null;
        }
        items.push({id: step.id, text: step.text, status: step.status, note: typeof step.note === "string" ? step.note : null});
    }
    return {title: typeof details.title === "string" ? details.title : null, items};
}

/** 在 `messages` 里找到 `callId` 之前最近一次成功解析的任务清单；没有时返回 null。 */
export function findPreviousTaskList(messages: readonly MessageView[], callId: string): TaskListView | null {
    let previous: TaskListView | null = null;
    for (const message of messages) {
        if (message.kind !== "assistant") {
            continue;
        }
        for (const call of message.toolCalls) {
            if (call.id === callId) {
                return previous;
            }
            if (TASK_TOOL_NAMES.includes(call.name) && call.status === "success") {
                previous = parseTaskList(call) ?? previous;
            }
        }
    }
    return previous;
}

/**
 * 两版清单之间状态变了或新出现的项，按新清单顺序排列。
 * `task_create` 会整张替换清单，此时调用方应把它当作新清单完整显示，而不是只看变化。
 */
export function diffTaskLists(previous: TaskListView | null, next: TaskListView): TaskChange[] {
    const before = new Map((previous?.items ?? []).map((item) => [item.id, item.status]));
    return next.items
        .filter((item) => before.get(item.id) !== item.status)
        .map((item) => ({id: item.id, text: item.text, from: before.get(item.id) ?? null, to: item.status}));
}
