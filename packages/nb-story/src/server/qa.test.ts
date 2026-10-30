/**
 * 独立服务里的网页问答与设置（docs/specs/story/qa.md 的“网页”）：真实的 `serve` 进程、HTTP 与推送，模型是本机的
 * OpenAI 兼容端点。推送按浏览器的读法读（fetch 加 eventsource-parser，同问答页）。
 *
 * 服务读默认位置的配置：子进程的 XDG_CONFIG_HOME 指向用例自己的目录。密钥是测试里编的假值，只发往本机端点；每个
 * 用例都扫一遍收到的全部响应与帧里没有它。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {connect} from "node:net";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {createParser} from "eventsource-parser";

import type {QaFrame, QaRunView} from "../contract/contract";
import {createStoryApi} from "../core/api";
import {QaRecords} from "../core/qa-records";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI, loginCookie, rpc, startServe, type ServeProcess} from "../../testing/processes";
import {makeSampleRoot} from "../../testing/sample";
import {createServeAuth} from "./auth";
import {createHandler, EVENTS_BACKLOG_BYTES} from "./http";
import type {IngestService} from "./ingest-service";
import type {QaService} from "./qa-service";

const KEY_ENV = "NBSTORY_SERVE_QA_TEST_CREDENTIAL";
const FAKE_KEY = "fake-serve-qa-credential-0042";

let root = "";
let sampleFile = "";
let counter = 0;
const cleanups: (() => Promise<unknown> | unknown)[] = [];

beforeAll(async () => {
    const sample = await makeSampleRoot("serve-qa");
    root = sample.root;
    sampleFile = sample.file;
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const READ_THEN_ANSWER: EndpointReply[] = [
    {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}]},
    {kind: "tools", calls: [{name: "answer", args: {conclusion: "读者在 37.8 知道了", conclusionType: "明说", explanation: "旁白点破", evidence: ["37.8"], coverage: "第 37 章"}}]},
];
const GIVE_UP: EndpointReply = {kind: "tools", calls: [{name: "answer", args: {conclusion: "说不准", conclusionType: "无法确定", explanation: "没读", evidence: [], coverage: "无"}}]};

/** 等 `release()` 之后才照 `reply` 回复。 */
function held(reply: EndpointReply): {reply: EndpointReply; release(): void} {
    let release!: () => void;
    const ready = new Promise<void>(resolve => (release = resolve));
    return {reply: {kind: "after", ready, reply}, release};
}

interface Env {
    library: string;
    configFile: string;
    endpoint: Endpoint;
    serve: ServeProcess;
    /** 收到的全部响应正文与帧，用例结束时扫密钥。 */
    seen: string[];
    cookie: string;
    call(method: string, params: unknown): Promise<{status: number; body: any}>;
    events(conversation: string): Stream;
}

interface Stream {
    frames: QaFrame[];
    /** 已经读到的字节数。 */
    bytes(): number;
    /** 流结束（服务端关掉）时 resolve。 */
    closed: Promise<void>;
    abort(): void;
}

async function setup(replies: EndpointReply[], options: {config?: unknown; endpointIdleTimeout?: number} = {}): Promise<Env> {
    counter += 1;
    const dir = join(root, `case-${counter}`);
    const configHome = join(dir, "xdg");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    const endpoint = startEndpoint(replies, options.endpointIdleTimeout === undefined ? {} : {idleTimeoutSeconds: options.endpointIdleTimeout});
    cleanups.push(() => endpoint.stop());
    const configFile = join(configHome, "nbstory", "config.json");
    if (options.config !== null) await writeFile(configFile, JSON.stringify(options.config ?? {model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}}));
    const library = join(dir, "library");
    const imported = await createStoryApi({library}).call("book.import", {file: sampleFile, title: "样例", id: "fox"});
    if (!imported.ok) throw new Error(imported.error.message);
    const serve = await startServe(library, {XDG_CONFIG_HOME: configHome, [KEY_ENV]: FAKE_KEY});
    cleanups.push(() => serve.stop("SIGKILL"));
    const cookie = await loginCookie(serve.login!);
    const seen: string[] = [];
    cleanups.push(() => {
        for (const text of seen) expect(text).not.toContain(FAKE_KEY);
    });
    return {
        library,
        configFile,
        endpoint,
        serve,
        seen,
        cookie,
        async call(method, params) {
            const result = await rpc(serve.base!, method, params, cookie);
            seen.push(JSON.stringify(result.body));
            return result;
        },
        events(conversation) {
            const frames: QaFrame[] = [];
            let bytes = 0;
            const controller = new AbortController();
            const closed = (async () => {
                const response = await fetch(`${serve.base}/api/qa/events?book=fox&conversation=${conversation}`, {headers: {cookie}, signal: controller.signal});
                expect(response.headers.get("content-type")).toContain("text/event-stream");
                const parser = createParser({
                    onEvent: event => {
                        seen.push(event.data);
                        frames.push(JSON.parse(event.data) as QaFrame);
                    },
                });
                const decoder = new TextDecoder();
                for await (const chunk of response.body!) {
                    bytes += chunk.byteLength;
                    parser.feed(decoder.decode(chunk, {stream: true}));
                }
            })().catch((error: unknown) => {
                if (!controller.signal.aborted) throw error;
            });
            return {frames, bytes: () => bytes, closed, abort: () => controller.abort()};
        },
    };
}

const code = (result: {body: any}) => (result.body as {code?: string}).code;

async function qaFiles(library: string): Promise<string[]> {
    return (await readdir(join(library, "fox", "qa")).catch(() => [] as string[])).sort();
}

describe("一轮问答在服务里跑，进展经推送到页面", () => {
    test("开始后订阅：先一帧快照，再按顺序是日志与事件，最后是结束帧；结束后的记录与推送的日志一致", async () => {
        const gate = held(READ_THEN_ANSWER[0]!);
        const env = await setup([gate.reply, READ_THEN_ANSWER[1]!]);
        const started = await env.call("qa.start", {book: "fox", question: "地狱猫是谁？", at: {chapter: 38}});
        expect(started.status).toBe(200);
        const {conversation, runId, turn} = started.body as {conversation: string; runId: string; turn: number};
        expect(turn).toBe(1);
        const stream = env.events(conversation);
        await waitUntil("收到快照", () => stream.frames.length > 0);
        gate.release();
        await stream.closed;

        const [snapshot, ...rest] = stream.frames;
        expect(snapshot).toMatchObject({type: "snapshot", run: {runId, conversation, turn: 1, baseTurns: 0, logFrom: 1, state: "running", result: null, saved: null}});
        const ended = rest.at(-1)!;
        expect(ended).toMatchObject({type: "ended", run: {runId, state: "ended", saved: {ok: true}, result: {status: "answered", answer: {evidence: ["37.8"]}}}});
        expect(rest.slice(0, -1).every(frame => (frame.type === "log" || frame.type === "event") && frame.runId === runId)).toBe(true);
        expect(rest.some(frame => frame.type === "event" && (frame.event as {type: string}).type === "tool_execution_end")).toBe(true);
        // 合并的 message_update 不越过结算：最后一帧更新在 agent_end 之前，且不在它所属消息的日志之后。
        const eventType = (frame: QaFrame) => (frame.type === "event" ? (frame.event as {type: string}).type : frame.type);
        expect(rest.findLastIndex(frame => eventType(frame) === "message_update")).toBeLessThan(rest.findIndex(frame => eventType(frame) === "agent_end"));

        // 快照里已有的条目加上之后的日志帧，正好是存下来的日志：页面据此拼出完整的这一轮。
        const pushed = [...((snapshot as Extract<QaFrame, {type: "snapshot"}>).entries as {seq: number}[]), ...rest.flatMap(frame => (frame.type === "log" ? (frame.entries as {seq: number}[]) : []))].map(entry => entry.seq);
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        expect(got.status).toBe(200);
        expect(got.body).toMatchObject({record: {id: conversation, turns: [{status: "answered", logFrom: 1}]}, log: {ok: true}, continuable: {ok: true}, run: {runId, state: "ended"}});
        expect(pushed).toEqual((got.body.log.entries as {seq: number}[]).map(entry => entry.seq));

        const listed = await env.call("qa.list", {book: "fox"});
        expect(listed.body).toMatchObject({conversations: [{id: conversation, question: "地狱猫是谁？", turns: 1, status: "answered", run: {runId, state: "ended", saved: true}}], broken: []});
    });

    test("设了阅读位置：推送的帧与 qa.get 的日志里没有位置之前搜不到的词，存下的日志照原样（issue 265）", async () => {
        const later = "夏桃桃";
        const env = await setup([
            {kind: "tools", calls: [{name: "search", args: {query: later}}, {name: "card", args: {entity: later}}]},
            READ_THEN_ANSWER[0]!,
            READ_THEN_ANSWER[1]!,
        ]);
        const started = await env.call("qa.start", {book: "fox", question: "夏桃桃是谁？", at: {chapter: 38}});
        const {conversation} = started.body as {conversation: string};
        const stream = env.events(conversation);
        await stream.closed;
        const pushed = JSON.stringify(stream.frames);
        // 问题文字是用户自己写的，不算；模型的调用与结果里不能有。
        expect(pushed.replaceAll("夏桃桃是谁？", "")).not.toContain(later);
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        expect(JSON.stringify(got.body.log.entries).replaceAll("夏桃桃是谁？", "")).not.toContain(later);
        const api = createStoryApi({library: env.library});
        const stored = await new QaRecords(api.library, "fox").getWithLog(conversation, (await api.openBook("fox")).generation);
        expect(stored.log.ok && stored.log.jsonl.includes(`"query":"${later}"`)).toBe(true);
    });

    test("推送的流比 Bun 默认的 10 秒空闲超时活得久：模型 12 秒才回，结束帧照样送到", async () => {
        const gate = held(GIVE_UP);
        const env = await setup([gate.reply], {endpointIdleTimeout: 0});
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "慢问题", at: {chapter: 38}})).body as {conversation: string};
        const stream = env.events(conversation);
        await waitUntil("收到快照", () => stream.frames.length > 0);
        await Bun.sleep(12_000);
        gate.release();
        await stream.closed;
        expect(stream.frames.at(-1)).toMatchObject({type: "ended", run: {saved: {ok: true}, result: {status: "answered"}}});
    }, 30_000);

    test("没有运行时订阅：只有一帧空快照，流随即结束", async () => {
        const env = await setup([]);
        const stream = env.events("20261023000000000-abcdef");
        await stream.closed;
        expect(stream.frames).toEqual([{type: "snapshot", run: null, entries: []}]);
    });

    test("同一个对话同时只跑一轮：再开始得到 qa_busy；停下的一轮记为中断并保存，之后可以续问", async () => {
        const env = await setup([{kind: "hang"}, GIVE_UP]);
        const first = await env.call("qa.start", {book: "fox", question: "第一问", at: {chapter: 38}});
        const {conversation} = first.body as {conversation: string};
        await env.endpoint.firstRequest;
        const again = await env.call("qa.start", {book: "fox", question: "第二问", conversation});
        expect(again.status).toBe(409);
        expect(code(again)).toBe("qa_busy");

        const stream = env.events(conversation);
        expect((await env.call("qa.stop", {book: "fox", conversation})).status).toBe(200);
        await stream.closed;
        expect(stream.frames.at(-1)).toMatchObject({type: "ended", run: {state: "ended", saved: {ok: true}, result: {status: "interrupted"}}});

        const next = await env.call("qa.start", {book: "fox", question: "第二问", conversation});
        expect(next.body).toMatchObject({conversation, turn: 2});
        await waitUntil("第二轮结束", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView}).run.state === "ended");
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        expect(got.body).toMatchObject({record: {turns: [{status: "interrupted"}, {status: "answered", question: "第二问"}]}, run: {turn: 2, baseTurns: 1}});
        expect(got.body.record.turns[1].logFrom).toBe(got.body.run.logFrom);
    });

    test("对话中途改阅读位置（t25）：运行中是 qa_busy；结束后 qa.position 写进提醒、列表给 currentAt 与 highestAt；位置往回调后最高位置不降；全读对话 qa_position_fixed；续问带 at 先改位置", async () => {
        // 第一轮的回复闸住，保证 qa.position 到达时它还在运行。
        const gate = held({kind: "text", text: "第一轮"});
        const env = await setup([gate.reply, GIVE_UP, GIVE_UP]);
        const first = await env.call("qa.start", {book: "fox", question: "第一问", at: {chapter: 38}});
        const {conversation} = first.body as {conversation: string};
        const during = await env.call("qa.position", {book: "fox", conversation, at: {chapter: 30}});
        expect(during.status).toBe(409);
        expect(code(during)).toBe("qa_busy");
        gate.release();
        await waitUntil("第一轮结束", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView}).run.state === "ended");

        const changed = await env.call("qa.position", {book: "fox", conversation, at: {chapter: 30}});
        expect(changed.status).toBe(200);
        expect(changed.body).toMatchObject({changed: true, at: {chapter: 30}});
        const row = ((await env.call("qa.list", {book: "fox"})).body as {conversations: {id: string; at: {chapter: number}; currentAt: {chapter: number}; highestAt: {chapter: number}}[]}).conversations.find(item => item.id === conversation)!;
        // 对话在第 38 章开始，位置往回调到 30：当前位置 30，整个对话出现过的最高位置仍是 38。
        expect(row).toMatchObject({at: {chapter: 38}, currentAt: {chapter: 30}, highestAt: {chapter: 38}});
        expect((await env.call("qa.position", {book: "fox", conversation, at: {chapter: 30}})).body).toMatchObject({changed: false});
        // qa.get 的日志里有提醒消息与紧跟的 qa.position meta（网页靠它认出提醒）。
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        const kinds = (got.body.log.entries as {kind: string; key?: string}[]).slice(-2).map(entry => [entry.kind, entry.key]);
        expect(kinds).toEqual([["agent_message", undefined], ["meta", "qa.position"]]);
        expect(got.body.record).toMatchObject({currentAt: {chapter: 30}, positionChanges: 1});

        // 续问带 at：先改位置再运行；全读对话改位置是 qa_position_fixed。
        const next = await env.call("qa.start", {book: "fox", question: "第二问", conversation, at: {chapter: 35}});
        expect(next.status).toBe(200);
        await waitUntil("第二轮结束", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView}).run.state === "ended");
        expect((await env.call("qa.get", {book: "fox", id: conversation})).body.record).toMatchObject({positionChanges: 2, currentAt: {chapter: 35}});
        const full = await env.call("qa.start", {book: "fox", question: "全读", at: {chapter: 38}, mode: "full"});
        const fullId = (full.body as {conversation: string}).conversation;
        await waitUntil("全读结束", async () => ((await env.call("qa.get", {book: "fox", id: fullId})).body as {run: QaRunView}).run.state === "ended");
        const fixed = await env.call("qa.position", {book: "fox", conversation: fullId, at: {chapter: 20}});
        expect(fixed.status).toBe(409);
        expect(code(fixed)).toBe("qa_position_fixed");
    }, 60_000);

    test("开始前的错误作为请求的错误返回，不留下运行：没配置、续问的对话不存在、位置超出", async () => {
        const env = await setup([], {config: null});
        const unconfigured = await env.call("qa.start", {book: "fox", question: "问", at: {chapter: 38}});
        expect(unconfigured.status).toBe(400);
        expect(code(unconfigured)).toBe("qa_unconfigured");
        await writeFile(env.configFile, JSON.stringify({model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}}));
        const missing = await env.call("qa.start", {book: "fox", question: "问", conversation: "20261023000000000-abcdef"});
        expect(code(missing)).toBe("qa_record_not_found");
        const beyond = await env.call("qa.start", {book: "fox", question: "问", at: {chapter: 999}});
        expect(code(beyond)).toBe("position_out_of_range");
        expect((await env.call("qa.list", {book: "fox"})).body).toEqual({conversations: [], broken: []});
        expect(env.endpoint.bodies).toHaveLength(0);
    });

    test("全读的对话：页面拿到的日志（qa.get、推送的快照与日志帧）里没有原文，只有问题与段数；存下的日志照旧带原文（续问要交回模型）", async () => {
        const gate = held(GIVE_UP);
        const env = await setup([gate.reply]);
        const started = await env.call("qa.start", {book: "fox", question: "全读的问题", at: {chapter: 2, paragraph: 3}, mode: "full"});
        expect(started.status).toBe(200);
        const {conversation} = started.body as {conversation: string};
        const stream = env.events(conversation);
        await waitUntil("收到快照", () => stream.frames.length > 0);
        gate.release();
        await stream.closed;
        expect(JSON.stringify(stream.frames)).toContain("全读的问题");
        expect(JSON.stringify(stream.frames)).not.toContain("以下是阅读位置以前的全部原文");
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        const firstUser = (got.body.log.entries as {kind: string; message?: {role: string; content: {text: string}[]}}[]).find(entry => entry.kind === "agent_message" && entry.message?.role === "user")!;
        expect(firstUser.message!.content[0]!.text).toMatch(/^全读的问题\n\n（已附阅读位置以前的全部原文，共 \d+ 段，这里不显示）$/u);
        const stored = (await Promise.all((await qaFiles(env.library)).filter(name => name.endsWith(".session.jsonl")).map(name => readFile(join(env.library, "fox", "qa", name), "utf8")))).join("");
        expect(stored).toContain("以下是阅读位置以前的全部原文");
        expect(JSON.stringify(got.body)).not.toContain("以下是阅读位置以前的全部原文");
    });
});

describe("没保存的一轮与别的一代", () => {
    test("首轮写不进去：结果留在服务里，qa.get 没有记录、给出这一轮与没保存的原因，列表里照样有它", async () => {
        const env = await setup([GIVE_UP]);
        // qa 目录只读：写会话日志时报 EACCES（列目录照常）。
        const qaDir = join(env.library, "fox", "qa");
        await mkdir(qaDir);
        await chmod(qaDir, 0o555);
        cleanups.push(() => chmod(qaDir, 0o755));
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "写不进去", at: {chapter: 38}})).body as {conversation: string};
        await waitUntil("结束", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView | null}).run?.state === "ended");
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        expect(got.body).toMatchObject({record: null, continuable: {ok: false}, run: {state: "ended", saved: {ok: false, reason: "write_failed"}, result: {status: "answered"}}});
        expect((await env.call("qa.list", {book: "fox"})).body.conversations).toMatchObject([{id: conversation, turns: 0, status: "answered", run: {state: "ended", saved: false}}]);
        const stream = env.events(conversation);
        await stream.closed;
        expect(stream.frames).toMatchObject([{type: "snapshot", run: {saved: {ok: false}}}]);
        expect((stream.frames[0] as Extract<QaFrame, {type: "snapshot"}>).entries.length).toBeGreaterThan(0);
    });

    test("命令行在网页这一轮期间先续问并保存：网页这一轮报冲突、不保存，记录是命令行写的两轮", async () => {
        const env = await setup([GIVE_UP, GIVE_UP]);
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "第一问", at: {chapter: 38}})).body as {conversation: string};
        await waitUntil("第一轮保存", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {record: unknown}).record !== null);
        const gate = held(GIVE_UP);
        await env.endpoint.stop();
        const webEndpoint = startEndpoint([gate.reply], {idleTimeoutSeconds: 0});
        cleanups.push(() => webEndpoint.stop());
        await writeFile(env.configFile, JSON.stringify({model: {baseUrl: webEndpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}}));
        expect((await env.call("qa.start", {book: "fox", question: "网页的第二问", conversation})).status).toBe(200);
        await webEndpoint.firstRequest;

        const cliEndpoint = startEndpoint([GIVE_UP]);
        cleanups.push(() => cliEndpoint.stop());
        const cliConfig = join(env.library, "..", "cli-config.json");
        await writeFile(cliConfig, JSON.stringify({model: {baseUrl: cliEndpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}}));
        const cli = Bun.spawn(["bun", CLI, "ask", "命令行的第二问", "--continue", conversation, "--config", cliConfig, "--library", env.library], {stdout: "pipe", stderr: "pipe", env: {...process.env, [KEY_ENV]: FAKE_KEY}});
        expect(await cli.exited).toBe(0);

        gate.release();
        await waitUntil("网页这一轮结束", async () => ((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView | null}).run?.state === "ended");
        const got = await env.call("qa.get", {book: "fox", id: conversation});
        expect(got.body).toMatchObject({run: {turn: 2, baseTurns: 1, saved: {ok: false, reason: "conflict"}}});
        expect((got.body.record.turns as {question: string}[]).map(turn => turn.question)).toEqual(["第一问", "命令行的第二问"]);
    });
});

describe("删除", () => {
    test("首轮运行中删除对话：先停下、等它收口，再删；列表里没有它，磁盘上也没有它的文件", async () => {
        const env = await setup([{kind: "hang"}]);
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "要删的", at: {chapter: 38}})).body as {conversation: string};
        await env.endpoint.firstRequest;
        expect((await env.call("qa.list", {book: "fox"})).body.conversations).toMatchObject([{id: conversation, turns: 0, status: null, run: {state: "running"}}]);
        const removed = await env.call("qa.remove", {book: "fox", id: conversation});
        expect(removed.status).toBe(200);
        expect((await env.call("qa.list", {book: "fox"})).body).toEqual({conversations: [], broken: []});
        expect(await qaFiles(env.library)).toEqual([]);
        expect(code(await env.call("qa.get", {book: "fox", id: conversation}))).toBe("qa_record_not_found");
        expect(code(await env.call("qa.remove", {book: "fox", id: conversation}))).toBe("qa_record_not_found");
    });

    test("运行中删除书：问答先停下、保存完，书再删掉", async () => {
        const env = await setup([{kind: "hang"}]);
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "问", at: {chapter: 38}})).body as {conversation: string};
        await env.endpoint.firstRequest;
        const stream = env.events(conversation);
        expect((await env.call("book.remove", {book: "fox"})).status).toBe(200);
        await stream.closed;
        // 删书先等这一轮停下并保存完，再删书目录（记录随书一起删掉）。
        expect(stream.frames.at(-1)).toMatchObject({type: "ended", run: {result: {status: "interrupted"}, saved: {ok: true}}});
        expect(code(await env.call("qa.list", {book: "fox"}))).toBe("book_not_found");
    });

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
        test(`运行中停服务（${signal}）：这一轮先停下、保存为中断，撤销登记，服务再以 0 退出`, async () => {
            const env = await setup([{kind: "hang"}]);
            const {conversation} = (await env.call("qa.start", {book: "fox", question: "停服务", at: {chapter: 38}})).body as {conversation: string};
            await env.endpoint.firstRequest;
            expect(await env.serve.stop(signal)).toBe(0);
            const record = JSON.parse(await readFile(join(env.library, "fox", "qa", `${conversation}.json`), "utf8")) as {turns: {status: string}[]};
            expect(record.turns.map(turn => turn.status)).toEqual(["interrupted"]);
            expect(existsSync(join(env.library, ".serve.json"))).toBe(false);
        });
    }

    test("参数不对的删书请求直接报错，不先停下这本书的问答", async () => {
        const env = await setup([{kind: "hang"}]);
        const {conversation} = (await env.call("qa.start", {book: "fox", question: "别停我", at: {chapter: 38}})).body as {conversation: string};
        await env.endpoint.firstRequest;
        const bad = await env.call("book.remove", {book: "fox", unexpected: true});
        expect(code(bad)).toBe("invalid_params");
        expect(((await env.call("qa.get", {book: "fox", id: conversation})).body as {run: QaRunView}).run.state).toBe("running");
        expect((await env.call("qa.stop", {book: "fox", conversation})).status).toBe(200);
    });

    test("损坏的记录单列，可以删除", async () => {
        const env = await setup([]);
        await mkdir(join(env.library, "fox", "qa"), {recursive: true});
        await writeFile(join(env.library, "fox", "qa", "20261023000000000-abcdef.json"), "{坏的");
        const listed = await env.call("qa.list", {book: "fox"});
        expect(listed.body).toMatchObject({conversations: [], broken: [{id: "20261023000000000-abcdef"}]});
        expect((await env.call("qa.remove", {book: "fox", id: "20261023000000000-abcdef"})).status).toBe(200);
        expect(await qaFiles(env.library)).toEqual([]);
    });
});

describe("设置页的配置", () => {
    test("没有配置文件时给起始配置；按摘要整份写入，别处改过就报冲突；密钥变量有没有值按服务的环境", async () => {
        const env = await setup([], {config: null});
        const absent = await env.call("config.get", {});
        // 起点是第 2 版的空配置：还没有候选，也就没有要看的密钥变量。
        expect(absent.body).toMatchObject({state: "absent", digest: "absent", config: {models: [], model: {use: ""}}, keys: {}});

        const config = {providers: {custom: {api: "openai-completions", baseUrl: env.endpoint.url, apiKeyEnv: KEY_ENV, models: [{id: "qa-model"}]}}, models: ["custom/qa-model"], model: {use: "custom/qa-model"}};
        const created = await env.call("config.set", {config, expect: "absent"});
        expect(created.status).toBe(200);
        expect(created.body.keys).toEqual({[KEY_ENV]: true});
        const stale = await env.call("config.set", {config, expect: "absent"});
        expect(stale.status).toBe(409);
        expect(code(stale)).toBe("config_conflict");

        const valid = await env.call("config.get", {});
        expect(valid.body).toMatchObject({state: "valid", config, digest: created.body.digest});
        const pasted = "sk-pasted-into-settings-0042";
        const rejected = await env.call("config.set", {config: {...config, providers: {custom: {...config.providers.custom, apiKeyEnv: pasted}}}, expect: created.body.digest});
        expect(code(rejected)).toBe("invalid_params");
        // 字段之间的约束不成立同样不收：默认模型不在候选里。
        expect(code(await env.call("config.set", {config: {...config, model: {use: "custom/other"}}, expect: created.body.digest}))).toBe("invalid_params");
        // 第 1 版整份写进来，存下的是第 2 版。
        const legacy = await env.call("config.set", {config: {model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}}, expect: created.body.digest});
        expect(legacy.status).toBe(200);
        expect(JSON.parse(await readFile(env.configFile, "utf8"))).toEqual(config);
        expect(code(rejected)).toBe("invalid_params");
        expect(JSON.stringify(rejected.body)).not.toContain(pasted);
        expect(await readFile(env.configFile, "utf8")).not.toContain(pasted);
    });

    test("变量名 `__proto__` 照样列进“有没有值”的表", async () => {
        const env = await setup([], {config: null});
        await writeFile(env.configFile, JSON.stringify({model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: "__proto__"}}));
        const got = await env.call("config.get", {});
        expect(Object.hasOwn(got.body.keys, "__proto__")).toBe(true);
    });

    test("文件坏了只给原因、不回传原文，可以整份覆盖", async () => {
        const env = await setup([], {config: null});
        await writeFile(env.configFile, `{"model": {"apiKeyEnv": "${FAKE_KEY}"`);
        const invalid = await env.call("config.get", {});
        expect(invalid.body).toMatchObject({state: "invalid", problem: expect.any(String)});
        const config = {model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}};
        expect((await env.call("config.set", {config, expect: invalid.body.digest})).status).toBe(200);
    });

    test("测试连接：通过时给模型与用时；模型回 401 时失败原因里没有密钥", async () => {
        const env = await setup([{kind: "text", text: "好"}, {kind: "status", status: 401, echoKey: true}]);
        const passed = await env.call("config.test", {});
        expect(passed.body).toMatchObject({ok: true, model: "custom/qa-model", thinking: null, error: null});
        const failed = await env.call("config.test", {});
        expect(failed.body).toMatchObject({ok: false, error: {kind: expect.any(String), message: expect.any(String)}});
    });
});

describe("推送的积压上限", () => {
    test("读得慢的连接积压超过上限就被断开，别的订阅者照常收到", async () => {
        // 真实的处理函数与 HTTP；问答服务换成一个只管推帧的替身（它的订阅合同同 QaService.subscribe）：真实的运行
        // 推不出这么多数据，测试进程解析大帧又会拖慢自己。
        const subscribers = new Map<number, {send: (frame: QaFrame) => void; closed: boolean}>();
        let next = 0;
        const big = "字".repeat(100_000);
        const qa: QaService = {
            async call() {
                throw new Error("不该调用");
            },
            subscribe(_book, _conversation, send) {
                const id = (next += 1);
                const subscriber = {send, closed: false};
                subscribers.set(id, subscriber);
                send({type: "snapshot", run: null, entries: []});
                return {live: true, close: () => void (subscriber.closed = true)};
            },
            exclusive: (_book, task) => task(),
            close: async () => undefined,
        };
        let auth!: ReturnType<typeof createServeAuth>;
        let handler!: (request: Request) => Promise<Response>;
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: request => handler(request)});
        cleanups.push(() => server.stop(true));
        auth = createServeAuth(server.port!);
        handler = createHandler({api: createStoryApi({library: join(root, "unused")}), ingest: {} as IngestService, qa, auth, instance: "test", webRoot: join(root, "no-web"), timeout: (request, seconds) => server.timeout(request, seconds)});
        const cookie = auth.cookie(auth.login(auth.token)!).split(";")[0]!;

        const slow = connect({host: "127.0.0.1", port: server.port!});
        cleanups.push(() => slow.destroy());
        slow.write(`GET /api/qa/events?book=fox&conversation=c HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${cookie}\r\n\r\n`);
        slow.pause();
        await waitUntil("慢的一方订阅上", () => subscribers.has(1));
        const fast = await fetch(`http://127.0.0.1:${server.port}/api/qa/events?book=fox&conversation=c`, {headers: {cookie}});
        const reader = fast.body!.getReader();
        await waitUntil("快的一方订阅上", () => subscribers.has(2));

        // 每轮给两边各推一帧，快的一方读完这一帧再推下一轮；慢的一方不读，积压到上限被断开。
        const frame: QaFrame = {type: "event", runId: "r", event: {type: "message_update", text: big}};
        let rounds = 0;
        while (!subscribers.get(1)!.closed) {
            for (const subscriber of subscribers.values()) if (!subscriber.closed) subscriber.send(frame);
            rounds += 1;
            let got = 0;
            while (got < 300_000) got += (await reader.read()).value!.byteLength;
            if (rounds > 1_000) throw new Error("推了 1000 帧慢的一方还没被断开");
        }
        expect(subscribers.get(2)!.closed).toBe(false);
        // 上限加上内核的套接字缓冲：断开时推给它的字节数在上限之上、不会多出太多。
        expect(rounds * 300_000).toBeGreaterThan(EVENTS_BACKLOG_BYTES);
        await reader.cancel();
    });
});

describe("选模型的接口（t16）", () => {
    function customConfig(url: string, extra: object = {}) {
        return {providers: {custom: {api: "openai-completions", baseUrl: url, apiKeyEnv: KEY_ENV, models: [{id: "qa-model"}, {id: "gpt-5.6-sol"}]}}, models: ["custom/qa-model", "custom/gpt-5.6-sol"], model: {use: "custom/qa-model"}, ...extra};
    }
    const QUESTION = {book: "fox", question: "地狱猫是谁？", at: {chapter: 38}};

    test("qa.start 的模型与推理档：不在候选、不支持的档、只给档、续问带作答方式都在开始前报 invalid_params，不发请求、不留运行", async () => {
        const env = await setup([], {config: null});
        await writeFile(env.configFile, JSON.stringify(customConfig(env.endpoint.url)));
        for (const extra of [{model: "custom/missing"}, {model: "custom/qa-model", thinking: "high"}, {thinking: "high"}, {model: "custom/gpt-5.6-sol", thinking: "minimal"}]) {
            const result = await env.call("qa.start", {...QUESTION, ...extra});
            expect([result.status, code(result)]).toEqual([400, "invalid_params"]);
        }
        expect((await env.call("qa.start", {book: "fox", question: "追问", conversation: "20261024000000000-abcdef", answer: "markdown"})).body.code).toBe("invalid_params");
        expect(env.endpoint.bodies).toEqual([]);
        expect((await env.call("qa.list", {book: "fox"})).body).toEqual({conversations: [], broken: []});
    });

    test("选了模型与档：这一轮用它，运行与记录都写引用；对话记录带作答方式", async () => {
        const env = await setup([{kind: "text", text: "你好"}], {config: null});
        await writeFile(env.configFile, JSON.stringify(customConfig(env.endpoint.url)));
        const started = await env.call("qa.start", {...QUESTION, model: "custom/gpt-5.6-sol", thinking: "max"});
        expect(started.status).toBe(200);
        const {conversation} = started.body as {conversation: string};
        await waitUntil("这一轮保存", async () => (await env.call("qa.get", {book: "fox", id: conversation})).body.record !== null);
        const got = (await env.call("qa.get", {book: "fox", id: conversation})).body;
        expect(got.record).toMatchObject({answer: "markdown", turns: [{model: "custom/gpt-5.6-sol", status: "answered"}]});
        expect(got.run).toMatchObject({model: "custom/gpt-5.6-sol"});
        expect(got.continuable).toEqual({ok: true});
        expect(env.endpoint.bodies.map(body => body.model)).toEqual(["gpt-5.6-sol"]);
    });

    test("早先版本的 Profile 开始的对话：qa.get 报不能续问，照常可以查看", async () => {
        const env = await setup([]);
        const api = createStoryApi({library: env.library});
        const book = await api.openBook("fox");
        const at = new Date().toISOString();
        const turn = {question: "旧问题", status: "answered" as const, answer: null, reply: {text: "旧回答", truncated: false, unverifiedRefs: []}, error: null, chaptersRead: [], rejections: 0, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true}, ms: 1, model: "qa-model", startedAt: at, logFrom: 1};
        const id = "20261020000000000-abcdef";
        const snapshot = {kind: "session_snapshot", seq: 1, at, profile: {key: "story-qa", version: "3"}, initial: {}, tools: []};
        const saved = await new QaRecords(api.library, "fox").save({id, book: "fox", generation: book.generation, at: {chapter: 38, paragraph: 1}, mode: "graph", maxChapters: 20, read: [], turns: [turn], startedAt: at}, `${JSON.stringify(snapshot)}\n`, {expectTurns: 0});
        expect(saved.saved).toBe(true);
        const got = (await env.call("qa.get", {book: "fox", id})).body;
        expect(got.record).toMatchObject({answer: "structured", turns: [{question: "旧问题"}]});
        expect(got.continuable).toMatchObject({ok: false, reason: expect.stringContaining("早先版本")});
    });

    test("models.catalog：自定义模型的单价币种以配置里写的为准（不被目录投影改成 USD）", async () => {
        const env = await setup([], {config: null});
        const config = customConfig(env.endpoint.url);
        config.providers.custom.models = [{id: "cny", price: {input: 1, output: 2, currency: "CNY"}}, {id: "usd", price: {input: 1, output: 2, currency: "USD"}}] as never;
        config.models = ["custom/cny", "custom/usd"];
        await writeFile(env.configFile, JSON.stringify(config));
        const {providers} = (await env.call("models.catalog", {})).body as {providers: {id: string; models: {id: string; price: {currency: string} | null}[]}[]};
        const custom = providers.find(provider => provider.id === "custom")!;
        expect(custom.models.map(model => [model.id, model.price?.currency])).toEqual([["cny", "CNY"], ["usd", "USD"]]);
    });

    test("models.catalog：自定义服务商在前，没写的参数按模型名补上、密钥按服务的环境；目录服务商带分类与密钥变量", async () => {
        const env = await setup([], {config: null});
        await writeFile(env.configFile, JSON.stringify(customConfig(env.endpoint.url)));
        const {providers} = (await env.call("models.catalog", {})).body as {providers: {id: string; source: string; access: string; keyEnvs: string[]; keySet: boolean; models: {id: string; contextWindow: number | null; efforts: string[]; price: unknown}[]}[]};
        expect(providers[0]).toMatchObject({id: "custom", source: "custom", access: "key", keyEnvs: [KEY_ENV], keySet: true});
        expect(providers[0]!.models.find(model => model.id === "gpt-5.6-sol")).toMatchObject({contextWindow: 1_050_000, price: null});
        expect(providers[0]!.models.find(model => model.id === "qa-model")).toMatchObject({contextWindow: null, efforts: []});
        expect(providers.find(provider => provider.id === "deepseek")).toMatchObject({source: "catalog", access: "key", keyEnvs: ["DEEPSEEK_API_KEY"]});
        expect(providers.find(provider => provider.id === "anthropic")).toMatchObject({access: "login"});
        expect(providers.filter(provider => provider.source === "catalog")).toHaveLength(69);
        // 没有配置文件时只有目录。
        await rm(env.configFile);
        expect(((await env.call("models.catalog", {})).body.providers as {source: string}[]).every(provider => provider.source === "catalog")).toBe(true);
    });

    test("models.discover：用给的地址与密钥变量读 /models，不读配置；结果里没有密钥；不认的接口是 invalid_params", async () => {
        const env = await setup([]);
        const authorizations: (string | null)[] = [];
        const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
                authorizations.push(request.headers.get("authorization"));
                return new URL(request.url).pathname === "/v1/models" ? Response.json({data: [{id: "gpt-5.6-sol"}, {id: "house"}]}) : new Response("no", {status: 404});
            },
        });
        cleanups.push(() => server.stop(true));
        const url = `http://127.0.0.1:${server.port}/v1`;
        const found = (await env.call("models.discover", {api: "openai-completions", baseUrl: url, apiKeyEnv: KEY_ENV})).body;
        expect(found).toMatchObject({state: "found", keySet: true, models: [{id: "gpt-5.6-sol", suggested: {from: "openai/gpt-5.6-sol"}}, {id: "house", suggested: null}]});
        expect(authorizations).toEqual([`Bearer ${FAKE_KEY}`]);
        const missing = (await env.call("models.discover", {api: "openai-responses", baseUrl: `http://127.0.0.1:${server.port}/nothing`, apiKeyEnv: "NBSTORY_NOT_SET_ANYWHERE"})).body;
        expect(missing).toMatchObject({state: "not_supported", status: 404, keySet: false, models: []});
        expect(authorizations.at(-1)).toBeNull();
        expect(code(await env.call("models.discover", {api: "anthropic-messages", baseUrl: url, apiKeyEnv: KEY_ENV}))).toBe("invalid_params");
        expect(code(await env.call("models.discover", {api: "openai-completions", baseUrl: url, apiKeyEnv: "sk-pasted-0042"}))).toBe("invalid_params");
    });
});
