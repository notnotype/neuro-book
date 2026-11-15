/**
 * “模型请求”页的状态（docs/specs/agent/request-trace.md 输出 13、15、18、26 与“时序与寿命”）：真实服务端、真实远程链路
 * （窗口的 `nbook.agent/requests` 客户端），本机 OpenAI 兼容端点。测页面的状态怎样跟着记录变：先订阅再取列表、新请求插到
 * 顶上、结算原地换、命令带的会话与请求序号、按需取全文与原始请求体。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";
import {RequestsPage} from "./web/requests-page";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
const releases: (() => void)[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "requests-page");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    for (const release of releases.splice(0)) release();
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `c-${String((commands += 1))}`;

async function open(): Promise<{readonly w: AgentWorld; readonly page: RequestsPage; readonly reports: string[]}> {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(w);
    const {requests} = await w.window("page");
    const reports: string[] = [];
    return {w, page: new RequestsPage(requests, (code) => reports.push(code)), reports};
}

async function say(w: AgentWorld, text: string, session?: SessionApi): Promise<SessionApi> {
    let target = session;
    if (target === undefined) {
        const created = await w.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(`create failed: ${created.code}`);
        target = created.value;
    }
    const sent = await target.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await target.waitRun(sent.value.runId);
    return target;
}

const settledRows = (page: RequestsPage, count: number) => waitUntil(`列表里有 ${String(count)} 条已结束的记录`, () => page.rows.value.length === count && page.rows.value.every((row) => row.status !== "running"));

describe("“模型请求”页的状态", () => {
    test("输出 18：打开时选中最新的一条；页面开着时来了新请求插到顶上，结算之后原地换", async () => {
        const {w, page} = await open();
        endpoint.script("一", "二");
        const session = await say(w, "第一句");
        releases.push(page.borrow());
        await settledRows(page, 1);
        const first = page.rows.value[0]!;
        await waitUntil("选中最新的一条并读到详情", () => page.detail.value.state === "ready" && page.selected.value === first.id);

        const hold = endpoint.hold();
        const running = say(w, "第二句", session);
        await hold.arrived;
        await waitUntil("新请求插到顶上，状态是进行中", () => page.rows.value.length === 2 && page.rows.value[0]?.status === "running");
        expect(page.rows.value[1]?.id).toBe(first.id);
        // 选中不因为来了新请求而改变（输出 15）。
        expect(page.selected.value).toBe(first.id);
        hold.release();
        await running;
        await waitUntil("结算之后原地换成成功", () => page.rows.value[0]?.status === "ok");
        expect(page.rows.value.map((row) => row.request)).toEqual([2, 1]);
    });

    test("输出 26：命令带会话时只看它、带序号时选中那一次；那一次没有记录时写没有", async () => {
        const {w, page} = await open();
        endpoint.script("一", "二", "别的");
        const session = await say(w, "第一句");
        await say(w, "第二句", session);
        await say(w, "别的会话");
        const id = (await session.snapshot()).header.id;
        releases.push(page.borrow());
        await settledRows(page, 3);

        await page.open({sessionId: id, request: 1});
        await waitUntil("只看这个会话、选中第 1 次", () => page.rows.value.length === 2 && page.detail.value.state === "ready" && page.detail.value.value.request === 1);
        expect(page.query.value.sessions).toEqual([id]);
        await page.open({sessionId: id, request: 99});
        expect(page.detail.value.state).toBe("missing");
    });

    test("输出 19、21：详情带着前一次与相同的消息前缀；比较页拿前一次来比，换了选中就清掉", async () => {
        const {w, page} = await open();
        endpoint.script("一", "二");
        const session = await say(w, "第一句");
        await say(w, "第二句", session);
        releases.push(page.borrow());
        await settledRows(page, 2);
        await waitUntil("选中最新的一条", () => page.detail.value.state === "ready" && page.detail.value.value.request === 2);
        const latest = page.detail.value.state === "ready" ? page.detail.value.value : null;
        // 第二次请求的消息是第一次的全部加上回复与第二句。
        expect(latest?.previous).toMatchObject({request: 1, sharedPrefix: 1});
        await page.compareWith(latest?.previous?.id ?? "");
        expect(page.compare.value.detail.state === "ready" ? page.compare.value.detail.value.request : null).toBe(1);
        page.select(page.rows.value[1]!.id);
        expect(page.compare.value).toEqual({base: null, detail: {state: "idle"}});
    });

    test("输出 17、20：查找词换掉列表、选中时取这一条的命中；清掉查找词回到普通列表", async () => {
        const {w, page} = await open();
        endpoint.script("雾港在第三章。", "别的。");
        await say(w, "讲讲雾港");
        await say(w, "说点别的");
        releases.push(page.borrow());
        await settledRows(page, 2);
        page.setSearch("雾港");
        await waitUntil("查找结束", () => page.searchState.value.state === "done");
        expect(page.rows.value.map((row) => row.match?.count)).toEqual([2]);
        page.select(page.rows.value[0]!.id);
        await waitUntil("取到命中", () => page.hits.value !== null);
        expect(page.hits.value).toHaveLength(2);
        page.setSearch("");
        await waitUntil("回到普通列表", () => page.rows.value.length === 2 && page.list.value.state === "ready");
        expect(page.searchState.value.state).toBe("idle");
    });

    test("全文与原始请求体按需要取，读回来的是存下的原文", async () => {
        const {w, page} = await open();
        endpoint.script("好的");
        await say(w, "看看第三章");
        releases.push(page.borrow());
        await settledRows(page, 1);
        await waitUntil("详情读到", () => page.detail.value.state === "ready");
        const detail = page.detail.value.state === "ready" ? page.detail.value.value : null;
        const hash = detail?.messages.find((message) => message.role === "user")?.hash ?? "";
        await page.loadContent(hash);
        const content = page.contents.value[hash];
        expect(content?.state).toBe("ready");
        expect(content?.state === "ready" ? JSON.parse(content.text) : null).toMatchObject({role: "user"});
        await page.loadPayload(detail?.id ?? "");
        expect(page.payload.value.state === "ready" ? page.payload.value.text : "").toContain("看看第三章");
    });
});
