/**
 * 模型请求记录器（docs/specs/agent/request-trace.md 的“记录”与“副作用与数据”）。真实的临时目录；端口是替身，它对观察者
 * 的调用方式与真实适配器相同（适配器一侧由 tests/models.test.ts 的“线上事实交给观察者”经真实 HTTP 核对）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {appendFile, chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync, gzipSync} from "node:zlib";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {Message, ModelCallMeta, ModelPort, ModelQuery, ModelRequest, ModelResponse, ModelWireAttempt, ModelWireObserver, ToolDeclaration, Usage} from "../../kernel/contracts.js";
import {traceModelPort} from "./port.js";
import {RequestRecorder, RequestTraceUnavailable} from "./recorder.js";
import {MASK} from "./sanitize.js";
import type {RequestChange, RequestRow} from "./types.js";

let base: string;
beforeAll(async () => {
    base = await createTestTmpRoot("nb-harness", "kit-requests");
});
afterAll(async () => {
    await rm(base, {recursive: true, force: true});
});

const recorders: RequestRecorder[] = [];
afterEach(async () => {
    for (const recorder of recorders.splice(0)) await recorder.close();
});

const DAY = 24 * 60 * 60 * 1000;
const NOV_15 = Date.UTC(2026, 10, 15, 12);
let counter = 0;

interface Rig {
    readonly root: string;
    readonly recorder: RequestRecorder;
    readonly settings: {enabled: boolean; payload: boolean; headers: boolean};
    readonly reports: {readonly code: string; readonly message: string}[];
    readonly changes: RequestChange[];
    readonly clock: {now: number};
}

async function rig(options: {readonly root?: string; readonly payloadLimit?: number} = {}): Promise<Rig> {
    counter += 1;
    const root = options.root ?? join(base, `trace-${String(counter)}`);
    const settings = {enabled: true, payload: true, headers: false};
    const reports: Rig["reports"] = [];
    const changes: RequestChange[] = [];
    const clock = {now: NOV_15};
    const recorder = new RequestRecorder({
        root,
        settings: () => settings,
        report: (code, message) => reports.push({code, message}),
        now: () => clock.now,
        ...(options.payloadLimit === undefined ? {} : {payloadLimit: options.payloadLimit}),
    });
    recorders.push(recorder);
    recorder.onChange((change) => changes.push(change));
    await recorder.open();
    return {root, recorder, settings, reports, changes, clock};
}

const QUERY: ModelQuery = {settings: {model: null, effort: null, approvalMode: "ask", readOnly: false}, purpose: "turn", profile: "p"};
const TOOL: ToolDeclaration = {id: "builtin.read", description: "读文件。\n第二行不进大纲。", parameters: {type: "object"}, provider: "builtin", version: "1", finish: false, concurrency: "shared", strict: false, effect: "read"};
const OTHER_TOOL: ToolDeclaration = {...TOOL, id: "builtin.write", description: "写文件"};

const usage = (input = 100, cacheRead = 0, cost: number | null = 0.01): Usage => ({input, output: 20, cacheRead, cacheWrite: 0, cost, complete: true});
const reply = (text: string, extra: Partial<ModelResponse> = {}): ModelResponse => ({content: [{kind: "text", text}], toolCalls: [], stopReason: "stop", usage: usage(), model: "test/model-2", ...extra});

const user = (text: string): Message => ({role: "user", content: [{kind: "text", text, origin: {kind: "fixed", by: "kernel"}}]});

function request(messages: readonly Message[], extra: Partial<ModelRequest> = {}): ModelRequest {
    return {purpose: "turn", model: "test/model", params: {maxTokens: 1000}, headers: {}, system: [{kind: "text", text: "你是写作助手。", origin: {kind: "fixed", by: "profile"}}], messages, tools: [TOOL], ...extra};
}

const meta = (number: number, extra: Partial<ModelCallMeta> = {}): ModelCallMeta => ({session: "s1", request: number, hash: `hash-${String(number)}`, turn: {id: "turn-1", index: 1, input: "写第一章"}, ...extra});

/** 适配器替身：按真实适配器的顺序调观察者（尝试结束、第一块内容），再交回回复。 */
type Adapter = (request: ModelRequest, signal: AbortSignal, observe: ModelWireObserver | undefined, meta: ModelCallMeta | undefined) => Promise<ModelResponse>;

function portOf(adapter: Adapter): ModelPort {
    return {resolve: () => ({ok: true, info: {id: "test/model", contextWindow: 100_000, capabilities: {vision: true, thinking: false}, efforts: []}, call: (req, signal, _onDelta, callMeta) => adapter(req, signal, callMeta?.observe, callMeta)})};
}

function attempt(status: number, extra: Partial<ModelWireAttempt> = {}): ModelWireAttempt {
    return {url: "https://api.example.test/v1/chat/completions", headers: {authorization: `Bearer ${MASK}`}, body: "{}", startedAt: NOV_15, endedAt: NOV_15 + 5, response: {status, headers: {"content-type": "application/json"}}, ...extra};
}

const answering = (text = "好的", extra: Partial<ModelResponse> = {}): Adapter => async (req, _signal, observe) => {
    observe?.attempt?.(attempt(200, {body: JSON.stringify({messages: req.messages.map((message) => message.content)})}));
    observe?.firstContent?.();
    return reply(text, extra);
};

async function send(port: ModelPort, req: ModelRequest, callMeta: ModelCallMeta | undefined, signal = new AbortController().signal): Promise<ModelResponse> {
    const resolution = port.resolve(QUERY);
    if (!resolution.ok) throw new Error(resolution.code);
    return resolution.call(req, signal, () => undefined, callMeta);
}

/** 端口替身里挂住的请求：`release` 之前不交回。 */
function holding(): {readonly adapter: Adapter; readonly arrived: Promise<void>; release(): void} {
    let release = (): void => undefined;
    let arrive = (): void => undefined;
    const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        adapter: async (req, signal, observe) => {
            arrive();
            await gate;
            return answering()(req, signal, observe, undefined);
        },
        arrived,
        release: () => release(),
    };
}

async function settled(r: Rig, count: number): Promise<void> {
    await waitUntil(`${String(count)} 条记录结束`, () => r.changes.filter((change) => change.kind === "settled").length >= count);
}

async function rows(r: Rig): Promise<readonly RequestRow[]> {
    return (await r.recorder.list()).rows;
}

/** 记录目录里全部文件的文字（请求体解压）：查“目录里搜不到”。 */
async function everything(root: string): Promise<string> {
    const parts: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else {
                const data = await readFile(path);
                parts.push(path.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8"));
            }
        }
    };
    await walk(root);
    return parts.join("\n");
}

describe("记录", () => {
    test("输出 1、2、4：记录在请求发给适配器之前写好，结束后原地变成成功", async () => {
        const r = await rig();
        let atAdapter: readonly RequestRow[] = [];
        const port = traceModelPort(portOf(async (req, signal, observe) => {
            atAdapter = await rows(r);
            return answering()(req, signal, observe, undefined);
        }), r.recorder);
        await send(port, request([user("写第一章")]), meta(1, {modifiedBy: [{extension: "ext.a", fields: ["system"]}]}));
        await settled(r, 1);

        expect(atAdapter.map((row) => row.status)).toEqual(["running"]);
        const [row] = await rows(r);
        expect(row).toMatchObject({session: "s1", request: 1, hash: "hash-1", purpose: "turn", model: "test/model", turn: {id: "turn-1", index: 1, input: "写第一章"}, status: "ok", stopReason: "stop", answeredBy: "test/model-2", http: 200, attempts: 1, toolsChanged: false, usage: usage()});
        expect(row?.firstContentAt).toBe(NOV_15);
        expect(r.changes.map((change) => [change.kind, change.kind === "removed" ? null : change.row.id])).toEqual([["added", row?.id], ["settled", row?.id]]);

        const detail = await r.recorder.read(row?.id ?? "");
        expect(detail?.modifiedBy).toEqual([{extension: "ext.a", fields: ["system"]}]);
        expect(detail?.params).toEqual({maxTokens: 1000});
        await send(port, request([user("带选项")], {providerOptions: {store: false, gatewayToken: "option-secret-value"}}), meta(2));
        await settled(r, 2);
        const withOptions = await r.recorder.read((await r.recorder.find("s1", 2))?.id ?? "");
        expect(withOptions?.params).toEqual({maxTokens: 1000, providerOptions: ["store", "gatewayToken"]});
        expect(await everything(r.root)).not.toContain("option-secret-value");
        expect(detail?.system.map((block) => block.preview)).toEqual(["你是写作助手。"]);
        expect(detail?.messages.map((message) => [message.role, message.preview])).toEqual([["user", "写第一章"]]);
        expect(detail?.tools.map((tool) => [tool.id, tool.description])).toEqual([["builtin.read", "读文件。"]]);
        expect(detail?.reply).toMatchObject({role: "assistant", preview: "好的"});
        expect(JSON.parse(await r.recorder.content(detail?.messages[0]?.hash ?? "") ?? "null")).toMatchObject({role: "user", content: [{kind: "text", text: "写第一章"}]});
        expect((await r.recorder.find("s1", 1))?.id).toBe(row?.id);
        expect(await r.recorder.find("s1", 9)).toBeNull();
    });

    test("输出 3：失败的回复记类别、码、状态与文字；适配器抛错与中止也结算", async () => {
        const r = await rig();
        const failing = traceModelPort(portOf(async () => reply("半截", {stopReason: "error", error: {kind: "rate_limit", code: "rate-limited", status: 429, message: "Too many requests"}})), r.recorder);
        await send(failing, request([user("一")]), meta(1));
        const throwing = traceModelPort(portOf(async () => {
            throw new Error("adapter exploded");
        }), r.recorder);
        await expect(send(throwing, request([user("二")]), meta(2))).rejects.toThrow("adapter exploded");
        const controller = new AbortController();
        const aborting = traceModelPort(portOf(async (_req, signal) => {
            controller.abort();
            throw signal.reason;
        }), r.recorder);
        await expect(send(aborting, request([user("三")]), meta(3), controller.signal)).rejects.toBeDefined();
        await settled(r, 3);

        const byRequest = new Map((await rows(r)).map((row) => [row.request, row]));
        expect(byRequest.get(1)).toMatchObject({status: "error", stopReason: "error", error: {kind: "rate_limit", code: "rate-limited", status: 429}});
        expect((await r.recorder.read(byRequest.get(1)?.id ?? ""))?.reply?.preview).toBe("半截");
        expect((await r.recorder.read(byRequest.get(1)?.id ?? ""))?.errorMessage).toBe("Too many requests");
        expect(byRequest.get(2)).toMatchObject({status: "error", error: {kind: "local"}});
        expect((await r.recorder.read(byRequest.get(2)?.id ?? ""))?.errorMessage).toBe("adapter exploded");
        expect(byRequest.get(3)?.status).toBe("aborted");
    });

    test("输出 5：每次尝试的地址、状态与响应头；凭据类的头与查询参数遮盖，请求头只在设置开着时记", async () => {
        const r = await rig();
        const port = traceModelPort(portOf(async (_req, _signal, observe) => {
            const shared = {url: "https://api.example.test/v1/chat?key=query-secret-value&alt=sse", headers: {"Authorization": `Bearer ${MASK}`, "x-goog-api-key": "goog-secret-value", "x-custom": "plain"}};
            observe?.attempt?.(attempt(429, {...shared, response: {status: 429, headers: {"x-ratelimit-remaining-requests": "0", "retry-after": "1", "set-cookie": "sid=cookie-secret-value"}}}));
            observe?.attempt?.(attempt(200, {...shared, response: {status: 200, headers: {"x-api-token": "token-secret-value"}}}));
            return reply("好");
        }), r.recorder);
        await send(port, request([user("一")]), meta(1));
        r.settings.headers = true;
        await send(port, request([user("二")]), meta(2));
        await settled(r, 2);

        const [second, first] = await rows(r);
        const before = await r.recorder.read(first?.id ?? "");
        expect(before?.attemptList.map((item) => item.status)).toEqual([429, 200]);
        expect(before?.attemptList[0]?.url).toBe(`https://api.example.test/v1/chat?key=${encodeURIComponent(MASK)}&alt=sse`);
        expect(before?.attemptList[0]?.responseHeaders).toEqual({"x-ratelimit-remaining-requests": "0", "retry-after": "1", "set-cookie": MASK});
        expect(before?.attemptList[1]?.responseHeaders).toEqual({"x-api-token": MASK});
        expect(before?.attemptList.map((item) => item.requestHeaders)).toEqual([undefined, undefined]);
        const after = await r.recorder.read(second?.id ?? "");
        expect(after?.attemptList[0]?.requestHeaders).toEqual({"authorization": MASK, "x-goog-api-key": MASK, "x-custom": "plain"});
        expect(first?.http).toBe(200);

        const text = await everything(r.root);
        for (const secret of ["query-secret-value", "goog-secret-value", "cookie-secret-value", "token-secret-value"]) expect(text).not.toContain(secret);
    });

    test("输出 6：存最后一次尝试发出的请求体；设置关着、拿不到时写明原因", async () => {
        const r = await rig();
        const port = traceModelPort(portOf(async (_req, _signal, observe) => {
            observe?.attempt?.(attempt(500, {body: JSON.stringify({try: 1})}));
            observe?.attempt?.(attempt(200, {body: JSON.stringify({try: 2})}));
            return reply("好");
        }), r.recorder);
        await send(port, request([user("一")]), meta(1));
        await send(traceModelPort(portOf(async (_req, _signal, observe) => {
            observe?.payload?.(JSON.stringify({transport: "websocket"}));
            return reply("好");
        }), r.recorder), request([user("二")]), meta(2));
        await send(traceModelPort(portOf(async () => reply("好")), r.recorder), request([user("三")]), meta(3));
        r.settings.payload = false;
        await send(port, request([user("四")]), meta(4));
        r.settings.payload = true;
        // 最后一次尝试的体是流（null）：没有可存的，不退回第一次的。
        await send(traceModelPort(portOf(async (_req, _signal, observe) => {
            observe?.attempt?.(attempt(500, {body: JSON.stringify({try: 1})}));
            observe?.attempt?.(attempt(200, {body: null}));
            return reply("好");
        }), r.recorder), request([user("五")]), meta(5));
        await settled(r, 5);

        const byRequest = new Map((await rows(r)).map((row) => [row.request, row.id]));
        const state = async (number: number) => (await r.recorder.read(byRequest.get(number) ?? ""))?.payload.state;
        expect(await r.recorder.payload(byRequest.get(1) ?? "")).toBe(JSON.stringify({try: 2}));
        expect(await r.recorder.payload(byRequest.get(2) ?? "")).toBe(JSON.stringify({transport: "websocket"}));
        expect([await state(1), await state(2), await state(3), await state(4), await state(5)]).toEqual(["present", "present", "unavailable", "disabled", "unavailable"]);
        expect(await r.recorder.payload(byRequest.get(4) ?? "")).toBeNull();
        expect(await r.recorder.payload(byRequest.get(5) ?? "")).toBeNull();
    });

    test("输出 6：原始请求体合计超过上限时从最旧的删起，记录本身留着", async () => {
        // 随机内容压缩不动：每份约 1 KB，上限放得下两份。
        const noise = () => Array.from({length: 1500}, () => Math.floor(Math.random() * 36).toString(36)).join("");
        const r = await rig({payloadLimit: 2600});
        const port = traceModelPort(portOf(async (_req, _signal, observe) => {
            observe?.attempt?.(attempt(200, {body: JSON.stringify({noise: noise()})}));
            return reply("好");
        }), r.recorder);
        for (const number of [1, 2, 3]) await send(port, request([user(String(number))]), meta(number));
        await settled(r, 3);

        const listed = await rows(r);
        expect(listed.map((row) => row.status)).toEqual(["ok", "ok", "ok"]);
        const states = await Promise.all(listed.map(async (row) => (await r.recorder.read(row.id))?.payload.state));
        expect(states).toEqual(["present", "present", "pruned"]);
        expect(await r.recorder.payload(listed[2]?.id ?? "")).toBeNull();
        expect(await readdir(join(r.root, "payloads"))).toHaveLength(2);
    });

    test("输出 7、场景 3：进程在请求进行中被结束，下次打开时那条记录是已中断", async () => {
        counter += 1;
        const root = join(base, `trace-${String(counter)}`);
        const child = Bun.spawn(["bun", join(import.meta.dir, "../../../tests/fixtures/hold-request.ts"), root], {stdout: "pipe", stderr: "inherit"});
        try {
            const {value} = await child.stdout.getReader().read();
            expect(new TextDecoder().decode(value).trim()).toBe("started");
            child.kill(9);
            await child.exited;
            const r = await rig({root});
            expect((await rows(r)).map((row) => [row.session, row.status])).toEqual([["held", "interrupted"]]);
            const reopened = await rig({root});
            expect((await rows(reopened)).map((row) => row.status)).toEqual(["interrupted"]);
        } finally {
            child.kill(9);
            await child.exited;
        }
    });

    test("场景 3：写到一半退出留下的半行不出现，之后照常追加", async () => {
        const first = await rig();
        const port = traceModelPort(portOf(answering()), first.recorder);
        await send(port, request([user("一")]), meta(1));
        await settled(first, 1);
        await first.recorder.close();
        const [day] = await readdir(join(first.root, "index"));
        const dayPath = join(first.root, "index", day ?? "");
        await appendFile(dayPath, `{"v":1,"seq":99,"id":"half","kind":"st`);

        const second = await rig({root: first.root});
        expect((await rows(second)).map((row) => row.request)).toEqual([1]);
        await send(traceModelPort(portOf(answering()), second.recorder), request([user("二")]), meta(2));
        await settled(second, 1);
        expect((await rows(second)).map((row) => [row.request, row.status])).toEqual([[2, "ok"], [1, "ok"]]);
        const lines = (await readFile(dayPath, "utf8")).split("\n").filter((line) => line !== "");
        expect(lines.every((line) => JSON.parse(line) !== null)).toBe(true);
        expect(second.reports).toEqual([]);
    });

    test("场景 3：内容写完、行还没写就退出，留下的文件不成为记录，清理时回收", async () => {
        const first = await rig();
        await send(traceModelPort(portOf(answering()), first.recorder), request([user("留下")]), meta(1));
        await settled(first, 1);
        await first.recorder.close();
        // 退出时刻的残留：没有行引用的内容、请求体，以及改名之前的临时文件。
        const orphanHash = "ab".padEnd(64, "0");
        await mkdir(join(first.root, "blobs", "ab"), {recursive: true});
        await writeFile(join(first.root, "blobs", "ab", `${orphanHash}.json`), JSON.stringify({role: "user", content: []}));
        await writeFile(join(first.root, "blobs", "ab", `${orphanHash}.json.0000.tmp`), "{");
        await writeFile(join(first.root, "payloads", "orphan.json.gz"), gzipSync("{}"));
        await writeFile(join(first.root, "payloads", "orphan.json.gz.0000.tmp"), "");
        await writeFile(join(first.root, "index", "2026-11-15.jsonl.0000.tmp"), "");

        const second = await rig({root: first.root});
        expect((await rows(second)).map((row) => row.request)).toEqual([1]);
        expect(await readdir(join(first.root, "index"))).toEqual(["2026-11-15.jsonl"]);
        await second.recorder.sweep(14);
        expect(await second.recorder.content(orphanHash)).toBeNull();
        expect(await readdir(join(first.root, "blobs", "ab"))).toEqual([]);
        const [row] = await rows(second);
        expect(await readdir(join(first.root, "payloads"))).toEqual([`${row?.id ?? ""}.json.gz`]);
        const detail = await second.recorder.read(row?.id ?? "");
        expect(detail?.messages.map((message) => message.missing)).toEqual([undefined]);
    });

    test("输出 8：与前一次完全相同的请求标重发与第几次；工具声明与上一次不同时标出", async () => {
        const r = await rig();
        const port = traceModelPort(portOf(answering()), r.recorder);
        const same = request([user("一")]);
        for (const number of [1, 2, 3]) await send(port, same, {...meta(number), hash: "same"});
        await send(port, request([user("一")], {tools: [TOOL, OTHER_TOOL]}), meta(4));
        await send(port, request([user("一")], {purpose: "compaction", tools: [TOOL, OTHER_TOOL]}), {...meta(5), hash: "hash-4"});
        await settled(r, 5);

        const byRequest = new Map((await rows(r)).map((row) => [row.request, row]));
        expect([1, 2, 3, 4, 5].map((number) => byRequest.get(number)?.resend)).toEqual([undefined, 2, 3, undefined, undefined]);
        expect([1, 2, 3, 4, 5].map((number) => byRequest.get(number)?.toolsChanged)).toEqual([false, false, false, true, false]);
    });

    test.skipIf(process.getuid?.() === 0)("输出 9：记录写不进去时请求照常发出，这一次没有记录，写一条诊断", async () => {
        const r = await rig();
        const index = join(r.root, "index");
        await chmod(index, 0o500);
        try {
            const response = await send(traceModelPort(portOf(answering("照常")), r.recorder), request([user("一")]), meta(1));
            expect(response.content).toEqual([{kind: "text", text: "照常"}]);
        } finally {
            await chmod(index, 0o700);
        }
        expect(await rows(r)).toEqual([]);
        expect(r.reports.map((report) => report.code)).toEqual(["requests.write-failed"]);
    });

    test("输出 10：关掉记录之后的请求不记，已有的照样能看；适配器拿到的说明不带观察者", async () => {
        const r = await rig();
        const seen: (ModelCallMeta | undefined)[] = [];
        const port = traceModelPort(portOf(async (req, signal, observe, callMeta) => {
            seen.push(callMeta);
            return answering()(req, signal, observe, undefined);
        }), r.recorder);
        await send(port, request([user("一")]), meta(1));
        await settled(r, 1);
        r.settings.enabled = false;
        await send(port, request([user("二")]), meta(2));
        expect((await rows(r)).map((row) => row.request)).toEqual([1]);
        expect(seen[1]).toEqual(meta(2));
    });

    test("输出 11：清理删掉过期的天、不动进行中的，之后没有记录用到的内容一并删掉", async () => {
        const r = await rig();
        r.clock.now = Date.UTC(2026, 10, 1, 12);
        const port = traceModelPort(portOf(answering()), r.recorder);
        await send(port, request([user("旧的内容")]), meta(1));
        const held = holding();
        const running = send(traceModelPort(portOf(held.adapter), r.recorder), request([user("还在跑")]), meta(2, {session: "s2"}));
        await held.arrived;
        await settled(r, 1);
        const [oldRow] = (await rows(r)).filter((row) => row.request === 1);
        const oldHash = (await r.recorder.read(oldRow?.id ?? ""))?.messages[0]?.hash ?? "";

        r.clock.now = Date.UTC(2026, 10, 20, 12);
        await send(port, request([user("新的内容")]), meta(3));
        await settled(r, 2);
        expect(await r.recorder.sweep(14)).toBe(1);
        expect((await rows(r)).map((row) => [row.request, row.status])).toEqual([[3, "ok"], [2, "running"]]);
        expect(await r.recorder.content(oldHash)).toBeNull();
        expect(r.changes.filter((change) => change.kind === "removed")).toEqual([{seq: expect.any(Number), kind: "removed", ids: [oldRow?.id]}]);

        held.release();
        await running;
        await settled(r, 3);
        expect((await rows(r)).map((row) => [row.request, row.status])).toEqual([[3, "ok"], [2, "ok"]]);
        expect(await r.recorder.sweep(14)).toBe(1);
        expect((await rows(r)).map((row) => row.request)).toEqual([3]);
        expect(await readdir(join(r.root, "index"))).toEqual(["2026-11-20.jsonl"]);
    });

    test("输出 12、场景 6：图片只记类型、字节数与哈希，记录目录里搜不到图片的内容", async () => {
        const r = await rig();
        const image = Buffer.from(Array.from({length: 3000}, (_, index) => (index * 7919) % 251)).toString("base64");
        const withImage: Message = {role: "tool", callId: "c1", content: [{kind: "text", text: "截图如下", origin: {kind: "fixed", by: "kernel"}}, {kind: "image", data: image, mime: "image/png", origin: {kind: "fixed", by: "kernel"}}]};
        const port = traceModelPort(portOf(async (_req, _signal, observe) => {
            // 第三种是 Gemini 的 `inlineData`，图很小也照换。
            const body = {messages: [{content: [{type: "image_url", image_url: {url: `data:image/png;base64,${image}`}}]}, {content: [{type: "image", source: {type: "base64", media_type: "image/png", data: image}}]}, {parts: [{inlineData: {mimeType: "image/png", data: "c21hbGwtaW1hZ2U="}}]}]};
            observe?.attempt?.(attempt(200, {body: JSON.stringify(body)}));
            return {...reply("看到了"), content: [{kind: "text", text: "看到了"}, {kind: "image", data: image, mime: "image/png"}]};
        }), r.recorder);
        await send(port, request([user("看图"), withImage]), meta(1));
        await settled(r, 1);

        const [row] = await rows(r);
        const detail = await r.recorder.read(row?.id ?? "");
        expect(detail?.messages.map((message) => message.images)).toEqual([0, 1]);
        expect(JSON.parse(await r.recorder.content(detail?.messages[1]?.hash ?? "") ?? "null")).toMatchObject({content: [{kind: "text"}, {kind: "image", mime: "image/png", bytes: 3000, hash: expect.stringMatching(/^[0-9a-f]{64}$/u)}]});
        const text = await everything(r.root);
        expect(text).not.toContain(image.slice(200, 260));
        expect(text).not.toContain("c21hbGwtaW1hZ2U=");
    });

    test("输出 25：清空一个会话的记录不动别的会话与进行中的", async () => {
        const r = await rig();
        const port = traceModelPort(portOf(answering()), r.recorder);
        await send(port, request([user("一")]), meta(1));
        await send(port, request([user("二")]), meta(2));
        await send(port, request([user("别的会话")]), meta(1, {session: "s2"}));
        const held = holding();
        const running = send(traceModelPort(portOf(held.adapter), r.recorder), request([user("还在跑")]), meta(3));
        await held.arrived;
        await settled(r, 3);

        expect(await r.recorder.clear({session: "s1"})).toBe(2);
        expect((await rows(r)).map((row) => [row.session, row.request, row.status])).toEqual([["s1", 3, "running"], ["s2", 1, "ok"]]);
        held.release();
        await running;
        await settled(r, 4);
        expect(await r.recorder.clear()).toBe(2);
        expect(await rows(r)).toEqual([]);
        expect(await readdir(join(r.root, "index"))).toEqual([]);
        expect(await readdir(join(r.root, "payloads"))).toEqual([]);
    });
});

describe("列表", () => {
    test("输出 16：筛选、排序、分页与合计；筛选候选不受自己那一项筛选的影响", async () => {
        const r = await rig();
        const cases: {readonly session: string; readonly model: string; readonly purpose: ModelRequest["purpose"]; readonly response: ModelResponse; readonly took: number}[] = [
            {session: "s1", model: "a/one", purpose: "turn", response: reply("1", {usage: usage(100, 80, 0.02)}), took: 30},
            {session: "s1", model: "a/one", purpose: "compaction", response: reply("2", {usage: usage(300, 0, null)}), took: 10},
            {session: "s2", model: "b/two", purpose: "turn", response: reply("3", {stopReason: "error", usage: usage(50, 0, null), error: {kind: "network", message: "down"}}), took: 50},
            {session: "s2", model: "a/one", purpose: "turn", response: reply("4", {usage: usage(200, 0, 0.03)}), took: 20},
        ];
        for (const [index, item] of cases.entries()) {
            r.clock.now = NOV_15 + index * 1000;
            const port = traceModelPort(portOf(async () => {
                r.clock.now += item.took;
                return item.response;
            }), r.recorder);
            await send(port, request([user(String(index))], {model: item.model, purpose: item.purpose}), meta(index + 1, {session: item.session}));
        }
        await settled(r, 4);
        const numbers = (page: {readonly rows: readonly RequestRow[]}) => page.rows.map((row) => row.request);

        const all = await r.recorder.list();
        expect(numbers(all)).toEqual([4, 3, 2, 1]);
        expect(all.totals).toEqual({count: 4, input: 730, cacheRead: 80, cost: 0.05});
        expect(all.seq).toBe(r.changes.at(-1)?.seq ?? -1);

        const first = await r.recorder.list({limit: 3});
        expect(numbers(first)).toEqual([4, 3, 2]);
        const rest = await r.recorder.list({limit: 3, ...(first.next === undefined ? {} : {cursor: first.next})});
        expect(numbers(rest)).toEqual([1]);
        expect(rest.next).toBeUndefined();

        expect(numbers(await r.recorder.list({sort: "duration"}))).toEqual([3, 1, 4, 2]);
        expect(numbers(await r.recorder.list({sort: "input"}))).toEqual([2, 4, 1, 3]);
        expect(numbers(await r.recorder.list({sort: "cost"}))).toEqual([4, 1, 3, 2]);

        const filtered = await r.recorder.list({models: ["a/one"], purposes: ["turn"]});
        expect(numbers(filtered)).toEqual([4, 1]);
        expect(filtered.totals).toEqual({count: 2, input: 380, cacheRead: 80, cost: 0.05});
        expect(filtered.facets.models).toEqual([{id: "a/one", count: 2}, {id: "b/two", count: 1}]);
        expect(filtered.facets.sessions).toEqual([{id: "s1", count: 1}, {id: "s2", count: 1}]);

        expect(numbers(await r.recorder.list({statuses: ["error"]}))).toEqual([3]);
        expect(numbers(await r.recorder.list({statuses: ["cache-miss"]}))).toEqual([4, 2]);
        expect(numbers(await r.recorder.list({statuses: ["error", "cache-miss"]}))).toEqual([4, 3, 2]);
        expect(numbers(await r.recorder.list({since: NOV_15 + 2000}))).toEqual([4, 3]);
        expect((await r.recorder.list({sessions: ["s2"], statuses: ["error"]})).totals.cost).toBeNull();
        await expect(r.recorder.list({cursor: "not-a-cursor"})).rejects.toThrow(TypeError);
    });
});

describe("边界", () => {
    test("没有会话说明的调用（complete()）不记；外层观察者照样收到线上事实", async () => {
        const r = await rig();
        const port = traceModelPort(portOf(answering()), r.recorder);
        await send(port, request([user("一")]), undefined);
        const outer: string[] = [];
        await send(port, request([user("二")]), meta(2, {observe: {attempt: (wire) => outer.push(`attempt ${String(wire.response?.status)}`), firstContent: () => outer.push("first")}}));
        await settled(r, 1);
        expect((await rows(r)).map((row) => row.request)).toEqual([2]);
        expect(outer).toEqual(["attempt 200", "first"]);
    });

    test("格式版本不认识时整个目录不动：读得到 trace-unavailable，请求照发不记", async () => {
        counter += 1;
        const root = join(base, `trace-${String(counter)}`);
        await mkdir(root, {recursive: true});
        await writeFile(join(root, "format.json"), JSON.stringify({version: 2}));
        // 更新的版本留下的东西：恢复中的临时文件、写到一半的天文件。
        await mkdir(join(root, "index"), {recursive: true});
        await writeFile(join(root, "index", "2026-11-15.jsonl.0000.tmp"), "{}\n");
        await writeFile(join(root, "index", "2026-11-14.jsonl"), `{"v":2,"seq":1}\n{"v":2`);
        const r = await rig({root});
        await expect(r.recorder.list()).rejects.toMatchObject({code: "trace-unavailable", reason: "newer-format"});
        await expect(r.recorder.list()).rejects.toBeInstanceOf(RequestTraceUnavailable);
        const response = await send(traceModelPort(portOf(answering("照常")), r.recorder), request([user("一")]), meta(1));
        expect(response.content).toEqual([{kind: "text", text: "照常"}]);
        expect((await readdir(join(root, "index"))).sort()).toEqual(["2026-11-14.jsonl", "2026-11-15.jsonl.0000.tmp"]);
        expect(await readFile(join(root, "index", "2026-11-14.jsonl"), "utf8")).toBe(`{"v":2,"seq":1}\n{"v":2`);
        expect(await readFile(join(root, "format.json"), "utf8")).toBe(JSON.stringify({version: 2}));
        expect(r.reports.map((report) => report.code)).toEqual(["requests.unreadable"]);
    });

    test("索引里不认识版本的天文件不显示、不截半行；id 不是记录 id 的行不认（它会拼进请求体的文件名）", async () => {
        const first = await rig();
        await first.recorder.close();
        const index = join(first.root, "index");
        await writeFile(join(index, "2026-11-13.jsonl"), `{"v":2,"seq":1,"id":"x","kind":"start"}\n{"v":2`);
        await writeFile(join(index, "2026-11-14.jsonl"), `${JSON.stringify({v: 1, seq: 1, id: "../../outside", kind: "start", at: NOV_15, session: "s1", request: 1, hash: "h", purpose: "turn", model: "m", params: {}, system: [], messages: [], tools: [], toolsChanged: false})}\n`);

        const second = await rig({root: first.root});
        expect(await rows(second)).toEqual([]);
        expect(await second.recorder.payload("../../outside")).toBeNull();
        expect(await readFile(join(index, "2026-11-13.jsonl"), "utf8")).toBe(`{"v":2,"seq":1,"id":"x","kind":"start"}\n{"v":2`);
        expect(second.reports.map((report) => report.code)).toEqual(["requests.unreadable", "requests.unreadable"]);
    });
});
