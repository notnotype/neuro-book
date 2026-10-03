import {beforeEach, describe, expect, it, vi} from "vitest";
import type {InboxGroup, OperationLogEntry} from "@notnotype/nb-history";
type MockHistoryDependencies = {
    readonly mutate: ReturnType<typeof vi.fn>;
    readonly requireProjectHandles: ReturnType<typeof vi.fn>;
    readonly waitForWarmup: ReturnType<typeof vi.fn>;
};

describe("workspace history revision routes", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("diff 只读取请求指定的当前 revision", async () => {
        const textDiff = vi.fn(async () => ({
            available: true as const,
            changes: [{value: "old\n", removed: true, count: 1}, {value: "new\n", added: true, count: 1}],
            beforeText: "old\n",
            afterText: "new\n",
        }));
        mockGetQuery({projectRoot: "book", path: "manuscript/a.md", revision: "7", mode: "inline"});
        const history = {inbox: vi.fn(async () => [group("manuscript/a.md", 7)]), textDiff};
        const dependencies = mockHistory(history);

        const handler = (await import("nbook/server/api/workspace-history/diff.get")).default;
        await expect(handler({} as never)).resolves.toMatchObject({status: "available", original: "old\n", modified: "new\n"});
        expect(dependencies.waitForWarmup).toHaveBeenCalledTimes(1);
        expect(dependencies.waitForWarmup.mock.invocationCallOrder[0])
            .toBeLessThan(history.inbox.mock.invocationCallOrder[0]!);
        expect(dependencies.requireProjectHandles).toHaveBeenCalledOnce();
        expect(dependencies.requireProjectHandles).toHaveBeenCalledWith("book");
        expect(textDiff).toHaveBeenCalledTimes(1);
    });

    it("diff revision 过期时返回 412，且不读取 snapshot 正文", async () => {
        const textDiff = vi.fn();
        mockGetQuery({projectRoot: "book", path: "manuscript/a.md", revision: "6", mode: "inline"});
        mockHistory({inbox: vi.fn(async () => [group("manuscript/a.md", 7)]), textDiff});

        const handler = (await import("nbook/server/api/workspace-history/diff.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(textDiff).not.toHaveBeenCalled();
    });

    it("accept 与 revert 均拒绝 path 相同但 revision 已更新的分组", async () => {
        const history = {
            acceptAtRevision: vi.fn(async () => {
                throw await inboxMutationError("stale");
            }),
            revertAtRevision: vi.fn(async () => {
                throw await inboxMutationError("stale");
            }),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", path: "manuscript/a.md", revision: 6})));

        const acceptHandler = (await import("nbook/server/api/workspace-history/accept.post")).default;
        await expect(acceptHandler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.acceptAtRevision).toHaveBeenCalledWith("local", "manuscript/a.md", 6);

        vi.resetModules();
        mockHistory(history);
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", path: "manuscript/a.md", revision: 6})));
        const revertHandler = (await import("nbook/server/api/workspace-history/revert.post")).default;
        await expect(revertHandler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.revertAtRevision).toHaveBeenCalledWith("local", "manuscript/a.md", 6);
    });

    it("accept 与 revert 在 revision 匹配时只操作当前分组", async () => {
        const history = {
            acceptAtRevision: vi.fn(),
            revertAtRevision: vi.fn(),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", path: "manuscript/a.md", revision: 7})));

        const acceptHandler = (await import("nbook/server/api/workspace-history/accept.post")).default;
        await expect(acceptHandler({} as never)).resolves.toEqual({success: true});
        expect(history.acceptAtRevision).toHaveBeenCalledWith("local", "manuscript/a.md", 7);

        vi.resetModules();
        const revertMocks = mockHistory(history);
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", path: "manuscript/a.md", revision: 7})));
        const revertHandler = (await import("nbook/server/api/workspace-history/revert.post")).default;
        await expect(revertHandler({} as never)).resolves.toEqual({success: true});
        expect(history.revertAtRevision).toHaveBeenCalledWith("local", "manuscript/a.md", 7);
        expect(revertMocks.mutate).toHaveBeenCalledTimes(1);
    });

    it("accept-all 只接受用户确认过的 Inbox revision", async () => {
        const history = {
            acceptAllAtRevision: vi.fn(async () => {
                throw await inboxMutationError("stale");
            }),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", revision: 7})));

        const handler = (await import("nbook/server/api/workspace-history/accept-all.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.acceptAllAtRevision).toHaveBeenCalledWith("local", 7);
    });

    it("accept-all 在 Inbox revision 匹配时接受当前全部分组", async () => {
        const history = {
            acceptAllAtRevision: vi.fn(async () => 2),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectRoot: "book", revision: 9})));

        const handler = (await import("nbook/server/api/workspace-history/accept-all.post")).default;
        await expect(handler({} as never)).resolves.toEqual({success: true, accepted: 2});
        expect(history.acceptAllAtRevision).toHaveBeenCalledWith("local", 9);
    });
});

/** 使用与动态 route import 相同的模块实例构造稳定收件箱错误。 */
async function inboxMutationError(code: "missing" | "stale"): Promise<Error> {
    const {HistoryInboxMutationError} = await import("@notnotype/nb-history");
    return new HistoryInboxMutationError(code, code);
}

/** 为 GET route 提供 h3 query，同时保留真实 createError 行为。 */
function mockGetQuery(query: Record<string, string>): void {
    vi.doMock("h3", async () => {
        const actual = await vi.importActual<typeof import("h3")>("h3");
        return {...actual, getQuery: () => query};
    });
}

/** 注入 Project Workspace 已打开且 history 可用的最小依赖。 */
function mockHistory(history: object): MockHistoryDependencies {
    const mutate = vi.fn(async (operation: () => Promise<unknown>) => operation());
    const waitForWarmup = vi.fn(async () => undefined);
    const requireProjectHandles = vi.fn(() => ({
        fileIndex: {mutate},
        history: {history: Promise.resolve(history), waitForWarmup},
    }));
    const withProjectHandlesOperation = vi.fn((projectPath: string, handler: (handles: ReturnType<typeof requireProjectHandles>) => unknown) => (
        handler(requireProjectHandles(projectPath))
    ));
    vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({
        requireProjectHandles,
        withProjectHandlesOperation,
    }));
    vi.doMock("nbook/server/workspace-history/project-history", () => ({
        LOCAL_USER_ID: "local",
    }));
    return {mutate, requireProjectHandles, waitForWarmup};
}

/** 构造 route revision 测试使用的收件箱分组。 */
function group(path: string, revision: number): InboxGroup {
    return {
        path,
        baseHash: "before",
        endHash: "after",
        entries: [entry(revision, path)],
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
