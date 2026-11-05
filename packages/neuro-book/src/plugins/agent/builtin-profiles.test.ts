/**
 * 内置 Profile（docs/specs/agent/builtin-profiles.md）：真实服务端内核、真实设置与文件服务，模型是本机的 OpenAI 兼容端点。测试名里的
 * 编号是这份 Spec 的输出条目与验收场景。提示词的措辞会按实际创作继续改，这里只锁节名与工具。
 *
 * 应用里还没有压缩方法（t11）：压缩由测试扩展在 `intercept.compaction` 里交回结果，内核的后续路径是真的。
 */

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createJsonlStore, defineExtension} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";

import {loadRules} from "./backend/builtin/profiles/rules";
import {ResourceReadError} from "./backend/resources";
import {titleSessionId} from "./backend/session-meta";
import {MAIN_PROFILE, SESSION_TITLE_PROFILE} from "./shared/contracts";
import {agentExtension, agentTool} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, SeenRequest} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
/** tiny 角色的模型：标题请求单独一个端点，主会话的脚本与请求数不混在一起。 */
let tiny: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "builtin-profiles");
    endpoint = fakeEndpoint();
});
beforeEach(() => {
    tiny = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
    tiny.stop();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `b-${String((commands += 1))}`;

interface WorldOptions {
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly plugins?: readonly PluginDefinition[];
    /** 建场地之前写进 `<状态根>/user/AGENTS.md`。 */
    readonly userRules?: string;
    /** 用已有的目录（重启）。 */
    readonly at?: string;
}

async function world(options: WorldOptions = {}): Promise<AgentWorld> {
    counter += 1;
    const base = options.at ?? join(root, `w${String(counter)}`);
    if (options.userRules !== undefined) {
        await mkdir(join(base, "state", "user"), {recursive: true});
        await writeFile(join(base, "state", "user", "AGENTS.md"), options.userRules);
    }
    const created = await agentWorld(base, {plugins: options.plugins ?? [], userSettings: {...localModelSettings(endpoint.baseUrl), ...options.settings}});
    worlds.push(created);
    return created;
}

async function createMain(w: AgentWorld): Promise<SessionApi> {
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(`create failed: ${created.code} ${JSON.stringify(created.detail)}`);
    return created.value;
}

/** 跑一轮，交回这一轮发给模型的请求。 */
async function turn(session: SessionApi, text: string): Promise<SeenRequest> {
    const sent = endpoint.requests.length;
    endpoint.script("好");
    const accepted = await session.send({commandId: cid(), input: {text}});
    if (!accepted.ok || accepted.value.runId === null) throw new Error(`send failed: ${JSON.stringify(accepted)}`);
    await session.waitRun(accepted.value.runId);
    return endpoint.requests[sent]!;
}

/** 一个本机服务商，加另一个给 tiny 角色用的（`compaction` 角色也绑上，压缩才走得到）。 */
const withTiny = (): Record<string, unknown> => ({
    "nbook.models/providers": [
        {id: "local", kind: "custom", name: "本机", baseUrl: endpoint.baseUrl, api: "openai-completions", auth: "none", models: [{id: "m", enabled: true, contextWindow: 32_000}]},
        {id: "small", kind: "custom", name: "小模型", baseUrl: tiny.baseUrl, api: "openai-completions", auth: "none", models: [{id: "t", enabled: true, contextWindow: 32_000}]},
    ],
    "nbook.models/roles": {items: ["tiny", "fast", "main", "deep", "compaction"].map((id) => ({id, axis: id === "compaction" ? "specialist" : "gradient", name: "", description: "", model: id === "tiny" ? "small/t" : id === "fast" || id === "deep" ? null : "local/m"}))},
    "nbook.agent/modelRetries": 0,
});

const generated = (title: string, description: string) => ({tool: "yield", args: {title, description}});

/**
 * 压缩由这个测试扩展交回结果。`replacement` 为 null 时是不带摘要的压缩；传函数时每次压缩现取。
 *
 * 生成按前台会话排队：要断言“没有多发请求”时，用 `marker` 排一个压缩后的更新，等它写下，前面的项就都处理完了。
 */
function compactor(replacement: string | null | (() => string | null)): PluginDefinition {
    const extension = agentExtension("test.compactor.ext");
    return {id: "test.compactor", entries: [defineEntry({id: "server", location: "server", activationEvents: [extension.activationEvent], contributions: [extension.contribution], activate: () => ({contributions: {"agent.extensions": {"test.compactor.ext": defineExtension({id: "test.compactor.ext", intercept: {
        compaction: async (job) => {
            const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
            return cut === undefined ? {failed: "no-cut"} : {method: job.method, firstKeptEntryId: cut.entryId, replacement: typeof replacement === "function" ? replacement() : replacement, omitted: [], tokensBefore: 100, tokensAfter: 10};
        },
    }})}}})})]};
}

async function compact(session: SessionApi): Promise<void> {
    const compacted = await session.compact({commandId: cid()});
    if (!compacted.ok || compacted.value.runId === undefined) throw new Error(`compact failed: ${JSON.stringify(compacted)}`);
    await session.waitRun(compacted.value.runId);
}

/** 再跑一轮、压缩一次，等压缩后的说明写下（见 `compactor`）。 */
async function marker(session: SessionApi, description: string): Promise<void> {
    await turn(session, "标记前的一轮");
    tiny.script(generated("标记", description));
    await compact(session);
    await waitUntil("标记写下", async () => (await metaOf(session))[1] === description);
}

const diagnosticEvents = (w: AgentWorld): readonly string[] => w.settings.diagnostics("hub").query({}).records.map((record) => record.event);
const metaOf = async (session: SessionApi): Promise<readonly [string | null, string | null]> => {
    const snapshot = await session.snapshot();
    return [snapshot.title, snapshot.description];
};
const messagesText = (request: SeenRequest): string => JSON.stringify(request.messages.filter((message) => message.role !== "system"));
const SECTIONS = ["role", "work", "writing", "addresses"];

describe("主创", () => {
    test("输出 1、2、3：节都在，工具是该有的那些；目录里 Profile 可用", async () => {
        const w = await world();
        expect(w.service.profiles().find((profile) => profile.key === MAIN_PROFILE)).toMatchObject({status: "ok", source: "nbook.agent"});
        const request = await turn(await createMain(w), "开始");
        for (const section of SECTIONS) expect(request.system).toContain(`<${section}>`);
        expect(request.system).toContain("<shell>");
        expect([...request.tools].sort()).toEqual(["edit", "glob", "grep", "read", "shell", "write"]);
    });

    /** 让模型调一次 `edit`，交回这次调用实际执行的工具 id。 */
    async function editedBy(w: AgentWorld, session: SessionApi, args: Readonly<Record<string, unknown>>): Promise<string | undefined> {
        await mkdir(join(w.stateRoot, "agent", "sessions", session.id, "home"), {recursive: true});
        await writeFile(join(w.stateRoot, "agent", "sessions", session.id, "home", "a.md"), "甲\n");
        endpoint.script({tool: "edit", args}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "改一下"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        await session.waitRun(sent.value.runId);
        return (await session.path()).filter((event) => event.type === "toolResult").map((event) => (event.data as {tool: string}).tool).at(-1);
    }

    test("输出 2：缺省的 edit 是 replace", async () => {
        const w = await world({settings: {"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}}});
        const session = await createMain(w);
        expect(await editedBy(w, session, {path: "session://a.md", old_string: "甲", new_string: "乙"})).toBe("nbook.agent.edit-replace");
        expect(await readFile(join(w.stateRoot, "agent", "sessions", session.id, "home", "a.md"), "utf8")).toBe("乙\n");
    });

    test("输出 2、3：绑定能去掉 shell（节也没有了）、换一种 edit；必需的去不掉", async () => {
        const w = await world({settings: {"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}, "nbook.agent/toolBindings": {[MAIN_PROFILE]: {added: ["nbook.agent.edit"], removed: ["nbook.agent.shell", "nbook.agent.edit-replace", "nbook.agent.read"]}}}});
        const session = await createMain(w);
        const request = await turn(session, "开始");
        expect(request.system).not.toContain("<shell>");
        expect([...request.tools].sort()).toEqual(["edit", "glob", "grep", "read", "write"]);
        expect(await editedBy(w, session, {input: "不是合法的 hashline"})).toBe("nbook.agent.edit");
    });

    test("输出 4：用户的规则进开场并标明来源；没有文件时开场里没有；没有打开书不写诊断", async () => {
        const with_ = await world({userRules: "所有回复都用简体中文。"});
        const shown = messagesText(await turn(await createMain(with_), "开始"));
        expect(shown).toContain("user://AGENTS.md");
        expect(shown).toContain("所有回复都用简体中文。");
        expect(shown).not.toContain("book_rules");

        const without = await world();
        const session = await createMain(without);
        const plain = messagesText(await turn(session, "开始"));
        expect(plain).not.toContain("user_rules");
        expect((await session.diagnostics()).map((item) => item.code)).not.toContain("rules-unreadable");
    });

    test("输出 5：规则文件建会话时读；改了文件要到压缩之后才生效", async () => {
        const w = await world({userRules: "旧规则。", plugins: [compactor("前情摘要")], settings: {"nbook.models/roles": {items: ["tiny", "fast", "main", "deep", "compaction"].map((id) => ({id, axis: id === "compaction" ? "specialist" : "gradient", name: "", description: "", model: id === "main" || id === "compaction" ? "local/m" : null}))}}});
        const session = await createMain(w);
        expect(messagesText(await turn(session, "第一轮"))).toContain("旧规则。");
        await writeFile(join(w.stateRoot, "user", "AGENTS.md"), "新规则。");
        expect(messagesText(await turn(session, "第二轮"))).toContain("旧规则。");

        await compact(session);
        const after = messagesText(await turn(session, "第三轮"));
        expect(after).toContain("新规则。");
        expect(after).not.toContain("旧规则。");
    });
});

describe("规则文件的读取", () => {
    const files = (entries: Readonly<Record<string, string | Error>>) => ({
        resolve: (uri: string) => uri,
        read: async (uri: string) => {
            const value = entries[uri];
            if (value instanceof Error) throw value;
            return value;
        },
    });
    const reports = (): {readonly seen: string[]; report(code: string): void} => {
        const seen: string[] = [];
        return {seen, report: (code) => seen.push(code)};
    };

    test("输出 4：用户的在前、书的在后，各自标明来源", async () => {
        const {report} = reports();
        const parts = await loadRules(files({"user://AGENTS.md": "甲", "project://AGENTS.md": "乙"}), report);
        expect(parts.slice(1)).toEqual(["<user_rules source=\"user://AGENTS.md\">\n甲\n</user_rules>", "<book_rules source=\"project://AGENTS.md\">\n乙\n</book_rules>"]);
    });

    test("输出 4：超过 32 KiB 按 UTF-8 字节截断，不切开字符，标明全文的地址", async () => {
        const {report} = reports();
        // 每个字 3 字节，32 KiB 落在一个字的中间。
        const parts = await loadRules(files({"user://AGENTS.md": "规".repeat(11_000)}), report);
        const body = parts[1]!;
        expect(body).not.toContain("�");
        expect(body).toContain("规".repeat(10_922));
        expect(body).not.toContain("规".repeat(10_923));
        expect(body).toContain("全文读 user://AGENTS.md");

        const {report: quiet} = reports();
        const exact = await loadRules(files({"user://AGENTS.md": "a".repeat(32 * 1024)}), quiet);
        expect(exact[1]).not.toContain("全文读");
    });

    test("输出 4：没打开书不写诊断；别的读取失败写诊断，另一个文件照常", async () => {
        const quiet = reports();
        expect(await loadRules(files({"user://AGENTS.md": "甲", "project://AGENTS.md": new ResourceReadError("no-project", "project://AGENTS.md", "没有主项目")}), quiet.report)).toHaveLength(2);
        expect(quiet.seen).toEqual([]);

        const noisy = reports();
        const parts = await loadRules(files({"user://AGENTS.md": new ResourceReadError("not-text", "user://AGENTS.md", "不是 UTF-8 文本"), "project://AGENTS.md": "乙"}), noisy.report);
        expect(noisy.seen).toEqual(["rules-unreadable"]);
        expect(parts).toHaveLength(2);
        expect(parts[1]).toContain("乙");
    });

    test("输出 4：都没有时开场是空的", async () => {
        const {report} = reports();
        expect(await loadRules(files({}), report)).toEqual([]);
    });
});

describe("标题和说明", () => {
    test("输出 6、验收 1：第一轮后写进快照与列表；生成期间主会话能发下一条", async () => {
        const w = await world({settings: withTiny()});
        const session = await createMain(w);
        const hold = tiny.hold();
        tiny.script(generated("雨夜", "写第一章的开头"));
        await turn(session, "帮我写第一章");
        await hold.arrived;
        expect(await metaOf(session)).toEqual([null, null]);
        await turn(session, "再写一段");
        hold.release();
        await waitUntil("标题写下", async () => (await metaOf(session))[1] !== null);
        expect(await metaOf(session)).toEqual(["雨夜", "写第一章的开头"]);
        const listed = await w.service.list();
        if (!listed.ok) throw new Error(listed.code);
        expect(listed.value.filter((entry) => entry.id === session.id).map((entry) => [entry.title, entry.description])).toEqual([["雨夜", "写第一章的开头"]]);
    });

    test("输出 6、12：同时触发只发一次；有了标题和说明之后不再发", async () => {
        const w = await world({settings: withTiny(), plugins: [compactor("前情摘要")]});
        const session = await createMain(w);
        const hold = tiny.hold();
        tiny.script(generated("雨夜", "说明"));
        await turn(session, "第一轮");
        await hold.arrived;
        await turn(session, "第二轮");
        await turn(session, "第三轮");
        hold.release();
        await waitUntil("标题写下", async () => (await metaOf(session))[0] !== null);
        await marker(session, "标记");
        expect(tiny.requests).toHaveLength(2);
    });

    test("输出 7：材料是第一条用户的话和第一条有文字的回复，各取前 2000 个字符，标明是材料", async () => {
        const w = await world({settings: withTiny()});
        const session = await createMain(w);
        tiny.script(generated("甲", "乙"));
        const sent = endpoint.requests.length;
        endpoint.script({tool: "grep", args: {pattern: "x", path: "session://"}}, `${"回".repeat(2000)}多余的回复`);
        const accepted = await session.send({commandId: cid(), input: {text: `${"问".repeat(2000)}多余的问题`}});
        if (!accepted.ok || accepted.value.runId === null) throw new Error("send failed");
        await session.waitRun(accepted.value.runId);
        expect(endpoint.requests.length - sent).toBe(2);
        await waitUntil("标题请求到达", () => tiny.requests.length === 1);
        const body = messagesText(tiny.requests[0]!);
        expect(tiny.requests[0]!.system).toContain("<conversation>");
        expect(body).toContain("<conversation>");
        expect(body).toContain("问".repeat(2000));
        expect(body).toContain("回".repeat(2000));
        expect(body).not.toContain("多余的");
    });

    test("输出 8：带摘要的压缩只更新说明，用的是摘要与当前标题；压缩运行结束不触发生成标题", async () => {
        const w = await world({settings: withTiny(), plugins: [compactor("前情摘要")]});
        const session = await createMain(w);
        tiny.script(generated("雨夜", "第一版说明"));
        await turn(session, "第一轮");
        await waitUntil("第一版", async () => (await metaOf(session))[1] !== null);
        await turn(session, "第二轮");
        tiny.script(generated("压缩后不该用的标题", "第二版说明"));
        await compact(session);
        await waitUntil("说明更新", async () => (await metaOf(session))[1] === "第二版说明");
        expect((await metaOf(session))[0]).toBe("雨夜");
        const body = messagesText(tiny.requests[1]!);
        expect(body).toContain("前情摘要");
        expect(body).toContain("雨夜");
        await marker(session, "第三版说明");
        expect(tiny.requests).toHaveLength(3);
    });

    test("输出 8：不带摘要的压缩不更新；压缩后的生成失败不会变成生成标题", async () => {
        let summary: string | null = null;
        const quiet = await world({settings: withTiny(), plugins: [compactor(() => summary)]});
        const session = await createMain(quiet);
        tiny.script(generated("雨夜", "说明"));
        await turn(session, "第一轮");
        await waitUntil("第一版", async () => (await metaOf(session))[1] !== null);
        await turn(session, "第二轮");
        await compact(session);
        summary = "前情摘要";
        await marker(session, "标记");
        expect(tiny.requests).toHaveLength(2);

        const before = tiny.requests.length;
        const failing = await world({settings: withTiny(), plugins: [compactor("前情摘要")]});
        const other = await createMain(failing);
        tiny.script(generated("雨夜", "说明"));
        await turn(other, "第一轮");
        await waitUntil("第一版", async () => (await metaOf(other))[1] !== null);
        await turn(other, "第二轮");
        tiny.script({status: 400});
        await compact(other);
        await waitUntil("失败的诊断", () => diagnosticEvents(failing).includes("agent.session-meta-failed"));
        await turn(other, "第三轮");
        expect(await metaOf(other)).toEqual(["雨夜", "说明"]);
        expect(tiny.requests.length - before).toBe(2);
    });

    test("输出 9：标题会话不进列表、running() 与 sessions://；按 id 读得到；前台费用不算它；第二次请求不带第一次的内容", async () => {
        const w = await world({settings: withTiny(), plugins: [compactor("前情摘要")]});
        const session = await createMain(w);
        const hold = tiny.hold();
        tiny.script(generated("雨夜", "说明"));
        await turn(session, "第一轮的独有内容");
        await hold.arrived;
        const titleId = titleSessionId(session.id);
        expect(w.service.running()).not.toContain(titleId);
        expect((await w.service.session(titleId).snapshot()).status.state).toBe("running");
        hold.release();
        await waitUntil("标题写下", async () => (await metaOf(session))[1] !== null);

        const listed = await w.service.list();
        if (!listed.ok) throw new Error(listed.code);
        expect(listed.value.map((entry) => entry.id)).toEqual([session.id]);
        expect((await session.snapshot()).usage.unpriced).toBe(1);

        await turn(session, "第二轮");
        tiny.script(generated("雨夜", "第二版"));
        await compact(session);
        await waitUntil("说明更新", async () => (await metaOf(session))[1] === "第二版");
        expect(messagesText(tiny.requests[1]!)).not.toContain("第一轮的独有内容");
        expect((await w.service.session(titleId).snapshot()).header).toMatchObject({profile: SESSION_TITLE_PROFILE, background: true});
    });

    test("输出 10、验收 2：生成进行中用户改名，用户的名字保留，说明照写；之后的更新也不改名字", async () => {
        const w = await world({settings: withTiny(), plugins: [compactor("前情摘要")]});
        const session = await createMain(w);
        const hold = tiny.hold();
        tiny.script(generated("生成的标题", "说明一"));
        await turn(session, "第一轮");
        await hold.arrived;
        await session.setTitle({commandId: cid(), title: "我的书"});
        hold.release();
        await waitUntil("说明写下", async () => (await metaOf(session))[1] !== null);
        expect(await metaOf(session)).toEqual(["我的书", "说明一"]);
    });

    test("输出 11、验收 3：tiny 没绑时不发请求，用第一句话作兜底标题；绑上之后换成生成的", async () => {
        const w = await world({settings: {...withTiny(), "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? "local/m" : null}))}}});
        const session = await createMain(w);
        await turn(session, `  第一句话
很长很长，${"字".repeat(40)}`);
        await waitUntil("兜底标题", async () => (await metaOf(session))[0] !== null);
        expect(await metaOf(session)).toEqual([`第一句话 很长很长，${"字".repeat(20)}`, null]);
        expect(tiny.requests).toHaveLength(0);

        const settings = JSON.parse(await readFile(w.settings.userFile, "utf8")) as Record<string, unknown>;
        await writeFile(w.settings.userFile, JSON.stringify({...settings, ...withTiny()}));
        tiny.script(generated("生成的标题", "生成的说明"));
        // 文件变化的重读按设置场地的手动时钟合并。
        await waitUntil("换成生成的", async () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            await turn(session, "再来一轮");
            return (await metaOf(session))[1] !== null;
        });
        expect(await metaOf(session)).toEqual(["生成的标题", "生成的说明"]);
    });

    test("输出 12：模型失败或不调 yield 写诊断，不改标题和说明；下一轮结束再试", async () => {
        const w = await world({settings: withTiny()});
        const session = await createMain(w);
        tiny.script({status: 400});
        await turn(session, "第一轮");
        await waitUntil("失败的诊断", () => diagnosticEvents(w).includes("agent.session-meta-failed"));
        expect(await metaOf(session)).toEqual([null, null]);

        tiny.script("不用工具", "还是不用工具");
        await turn(session, "第二轮");
        await waitUntil("第二次失败的诊断", () => diagnosticEvents(w).filter((event) => event === "agent.session-meta-failed").length === 2);
        expect(await metaOf(session)).toEqual([null, null]);

        tiny.script(generated("雨夜", "说明"));
        await turn(session, "第三轮");
        await waitUntil("再试成功", async () => (await metaOf(session))[1] !== null);
        expect(await metaOf(session)).toEqual(["雨夜", "说明"]);
    });

    test("输出 13：标题 Profile 的工具集只有 yield，装到所有 Profile 的工具不进来；目录里带 hidden", async () => {
        const everywhere = agentTool("test.every.tool", {description: "到处都有", parameters: {type: "object", properties: {}}, version: "1", effect: "read", defaultForAll: true});
        const plugin: PluginDefinition = {id: "test.every", entries: [defineEntry({id: "server", location: "server", activationEvents: [everywhere.activationEvent], contributions: [everywhere.contribution], activate: () => ({contributions: {"agent.tools": {"test.every.tool": {create: () => ({execute: async () => "ok"})}}}})})]};
        const w = await world({settings: withTiny(), plugins: [plugin]});
        expect(w.service.profiles().find((profile) => profile.key === SESSION_TITLE_PROFILE)).toMatchObject({hidden: true, status: "ok"});
        const session = await createMain(w);
        tiny.script(generated("雨夜", "说明"));
        const main = await turn(session, "第一轮");
        expect(main.tools).toContain("test__every__tool");
        await waitUntil("标题写下", async () => (await metaOf(session))[1] !== null);
        expect(tiny.requests[0]!.tools).toEqual(["yield"]);
    });

    test("时序：生成中停止插件不写诊断，不留下打开的会话；重启后下一轮结束再生成，上次中断的标题会话接着用", async () => {
        const w = await world({settings: withTiny()});
        const session = await createMain(w);
        const hold = tiny.hold();
        await turn(session, "第一轮");
        await hold.arrived;
        const diagnostics = w.settings.diagnostics("hub");
        const closing = w.close();
        worlds.splice(worlds.indexOf(w), 1);
        hold.release();
        await closing;
        expect(diagnostics.query({}).records.map((record) => record.event)).not.toContain("agent.session-meta-failed");

        const titleId = titleSessionId(session.id);
        const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
        const opened = await store.open(titleId);
        if (!opened.ok) throw new Error(`the title session is still held: ${opened.code}`);
        await store.close(opened.value);

        const again = await world({settings: withTiny(), at: join(w.stateRoot, "..")});
        const reopened = again.service.session(session.id);
        tiny.script(generated("雨夜", "说明"));
        await turn(reopened, "第二轮");
        await waitUntil("重启后生成", async () => (await metaOf(reopened))[1] !== null);
        expect(await metaOf(reopened)).toEqual(["雨夜", "说明"]);
    });

    test("时序：一轮刚结束就停止（生成还在建标题会话）也不留下打开的会话", async () => {
        const w = await world({settings: withTiny()});
        const session = await createMain(w);
        await turn(session, "第一轮");
        const closing = w.close();
        worlds.splice(worlds.indexOf(w), 1);
        await closing;
        const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
        const opened = await store.open(titleSessionId(session.id));
        if (opened.ok) await store.close(opened.value);
        else expect(opened.code).not.toBe("session-busy");
    });

    test("时序：会话头是后台或有调用方时不生成；fork 出的会话自己生成", async () => {
        const w = await world({settings: withTiny()});
        const started = await w.service.startTask({taskId: "3f2a7c10-0000-4000-8000-000000000001", profile: MAIN_PROFILE, input: {text: "后台任务"}, background: true});
        if (!started.ok) throw new Error(started.code);
        await started.result;

        const session = await createMain(w);
        tiny.script(generated("雨夜", "说明"));
        await turn(session, "第一轮");
        await waitUntil("标题写下", async () => (await metaOf(session))[1] !== null);
        // 后台会话也生成的话，它的请求会先到（队列各走各的，这里只抓得到错的情况，不会误报）。
        expect(tiny.requests.map((request) => messagesText(request).includes("后台任务"))).toEqual([false]);
        const forked = await session.fork({commandId: cid()});
        if (!forked.ok) throw new Error(forked.code);
        const copy = w.service.session(forked.value.sessionId);
        expect(await metaOf(copy)).toEqual([null, null]);
        tiny.script(generated("分支", "分支的说明"));
        await turn(copy, "分支的一轮");
        await waitUntil("分支的标题", async () => (await metaOf(copy))[1] !== null);
        expect(await metaOf(copy)).toEqual(["分支", "分支的说明"]);
        expect(await metaOf(session)).toEqual(["雨夜", "说明"]);
    });

    test("失败码：前台 id 有 128 个字符也能生成；标题会话的 id 被别的会话占了就报冲突，不往里发", async () => {
        const w = await world({settings: withTiny()});
        const long = await w.service.create({profile: MAIN_PROFILE, id: "a".repeat(128)});
        if (!long.ok) throw new Error(long.code);
        tiny.script(generated("雨夜", "说明"));
        await turn(long.value, "第一轮");
        await waitUntil("标题写下", async () => (await metaOf(long.value))[1] !== null);

        const taken = "b".repeat(16);
        const squatter = await w.service.create({profile: MAIN_PROFILE, id: titleSessionId(taken)});
        if (!squatter.ok) throw new Error(squatter.code);
        const victim = await w.service.create({profile: MAIN_PROFILE, id: taken});
        if (!victim.ok) throw new Error(victim.code);
        const before = tiny.requests.length;
        const untouched = (await squatter.value.snapshot()).head;
        await turn(victim.value, "第一轮");
        await waitUntil("冲突的诊断", () => diagnosticEvents(w).includes("agent.session-meta-conflict"));
        expect(tiny.requests.length).toBe(before);
        expect((await squatter.value.snapshot()).head).toBe(untouched);
        expect(await metaOf(victim.value)).toEqual([null, null]);
    });
});
