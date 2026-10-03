import {beforeEach, describe, expect, it, vi} from "vitest";
import type {UnseenGroup} from "@notnotype/nb-history";
import type {WorkspaceHistory} from "@notnotype/nb-history";
import type {ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";

describe("agent change diff 整轮预算", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("20 个小 diff 默认只计算前 4 个文件，reference 不保留正文", async () => {
        const textDiff = vi.fn(async () => ({
            available: true as const,
            changes: [{value: "old\n", removed: true, count: 1}, {value: "new\n", added: true, count: 1}],
            beforeText: "old\n",
            afterText: "new\n",
        }));
        const {readAgentChangeDiffDetails} = await import("nbook/server/workspace-history/agent-change-diff");

        const details = await readAgentChangeDiffDetails({
            history: historyHandle(textDiff),
            groups: Array.from({length: 20}, (_, index) => unseenGroup(index + 1)),
            maxChars: 512,
        });

        expect(textDiff).toHaveBeenCalledTimes(4);
        expect(details.size).toBe(4);
        expect([...details.values()].every((detail) => detail.kind === "inline")).toBe(true);
    });

    it("提高单文件阈值后仍受 8192 字符整轮总预算约束", async () => {
        const textDiff = vi.fn(async () => ({
            available: true as const,
            changes: [{value: `${"旧".repeat(2_700)}\n`, removed: true, count: 1}, {value: `${"新".repeat(2_700)}\n`, added: true, count: 1}],
            beforeText: `${"旧".repeat(2_700)}\n`,
            afterText: `${"新".repeat(2_700)}\n`,
        }));
        const {readAgentChangeDiffDetails} = await import("nbook/server/workspace-history/agent-change-diff");

        const details = await readAgentChangeDiffDetails({
            history: historyHandle(textDiff),
            groups: Array.from({length: 4}, (_, index) => unseenGroup(index + 1)),
            maxChars: 8_192,
        });
        const values = [...details.values()];

        expect(values.filter((detail) => detail.kind === "inline").length).toBe(1);
        const references = values.filter((detail) => detail.kind === "reference");
        expect(references.length).toBe(3);
        expect(references.every((detail) => !("diff" in detail))).toBe(true);
    });
});

/** 构造只暴露 textDiff 的 generation-scoped History 测试 handle。 */
function historyHandle(textDiff: WorkspaceHistory["textDiff"]): ProjectHistoryHandle {
    return {
        waitForWarmup: async () => undefined,
        history: Promise.resolve({textDiff} as WorkspaceHistory),
    } as ProjectHistoryHandle;
}

/** 构造整轮预算测试使用的 unseen 文件。 */
function unseenGroup(id: number): UnseenGroup {
    const path = `notes/change-${id}.md`;
    return {
        path,
        baseHash: `before-${id}`,
        endHash: `after-${id}`,
        maxEntryId: id,
        entries: [{
            id,
            occurredAt: new Date(id * 1000).toISOString(),
            actor: {kind: "user", userId: "local"},
            operation: {type: "file.edit", path, beforeHash: `before-${id}`, afterHash: `after-${id}`},
        }],
    };
}
