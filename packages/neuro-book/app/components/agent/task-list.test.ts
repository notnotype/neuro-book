import {describe, expect, it} from "vitest";
import type {JsonValue, MessageView, ToolCallView} from "./agent-view.types";
import {diffTaskLists, findPreviousTaskList, parseTaskList} from "./task-list";

function taskCall(id: string, name: string, steps: Array<[string, string, string]>, status: ToolCallView["status"] = "success"): ToolCallView {
    const details: JsonValue = {title: "第三章", steps: steps.map(([stepId, text, stepStatus]) => ({id: stepId, text, status: stepStatus, updatedAt: "t"})), updatedAt: "t"};
    return {id, name, status, args: {}, result: {text: "", truncated: false, details}};
}

function assistant(id: string, toolCalls: ToolCallView[]): MessageView {
    return {kind: "assistant", id, timestamp: 0, status: "done", text: "", thinking: "", model: "m", toolCalls, contentOmitted: false};
}

describe("任务清单", () => {
    it("从结果 details 解析整张清单；形状不对时返回 null", () => {
        expect(parseTaskList(taskCall("t1", "task_create", [["s1", "合并回忆", "pending"]]))).toEqual({
            title: "第三章",
            items: [{id: "s1", text: "合并回忆", status: "pending", note: null}],
        });
        expect(parseTaskList({id: "x", name: "task_create", status: "success", args: {}, result: {text: "", truncated: false, details: {steps: [{id: 1}]}}})).toBeNull();
        expect(parseTaskList({id: "x", name: "task_create", status: "running", args: {}})).toBeNull();
    });

    it("找上一版清单时跨消息、跳过失败的调用，第一版没有上一版", () => {
        const messages = [
            assistant("a1", [taskCall("t1", "task_create", [["s1", "合并回忆", "pending"], ["s2", "前移对话", "pending"]])]),
            assistant("a2", [taskCall("t2", "task_set_status", [["s1", "合并回忆", "completed"]], "error")]),
            assistant("a3", [taskCall("t3", "task_set_status", [["s1", "合并回忆", "completed"], ["s2", "前移对话", "pending"]])]),
        ];
        expect(findPreviousTaskList(messages, "t1")).toBeNull();
        expect(findPreviousTaskList(messages, "t3")?.items.map((item) => item.status)).toEqual(["pending", "pending"]);
    });

    it("比对只列出状态变化与新增的项", () => {
        const before = parseTaskList(taskCall("t1", "task_create", [["s1", "合并回忆", "pending"], ["s2", "前移对话", "pending"]]));
        const after = parseTaskList(taskCall("t2", "task_set_status", [["s1", "合并回忆", "completed"], ["s2", "前移对话", "pending"], ["s3", "检查第四章", "pending"]]))!;
        expect(diffTaskLists(before, after)).toEqual([
            {id: "s1", text: "合并回忆", from: "pending", to: "completed"},
            {id: "s3", text: "检查第四章", from: null, to: "pending"},
        ]);
    });
});
