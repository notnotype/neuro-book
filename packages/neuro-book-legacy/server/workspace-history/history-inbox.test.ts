import {describe, expect, it} from "vitest";
import {
    matchWorkspaceHistoryInboxGroup,
    workspaceHistoryGroupRevision,
    workspaceHistoryInboxRevision,
} from "nbook/server/workspace-history/history-inbox";
import type {InboxGroup, OperationLogEntry} from "@notnotype/nb-history";

describe("workspace history inbox revision", () => {
    it("使用分组最大 entry id 作为 group revision，并计算 inbox revision", () => {
        const first = group("manuscript/a.md", [2, 7]);
        const second = group("manuscript/b.md", [3, 5]);

        expect(workspaceHistoryGroupRevision(first)).toBe(7);
        expect(workspaceHistoryInboxRevision([first, second])).toBe(7);
        expect(workspaceHistoryInboxRevision([])).toBe(0);
    });

    it("区分 matched、stale 与 missing，避免 path-only 请求误操作新版本", () => {
        const current = group("manuscript/a.md", [2, 7]);

        expect(matchWorkspaceHistoryInboxGroup([current], current.path, 7)).toEqual({kind: "matched", group: current});
        expect(matchWorkspaceHistoryInboxGroup([current], current.path, 2)).toEqual({kind: "stale", currentRevision: 7});
        expect(matchWorkspaceHistoryInboxGroup([current], "manuscript/missing.md", 7)).toEqual({kind: "missing"});
    });
});

/** 构造 revision 测试需要的最小收件箱分组。 */
function group(path: string, ids: number[]): InboxGroup {
    return {
        path,
        baseHash: "before",
        endHash: "after",
        entries: ids.map((id) => entry(id, path)),
    };
}

/** 构造最小文件编辑条目。 */
function entry(id: number, path: string): OperationLogEntry {
    return {
        id,
        occurredAt: new Date(id * 1000).toISOString(),
        actor: {kind: "agent", sessionId: "7"},
        operation: {
            type: "file.edit",
            path,
            beforeHash: "before",
            afterHash: "after",
        },
    };
}
