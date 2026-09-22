import {describe, expect, it} from "vitest";
import {parseTaskList} from "nbook/app/components/novel-ide/agent/task-list";

describe("parseTaskList", () => {
    it("优先解析 resultData 里的结构化任务快照", () => {
        const taskList = parseTaskList({
            resultData: {
                title: "实现任务卡片",
                updatedAt: "2026-05-07T00:00:00.000Z",
                steps: [
                    {
                        id: "create",
                        text: "创建任务",
                        status: "completed",
                        updatedAt: "2026-05-07T00:00:00.000Z",
                    },
                    {
                        id: "render",
                        text: "渲染卡片",
                        status: "in_progress",
                        note: "正在补组件",
                        updatedAt: "2026-05-07T00:01:00.000Z",
                    },
                ],
            },
            result: "",
        });

        expect(taskList?.title).toBe("实现任务卡片");
        expect(taskList?.steps).toHaveLength(2);
        expect(taskList?.steps[1]?.note).toBe("正在补组件");
    });

    it("会回退解析 result 中的 JSON 文本", () => {
        const taskList = parseTaskList({
            resultData: undefined,
            result: JSON.stringify({
                updatedAt: "2026-05-07T00:02:00.000Z",
                steps: [
                    {
                        id: "verify",
                        text: "验证显示",
                        status: "pending",
                        updatedAt: "2026-05-07T00:02:00.000Z",
                    },
                ],
            }),
        });

        expect(taskList?.steps[0]?.text).toBe("验证显示");
    });
});
