/**
 * Agent 的上下文压缩（docs/specs/agent/compaction.md；测试名里的编号是它的输出条目与验收场景）：真实服务端内核装 `nbook.files`、
 * `nbook.models`、`nbook.agent`，模型是本机的 OpenAI 兼容端点，脚本化地回复，断言落在端点收到的请求与日志事件上。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {CompactionMethodImpl, LogEvent, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {agentCompactionMethod, agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let commands = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "compaction");
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

const MAIN = "test.cp.main";
const VENDOR = "test.cp.vendor";
const VENDOR_METHOD = "test.cp.method";
const BIG = "test.cp.big";
const cid = () => `c-${String((commands += 1))}`;
/** 一条估算约 25,000 token 的用户消息（每 3 字节一个 token）：超过下面设的触发点 20,000，本身又超过保留窗口 20,000。 */
const HUGE = "写".repeat(25_000);

/** 窗口 20 万、触发点 2 万；压缩角色绑同一个模型。 */
function modelSettings(window = 200_000, compactAt = 20_000): Record<string, unknown> {
    const base = localModelSettings(endpoint.baseUrl) as {"nbook.models/providers": {models: Record<string, unknown>[]}[]; "nbook.models/roles": {items: {id: string; model: string | null}[]}};
    base["nbook.models/providers"][0]!.models = [{id: "m", enabled: true, contextWindow: window, compactAt}];
    for (const item of base["nbook.models/roles"].items) if (item.id === "compaction") item.model = "local/m";
    return base;
}

let vendorCalls: string[] = [];
/** 第三方方法：交回一份固定的摘要，切点取最后一个。 */
const vendorMethod: CompactionMethodImpl = async (job) => {
    vendorCalls.push(job.reason);
    const cut = job.cuts.at(-1)!;
    return {method: job.method, firstKeptEntryId: cut.entryId, replacement: "第三方的摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: cut.tokensKept + 5};
};

/** 结果约 25,000 token 的工具：shake 不认识它，不会省。 */
const bigTool: AgentToolImplementation = {create: () => ({execute: async () => "x".repeat(75_000)})};

function testPlugin(): PluginDefinition {
    const method = agentCompactionMethod(VENDOR_METHOD);
    const big = agentTool(BIG, {description: "交回一大段文字", parameters: {type: "object", properties: {}}, version: "1", effect: "read"});
    const profiles = [agentProfile(MAIN, {name: MAIN, description: "测试用", tools: {required: ["nbook.agent.read", "nbook.agent.edit", BIG], optional: []}}), agentProfile(VENDOR, {name: VENDOR, description: "测试用", tools: {required: ["nbook.agent.read", "nbook.agent.edit", BIG], optional: []}})];
    return {id: "test.cp", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", ...profiles.map((item) => item.activationEvent), method.activationEvent, big.activationEvent],
        contributions: [...profiles.map((item) => item.contribution), method.contribution, big.contribution],
        activate: () => ({contributions: {
            "agent.profiles": {
                [MAIN]: defineProfile({id: MAIN, version: "1", name: MAIN, description: "测试用", system: "测试。", tools: {required: ["nbook.agent.read", "nbook.agent.edit", BIG], optional: []}}),
                [VENDOR]: defineProfile({id: VENDOR, version: "1", name: VENDOR, description: "测试用", system: "测试。", tools: {required: ["nbook.agent.read", "nbook.agent.edit", BIG], optional: []}, compaction: {onThreshold: [VENDOR_METHOD]}}),
            },
            "agent.compactionMethods": {[VENDOR_METHOD]: vendorMethod},
            "agent.tools": {[BIG]: bigTool},
        }}),
    })]};
}

async function world(window?: number, compactAt?: number): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...modelSettings(window, compactAt), "nbook.agent/profileSettings": {[MAIN]: {approvalMode: "yolo"}, [VENDOR]: {approvalMode: "yolo"}}}});
    worlds.push(created);
    return created;
}

async function open(w: AgentWorld, profile = MAIN): Promise<{readonly session: SessionApi; readonly id: string; readonly home: string}> {
    const created = await w.service.create({profile});
    if (!created.ok) throw new Error(created.code);
    return {session: created.value, id: created.value.id, home: join(w.stateRoot, "agent", "sessions", created.value.id, "home")};
}

async function say(session: SessionApi, text: string): Promise<{readonly reason: string; readonly events: readonly LogEvent[]}> {
    const before = (await session.path()).length;
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    const result = await session.waitRun(sent.value.runId);
    return {reason: result.reason, events: (await session.path()).slice(before)};
}

const dataOf = (events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as Record<string, unknown>);
const purposes = (events: readonly LogEvent[]) => dataOf(events, "modelStarted").map((data) => data.purpose);
const textOf = (message: {readonly content?: unknown}): string => (typeof message.content === "string" ? message.content : JSON.stringify(message.content));

describe("方法与缺省顺序", () => {
    test("输出 1：超过阈值，shake 省得够就停：旧的读文件结果换成占位，对话和摘要都没动，不调压缩的模型", async () => {
        const w = await world();
        const {session, id, home} = await open(w);
        await mkdir(home, {recursive: true});
        for (const name of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(home, name), Array.from({length: 1_500}, (_, line) => `${name} 第 ${String(line)} 行的内容`).join("\n"));
        for (const name of ["a.txt", "b.txt", "c.txt"]) {
            endpoint.script({tool: "read", args: {path: `sessions://${id}/home/${name}`}}, "好");
            expect((await say(session, `读 ${name}`)).reason).toBe("completed");
        }
        const requestsBefore = endpoint.requests.length;
        endpoint.script("最后的回答");
        const last = await say(session, HUGE);
        expect(last.reason).toBe("completed");
        expect(purposes(last.events)).toEqual(["turn"]);
        const compaction = dataOf(last.events, "compaction")[0]!;
        expect(compaction).toMatchObject({method: "nbook.agent.shake", replacement: null});
        expect((compaction.omitted as unknown[]).length).toBeGreaterThanOrEqual(3);
        const sent = endpoint.requests.slice(requestsBefore);
        expect(sent).toHaveLength(1);
        const tools = sent[0]!.messages.filter((message) => message.role === "tool").map(textOf);
        expect(tools.length).toBeGreaterThanOrEqual(3);
        for (const text of tools) expect(text).toContain("内容已省略");
        // shake 没丢对话，不放回（输出 7）。
        expect(compaction.restored).toBeUndefined();
        expect(JSON.stringify(sent[0]!.messages)).not.toContain("压缩之前你读过");
        expect(JSON.stringify(sent[0]!.messages)).not.toContain("第 1499 行的内容");
    });

    test("输出 2：shake 没东西可省换就地：用会话的模型，追加压缩请求，工具声明不变、不许调用工具；摘要排在后面的请求前面", async () => {
        const w = await world();
        const {session} = await open(w);
        endpoint.script("答一");
        await say(session, "第一问");
        endpoint.script("就地的摘要", "答二");
        const before = endpoint.requests.length;
        const second = await say(session, HUGE);
        expect(second.reason).toBe("completed");
        expect(purposes(second.events)).toEqual(["compaction", "turn"]);
        const compaction = dataOf(second.events, "compaction")[0]!;
        expect(compaction).toMatchObject({method: "nbook.agent.inplace", replacement: "就地的摘要"});
        const [asked, answered] = endpoint.requests.slice(before);
        expect(asked!.tools).toEqual(["read", "edit", "test__cp__big"]);
        expect(asked!.options).toMatchObject({toolChoice: "none", maxTokens: 16_384});
        expect(textOf(asked!.messages.at(-1)!)).toContain("上下文快满了");
        // 前缀和对话请求相同：压缩请求的消息是对话请求的前缀加一条。
        expect(answered!.tools).toEqual(asked!.tools);
        expect(JSON.stringify(answered!.messages)).toContain("就地的摘要");
    });

    test("输出 2：就地的回复带工具调用算失败，换到摘要：用压缩的角色发，系统提示词是摘要的，消息里只有对话", async () => {
        const w = await world();
        const {session, id} = await open(w);
        endpoint.script("答一");
        await say(session, "第一问：开头要冷峻");
        endpoint.script({tool: "read", args: {path: `sessions://${id}/home/x`}}, "写完的摘要", "答二");
        const before = endpoint.requests.length;
        const second = await say(session, HUGE);
        expect(second.reason).toBe("completed");
        expect(purposes(second.events)).toEqual(["compaction", "compaction", "turn"]);
        expect(dataOf(second.events, "compaction")[0]).toMatchObject({method: "nbook.agent.summary", replacement: "写完的摘要"});
        const [, summarizing] = endpoint.requests.slice(before);
        expect(summarizing!.tools).toEqual([]);
        expect(summarizing!.system).toContain("用户的要求");
        expect(JSON.stringify(summarizing!.messages)).toContain("第一问：开头要冷峻");
        // 开场、规则文件、扩展的槽每次请求都重新渲染，不进摘要的输入。
        expect(JSON.stringify(summarizing!.messages)).not.toContain("测试。");
    });
});

describe("切点", () => {
    test("输出 4：运行中途压缩，切点落在只调工具的回复上：这一步的结果原样留着，不进摘要的输入", async () => {
        const w = await world();
        const {session} = await open(w);
        endpoint.script("答一");
        await say(session, "第一问：开头要冷峻");
        // 第二问里模型先调一次大工具；结果让估算超过触发点，下一个边界压缩，这时切点是这一步的回复（它没有文字）。
        endpoint.script({tool: "test__cp__big"}, {tool: "read", args: {path: "session://nothing"}}, "摘要：冷峻", "答二");
        const before = endpoint.requests.length;
        const second = await say(session, "第二问：查一下");
        expect(second.reason).toBe("completed");
        const compaction = dataOf(second.events, "compaction")[0]!;
        expect(compaction.method).toBe("nbook.agent.summary");
        const reply = second.events.find((event) => event.type === "assistant")!;
        expect(compaction.firstKeptEntryId).toBe(reply.id);
        const summarizing = endpoint.requests.slice(before).find((request) => request.tools.length === 0)!;
        expect(JSON.stringify(summarizing.messages)).toContain("第一问：开头要冷峻");
        expect(JSON.stringify(summarizing.messages)).not.toContain("xxxxxxxxxx");
        const final = endpoint.requests.at(-1)!;
        expect(JSON.stringify(final.messages)).toContain("xxxxxxxxxx");
        expect(JSON.stringify(final.messages)).toContain("摘要：冷峻");
    });
});

describe("溢出", () => {
    test("输出 2：服务商回 413 也走压缩：shake 没得省换摘要，同一请求重发一次", async () => {
        const w = await world();
        const {session} = await open(w);
        endpoint.script("答一");
        await say(session, "第一问");
        endpoint.script({status: 413}, "413 之后的摘要", "答二");
        const second = await say(session, "第二问");
        expect(second.reason).toBe("completed");
        expect(purposes(second.events)).toEqual(["turn", "compaction", "turn"]);
        expect(dataOf(second.events, "modelFailed")[0]).toMatchObject({kind: "context_overflow", status: 413});
        expect(dataOf(second.events, "compaction")[0]).toMatchObject({method: "nbook.agent.summary", replacement: "413 之后的摘要"});
    });
});

describe("贡献的方法", () => {
    test("输出 12：第三方方法经贡献点按 Profile 的顺序调用，结果和内置的一样写进日志", async () => {
        vendorCalls = [];
        const w = await world();
        const {session} = await open(w, VENDOR);
        endpoint.script("答一");
        await say(session, "第一问");
        endpoint.script("答二");
        const second = await say(session, HUGE);
        expect(second.reason).toBe("completed");
        expect(vendorCalls).toEqual(["threshold"]);
        expect(dataOf(second.events, "compaction")[0]).toMatchObject({method: VENDOR_METHOD, replacement: "第三方的摘要"});
        expect(purposes(second.events)).toEqual(["turn"]);
    });
});

describe("放回", () => {
    const tagOf = (request: {readonly messages: readonly unknown[]}): string => /#([0-9A-F]{4})\]/u.exec(JSON.stringify(request.messages))?.[1] ?? "";

    test("输出 7–11：摘要之后放回最近读过的文件：读失败的不放，行锚和 read 给的一样能直接 edit，日志地址在里面；shake 不放回", async () => {
        const w = await world();
        const {session, id, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        endpoint.script({tool: "read", args: {path: `sessions://${id}/home/a.md`}}, {tool: "read", args: {path: `sessions://${id}/home/missing.md`}}, "好");
        await say(session, "读两个文件");
        // 读失败的那个文件后来才有：放回只认成功的调用，不能因为现在读得到就放进去。
        await writeFile(join(home, "missing.md"), "后来才有的内容");
        endpoint.script("摘要", "答二");
        const before = endpoint.requests.length;
        const second = await say(session, HUGE);
        const compaction = dataOf(second.events, "compaction")[0]!;
        expect(compaction.method).toBe("nbook.agent.inplace");
        const restored = compaction.restored as {kind: string; target: string; truncated: boolean}[];
        expect(restored.map((item) => item.kind)).toEqual(["file", "log"]);
        expect(restored[0]).toMatchObject({target: `sessions://${id}/home/a.md`, truncated: false});
        expect(restored[1]!.target).toBe(`sessions://${id}/session.jsonl`);
        const after = endpoint.requests.slice(before).at(-1)!;
        expect(JSON.stringify(after.messages)).toContain("压缩之前你读过或改过这个文件");
        expect(JSON.stringify(after.messages)).not.toContain("后来才有的内容");
        expect(JSON.stringify(after.messages)).toContain(`sessions://${id}/session.jsonl`);
        // 放回给的行锚直接能改：这一轮里没有 read 过。
        endpoint.script({tool: "edit", args: {input: `[sessions://${id}/home/a.md#${tagOf(after)}]\nPUT 2.=2:\n+贰\n`}}, "好");
        await say(session, "把第二行改成贰");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n三\n");
    });

    test("输出 8、10：放回的合计不超过窗口的四分之一：小窗口的模型上文件被截断，并标出来", async () => {
        const w = await world(8_000, 2_000);
        const {session, id, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "long.md"), Array.from({length: 3_000}, (_, line) => `第 ${String(line)} 行`).join("\n"));
        endpoint.script({tool: "read", args: {path: `sessions://${id}/home/long.md`, limit: 5}}, "好");
        await say(session, "读一下");
        endpoint.script("摘要", "答二");
        const second = await say(session, HUGE);
        const restored = (dataOf(second.events, "compaction")[0]!.restored as {kind: string; tokens: number; truncated: boolean}[]).find((item) => item.kind === "file")!;
        expect(restored.truncated).toBe(true);
        expect(restored.tokens).toBeLessThanOrEqual(2_000);
    });

    test("输出 8、9：一个文件读到一半出问题（没有权限）或单行就超预算：只跳过它，别的文件照放", async () => {
        const w = await world(8_000, 2_000);
        const {session, id, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "ok.md"), "好文件\n");
        await writeFile(join(home, "locked.md"), "读得到的时候没问题\n");
        await writeFile(join(home, "wide.md"), "宽".repeat(6_000));
        endpoint.script({tool: "read", args: {path: `sessions://${id}/home/ok.md`}}, {tool: "read", args: {path: `sessions://${id}/home/locked.md`}}, {tool: "read", args: {path: `sessions://${id}/home/wide.md`}}, "好");
        await say(session, "读三个文件");
        await chmod(join(home, "locked.md"), 0o000);
        try {
            endpoint.script("摘要", "答二");
            const second = await say(session, HUGE);
            const restored = dataOf(second.events, "compaction")[0]!.restored as {kind: string; target: string; tokens: number}[];
            expect(restored.filter((item) => item.kind === "file").map((item) => item.target)).toEqual([`sessions://${id}/home/ok.md`]);
            expect(dataOf(second.events, "compaction")[0]!.method).toBe("nbook.agent.inplace");
        } finally {
            await chmod(join(home, "locked.md"), 0o600);
        }
    });
});
