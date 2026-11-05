/**
 * Agent 的内置工具（docs/specs/agent/builtin-tools.md；测试名里的编号是它的输出条目与验收场景）：真实服务端内核装 `nbook.files`、
 * `nbook.agent`，模型是本机的 OpenAI 兼容端点，脚本化地调用这些工具，断言落在工具结果事件与真实文件上。
 */

import {EditStore} from "@oh-my-pi/pi-natives";
import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {deflateSync} from "node:zlib";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi, ToolContext, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {LEDGER_POINT} from "nbook/plugins/files/shared/ledger";
import type {Ledger, LedgerEntry} from "nbook/plugins/files/shared/ledger";

import {BUILTIN_TOOL_CONTRIBUTIONS, builtinTools} from "./backend/builtin";
import {previewEdit} from "./backend/builtin/edit";
import {runGlob, runGrep} from "./backend/builtin/search";
import {AgentTools} from "./backend/tools";
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
const ASK_FORM = "test.bt.ask-form";
const ASK_FIXED = "test.bt.ask-fixed";
const BUILTIN = ["read", "write", "edit", "grep", "glob", "shell"].map((name) => `nbook.agent.${name}`);
const BUILTIN_REPLACE = ["read", "write", "edit-replace"].map((name) => `nbook.agent.${name}`);
const cid = () => `c-${String((commands += 1))}`;

/** 测试工具拿到的服务：断言宿主写全文、对照资源视图。 */
let grabbed: {resources: SessionResources; artifacts: SessionArtifacts} | null = null;

/** 记账者：提交走到锁内成功阶段时调用（只有 `user://` 这样的根记账）。用它在第一个文件写完、第二个还没写时插一次外部修改。 */
let onLedger: ((entry: LedgerEntry) => Promise<void>) | null = null;

function testPlugin(): PluginDefinition {
    const asking = [agentProfile(ASK_FORM, {name: ASK_FORM, description: "测试用", tools: {required: ["nbook.agent.ask-form"], optional: []}}), agentProfile(ASK_FIXED, {name: ASK_FIXED, description: "测试用", tools: {required: ["nbook.agent.ask"], optional: []}})];
    const profiles = [...asking, agentProfile(MAIN, {name: MAIN, description: "测试用", tools: {required: [...BUILTIN, GRAB], optional: []}}), agentProfile(REPLACE, {name: REPLACE, description: "测试用", tools: {required: [...BUILTIN_REPLACE, GRAB], optional: []}})];
    const tool = agentTool(GRAB, {description: "交出服务", parameters: {type: "object", properties: {}}, version: "1", effect: "read"});
    const grab: AgentToolImplementation = {create: (_context, services) => {
        grabbed = services;
        return {execute: async () => "ok"};
    }};
    const ledger: Ledger = {record: async (entry) => {
        await onLedger?.(entry);
    }};
    return {id: "test.bt", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", ...profiles.map((item) => item.activationEvent), tool.activationEvent],
        contributions: [...profiles.map((item) => item.contribution), tool.contribution, {capability: LEDGER_POINT, id: "test.bt.ledger", declaration: {}}],
        activate: () => ({contributions: {
            "agent.profiles": Object.fromEntries([[MAIN, [...BUILTIN, GRAB]], [REPLACE, [...BUILTIN_REPLACE, GRAB]], [ASK_FORM, ["nbook.agent.ask-form"]], [ASK_FIXED, ["nbook.agent.ask"]]].map(([key, required]) => [key, defineProfile({id: key as string, version: "1", name: key as string, description: "测试用", system: "测试。", tools: {required: required as string[]}})])),
            "agent.tools": {[GRAB]: grab},
            [LEDGER_POINT]: {"test.bt.ledger": ledger},
        }}),
    })]};
}

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[MAIN]: {approvalMode: "yolo"}, [REPLACE]: {approvalMode: "yolo"}, [ASK_FORM]: {approvalMode: "yolo"}, [ASK_FIXED]: {approvalMode: "yolo"}}}});
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

/** 压不动的 PNG：伪随机噪声，`alpha` 时带透明通道。Bun.Image 不能从原始像素建图，这里自己组 PNG。 */
function noisePng(width: number, height: number, alpha: boolean): Uint8Array {
    const channels = alpha ? 4 : 3;
    const raw = Buffer.alloc((width * channels + 1) * height);
    let state = 12345;
    for (let index = 0; index < raw.length; index += 1) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        raw[index] = index % (width * channels + 1) === 0 ? 0 : state >> 16;
    }
    const crcTable = new Int32Array(256).map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c;
    });
    const crc = (bytes: Buffer): number => {
        let c = -1;
        for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
        return (c ^ -1) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
        const body = Buffer.concat([Buffer.from(type), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = alpha ? 6 : 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

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

    test("输出 5：大文件的非法 UTF-8 是 not-text，不替换成别的字符；一行特别长时内存有界、行号不乱", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "坏.txt"), Buffer.concat([Buffer.from([0xff]), Buffer.alloc(5 * 1024 * 1024, 0x61)]));
        expect(await call(session, "read", {path: "session://坏.txt"})).toMatchObject({status: "error", code: "not-text"});
        await writeFile(join(home, "单行.txt"), `${"甲".repeat(3 * 1024 * 1024)}\n第二行\n`);
        const long = await call(session, "read", {path: "session://单行.txt"});
        expect(long.status).toBe("ok");
        expect(long.text).toContain("本行超过");
        expect(long.text).toContain("2:第二行");
    });

    test("定位之后文件被删：not-found，不是工具抛错", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        const {resources, artifacts} = await services(session);
        await writeFile(join(home, "a.md"), "内容");
        const racing: SessionResources = {...resources, readPath: async (address, options) => {
            const located = await resources.readPath(address, options);
            await rm(join(home, "a.md"));
            return located;
        }};
        const tool = await builtinTools()["nbook.agent.read"]!.create({sessionId: session.id, profile: MAIN} as ToolSessionContext, {resources: racing, artifacts});
        const live = new AbortController();
        expect(await tool.execute({path: "session://a.md"}, {signal: live.signal, callId: "c", sessionId: session.id, initial: undefined, read: () => undefined} as unknown as ToolContext)).toMatchObject({status: "error", code: "not-found"});
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

    test("输出 7：压不动的图逐级压到 500 KiB 内；可能有透明的不用 JPEG；小图放大", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "噪声.dat"), noisePng(3000, 2000, false));
        const opaque = await call(session, "read", {path: "session://噪声.dat"});
        const opaqueBytes = Buffer.from(opaque.images![0]!.data, "base64");
        expect(opaqueBytes.length).toBeLessThanOrEqual(500 * 1024);
        expect(["image/jpeg", "image/webp"]).toContain(opaque.images![0]!.mime);
        const opaqueMeta = await new Bun.Image(opaqueBytes).metadata();
        expect([opaqueMeta.width, opaqueMeta.height]).toEqual([opaque.images![0]!.width!, opaque.images![0]!.height!]);
        expect(opaqueMeta.width).toBeLessThanOrEqual(1568);

        await writeFile(join(home, "透明.png"), noisePng(1500, 1000, true));
        const translucent = await call(session, "read", {path: "session://透明.png"});
        expect(translucent.images![0]!.mime).not.toBe("image/jpeg");
        expect(Buffer.from(translucent.images![0]!.data, "base64").length).toBeLessThanOrEqual(500 * 1024);

        await writeFile(join(home, "点.png"), await png(1, 1));
        expect((await call(session, "read", {path: "session://点.png"})).images).toMatchObject([{width: 200, height: 200}]);
        await writeFile(join(home, "细长.png"), await png(3000, 20));
        const thin = await call(session, "read", {path: "session://细长.png"});
        expect(thin.images![0]!.width).toBe(1568);
        expect(thin.images![0]!.height).toBeLessThan(200);
    }, 60_000);

    test("输出 7：图片按文件头判断，缩到最长边 1568；太大 too-large；别的二进制 not-text", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "封面.dat"), await png(3136, 1000));
        const big = await call(session, "read", {path: "session://封面.dat"});
        expect(big.status).toBe("ok");
        expect(big.images).toMatchObject([{width: 1568, height: 500}]);
        const meta = await new Bun.Image(Buffer.from(big.images![0]!.data, "base64")).metadata();
        expect(meta).toMatchObject({width: 1568, height: 500});
        expect(big.text).toContain("3136x1000");

        const small = await png(300, 300);
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
        expect(await call(session, "write", {path: "docs://builtin/x.md", content: "x"})).toMatchObject({code: "unsupported-capability"});
        const other = await open(w);
        expect(await call(session, "write", {path: `${other.global}/x.md`, content: "x"})).toMatchObject({code: "permission-denied"});
        expect(await call(session, "write", {path: "session://artifacts/x.log", content: "x"})).toMatchObject({code: "permission-denied"});
    });
});

describe("edit", () => {
    const hashline = (address: string, tag: string, body: string) => `[${address}#${tag}]\n${body}\n`;

    test("hashline 改一行：结果是全局地址，单数写法也一样；写完可以接着改", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const read = await call(session, "read", {path: "session://a.md"});
        const done = await call(session, "edit", {input: hashline("session://a.md", headerTag(read.text), "PUT 2.=2:\n+贰")});
        expect(done.status).toBe("ok");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n三\n");
        expect(done.text).toContain(`[${global}/a.md#`);
        expect(done.text).not.toContain("[session://");
        const again = await call(session, "edit", {input: hashline(`${global}/a.md`, headerTag(done.text), "PUT 3.=3:\n+叁")});
        expect(again.status).toBe("ok");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n叁\n");
    });

    test("输出 12：没看过的行、写完 write 后直接改：引擎的规则；失败码 edit-<errorKind>", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const page = await call(session, "read", {path: "session://a.md", limit: 1});
        const unseen = await call(session, "edit", {input: hashline("session://a.md", headerTag(page.text), "PUT 3.=3:\n+叁")});
        expect(unseen.status).toBe("error");
        expect(unseen.code).toMatch(/^edit-/u);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n三\n");
        const written = await call(session, "write", {path: "session://b.md", content: "甲\n乙\n"});
        expect((await call(session, "edit", {input: hashline("session://b.md", headerTag(written.text), "PUT 2.=2:\n+丙")})).status).toBe("ok");
        expect(await readFile(join(home, "b.md"), "utf8")).toBe("甲\n丙\n");
    });

    test("输出 5、12：截断的长行不算看过，只读到它时行锚也不放行编辑", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        const long = "长".repeat(2_500);
        await writeFile(join(home, "a.md"), `${long}\n二\n`);
        const read = await call(session, "read", {path: "session://a.md", limit: 1});
        expect(read.text).toContain("已截断");
        const refused = await call(session, "edit", {input: hashline("session://a.md", headerTag(read.text), "PUT 1.=1:\n+短")});
        expect(refused.status).toBe("error");
        expect(refused.code).toMatch(/^edit-/u);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe(`${long}\n二\n`);
    });

    test("输出 10：裸路径、相对路径整次拒绝且不露内容；删除、移动整次拒绝；目标不存在提示用 write", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n");
        const read = await call(session, "read", {path: "session://a.md"});
        const tag = headerTag(read.text);
        const secret = join(root, `secret-${String(counter)}.md`);
        await writeFile(secret, "机密内容\n");
        for (const path of [secret, "a.md", "../a.md"]) {
            const refused = await call(session, "edit", {input: hashline(path, "ABCD", "PUT 1.=1:\n+x")});
            expect(refused).toMatchObject({status: "error", code: "invalid-address"});
            expect(refused.text).not.toContain("机密内容");
        }
        expect(await readFile(secret, "utf8")).toBe("机密内容\n");
        expect(await call(session, "edit", {input: hashline("session://a.md", tag, "REM")})).toMatchObject({code: "unsupported-capability"});
        expect(await call(session, "edit", {input: hashline("session://a.md", tag, "MV session://b.md")})).toMatchObject({code: "unsupported-capability"});
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n");
        const missing = await call(session, "edit", {input: hashline("session://没有.md", "ABCD", "PUT 1.=1:\n+x")});
        expect(missing).toMatchObject({code: "not-found"});
        expect(missing.text).toContain("write");
    });

    test("replace：改写、全局地址，old_string 找不到得 edit- 码，声明里没有语法", async () => {
        const w = await world();
        const {session, home, global} = await open(w, REPLACE);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "林舟走进雨里\n");
        const done = await call(session, "edit", {path: "session://a.md", old_string: "雨里", new_string: "雪里"});
        expect(done.status).toBe("ok");
        expect(done.text).not.toContain("session://");
        expect(done.text).toContain(global);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("林舟走进雪里\n");
        const miss = await call(session, "edit", {path: "session://a.md", old_string: "没有这句", new_string: "x"});
        expect(miss.status).toBe("error");
        expect(miss.code).toMatch(/^edit-/u);
        expect(await call(session, "edit", {path: "a.md", old_string: "x", new_string: "y"})).toMatchObject({code: "invalid-address"});
    });

    test("验收 4、输出 11、13：第二个文件被别人改过：第一个已写入、第二个 conflict 不覆盖，下一次请求里看得到", async () => {
        const w = await world();
        const {session} = await open(w);
        const user = join(w.stateRoot, "user");
        await writeFile(join(user, "甲.md"), "甲一\n");
        await writeFile(join(user, "乙.md"), "乙一\n");
        const tagA = headerTag((await call(session, "read", {path: "user://甲.md"})).text);
        const tagB = headerTag((await call(session, "read", {path: "user://乙.md"})).text);
        // 第一个文件提交到锁内成功阶段时改第二个：它的基线已经读过，引擎也算好了。
        onLedger = async (entry) => {
            if (entry.path === "甲.md") await writeFile(join(user, "乙.md"), "别人改的\n");
        };
        const before = endpoint.requests.length;
        const result = await call(session, "edit", {input: `[user://甲.md#${tagA}]\nPUT 1.=1:\n+甲改\n[user://乙.md#${tagB}]\nPUT 1.=1:\n+乙改\n`});
        onLedger = null;
        expect(result).toMatchObject({status: "error", code: "conflict"});
        expect(await readFile(join(user, "甲.md"), "utf8")).toBe("甲改\n");
        expect(await readFile(join(user, "乙.md"), "utf8")).toBe("别人改的\n");
        expect(result.text).toContain("user://甲.md：已写入");
        expect(result.text).toContain("user://乙.md：失败（conflict）");
        const nextRequest = endpoint.requests[before + 1]!;
        const toolMessage = nextRequest.messages.filter((message) => message.role === "tool").at(-1)!;
        expect(JSON.stringify(toolMessage.content)).toContain("已写入");
    });

    test("输出 3：多文件成功时事件来源是这个会话、带条目 id、同一个组", async () => {
        const w = await world();
        const {session, id} = await open(w);
        const user = join(w.stateRoot, "user");
        await writeFile(join(user, "丙.md"), "丙\n");
        await writeFile(join(user, "丁.md"), "丁\n");
        const tagC = headerTag((await call(session, "read", {path: "user://丙.md"})).text);
        const tagD = headerTag((await call(session, "read", {path: "user://丁.md"})).text);
        const entries: LedgerEntry[] = [];
        onLedger = async (entry) => {
            entries.push(entry);
        };
        const result = await call(session, "edit", {input: `[user://丙.md#${tagC}]\nPUT 1.=1:\n+丙改\n[user://丁.md#${tagD}]\nPUT 1.=1:\n+丁改\n`});
        onLedger = null;
        expect(result.status).toBe("ok");
        expect(entries.map((entry) => entry.path).sort()).toEqual(["丁.md", "丙.md"]);
        expect(entries.every((entry) => entry.source.kind === "agent" && entry.source.session === id && entry.source.entry !== undefined)).toBe(true);
        expect(new Set(entries.map((entry) => entry.group?.id)).size).toBe(1);
        expect(entries[0]!.group?.title).toBe("nbook.agent.edit");
    });
});

describe("grep 与 glob", () => {
    test("输出 14、15：结果是全局地址，不露出的文件不出现；虚拟根报错，它下面的真实目录可以搜；搜索根可以是链接，根下面的目录链接不进", async () => {
        const w = await world();
        const {session, home, global, id} = await open(w);
        await mkdir(join(home, "子"), {recursive: true});
        await writeFile(join(home, "子/a.md"), "前\n林舟走进雨里\n后\n");
        await writeFile(join(home, ".隐藏.md"), "林舟\n");
        const found = await call(session, "grep", {pattern: "林舟", context: 1});
        expect(found.status).toBe("ok");
        expect(found.text).toContain(`${global}/子/a.md`);
        expect(found.text).toContain("2:林舟走进雨里");
        expect(found.text).toContain("1-前");
        expect(found.text).toContain(`${global}/.隐藏.md`);
        expect((await call(session, "grep", {pattern: "没有这个词"})).text).toBe("没有匹配");
        expect((await call(session, "glob", {pattern: "**/*.md"})).text).toContain(`${global}/子/a.md`);

        // 会话目录本身也能搜：index.json 不露出。
        const dir = await call(session, "grep", {pattern: "profile|林舟", path: `sessions://${id}`});
        expect(dir.text).toContain(`sessions://${id}/home/子/a.md`);
        expect(dir.text).not.toContain("index.json");
        const listed = await call(session, "glob", {pattern: "*", path: `sessions://${id}`});
        expect(listed.text).not.toContain("index.json");

        expect(await call(session, "grep", {pattern: "x", path: "sessions://"})).toMatchObject({code: "unsupported-capability"});
        expect(await call(session, "glob", {pattern: "*", path: "docs://"})).toMatchObject({code: "unsupported-capability"});

        const library = join(w.stateRoot, "user", "资料库");
        await mkdir(library, {recursive: true});
        await writeFile(join(library, "人物.md"), "林舟的设定\n");
        await symlink(library, join(w.stateRoot, "user", "资料"));
        const viaRoot = await call(session, "grep", {pattern: "林舟的设定", path: "user://资料"});
        expect(viaRoot.text).toContain("user://资料/人物.md");
        await mkdir(join(w.stateRoot, "user", "书"), {recursive: true});
        await symlink(library, join(w.stateRoot, "user", "书", "链接"));
        expect((await call(session, "grep", {pattern: "林舟的设定", path: "user://书"})).text).toBe("没有匹配");
    });

    test("输出 14、17：够了配额就停下，不露出的文件占不掉配额；limit + 1 判截断；长行与总字节有上限；不合法的模式不报错", async () => {
        const w = await world();
        const {session, home, global, id} = await open(w);
        await mkdir(join(home, "many"), {recursive: true});
        await Promise.all(Array.from({length: 1500}, (_, index) => writeFile(join(home, "many", `${String(index)}.md`), "needle\n")));
        const few = await call(session, "grep", {pattern: "needle", path: `${global}/many`, limit: 3}) as Result & {details: {more: boolean; matches: number; filesChecked: number}};
        expect(few.details).toMatchObject({matches: 3, more: true});
        expect(few.details.filesChecked).toBeLessThan(1500);
        expect(few.text).toContain("还有更多");

        const blobs = join(w.stateRoot, "agent", "sessions", id, "blobs");
        await mkdir(blobs, {recursive: true});
        await Promise.all(Array.from({length: 50}, (_, index) => writeFile(join(blobs, `${String(index)}.md`), "hidden-word\n")));
        await mkdir(join(home, "real"), {recursive: true});
        await writeFile(join(home, "real/a.md"), "hidden-word\n");
        const filtered = await call(session, "grep", {pattern: "hidden-word", path: `sessions://${id}`, glob: "*.md", limit: 1});
        expect(filtered.text).toContain("real/a.md");
        expect(filtered.text).not.toContain("blobs");
        expect(filtered.text).not.toContain("还有更多");

        await writeFile(join(home, "long.md"), `start${"长".repeat(3000)}\n`);
        const clipped = await call(session, "grep", {pattern: "start", path: "session://long.md"});
        expect(clipped.text).toContain("已截断");
        expect(clipped.text.length).toBeLessThan(1_000);
        await Promise.all(Array.from({length: 300}, (_, index) => writeFile(join(home, "many", `w${String(index)}.md`), `wide${"宽".repeat(400)}\n`)));
        const wide = await call(session, "grep", {pattern: "wide", path: `${global}/many`, limit: 500});
        expect(Buffer.byteLength(wide.text, "utf8")).toBeLessThan(55 * 1024);
        expect(wide.text).toContain("超过 50 KB");

        await writeFile(join(home, "括号.md"), "一个 [ 括号\n");
        expect((await call(session, "grep", {pattern: "[", path: "session://括号.md"})).status).toBe("ok");

        const globbed = await call(session, "glob", {pattern: "*.md", path: `${global}/many`, limit: 5});
        expect(globbed.text).toContain("还有更多");
        expect(globbed.text.split("\n").filter((line) => line.startsWith("sessions://"))).toHaveLength(5);
    });

    test("输出 17：到期限时 grep 标“不完整”、glob 报 timeout，与“没有匹配”分开；工具取消是 cancelled", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        const {resources} = await services(session);
        await mkdir(join(home, "many"), {recursive: true});
        await Promise.all(Array.from({length: 2000}, (_, index) => writeFile(join(home, "many", `${String(index)}.md`), "needle\n")));
        const live = new AbortController();
        const grepped = await runGrep(resources, undefined, {pattern: "needle", path: `${global}/many`, limit: 500}, live.signal, 0);
        expect(grepped.text).toContain("不完整");
        expect(grepped.text).not.toBe("没有匹配");
        expect(await runGlob(resources, undefined, {pattern: "**/*", path: `${global}/many`}, live.signal, 0)).toMatchObject({code: "timeout"});
        live.abort();
        expect(await runGrep(resources, undefined, {pattern: "needle", path: `${global}/many`}, live.signal)).toMatchObject({code: "cancelled"});

        // 期限管整次调用：原生搜索已经把匹配交出来、核对还没做完时到期，也不再继续核对。
        const checked: string[] = [];
        const slow: SessionResources = {...resources, readPath: async (address, options) => {
            if (address.includes("/many/")) {
                checked.push(address);
                // 核对一直不完成，直到期限信号触发：到期之后还继续核对的话，`checked` 会一路涨。
                await new Promise<void>((resolve) => {
                    options?.signal?.addEventListener("abort", () => resolve(), {once: true});
                });
            }
            return resources.readPath(address, options);
        }};
        const started = Date.now();
        const clipped = await runGrep(slow, undefined, {pattern: "needle", path: `${global}/many`, limit: 500}, new AbortController().signal, 150);
        expect(clipped.text).toContain("不完整");
        expect(checked.length).toBeLessThan(5);
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(await runGlob(resources, undefined, {pattern: "**/*", path: `${global}/many`}, live.signal)).toMatchObject({code: "cancelled"});
    });
});

describe("shell", () => {
    test("输出 18、20：没有主项目时工作目录是会话工作区；环境变量；退出码", async () => {
        const w = await world();
        const {session, home} = await open(w);
        const real = await realpath(await mkdir(home, {recursive: true}).then(() => home));
        const ran = await call(session, "shell", {command: 'pwd; echo "[$NBOOK_SESSION]"; echo "[${NBOOK_PROJECT-没有}]"; echo "$PATH" | wc -l'});
        expect(ran.status).toBe("ok");
        expect(ran.text.split("\n").slice(0, 4)).toEqual([real, `[${real}]`, "[没有]", "1"]);
        expect(ran.text).toContain("[退出码 0]");
        expect(await call(session, "shell", {command: "exit 3"})).toMatchObject({status: "error", code: "exit-nonzero", details: {exitCode: 3, code: "exit-nonzero"}});
    });

    test("输出 19：地址替换的引号与分隔符；路径含空格、$、反引号、单引号；新文件目标；不认识的方案不动", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        const weird = "a b$c`d'e";
        await mkdir(join(home, weird), {recursive: true});
        await writeFile(join(home, weird, "f.md"), "内容");
        await writeFile(join(home, "x.md"), "左");
        await writeFile(join(home, "y.md"), "右");
        const singular = `session://a\\ b\\$c\\\`d\\'e/f.md`;
        const outside = await call(session, "shell", {command: `cat ${singular}`});
        expect(outside.text.split("\n")[0]).toBe("内容");
        const single = await call(session, "shell", {command: `cat 'session://a b$c\`d'\\''e/f.md'`});
        expect(single.status).toBe("ok");
        const double = await call(session, "shell", {command: `cat "session://a b\\$c\\\`d'e/f.md"`});
        expect(double.text.split("\n")[0]).toBe("内容");

        // 地址本身写不进单引号；真实路径里的单引号要靠链接带进来：三种引号上下文都要按真实路径编码。
        const quoted = join(root, `带'引$号\`-${String(counter)}`);
        await mkdir(quoted, {recursive: true});
        await writeFile(join(quoted, "h.md"), "链接内容");
        await mkdir(join(w.stateRoot, "user"), {recursive: true});
        await symlink(join(quoted, "h.md"), join(w.stateRoot, "user", "q.md"));
        for (const command of ["cat user://q.md", "cat 'user://q.md'", 'cat "user://q.md"']) {
            expect((await call(session, "shell", {command})).text.split("\n")[0]).toBe("链接内容");
        }

        expect((await call(session, "shell", {command: "cat session://x.md;cat session://y.md"})).text.split("\n")[0]).toBe("左右");
        expect((await call(session, "shell", {command: "cat session://x.md|wc -c"})).text.split("\n")[0]?.trim()).toBe("3");
        expect((await call(session, "shell", {command: "cat session://x.md>session://新/../z.md"})).code).toBe("invalid-address");
        expect((await call(session, "shell", {command: "cat session://x.md>session://z.md"})).status).toBe("ok");
        expect(await readFile(join(home, "z.md"), "utf8")).toBe("左");
        expect((await call(session, "shell", {command: "cat session://x.md session://y.md"})).text.split("\n")[0]).toBe("左右");
        expect((await call(session, "shell", {command: "f() { echo \"$1\"; }; f --file=session://x.md"})).text.split("\n")[0]).toBe(`--file=${await realpath(join(home, "x.md"))}`);
        expect((await call(session, "shell", {command: `cat ${global}/x.md`})).text.split("\n")[0]).toBe("左");

        // 祖先一直到方案根：`user://新.txt` 的段走完了问 `user://`。
        expect((await call(session, "shell", {command: "echo 根 > user://根下新文件.txt"})).status).toBe("ok");
        expect(await readFile(join(w.stateRoot, "user", "根下新文件.txt"), "utf8")).toBe("根\n");
        // 虚拟方案下不存在的位置：原因是 not-found，不被“方案根没有真实路径”盖掉。
        expect(await call(session, "shell", {command: "cat sessions://没有这个会话/a.md"})).toMatchObject({code: "not-found"});
        // 末尾的斜杠：换成真实路径后补回。
        await mkdir(join(home, "带斜杠"), {recursive: true});
        await writeFile(join(home, "带斜杠/里面.md"), "x");
        expect((await call(session, "shell", {command: "ls session://带斜杠/"})).text.split("\n")[0]).toBe("里面.md");
        const mkdirs = await call(session, "shell", {command: "mkdir -p session://新/目录 && echo 写 > session://新/目录/g.md"});
        expect(mkdirs.status).toBe("ok");
        expect(await readFile(join(home, "新/目录/g.md"), "utf8")).toBe("写\n");
        expect((await call(session, "shell", {command: "echo https://example.com/a git://x/y xproject://z"})).text.split("\n")[0]).toBe("https://example.com/a git://x/y xproject://z");
        expect((await call(session, "shell", {command: "echo hello # 注释里 session://../坏"})).text.split("\n")[0]).toBe("hello");
        expect((await call(session, "shell", {command: "echo hello;#session://../坏"})).text.split("\n")[0]).toBe("hello");
        expect((await call(session, "shell", {command: "#session://../坏\necho hello"})).text.split("\n")[0]).toBe("hello");
        // `a#b` 不是注释：后面的地址要换。
        expect((await call(session, "shell", {command: "echo a#session://x.md"})).text.split("\n")[0]).toBe(`a#${await realpath(join(home, "x.md"))}`);
    });

    test("输出 19：虚拟地址、不露出的位置、没有主项目在执行前报错，命令不执行", async () => {
        const w = await world();
        const {session, home, id} = await open(w);
        await mkdir(home, {recursive: true});
        for (const [address, code] of [["docs://", "unsupported-capability"], ["sessions://", "unsupported-capability"], [`sessions://${id}/index.json`, "protected-path"], ["project://a.md", "no-project"], ["session://../x", "invalid-address"]] as const) {
            expect(await call(session, "shell", {command: `touch ran.txt; cat ${address}`})).toMatchObject({status: "error", code});
        }
        expect(await readFile(join(home, "ran.txt"), "utf8").catch(() => null)).toBeNull();
    });

    test("输出 21：短输出不留全文；放不下时只交回头尾，全文完整落盘，能分页读回", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        const short = await call(session, "shell", {command: "echo 短"});
        expect(short.text).not.toContain("全文");
        const long = await call(session, "shell", {command: 'for i in $(seq 1 60000); do echo "第 $i 行 xxxxxxxxxxxxxxxxxxxx"; done'}) as Result & {details: {artifact: string; bytes: number}};
        expect(long.status).toBe("ok");
        expect(long.text).toContain("第 60000 行");
        expect(long.text).toContain("第 1 行 ");
        expect(long.text).toContain("中间省略");
        expect(long.text).not.toContain("第 30000 行");
        expect(Buffer.byteLength(long.text, "utf8")).toBeLessThan(55 * 1024);
        expect(long.details.artifact.startsWith(`${global}/artifacts/shell-`)).toBe(true);
        expect(long.text).toContain(long.details.artifact);
        const saved = await readFile(join(home, "artifacts", long.details.artifact.split("/").at(-1)!), "utf8");
        expect(saved.split("\n")).toHaveLength(60_001);
        const page = await call(session, "read", {path: long.details.artifact, offset: 30_000, limit: 1});
        expect(page.text).toContain("第 30000 行");

        const many = await call(session, "shell", {command: "seq 1 3000"});
        expect(many.text).toContain("全文");
        expect(many.text).toContain("\n3000\n");
        expect(many.text).toContain("\n500\n");
        expect(many.text).not.toContain("\n1000\n");
        // 没超行数与字节、也没有长行：全部交回，不留全文。
        const fits = await call(session, "shell", {command: "seq 1 2000"});
        expect(fits.text).toContain("\n1000\n");
        expect(fits.text).not.toContain("全文");

        // 没有尾部换行时最后一段也算一行：2000 行放得下，2001 行放不下。
        expect((await call(session, "shell", {command: "seq 1 2000 | head -c -1"})).text).not.toContain("中间省略");
        expect((await call(session, "shell", {command: "seq 1 2001 | head -c -1"})).text).toContain("中间省略");
        // 一次回调就交出超过 50 KB（cat 常这样）：同样只留头尾。
        await writeFile(join(home, "一块.txt"), `${"第一行\n"}${`${"x".repeat(640)}\n`.repeat(90)}最后一行\n`);
        const oneChunk = await call(session, "shell", {command: "cat session://一块.txt"});
        expect(oneChunk.text).toContain("中间省略");
        expect(oneChunk.text).toContain("第一行");
        expect(oneChunk.text).toContain("最后一行");
        expect(Buffer.byteLength(oneChunk.text, "utf8")).toBeLessThan(45 * 1024);

        // 一行超过上限：窗口里截断，全文完整。
        const line = await call(session, "shell", {command: "printf 'A%.0s' $(seq 1 3000); echo; echo 结尾"}) as Result & {details: {artifact: string}};
        expect(line.text).toContain("本行共 3000 字节，已截断");
        expect(line.text).toContain("结尾");
        expect(line.text.length).toBeLessThan(1_500);
        expect((await readFile(join(home, "artifacts", line.details.artifact.split("/").at(-1)!), "utf8")).startsWith("A".repeat(3000))).toBe(true);

        const huge = await call(session, "shell", {command: "head -c 70000000 /dev/zero | tr '\\0' x"}) as Result & {details: {artifact: string; bytes: number}};
        expect(huge.details.bytes).toBe(70_000_000);
        expect(huge.text).toContain("只存了前 64 MiB");
        const stored = await readFile(join(home, "artifacts", huge.details.artifact.split("/").at(-1)!));
        expect(stored.length).toBeGreaterThan(64 * 1024 * 1024);
        expect(stored.length).toBeLessThan(64 * 1024 * 1024 + 200);
        expect(stored.subarray(-120).toString("utf8")).toContain("输出超过 64 MiB");
    }, 60_000);

    test("验收 3、输出 22：临时文件写不了、暂存目录不可用、提交失败：命令恰好执行一次，结果注明全文没能保存", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        const big = (marker: string) => `echo x >> ${marker}.count; seq 1 20000`;
        const times = async (marker: string) => (await readFile(join(home, `${marker}.count`), "utf8")).split("\n").length - 1;

        const original = process.env.TMPDIR;
        process.env.TMPDIR = join(root, "没有这个目录");
        try {
            const noTemp = await call(session, "shell", {command: big("temp")});
            expect(noTemp.status).toBe("ok");
            expect(noTemp.text).toContain("全文没能保存");
            expect(noTemp.text).toContain("20000");
            expect(await times("temp")).toBe(1);
        } finally {
            if (original === undefined) delete process.env.TMPDIR;
            else process.env.TMPDIR = original;
        }

        await writeFile(join(home, "artifacts"), "占位");
        const noCommit = await call(session, "shell", {command: big("commit")});
        expect(noCommit.status).toBe("ok");
        expect(noCommit.text).toContain("全文没能保存");
        expect(await times("commit")).toBe(1);
        await rm(join(home, "artifacts"));

        const staging = join(w.stateRoot, "staging");
        await rm(staging, {recursive: true, force: true});
        await writeFile(staging, "占位");
        const noStage = await call(session, "shell", {command: big("stage")});
        expect(noStage.status).toBe("ok");
        expect(noStage.text).toContain("全文没能保存");
        expect(await times("stage")).toBe(1);
        await rm(staging);
    }, 30_000);

    test("验收 2、输出 22：超时与中止时已输出的部分保存；fork 之后全文的地址仍指向原会话", async () => {
        const w = await world();
        const {session, home, global} = await open(w);
        await mkdir(home, {recursive: true});
        const timedOut = await call(session, "shell", {command: "seq 1 20000; sleep 30", timeout: 1}) as Result & {details: {artifact: string}};
        expect(timedOut).toMatchObject({status: "error", code: "timeout"});
        expect(timedOut.text).toContain("超时");
        const kept = await readFile(join(home, "artifacts", timedOut.details.artifact.split("/").at(-1)!), "utf8");
        expect(kept).toContain("20000");

        endpoint.script({tool: "shell", args: {command: "seq 1 20000; touch started; sleep 30"}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "跑"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await waitUntil("命令开始", async () => (await readFile(join(home, "started")).catch(() => null)) !== null);
        // 宽限期在手动时钟上，不推进：命令一中止工具就交回结果，不靠宽限期收口。
        await session.abort({commandId: cid()});
        await session.waitRun(sent.value.runId);
        const results = (await session.path()).filter((event) => event.type === "toolResult");
        const cancelled = results.at(-1)!.data as unknown as Result & {details: {artifact: string}};
        expect(cancelled).toMatchObject({status: "error", code: "cancelled"});
        expect(cancelled.details.artifact.startsWith(`${global}/artifacts/`)).toBe(true);
        expect(await readFile(join(home, "artifacts", cancelled.details.artifact.split("/").at(-1)!), "utf8")).toContain("20000");

        const forked = await session.fork({commandId: cid()});
        if (!forked.ok) throw new Error(forked.code);
        const copy = w.service.session(forked.value.sessionId);
        expect((await call(copy, "read", {path: timedOut.details.artifact})).text).toContain("20000");
    }, 30_000);
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

describe("ask", () => {
    const QUESTIONS = [
        {question: "主角叫什么？", options: [{label: "林舟"}, {label: "陈砚"}]},
        {question: "哪些人物要出场？", multiSelect: true, options: [{label: "甲"}, {label: "乙"}, {label: "丙"}]},
    ];
    const FORM = {type: "object", properties: {年龄: {type: "integer"}}, required: ["年龄"]};

    /** 模型调用 ask，运行进 waiting；交回事项与放行之后取结果的函数。 */
    async function asked(session: SessionApi, questions: unknown) {
        endpoint.script({tool: "ask", args: {questions}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const {runId} = sent.value;
        const finish = async () => {
            await session.waitRun(runId);
            return (await session.path()).filter((event) => event.type === "toolResult").at(-1)!.data as unknown as Result;
        };
        const id = await new Promise<string | null>((resolve) => {
            const stop = session.subscribe((frame) => {
                if (frame.type === "status" && frame.status.state === "waiting") {
                    stop();
                    resolve(frame.status.pending[0]!.id);
                }
                if (frame.type === "log" && frame.event.type === "toolResult") {
                    stop();
                    resolve(null);
                }
            });
        });
        return {id, finish};
    }

    test("输出 23：选项、其它、表单的回答回到模型；结构化的值在 details；请求带全部问题", async () => {
        const w = await world();
        const {session} = await open(w, ASK_FORM);
        const {id, finish} = await asked(session, [...QUESTIONS, {question: "年龄？", options: [{label: "跳过"}, {label: "填写"}], form: FORM}]);
        const requested = (await session.path()).find((event) => event.type === "interactionRequested")!.data as unknown as {kind: string; request: {data: {questions: unknown[]}}};
        expect(requested.kind).toBe("question");
        expect(requested.request.data.questions).toHaveLength(3);
        const answers = [{selected: ["林舟"]}, {selected: ["甲", "丙"], other: "再加一个丁"}, {selected: [], form: {年龄: 19}}];
        expect(await session.resolve({commandId: cid(), id: id!, decision: "answer", answer: {text: "见回答", data: {answers} as never}})).toMatchObject({ok: true});
        const result = await finish();
        expect(result.status).toBe("ok");
        expect(result.details).toEqual({answers} as never);
        expect(result.text).toContain("回答：林舟");
        expect(result.text).toContain("甲；丙；其它：再加一个丁");
        expect(result.text).toContain('表单：{"年龄":19}');
    });

    test("输出 23：回答越界得 ask-invalid-answer：选项之外、单选给两个、题数不对、表单不合规、没答", async () => {
        const w = await world();
        const {session} = await open(w, ASK_FORM);
        const cases: {readonly questions: unknown; readonly answers: unknown}[] = [
            {questions: QUESTIONS, answers: [{selected: ["不存在"]}, {selected: ["甲"]}]},
            {questions: QUESTIONS, answers: [{selected: ["林舟", "陈砚"]}, {selected: ["甲"]}]},
            {questions: QUESTIONS, answers: [{selected: ["林舟"]}]},
            {questions: QUESTIONS, answers: [{selected: []}, {selected: ["甲"]}]},
            {questions: [{question: "年龄？", options: [{label: "跳过"}, {label: "填写"}], form: FORM}], answers: [{selected: [], form: {年龄: "很老"}}]},
            {questions: QUESTIONS, answers: "不是列表"},
        ];
        for (const item of cases) {
            const {id, finish} = await asked(session, item.questions);
            await session.resolve({commandId: cid(), id: id!, decision: "answer", answer: {text: "见回答", data: {answers: item.answers} as never}});
            expect((await finish()).code, JSON.stringify(item.answers)).toBe("ask-invalid-answer");
        }
    });

    test("输出 24：form 不合 Agent 策略得 ask-form-invalid，不打扰用户；问题列在结果里", async () => {
        const w = await world();
        const {session} = await open(w, ASK_FORM);
        const {id, finish} = await asked(session, [{question: "填", options: [{label: "甲"}, {label: "乙"}], form: {type: "object", properties: {a: {type: "string", pattern: "^x"}}}}]);
        expect(id).toBeNull();
        const result = await finish();
        expect(result.code).toBe("ask-form-invalid");
        expect(result.text).toContain("第 1 题");
        expect((await session.path()).some((event) => event.type === "interactionRequested")).toBe(false);
    });

    test("输出 25：用户拒答、停止都得 ask-declined", async () => {
        const w = await world();
        const {session} = await open(w, ASK_FORM);
        const declined = await asked(session, QUESTIONS);
        await session.resolve({commandId: cid(), id: declined.id!, decision: "deny"});
        expect((await declined.finish()).code).toBe("ask-declined");
    });

    test("输出 25：后台会话得 ask-unavailable，不进等待", async () => {
        const w = await world();
        endpoint.script({tool: "ask", args: {questions: QUESTIONS}}, "好");
        const started = await w.service.startTask({taskId: crypto.randomUUID(), profile: ASK_FORM, input: {text: "问"}, background: true});
        if (!started.ok) throw new Error(started.code);
        const background = w.service.session(started.sessionId, {kind: "user"});
        await background.waitRun(started.runId);
        const events = await background.path();
        expect(events.some((event) => event.type === "interactionRequested")).toBe(false);
        expect((events.find((event) => event.type === "toolResult")!.data as unknown as Result).code).toBe("ask-unavailable");
    });

    test("输出 25：两条贡献给模型的名字相同；固定的那条没有 form，声明更短", async () => {
        const w = await world();
        const {session} = await open(w, ASK_FIXED);
        const {id, finish} = await asked(session, QUESTIONS);
        expect(endpoint.requests.at(-1)!.tools).toEqual(["ask"]);
        await session.resolve({commandId: cid(), id: id!, decision: "answer", answer: {text: "见回答", data: {answers: [{selected: ["林舟"]}, {selected: ["乙"]}]}}});
        expect((await finish()).status).toBe("ok");
        const declaration = (key: string) => BUILTIN_TOOL_CONTRIBUTIONS.find((item) => item.id === key)!.declaration;
        expect(declaration("nbook.agent.ask").providerName).toBe("ask");
        expect(declaration("nbook.agent.ask-form").providerName).toBe("ask");
        expect(JSON.stringify(declaration("nbook.agent.ask")).length).toBeLessThan(JSON.stringify(declaration("nbook.agent.ask-form")).length);
    });
});

describe("审批预览（输出 26）", () => {
    const hashline = (address: string, tag: string, body: string) => `[${address}#${tag}]\n${body}\n`;

    /** 把会话切到每次都问，让模型调用工具，运行停在审批上；交回事项 id 与接着跑完的函数。 */
    async function waitingApproval(session: SessionApi, tool: string, args: Readonly<Record<string, unknown>>) {
        const changed = await session.changeSettings({commandId: cid(), patch: {core: {approvalMode: "ask"}}});
        if (!changed.ok) throw new Error(changed.code);
        endpoint.script({tool, args}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "改"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const {runId} = sent.value;
        const id = await new Promise<string>((resolve) => {
            const stop = session.subscribe((frame) => {
                if (frame.type === "status" && frame.status.state === "waiting") {
                    stop();
                    resolve(frame.status.pending[0]!.id);
                }
            });
        });
        return {id, approve: async () => {
            await session.resolve({commandId: cid(), id, decision: "allow"});
            await session.waitRun(runId);
            return (await session.path()).filter((event) => event.type === "toolResult").at(-1)!.data as unknown as Result;
        }};
    }

    /** 等运行结束（拒绝之后模型还要回一句）。 */
    const until = (session: SessionApi) => new Promise<void>((resolve) => {
        const check = (state: string) => {
            if (state !== "idle") return;
            stop();
            resolve();
        };
        const stop = session.subscribe((frame) => {
            if (frame.type === "status") check(frame.status.state);
        });
        void session.snapshot().then((snapshot) => check(snapshot.status.state));
    });

    async function preview(w: AgentWorld, sessionId: string, interactionId: string) {
        const {client} = await w.window(`preview-${String((commands += 1))}`);
        const result = await client.approvalPreview({sessionId, interactionId});
        if (!result.ok) throw new Error(result.code);
        if (result.value.kind !== "inline") throw new Error("expected an inline preview");
        return result.value.preview;
    }

    test("write：新文件改前是空的，已有文件是现在的内容；不写盘", async () => {
        const w = await world();
        const {session, id, home, global} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "旧\n");
        const fresh = await waitingApproval(session, "write", {path: "session://新.md", content: "新内容\n"});
        expect(await preview(w, id, fresh.id)).toEqual({files: [{address: `${global}/新.md`, kind: "diff", before: "", after: "新内容\n"}]});
        await expect(readFile(join(home, "新.md"), "utf8")).rejects.toThrow();
        await fresh.approve();
        const existing = await waitingApproval(session, "write", {path: "session://a.md", content: "新\n"});
        expect(await preview(w, id, existing.id)).toEqual({files: [{address: `${global}/a.md`, kind: "diff", before: "旧\n", after: "新\n"}]});
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("旧\n");
        await existing.approve();
    });

    test("hashline 一次改两个文件按文件分节；预览不动会话的行锚：批准之后照样改得成", async () => {
        const w = await world();
        const {session, id, home, global} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n");
        await writeFile(join(home, "b.md"), "甲\n乙\n");
        const tagA = headerTag((await call(session, "read", {path: "session://a.md"})).text);
        const tagB = headerTag((await call(session, "read", {path: "session://b.md"})).text);
        const waiting = await waitingApproval(session, "edit", {input: `${hashline("session://a.md", tagA, "PUT 2.=2:\n+贰")}${hashline("session://b.md", tagB, "PUT 2.=2:\n+丙")}`});
        const first = await preview(w, id, waiting.id);
        expect(first.files).toEqual([
            {address: `${global}/a.md`, kind: "diff", before: "一\n二\n", after: "一\n贰\n"},
            {address: `${global}/b.md`, kind: "diff", before: "甲\n乙\n", after: "甲\n丙\n"},
        ]);
        expect(await preview(w, id, waiting.id)).toEqual(first);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n");
        const done = await waiting.approve();
        expect(done.status).toBe("ok");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n");
        expect(await readFile(join(home, "b.md"), "utf8")).toBe("甲\n丙\n");
    });

    test("预览之后拒绝：文件没变；接着用原来的行锚改，和没预览过一样", async () => {
        const w = await world();
        const {session, id, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n三\n");
        const tag = headerTag((await call(session, "read", {path: "session://a.md"})).text);
        const waiting = await waitingApproval(session, "edit", {input: hashline("session://a.md", tag, "PUT 2.=2:\n+贰")});
        await preview(w, id, waiting.id);
        await session.resolve({commandId: cid(), id: waiting.id, decision: "deny"});
        await until(session);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n三\n");
        // 改别的行：快照要还是读到的那份，不是预览算出来的。
        await session.changeSettings({commandId: cid(), patch: {core: {approvalMode: "yolo"}}});
        const next = await call(session, "edit", {input: hashline("session://a.md", tag, "PUT 2.=2:\n+两")});
        expect(next.status).toBe("ok");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n两\n三\n");
    });

    test("预览不动会话的快照：引擎写完会更新快照，试算要在副本上跑", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "a.md"), "一\n二\n");
        await call(session, "test__bt__grab", {});
        const resources = grabbed!.resources;
        const located = await resources.readPath("session://a.md", {signal: new AbortController().signal});
        if (!located.ok) throw new Error(located.code);
        const store = new EditStore();
        const tag = store.recordSnapshot(located.value.path, "一\n二\n", [1, 2]);
        const {written, failure} = await previewEdit("hashline", {input: hashline("session://a.md", tag, "PUT 2.=2:\n+贰")}, resources, store, new AbortController().signal);
        expect(failure).toBeNull();
        expect([...written.values()]).toEqual(["一\n贰\n"]);
        expect(store.headText(located.value.path)).toBe("一\n二\n");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n");
    });

    test("一大一小：大的给 too-large，小的照常", async () => {
        const w = await world();
        const {session, id, home, global} = await open(w, REPLACE);
        await mkdir(home, {recursive: true});
        const big = "大".repeat(100_000);
        await writeFile(join(home, "big.md"), big);
        const huge = await waitingApproval(session, "edit", {path: "session://big.md", old_string: "大大", new_string: "小", replace_all: true});
        const files = (await preview(w, id, huge.id)).files;
        expect(files).toMatchObject([{address: `${global}/big.md`, kind: "too-large"}]);
        await huge.approve();
        await writeFile(join(home, "small.md"), "一二三");
        const small = await waitingApproval(session, "edit", {path: "session://small.md", old_string: "二", new_string: "贰"});
        expect((await preview(w, id, small.id)).files).toEqual([{address: `${global}/small.md`, kind: "diff", before: "一二三", after: "一贰三"}]);
        await small.approve();
    });

    test("算不出来的得 failed：文件不存在、改不上；审批不受影响", async () => {
        const w = await world();
        const {session, id, home, global} = await open(w, REPLACE);
        await mkdir(home, {recursive: true});
        const missing = await waitingApproval(session, "edit", {path: "session://没有.md", old_string: "一", new_string: "二"});
        expect((await preview(w, id, missing.id)).files).toEqual([{address: `${global}/没有.md`, kind: "failed", code: "not-found"}]);
        expect((await missing.approve()).code).toBe("not-found");
        await writeFile(join(home, "a.md"), "一二三");
        const stale = await waitingApproval(session, "edit", {path: "session://a.md", old_string: "没有这段", new_string: "二"});
        expect((await preview(w, id, stale.id)).files).toMatchObject([{address: `${global}/a.md`, kind: "failed"}]);
        await stale.approve();
    });

    test("别的工具没有预览；不是审批的事项得 unknown-interaction", async () => {
        const w = await world();
        const {session, id} = await open(w);
        const waiting = await waitingApproval(session, "shell", {command: "true"});
        expect(await preview(w, id, waiting.id)).toEqual({files: []});
        const {client} = await w.window("preview-unknown");
        expect(await client.approvalPreview({sessionId: id, interactionId: "没有这个"})).toMatchObject({ok: false, code: "unknown-interaction"});
        await waiting.approve();
    });
});

describe("声明", () => {
    test("工具以模型熟悉的名字进请求；hashline 的语法声明经贡献点到达内核", async () => {
        const w = await world();
        const {session} = await open(w);
        await call(session, "read", {path: "session://"});
        expect(endpoint.requests.at(-1)!.tools).toEqual(expect.arrayContaining(["read", "write", "edit"]));
        const tools = new AgentTools({declarations: {list: <D>() => BUILTIN_TOOL_CONTRIBUTIONS.map((item) => ({id: item.id, plugin: "nbook.agent", declaration: item.declaration as unknown as D}))} as never, clock: w.settings.clock, activate: async () => false, report: () => undefined, services: () => { throw new Error("不会建实现"); }});
        expect(tools.all().get("nbook.agent.edit")?.customFormat).toMatchObject({syntax: "lark"});
        expect(tools.all().get("nbook.agent.edit-replace")?.customFormat).toBeUndefined();
    });
});
