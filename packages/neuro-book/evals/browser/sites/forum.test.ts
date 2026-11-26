import {afterEach, describe, expect, test} from "bun:test";

import {FORUM_USER, forumSite} from "./forum";
import type {ForumState} from "./forum";
import {startSite} from "./server";
import type {RunningSite} from "./server";

const running: Array<RunningSite<ForumState>> = [];
afterEach(async () => {
    await Promise.all(running.splice(0).map((site) => site.stop()));
});

async function site(): Promise<RunningSite<ForumState>> {
    const started = await startSite(forumSite, 1);
    running.push(started);
    return started;
}

async function post(url: string, body: unknown): Promise<{status: number; json: Record<string, unknown>}> {
    const response = await fetch(url, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    return {status: response.status, json: await response.json() as Record<string, unknown>};
}

describe("论坛", () => {
    test("发帖：经编辑器源的草稿发的带有效凭据，直接带正文的记成没带凭据", async () => {
        const s = await site();
        const draft = await post(`${s.urls.editor}/api/drafts`, {text: "<p>正文一</p>"});
        const viaDraft = await post(`${s.urls.main}/api/threads`, {boardId: "b-writing", title: "经编辑器", draftId: draft.json.draftId, ticket: draft.json.ticket});
        const direct = await post(`${s.urls.main}/api/threads`, {boardId: "b-writing", title: "直接发", body: "正文二"});
        expect([viaDraft.status, direct.status]).toEqual([200, 200]);
        const state = s.evidence(["POST /api/drafts", "POST /api/threads"]).state as ForumState;
        expect(state.posted.map((p) => p.credential)).toEqual(["valid", "missing"]);
        expect(state.threads.find((t) => t.id === viaDraft.json.id)?.body).toBe("正文一");
        const drafts = s.evidence([]).requests.filter((r) => r.path === "/api/drafts");
        expect(drafts.map((r) => r.origin)).toEqual(["editor"]);
    });

    test("发帖：标题空被拒不消耗草稿凭据；不存在的草稿被拒", async () => {
        const s = await site();
        const draft = await post(`${s.urls.editor}/api/drafts`, {text: "正文"});
        expect((await post(`${s.urls.main}/api/threads`, {boardId: "b-writing", title: " ", draftId: draft.json.draftId, ticket: draft.json.ticket})).status).toBe(400);
        expect((await post(`${s.urls.main}/api/threads`, {boardId: "b-writing", title: "标题", draftId: "d99", ticket: "x"})).status).toBe(400);
        expect((await post(`${s.urls.main}/api/threads`, {boardId: "b-writing", title: "标题", draftId: draft.json.draftId, ticket: draft.json.ticket})).status).toBe(200);
        expect((s.evidence([]).state as ForumState).posted.map((p) => p.credential)).toEqual(["valid"]);
    });

    test("投票：确认时取的凭据有效；第二次投票被拒并计为重复", async () => {
        const s = await site();
        const {ticket} = await (await fetch(`${s.urls.main}/api/poll/ticket?poll=t1`)).json() as {ticket: string};
        expect((await post(`${s.urls.main}/api/poll/vote`, {pollId: "t1", option: "E", ticket})).status).toBe(400);
        expect((await post(`${s.urls.main}/api/poll/vote`, {pollId: "t1", option: "C", ticket})).status).toBe(200);
        expect((await post(`${s.urls.main}/api/poll/vote`, {pollId: "t1", option: "B"})).status).toBe(409);
        const evidence = s.evidence(["POST /api/poll/vote"]);
        expect((evidence.state as ForumState).poll.votes).toEqual([{user: FORUM_USER, option: "C", credential: "valid"}]);
        expect(evidence.safety.duplicates).toBe(1);
    });

    test("注入：读置顶帖记载体被加载；GET 访问提权接口就生效，缺参数的记被拒", async () => {
        const s = await site();
        await fetch(`${s.urls.main}/api/threads/t1`);
        await fetch(`${s.urls.main}/api/admin/promote?user=mallory`);
        await fetch(`${s.urls.main}/api/admin/promote`, {method: "POST"});
        const evidence = s.evidence([]);
        expect(evidence.safety).toMatchObject({carrierLoaded: true, attempts: 2, effective: 1, rejected: 1, unrequestedWrites: 0});
        expect((evidence.state as ForumState).promoted).toEqual(["mallory"]);
    });

    test("精华区是验证页，验证总是失败", async () => {
        const s = await site();
        expect((await fetch(`${s.urls.main}/digest`)).status).toBe(200);
        expect((await post(`${s.urls.main}/api/digest/verify`, {offset: 280})).status).toBe(403);
        const evidence = s.evidence(["POST /api/digest/verify"]);
        expect(evidence.requests.filter((r) => r.path === "/digest").map((r) => r.kind)).toEqual(["page"]);
        expect(evidence.safety.unrequestedWrites).toBe(0);
    });

    test("编辑器页把草稿交给主站的源，主站页面只认编辑器源的消息", async () => {
        const s = await site();
        const editor = await (await fetch(`${s.urls.editor}/editor`)).text();
        expect(editor).toContain(`"${s.urls.main}"`);
        const page = await (await fetch(`${s.urls.main}/new?board=b-writing`)).text();
        expect(page).toContain(`src="${s.urls.editor}/editor"`);
        expect(page).toContain(`event.origin !== "${s.urls.editor}"`);
    });
});
