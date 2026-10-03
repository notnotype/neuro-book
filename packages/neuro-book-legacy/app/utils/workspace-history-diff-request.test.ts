import {describe, expect, it} from "vitest";
import {
    WorkspaceHistoryDiffRequestGuard,
    type WorkspaceHistoryDiffRequestIdentity,
} from "nbook/app/utils/workspace-history-diff-request";

describe("WorkspaceHistoryDiffRequestGuard", () => {
    it("刷新后拒绝旧响应", () => {
        const guard = new WorkspaceHistoryDiffRequestGuard<string>();
        const oldRequest = guard.begin(identity("workspace/a", "notes/a.md", 1));

        guard.invalidate();

        expect(oldRequest.controller.signal.aborted).toBe(true);
        expect(guard.resolve(oldRequest, "old diff")).toBe(false);
        expect(guard.state(identity("workspace/a", "notes/a.md", 1)).result).toBeNull();
    });

    it("同路径旧 revision 和旧项目响应不得回填", () => {
        const guard = new WorkspaceHistoryDiffRequestGuard<string>();
        const oldRevision = guard.begin(identity("workspace/a", "notes/a.md", 1));
        guard.invalidate();
        const currentRevision = guard.begin(identity("workspace/a", "notes/a.md", 2));

        expect(guard.resolve(oldRevision, "revision 1")).toBe(false);
        expect(guard.resolve(currentRevision, "revision 2")).toBe(true);

        const oldProject = guard.begin(identity("workspace/a", "notes/b.md", 1));
        guard.invalidate();
        const currentProject = guard.begin(identity("workspace/b", "notes/b.md", 1));

        expect(guard.resolve(oldProject, "project a")).toBe(false);
        expect(guard.resolve(currentProject, "project b")).toBe(true);
    });

    it("A/B 文件并发 loading、error 和 result 互不串线", () => {
        const guard = new WorkspaceHistoryDiffRequestGuard<string>();
        const fileA = identity("workspace/a", "notes/a.md", 1);
        const fileB = identity("workspace/a", "notes/b.md", 2);
        const requestA = guard.begin(fileA);
        const requestB = guard.begin(fileB);

        expect(guard.state(fileA).loading).toBe(true);
        expect(guard.state(fileB).loading).toBe(true);

        expect(guard.reject(requestA, "A failed")).toBe(true);
        expect(guard.resolve(requestB, "B diff")).toBe(true);

        expect(guard.state(fileA)).toEqual({loading: false, error: "A failed", result: null});
        expect(guard.state(fileB)).toEqual({loading: false, error: null, result: "B diff"});
    });
});

/** 构造版本化请求身份。 */
function identity(projectRoot: string, path: string, revision: number): WorkspaceHistoryDiffRequestIdentity {
    return {projectRoot, path, revision, mode: "inline"};
}
