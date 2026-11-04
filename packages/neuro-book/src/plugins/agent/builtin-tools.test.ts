/**
 * Agent 的内置工具（docs/specs/agent/builtin-tools.md；测试名里的编号是它的输出条目与验收场景）：真实服务端内核装 `nbook.files`、
 * `nbook.agent`，模型是本机的 OpenAI 兼容端点，脚本化地调用这些工具，断言落在工具结果事件与真实文件上。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import type {SessionArtifacts, SessionResources} from "./shared/resources";
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
    root = await createTestTmpRoot("neuro-book-agent", "builtin-tools");
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

const MAIN = "test.bt.main";
const REPLACE = "test.bt.replace";
const GRAB = "test.bt.grab";
const BUILTIN = ["read", "write"].map((name) => `nbook.agent.${name}`);
const cid = () => `c-${String((commands += 1))}`;

/** 测试工具拿到的服务：断言宿主写全文、对照资源视图。 */
let grabbed: {resources: SessionResources; artifacts: SessionArtifacts} | null = null;

function testPlugin(): PluginDefinition {
    const profiles = [agentProfile(MAIN, {name: MAIN, description: "测试用", tools: {required: [...BUILTIN, GRAB], optional: []}}), agentProfile(REPLACE, {name: REPLACE, description: "测试用", tools: {required: [GRAB], optional: []}})];
    const tool = agentTool(GRAB, {description: "交出服务", parameters: {type: "object", properties: {}}, version: "1", effect: "read"});
    const grab: AgentToolImplementation = {create: (_context, services) => {
        grabbed = services;
        return {execute: async () => "ok"};
    }};
    return {id: "test.bt", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: [...profiles.map((item) => item.activationEvent), tool.activationEvent],
        contributions: [...profiles.map((item) => item.contribution), tool.contribution],
        activate: () => ({contributions: {
            "agent.profiles": Object.fromEntries([MAIN, REPLACE].map((key) => [key, defineProfile({id: key, version: "1", name: key, description: "测试用", system: "测试。", tools: {required: key === MAIN ? [...BUILTIN, GRAB] : [GRAB]}})])),
            "agent.tools": {[GRAB]: grab},
        }}),
    })]};
}

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[MAIN]: {approvalMode: "yolo"}, [REPLACE]: {approvalMode: "yolo"}}}});
    worlds.push(created);
    return created;
}

interface Result {
    readonly text: string;
    readonly status: string;
    readonly code?: string;
    readonly details?: {readonly code?: string};
    readonly images?: readonly {readonly data: string; readonly mime: string; readonly width?: number; readonly height?: number}[];
}

/** 让模型调用一次工具，交回写进日志的工具结果。 */
async function call(session: SessionApi, tool: string, args: Readonly<Record<string, unknown>>): Promise<Result> {
    endpoint.script({tool, args}, "好");
    const sent = await session.send({commandId: cid(), input: {text: `调用 ${tool}`}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await session.waitRun(sent.value.runId);
    const events = await session.path();
    const result = events.filter((event) => event.type === "toolResult").at(-1);
    if (result === undefined) throw new Error("没有工具结果");
    return result.data as unknown as Result;
}

async function open(w: AgentWorld, profile = MAIN): Promise<{readonly session: SessionApi; readonly id: string; readonly home: string; readonly global: string}> {
    const created = await w.service.create({profile});
    if (!created.ok) throw new Error(created.code);
    const {id} = created.value;
    return {session: created.value, id, home: join(w.stateRoot, "agent", "sessions", id, "home"), global: `sessions://${id}/home`};
}

async function services(session: SessionApi): Promise<{resources: SessionResources; artifacts: SessionArtifacts}> {
    grabbed = null;
    await call(session, "test__bt__grab", {});
    if (grabbed === null) throw new Error("工具没有拿到服务");
    return grabbed;
}

const numbered = (count: number): string => Array.from({length: count}, (_, index) => `第${String(index + 1)}行`).join("\n");
const headerTag = (text: string): string => /#([0-9A-F]{4})\]/u.exec(text)?.[1] ?? "";

async function png(width: number, height: number): Promise<Uint8Array> {
    const dot = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
    return new Bun.Image(dot).resize(width, height, {fit: "fill"}).png().bytes();
}

describe("read", () => {
    test("输出 1、5：全局地址的头与行号；单数与全局写法等价；分页", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), `${numbered(3)}\n`);
        const first = await call(session, "read", {path: "session://a.md"});
        expect(first.status).toBe("ok");
        expect(first.text.split("\n")[0]).toMatch(new RegExp(`^\\[${global}/a\\.md#[0-9A-F]{4}\\]$`, "u"));
        expect(first.text).toContain("1:第1行");
        expect(first.text).toContain("3:第3行");
        expect((await call(session, "read", {path: `${global}/a.md`})).text).toBe(first.text);
        const page = await call(session, "read", {path: "session://a.md", offset: 2, limit: 1});
        expect(page.text).toContain("2:第2行");
        expect(page.text).not.toContain("1:第1行");
        expect(page.text).toContain("offset=3");
    });

    test("输出 5：大文件分页读回，超过 4 MiB 没有行锚；长行截断", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "big.md"), `${"长".repeat(2_500)}\n${Array.from({length: 400_000}, (_, index) => `line ${String(index)} ${"x".repeat(20)}`).join("\n")}\n`);
        const first = await call(session, "read", {path: "session://big.md", limit: 3});
        expect(first.text).toContain("本行共 2500 字符");
        expect(first.text).toContain("没有行锚");
        expect(headerTag(first.text)).toBe("");
        const far = await call(session, "read", {path: "session://big.md", offset: 300_000, limit: 2});
        expect(far.text).toContain("line 299998");
        const budget = await call(session, "read", {path: "session://big.md", offset: 10, limit: 2_000});
        expect(Buffer.byteLength(budget.text, "utf8")).toBeLessThan(60 * 1024);
        expect(budget.text).toContain("offset=");
    });

    test("输出 6：目录与虚拟根列出一层，地址是全局的", async () => {
        const w = await world();
        const {session, home, global, id} = await open(w);
        await mkdir(join(home, "子目录"), {recursive: true});
        await writeFile(join(home, "a.md"), "内容");
        const listed = await call(session, "read", {path: "session://"});
        expect(listed.text).toContain(`${global}/a.md`);
        expect(listed.text).toContain(`${global}/子目录/`);
        const virtual = await call(session, "read", {path: "sessions://"});
        expect(virtual.status).toBe("ok");
        expect(virtual.text).toContain(`sessions://${id}`);
    });

    test("输出 7：图片按文件头判断，缩到最长边 1568；太大 too-large；别的二进制 not-text", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "封面.dat"), await png(3136, 1000));
        const big = await call(session, "read", {path: "session://封面.dat"});
        expect(big.status).toBe("ok");
        expect(big.images).toMatchObject([{mime: "image/png", width: 1568, height: 500}]);
        const meta = await new Bun.Image(Buffer.from(big.images![0]!.data, "base64")).metadata();
        expect(meta).toMatchObject({width: 1568, height: 500});
        expect(big.text).toContain("3136x1000");

        const small = await png(10, 10);
        await writeFile(join(home, "小.png"), small);
        const kept = await call(session, "read", {path: "session://小.png"});
        expect(Buffer.from(kept.images![0]!.data, "base64").equals(Buffer.from(small))).toBe(true);

        const huge = new Uint8Array(21 * 1024 * 1024);
        huge.set(small.subarray(0, 8));
        await writeFile(join(home, "巨大.png"), huge);
        expect(await call(session, "read", {path: "session://巨大.png"})).toMatchObject({status: "error", code: "too-large", details: {code: "too-large"}});
        await writeFile(join(home, "坏.png"), small.subarray(0, 16));
        expect(await call(session, "read", {path: "session://坏.png"})).toMatchObject({code: "not-text"});
        await writeFile(join(home, "数据.bin"), new Uint8Array([1, 0, 2]));
        expect(await call(session, "read", {path: "session://数据.bin"})).toMatchObject({code: "not-text"});
    });

    test("输出 8：user:// 里指向根外的链接按目标读；不存在 not-found；不露出的文件与挂载方案的根外链接被拒", async () => {
        const w = await world();
        const {session, home, id} = await open(w);
        await mkdir(home, {recursive: true});
        const outside = join(root, `outside-${String(counter)}.md`);
        await writeFile(outside, "根外的内容");
        await mkdir(join(w.stateRoot, "user"), {recursive: true});
        await symlink(outside, join(w.stateRoot, "user", "链接.md"));
        expect((await call(session, "read", {path: "user://链接.md"})).text).toContain("根外的内容");
        // 挂载方案按真实路径授权：会话目录里的链接指到根外不读。
        await symlink(outside, join(home, "链接.md"));
        expect(await call(session, "read", {path: "session://链接.md"})).toMatchObject({code: "outside-root"});
        expect(await call(session, "read", {path: "session://没有.md"})).toMatchObject({code: "not-found"});
        expect(await call(session, "read", {path: `sessions://${id}/index.json`})).toMatchObject({code: "protected-path"});
        expect(await call(session, "read", {path: "project://a.md"})).toMatchObject({code: "no-project"});
    });
});

describe("write", () => {
    test("输出 9：新建并建上级目录，覆盖不核对基线；上级是文件、不能写的位置各得失败码", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        const created = await call(session, "write", {path: "session://新/目录/a.md", content: "一\n二\n"});
        expect(created.status).toBe("ok");
        expect(created.text).toContain(`[${global}/新/目录/a.md#`);
        expect(created.text).toContain("2 行");
        expect(await readFile(join(home, "新/目录/a.md"), "utf8")).toBe("一\n二\n");
        await writeFile(join(home, "新/目录/a.md"), "别人改过");
        expect((await call(session, "write", {path: "session://新/目录/a.md", content: "覆盖"})).status).toBe("ok");
        expect(await readFile(join(home, "新/目录/a.md"), "utf8")).toBe("覆盖");
        await writeFile(join(home, "文件"), "x");
        expect(await call(session, "write", {path: "session://文件/下面.md", content: "x"})).toMatchObject({code: "not-a-directory"});
        expect(await call(session, "write", {path: "docs://builtin/x.md", content: "x"})).toMatchObject({code: "permission-denied"});
        expect(await call(session, "write", {path: "session://artifacts/x.log", content: "x"})).toMatchObject({code: "permission-denied"});
    });
});

describe("全文（resources 输出 11）", () => {
    test("宿主 save 成功并交回全局地址；同一标签存两份互不覆盖；Agent 写仍被拒；label 含分隔符被拒", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        const {artifacts, resources} = await services(session);
        const encode = (text: string) => new TextEncoder().encode(text);
        const one = await artifacts.save("shell", (sink) => sink.write(encode("第一份")));
        const two = await artifacts.save("shell", (sink) => sink.write(encode("第二份")));
        if (!one.ok || !two.ok) throw new Error("save failed");
        expect(one.value.address.startsWith(`${global}/artifacts/shell-`)).toBe(true);
        expect(one.value.address).not.toBe(two.value.address);
        expect(await readFile(join(home, "artifacts", one.value.address.split("/").at(-1)!), "utf8")).toBe("第一份");
        const read = await resources.read(two.value.address);
        expect(read.ok && new TextDecoder().decode(read.value.bytes)).toBe("第二份");
        expect(await resources.write(one.value.address, "改", {expect: "any"})).toMatchObject({ok: false, code: "permission-denied"});
        expect(await artifacts.save("a/b", async () => undefined)).toMatchObject({ok: false, code: "invalid-address"});
        expect(await artifacts.save("..", async () => undefined)).toMatchObject({ok: false, code: "invalid-address"});
    });
});

describe("声明", () => {
    test("工具以模型熟悉的名字进请求", async () => {
        const w = await world();
        const {session} = await open(w);
        await call(session, "read", {path: "session://"});
        expect(endpoint.requests.at(-1)!.tools).toEqual(expect.arrayContaining(["read", "write"]));
    });
});
