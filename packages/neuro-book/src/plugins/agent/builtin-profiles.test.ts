/**
 * 内置 Profile（docs/specs/agent/builtin-profiles.md）：真实服务端内核、真实设置与文件服务，模型是本机的 OpenAI 兼容端点。测试名里的
 * 编号是这份 Spec 的输出条目与验收场景。提示词的措辞会按实际创作继续改，这里只锁节名与工具。
 *
 * 应用里还没有压缩方法（t11）：压缩由测试扩展在 `intercept.compaction` 里交回结果，内核的后续路径是真的。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineExtension} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {loadRules} from "./backend/builtin/profiles/rules";
import {ResourceReadError} from "./backend/resources";
import {MAIN_PROFILE} from "./shared/contracts";
import {agentExtension} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, SeenRequest} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "builtin-profiles");
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

let commands = 0;
const cid = () => `b-${String((commands += 1))}`;

interface WorldOptions {
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly plugins?: readonly PluginDefinition[];
    /** 建场地之前写进 `<状态根>/user/AGENTS.md`。 */
    readonly userRules?: string;
}

async function world(options: WorldOptions = {}): Promise<AgentWorld> {
    counter += 1;
    const base = join(root, `w${String(counter)}`);
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
        const compactor = agentExtension("test.compactor.ext");
        const plugin: PluginDefinition = {id: "test.compactor", entries: [defineEntry({id: "server", location: "server", activationEvents: [compactor.activationEvent], contributions: [compactor.contribution], activate: () => ({contributions: {"agent.extensions": {"test.compactor.ext": defineExtension({id: "test.compactor.ext", intercept: {
            compaction: async (job) => {
                const cut = job.cuts.filter((item) => item.kind === "turn").at(-1);
                return cut === undefined ? {failed: "no-cut"} : {method: job.method, firstKeptEntryId: cut.entryId, replacement: "前情摘要", omitted: [], tokensBefore: 100, tokensAfter: 10};
            },
        }})}}})})]};
        const w = await world({userRules: "旧规则。", plugins: [plugin], settings: {"nbook.models/roles": {items: ["tiny", "fast", "main", "deep", "compaction"].map((id) => ({id, axis: id === "compaction" ? "specialist" : "gradient", name: "", description: "", model: id === "main" || id === "compaction" ? "local/m" : null}))}}});
        const session = await createMain(w);
        expect(messagesText(await turn(session, "第一轮"))).toContain("旧规则。");
        await writeFile(join(w.stateRoot, "user", "AGENTS.md"), "新规则。");
        expect(messagesText(await turn(session, "第二轮"))).toContain("旧规则。");

        const compacted = await session.compact({commandId: cid()});
        if (!compacted.ok || compacted.value.runId === undefined) throw new Error(`compact failed: ${JSON.stringify(compacted)}`);
        await session.waitRun(compacted.value.runId);
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
