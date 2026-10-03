import {describe, expect, it} from "vitest";
import {AgentSessionListRequestGuard, sessionListQuerySignature} from "nbook/app/components/novel-ide/agent/session-list-request-guard";

describe("AgentSessionListRequestGuard", () => {
    it("只接受最新的替换式查询响应", () => {
        const guard = new AgentSessionListRequestGuard();

        const slowSearch = guard.begin({scope: "project", projectRoot: "a", search: "le", limit: 50, offset: 0});
        const latestSearch = guard.begin({scope: "project", projectRoot: "a", search: "leader", limit: 50, offset: 0});

        expect(guard.accepts(latestSearch)).toBe(true);
        expect(guard.accepts(slowSearch)).toBe(false);
    });

    it("筛选条件变化后拒绝旧加载更多响应", () => {
        const guard = new AgentSessionListRequestGuard();

        guard.begin({scope: "project", projectRoot: "a", status: "active", relation: "all", limit: 50, offset: 0});
        const loadMore = guard.begin({scope: "project", projectRoot: "a", status: "active", relation: "all", limit: 50, offset: 50});
        guard.begin({scope: "project", projectRoot: "a", status: "archived", relation: "all", limit: 50, offset: 0});

        expect(loadMore.shouldFetch).toBe(true);
        expect(guard.accepts(loadMore)).toBe(false);
    });

    it("同一筛选条件下允许加载更多", () => {
        const guard = new AgentSessionListRequestGuard();

        const firstPage = {scope: "project" as const, projectRoot: "a", status: "active" as const, relation: "all" as const, search: "leader", limit: 50, offset: 0};
        const nextPage = {...firstPage, offset: 50};
        const firstRequest = guard.begin(firstPage);
        const nextRequest = guard.begin(nextPage);

        expect(sessionListQuerySignature(firstPage)).toBe(sessionListQuerySignature(nextPage));
        expect(guard.accepts(firstRequest)).toBe(true);
        expect(nextRequest.shouldFetch).toBe(true);
        expect(guard.accepts(nextRequest)).toBe(true);
    });

    it("profileKey 变化时生成不同查询签名", () => {
        const leaderQuery = {scope: "project" as const, projectRoot: "a", profileKey: "leader.default", status: "active" as const, limit: 50, offset: 0};
        const inlineQuery = {...leaderQuery, profileKey: "inline.editor"};

        expect(sessionListQuerySignature(leaderQuery)).not.toBe(sessionListQuerySignature(inlineQuery));
    });

    it("同一追加页在途或已应用时不重复请求", () => {
        const guard = new AgentSessionListRequestGuard();
        const firstPage = {scope: "project" as const, projectRoot: "a", status: "active" as const, relation: "all" as const, limit: 50, offset: 0};
        const nextPage = {...firstPage, offset: 50};

        guard.begin(firstPage);
        const firstLoadMore = guard.begin(nextPage);
        const duplicateInFlight = guard.begin(nextPage);
        guard.markApplied(firstLoadMore);
        guard.finish(firstLoadMore);
        const duplicateApplied = guard.begin(nextPage);

        expect(firstLoadMore.shouldFetch).toBe(true);
        expect(duplicateInFlight.shouldFetch).toBe(false);
        expect(duplicateApplied.shouldFetch).toBe(false);
    });

    it("invalidate 后拒绝旧响应，旧 finally 不会清掉新代次 loading", () => {
        const guard = new AgentSessionListRequestGuard();
        const oldRequest = guard.begin({scope: "project", projectRoot: "a", status: "active", limit: 50});
        guard.start(oldRequest);
        guard.invalidate();
        const currentRequest = guard.begin({scope: "project", projectRoot: "b", status: "active", limit: 50});
        guard.start(currentRequest);

        expect(guard.accepts(oldRequest)).toBe(false);
        expect(guard.finish(oldRequest)).toBe(true);
        expect(guard.accepts(currentRequest)).toBe(true);
        expect(guard.finish(currentRequest)).toBe(false);
    });
});
