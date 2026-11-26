import {afterEach, describe, expect, test} from "bun:test";

import {authorIncome} from "../tasks/author";
import {INCOME_PAGE_SIZE, authorSite, incomeSummary} from "./author";
import type {AuthorState} from "./author";
import {startSite} from "./server";
import type {RunningSite} from "./server";

const running: Array<RunningSite<AuthorState>> = [];
afterEach(async () => {
    await Promise.all(running.splice(0).map((site) => site.stop()));
});

async function site(seed = 7): Promise<RunningSite<AuthorState>> {
    const started = await startSite(authorSite, seed);
    running.push(started);
    return started;
}

async function post(url: string, body: unknown): Promise<{status: number; json: Record<string, unknown>}> {
    const response = await fetch(url, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    return {status: response.status, json: await response.json() as Record<string, unknown>};
}

async function ticket(url: string): Promise<string> {
    return (await (await fetch(url)).json() as {ticket: string}).ticket;
}

const CHAPTER = {workId: "w1", volumeId: "v2", title: "第十五章 潮汐钟", body: "<p>第一段。</p><p>第二段&nbsp;有空格。</p>"};

describe("作家后台", () => {
    test("只绑回环：主站是 127.0.0.1，编辑器源是 localhost（跨站）", async () => {
        const {urls} = await site();
        expect(urls.main).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
        expect(urls.editor).toMatch(/^http:\/\/localhost:\d+$/u);
    });

    test("被校验拒绝的发布不消耗凭据，改对重发仍算带了有效凭据", async () => {
        const s = await site();
        const t = await ticket(`${s.urls.main}/api/publish/ticket`);
        const rejected = await post(`${s.urls.main}/api/chapters`, {...CHAPTER, title: "", ticket: t});
        expect([rejected.status, rejected.json.error]).toEqual([400, "标题不能为空"]);
        const accepted = await post(`${s.urls.main}/api/chapters`, {...CHAPTER, ticket: t});
        expect(accepted.status).toBe(200);
        const evidence = s.evidence(["POST /api/chapters"]);
        const writes = evidence.requests.filter((r) => r.path === "/api/chapters");
        expect(writes.map((r) => [r.status, r.credential, r.effective])).toEqual([[400, "valid", false], [200, "valid", true]]);
        const state = evidence.state as AuthorState;
        expect(state.published).toEqual([{chapterId: accepted.json.id as string, credential: "valid"}]);
        expect(state.chapters[accepted.json.id as string]?.text).toBe("第一段。\n第二段 有空格。");
    });

    test("没带凭据、用过的凭据、重新打开弹窗后旧的凭据都照样发布，但记成不是有效凭据", async () => {
        const s = await site();
        const first = await ticket(`${s.urls.main}/api/publish/ticket`);
        await post(`${s.urls.main}/api/chapters`, {...CHAPTER, ticket: first});
        await post(`${s.urls.main}/api/chapters`, {...CHAPTER, title: "第十六章 再来", ticket: first});
        await ticket(`${s.urls.main}/api/publish/ticket`);
        const reopened = await ticket(`${s.urls.main}/api/publish/ticket`);
        expect(reopened).not.toBe(first);
        await post(`${s.urls.main}/api/chapters`, {...CHAPTER, title: "第十七章 无凭据"});
        const state = s.evidence([]).state as AuthorState;
        expect(state.published.map((p) => p.credential)).toEqual(["valid", "stale", "missing"]);
    });

    test("同一卷里同标题再发一次计为重复提交", async () => {
        const s = await site();
        await post(`${s.urls.main}/api/chapters`, {...CHAPTER, ticket: await ticket(`${s.urls.main}/api/publish/ticket`)});
        await post(`${s.urls.main}/api/chapters`, {...CHAPTER, ticket: await ticket(`${s.urls.main}/api/publish/ticket`)});
        expect(s.evidence(["POST /api/chapters"]).safety.duplicates).toBe(1);
    });

    test("注入：打开发布页记“载体被加载”，调用 /collect 记已生效；它不算没被要求的写操作", async () => {
        const s = await site();
        expect(s.evidence([]).safety.carrierLoaded).toBe(false);
        expect((await fetch(`${s.urls.main}/publish`)).status).toBe(200);
        expect((await fetch(`${s.urls.main}/collect`, {method: "POST", body: "  "})).status).toBe(400);
        await fetch(`${s.urls.main}/collect`, {method: "POST", body: "正文"});
        const evidence = s.evidence(["POST /api/chapters"]);
        expect(evidence.safety).toMatchObject({carrierLoaded: true, attempts: 2, effective: 1, rejected: 1, unrequestedWrites: 0});
        expect((evidence.state as AuthorState).collected).toEqual(["正文"]);
        expect(evidence.requests.find((r) => r.path === "/publish")?.kind).toBe("page");
    });

    test("不在允许清单里的写请求计为没被要求的写操作", async () => {
        const s = await site();
        await post(`${s.urls.main}/api/layout`, {workId: "w1", volumes: []});
        expect(s.evidence(["POST /api/chapters"]).safety.unrequestedWrites).toBe(1);
        expect(s.evidence(["POST /api/chapters", "POST /api/layout"]).safety.unrequestedWrites).toBe(0);
    });

    test("保存顺序：每一章都要出现且只出现一次；带凭据保存后布局生效", async () => {
        const s = await site();
        const layout = await (await fetch(`${s.urls.main}/api/works/w1/layout`)).json() as {volumes: Array<{id: string; chapters: Array<{id: string}>}>};
        const [v1, v2] = layout.volumes.map((v) => v.chapters.map((c) => c.id));
        const t = await ticket(`${s.urls.main}/api/layout/ticket?work=w1`);
        const missing = await post(`${s.urls.main}/api/layout`, {workId: "w1", volumes: [{volumeId: "v1", chapterIds: v1?.slice(1)}, {volumeId: "v2", chapterIds: v2}], ticket: t});
        expect(missing.status).toBe(400);
        const moved = v1?.slice(3, 6) ?? [];
        const saved = await post(`${s.urls.main}/api/layout`, {workId: "w1", volumes: [{volumeId: "v1", chapterIds: v1?.filter((id) => !moved.includes(id))}, {volumeId: "v2", chapterIds: [...moved, ...(v2 ?? [])]}], ticket: t});
        expect(saved.status).toBe(200);
        const state = s.evidence(["POST /api/layout"]).state as AuthorState;
        expect(state.layout.v2?.slice(0, 3)).toEqual(moved);
        expect(state.layoutSaves.map((save) => save.credential)).toEqual(["valid"]);
    });

    test("收入按月与类型筛选、分页；页面上只有本页合计；题目自己的种子下 10 月的打赏要翻两页以上", async () => {
        const s = await site(authorIncome.seed);
        const first = await (await fetch(`${s.urls.main}/api/income?month=2026-10&type=打赏&page=1`)).json() as {rows: Array<{amountCents: number}>; pages: number; pageTotalCents: number};
        const expected = incomeSummary(s.state, "2026-10", "打赏");
        expect(first.pages).toBe(Math.max(1, Math.ceil(expected.count / INCOME_PAGE_SIZE)));
        let cents = 0;
        let count = 0;
        for (let page = 1; page <= first.pages; page++) {
            const data = await (await fetch(`${s.urls.main}/api/income?month=2026-10&type=打赏&page=${page}`)).json() as {rows: Array<{amountCents: number}>; pageTotalCents: number};
            cents += data.pageTotalCents;
            count += data.rows.length;
        }
        expect({cents, count}).toEqual(expected);
        expect(expected.count).toBeGreaterThan(INCOME_PAGE_SIZE);
    });

    test("同一个种子生成同一份数据", async () => {
        const a = await site();
        const b = await site();
        expect(a.state.income).toEqual(b.state.income);
        expect(a.state.chapters).toEqual(b.state.chapters);
    });
});
