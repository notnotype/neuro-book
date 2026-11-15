/**
 * 远程服务 `nbook.agent/requests`（docs/specs/agent/request-trace.md）：真实服务端内核、真实设置与模型服务，模型是本机的 OpenAI
 * 兼容端点，窗口经 JSON 编解码的链路调用。记录器自己的写入、折叠与清理规则由 nb-harness 的 `kit/requests/recorder.test.ts` 测，
 * 这里测接线（经会话发出的请求都进记录）、服务端补的会话标题与后台会话的所属、分段读与失败码、设置与按天清理。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {titleSessionId} from "@notnotype/nb-harness/kit/sessions";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import type {RequestChangeView, RequestRowView} from "./shared/requests";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld, RequestsClient} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "requests");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const DAY = 24 * 60 * 60 * 1000;
let commands = 0;
const cid = () => `c-${String((commands += 1))}`;

async function world(userSettings: Record<string, unknown> = {}): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), ...userSettings}});
    worlds.push(created);
    return created;
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

function ok<T>(result: {readonly ok: true; readonly value: T} | {readonly ok: false; readonly code: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${result.code}`);
    return result.value;
}

/** 记录在请求结束后排队写完：等到这个会话有 `count` 条已结束的记录。 */
async function settledRows(requests: RequestsClient, session: string, count: number): Promise<readonly RequestRowView[]> {
    return waitUntil(`会话 ${session} 有 ${String(count)} 条已结束的记录`, async () => {
        const rows = ok(await requests.list({sessions: [session]})).rows;
        return rows.filter((row) => row.status !== "running").length >= count ? rows : null;
    });
}

/** 分段读回一段全文。 */
async function readAll(read: (index: number) => Promise<{readonly ok: true; readonly value: {readonly text: string; readonly last: boolean}} | {readonly ok: false; readonly code: string}>): Promise<string> {
    let text = "";
    for (let index = 0; ; index += 1) {
        const chunk = ok(await read(index));
        text += chunk.text;
        if (chunk.last) return text;
    }
}

/** 标题 Profile 用 `tiny` 角色：绑到同一个本机端点，标题会话才真的发请求。 */
const withTitles = (): Record<string, unknown> => ({
    "nbook.models/roles": {items: ["tiny", "fast", "main", "deep", "compaction"].map((id) => ({id, axis: id === "compaction" ? "specialist" : "gradient", name: "", description: "", model: id === "tiny" || id === "main" ? "local/m" : null}))},
});

describe("记录", () => {
    test("输出 1、2、14：一轮带一次工具调用的对话有两条记录，同一轮；后台标题会话的请求归到它所属的会话", async () => {
        const w = await world(withTitles());
        const {requests} = await w.window("trace");
        // 两次对话请求，然后是这一轮结束后标题会话的那一次。
        endpoint.script({tool: "builtin.read", args: {path: "session://没有.md"}}, "读不到。", {tool: "yield", args: {title: "雨夜", description: "说明"}});
        const session = await say(w, "看看这个文件");
        const id = (await session.snapshot()).header.id;

        const rows = await waitUntil("标题会话的请求结束、标题写下", async () => {
            const listed = ok(await requests.list({sessions: [id]})).rows;
            return listed.length === 3 && listed.every((row) => row.status !== "running" && row.title === "雨夜") ? listed : null;
        });
        const background = rows.filter((row) => row.session === titleSessionId(id));
        expect(background.map((row) => [row.purpose, row.background])).toEqual([["turn", {owner: id}]]);
        const own = rows.filter((row) => row.session === id);
        expect(own.map((row) => [row.request, row.purpose, row.status, row.turn?.index, row.turn?.input])).toEqual([[2, "turn", "ok", 1, "看看这个文件"], [1, "turn", "ok", 1, "看看这个文件"]]);
        expect(own[0]?.turn?.id).toBe(own[1]?.turn?.id);
        expect(own.every((row) => row.http === 200 && row.attempts === 1)).toBe(true);

        const second = ok(await requests.read({id: own[0]?.id ?? ""}));
        expect(second.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
        expect(second.messages[1]?.toolCalls?.map((call) => call.tool)).toEqual(["builtin.read"]);
        expect(second.messages[2]?.isError).toBe(true);
        expect(second.reply?.preview).toBe("读不到。");
        expect(second.profile).toBe(MAIN_PROFILE);
        expect(second.messagesNext).toBeNull();
        expect(JSON.parse(await readAll((index) => requests.content({hash: second.messages[0]?.hash ?? "", index})))).toMatchObject({role: "user"});
        expect(await readAll((index) => requests.payload({id: own[0]?.id ?? "", index}))).toContain("看看这个文件");
        expect(ok(await requests.find({session: id, request: 2})).id).toBe(own[0]?.id);

        // 会话的候选里，标题会话的条数并进它所属的会话；清空这个会话连它的后台请求一起。
        expect(ok(await requests.list({})).facets.sessions).toEqual([{id, count: 3, title: "雨夜"}]);
        expect(ok(await requests.clear({session: id})).removed).toBe(3);
    });

    test("输出 10：关掉记录时请求照常，不记", async () => {
        const w = await world({"nbook.agent/requestTrace": false});
        const {requests} = await w.window("off");
        endpoint.script("好的");
        const session = await say(w, "你好");
        expect((await session.log({afterSeq: 0})).events.some((event) => event.type === "assistant")).toBe(true);
        expect(ok(await requests.list({})).rows).toEqual([]);
        expect(ok(await requests.usage({})).payloadBytes).toBe(0);
    });

    test("输出 11：之后每天清理一次，超过保留天数的记录删掉并推“删掉”", async () => {
        const w = await world({"nbook.agent/requestTraceDays": 1});
        const {requests} = await w.window("sweep");
        const changes: RequestChangeView[] = [];
        const subscription = ok(await requests.events.changed.subscribe({}, (change) => changes.push(change)));
        try {
            endpoint.script("好的");
            const id = (await (await say(w, "旧的")).snapshot()).header.id;
            const [row] = await settledRows(requests, id, 1);
            w.settings.clock.advance(3 * DAY);
            await waitUntil("清理推了删掉", () => changes.some((change) => change.kind === "removed"));
            expect(ok(await requests.list({})).rows.filter((item) => item.session === id)).toEqual([]);
            expect(changes.filter((change) => change.kind === "removed").flatMap((change) => (change.kind === "removed" ? change.ids : []))).toContain(row?.id);
            const kinds = changes.map((change) => change.kind);
            expect(kinds.indexOf("added")).toBeLessThan(kinds.indexOf("settled"));
            expect(changes.map((change) => change.seq)).toEqual([...changes.map((change) => change.seq)].sort((a, b) => a - b));
        } finally {
            subscription.release();
        }
    });
});

describe("查看", () => {
    test("输出 25：清空一个会话连同它的后台请求，别的会话不动", async () => {
        const w = await world();
        const {requests} = await w.window("clear");
        endpoint.script("一", "二");
        const first = (await (await say(w, "第一个会话")).snapshot()).header.id;
        const second = (await (await say(w, "第二个会话")).snapshot()).header.id;
        await settledRows(requests, first, 1);
        await settledRows(requests, second, 1);

        expect(ok(await requests.clear({session: first})).removed).toBeGreaterThanOrEqual(1);
        const left = ok(await requests.list({})).rows;
        expect(left.some((row) => row.session === first || row.background?.owner === first)).toBe(false);
        expect(left.some((row) => row.session === second)).toBe(true);
        expect(ok(await requests.clear({})).removed).toBe(left.length);
        expect(ok(await requests.list({})).rows).toEqual([]);
    });

    test("失败码：没有记录、内容、请求体，段号越界，游标认不出", async () => {
        const w = await world();
        const {requests} = await w.window("errors");
        endpoint.script("好的");
        const id = (await (await say(w, "一句")).snapshot()).header.id;
        const [row] = await settledRows(requests, id, 1);
        const missing = "00000000-0000-4000-8000-000000000000";
        expect(await requests.read({id: missing})).toMatchObject({ok: false, code: "request-not-found"});
        expect(await requests.messages({id: missing, from: 0})).toMatchObject({ok: false, code: "request-not-found"});
        expect(await requests.find({session: id, request: 99})).toMatchObject({ok: false, code: "request-not-found"});
        expect(await requests.content({hash: "0".repeat(64), index: 0})).toMatchObject({ok: false, code: "content-not-found"});
        expect(await requests.payload({id: missing, index: 0})).toMatchObject({ok: false, code: "payload-not-found"});
        expect(await requests.payload({id: row?.id ?? "", index: 99})).toMatchObject({ok: false, code: "out-of-range"});
        expect(await requests.list({cursor: "not-a-cursor"})).toMatchObject({ok: false, code: "invalid-cursor"});
    });
});
