/**
 * Agent 的资源地址（docs/specs/agent/resources.md 输出 1–9、验收 1、3、4）：真实服务端内核装 `nbook.files` 与 `nbook.agent`，
 * 资源视图从真实的工具工厂取得（`create(context, services)` 的 `services.resources`）：测试工具第一次执行时把它交给测试。
 * 模型是本机的 OpenAI 兼容端点，脚本化地调用这个工具。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {lstat, readFile, realpath, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildAgentDocs} from "../../../scripts/agent-docs";
import {kernelResources} from "./backend/resources";
import {agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import type {SessionResources} from "./shared/resources";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let commands = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
/** 测试写进系统临时目录的分区：用例结束时删掉。 */
const partitions: string[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "resources");
    endpoint = fakeEndpoint();
    // `docs://` 读开发时的生成目录，与 `bun run build:agent-docs` 相同。
    await buildAgentDocs(fileURLToPath(new URL("../../../dist/docs", import.meta.url)));
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    for (const partition of partitions) await rm(partition, {recursive: true, force: true});
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const WRITER = "test.res.writer";
const EDITOR = "test.res.editor";
const GRAB = "test.res.grab";
const cid = () => `c-${String((commands += 1))}`;

/** 工具工厂最近一次拿到的资源视图：用例里的会话依次调用工具，取完就清。 */
let grabbed: SessionResources | null = null;

function plugins(): PluginDefinition[] {
    const profiles = [WRITER, EDITOR].map((key) => agentProfile(key, {name: key, description: "测试用", tools: {required: [GRAB], optional: []}}));
    const tool = agentTool(GRAB, {description: "交出资源视图", parameters: {type: "object", properties: {}}, version: "1", effect: "read"});
    return [
        {id: "test.res", entries: [defineEntry({id: "server", location: "server", activationEvents: [...profiles.map((item) => item.activationEvent), tool.activationEvent], contributions: [...profiles.map((item) => item.contribution), tool.contribution], activate: () => {
            const grab: AgentToolImplementation = {create: (context, services) => {
                void context;
                grabbed = services.resources;
                return {execute: async () => "ok"};
            }};
            return {contributions: {
                "agent.profiles": Object.fromEntries([WRITER, EDITOR].map((key) => [key, defineProfile({id: key, version: "1", name: key, description: "测试用", system: "测试。"})])),
                "agent.tools": {[GRAB]: grab},
            }};
        }})]},
    ];
}

async function world(at?: string): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(at ?? join(root, `w${String(counter)}`), {plugins: plugins(), userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(created);
    const marker = createHash("sha256").update(await realpath(created.stateRoot)).digest("hex").slice(0, 16);
    partitions.push(join(tmpdir(), "nbook", marker));
    return created;
}

/** 让会话调用一次测试工具，交回工具工厂拿到的资源视图。 */
async function resourcesOf(session: SessionApi): Promise<SessionResources> {
    grabbed = null;
    endpoint.script({tool: "test__res__grab", args: {}}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "拿资源"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await session.waitRun(sent.value.runId);
    const found = grabbed as SessionResources | null;
    if (found === null) throw new Error("工具没有拿到资源视图");
    return found;
}

async function open(w: AgentWorld, profile = WRITER, project?: string): Promise<{readonly session: SessionApi; readonly id: string; readonly resources: SessionResources}> {
    const created = await w.service.create({profile, ...(project === undefined ? {} : {project})});
    if (!created.ok) throw new Error(created.code);
    const session = created.value;
    const resources = await resourcesOf(session);
    const home = resources.expand("session://");
    if (!home.ok) throw new Error(home.code);
    return {session, id: /^sessions:\/\/([^/]+)\/home$/u.exec(home.address)?.[1] ?? "", resources};
}

/** 先建再按基线写：服务端文件服务的写只改已存在的文件。 */
async function put(resources: SessionResources, address: string, text: string): Promise<unknown> {
    const made = await resources.create(address, "file");
    if (!made.ok && made.code !== "conflict") return made;
    const read = await resources.read(address);
    if (!read.ok) return read;
    return resources.write(address, text, read.value.baseline);
}

describe("改写与分类", () => {
    test("输出 1、2：单数地址改写成全局地址，点段被拒，没有主项目时 project:// 不可用；分类与写法无关", async () => {
        const w = await world();
        const {id, resources} = await open(w);
        expect(resources.expand("session://plan.md")).toEqual({ok: true, address: `sessions://${id}/home/plan.md`});
        expect(resources.expand("session://")).toEqual({ok: true, address: `sessions://${id}/home`});
        expect(resources.expand("profile://notes.md")).toEqual({ok: true, address: `profiles://${WRITER}/notes.md`});
        expect(resources.expand("tmp://a/b")).toEqual({ok: true, address: `temps://${id}/a/b`});
        expect(resources.expand("docs://builtin")).toEqual({ok: true, address: "docs://builtin"});
        expect(resources.expand("session://../session.jsonl")).toMatchObject({ok: false, code: "invalid-address"});
        expect(resources.expand("project://x.md")).toMatchObject({ok: false, code: "no-project"});
        expect(await resources.read("project://x.md")).toMatchObject({ok: false, code: "no-project"});

        expect(resources.classify("session://plan.md")).toEqual({content: false, write: "allowed"});
        expect(resources.classify(`sessions://${id}/home/plan.md`)).toEqual({content: false, write: "allowed"});
        expect(resources.classify("session://attachments/a.png")).toEqual({content: false, write: "denied"});
        expect(resources.classify("sessions://other/home/x")).toEqual({content: false, write: "denied"});
        expect(resources.classify("user://AGENTS.md")).toEqual({content: false, write: "ask"});
        expect(resources.classify("projects://book/第一章.md")).toEqual({content: true, write: "allowed"});
        expect(resources.classify("docs://builtin/sdk/README.md")).toEqual({content: false, write: "denied"});

        const withProject = await open(w, WRITER, "book");
        expect(withProject.resources.expand("project://设定/人物.md")).toEqual({ok: true, address: "projects://book/设定/人物.md"});
        expect(withProject.resources.classify("project://设定/人物.md")).toEqual({content: true, write: "allowed"});
    });
});

describe("各方案对 Agent 的权限", () => {
    test("验收 1：会话写自己的 home，经全局地址读到同样内容；不能写别人的 home 与日志，能读；附件只读；经链接写日志被拒；列出只露出日志与 home", async () => {
        const w = await world();
        const a = await open(w);
        const b = await open(w);
        expect(await put(a.resources, "session://plan.md", "计划")).toMatchObject({ok: true});
        expect(await b.resources.read(`sessions://${a.id}/home/plan.md`)).toMatchObject({ok: true, value: {text: "计划"}});
        expect(await b.resources.create(`sessions://${a.id}/home/x.md`, "file")).toMatchObject({ok: false, code: "permission-denied"});
        expect(await b.resources.read(`sessions://${a.id}/session.jsonl`)).toMatchObject({ok: true});
        expect(await a.resources.create("session://attachments/a.png", "file")).toMatchObject({ok: false, code: "permission-denied"});

        const home = join(w.stateRoot, "agent", "sessions", a.id, "home");
        await symlink(join(w.stateRoot, "agent", "sessions", a.id, "session.jsonl"), join(home, "log-alias"));
        const alias = await a.resources.read("session://log-alias");
        if (!alias.ok) throw new Error(alias.code);
        expect(await a.resources.write("session://log-alias", "改日志", alias.value.baseline)).toMatchObject({ok: false, code: "permission-denied"});

        const listed = await a.resources.list(`sessions://${a.id}`);
        expect(listed.ok && listed.value.entries.map((entry) => entry.name).sort()).toEqual(["home", "session.jsonl"]);
    });

    test("验收 3：只能写当前 Profile 的笔记；会话换 Profile 后 profile:// 指向新的，旧的变成只读", async () => {
        const w = await world();
        const {session, resources} = await open(w);
        expect(await put(resources, "profile://preferences.md", "不喜欢破折号")).toMatchObject({ok: true});
        expect(await readFile(join(w.stateRoot, "agent", "profiles", WRITER, "preferences.md"), "utf8")).toBe("不喜欢破折号");
        expect(await resources.create(`profiles://${EDITOR}/x.md`, "file")).toMatchObject({ok: false, code: "permission-denied"});

        const changed = await session.changeProfile({commandId: cid(), profile: EDITOR});
        expect(changed.ok).toBe(true);
        const after = await resourcesOf(session);
        expect(after.expand("profile://x.md")).toEqual({ok: true, address: `profiles://${EDITOR}/x.md`});
        expect(await after.create("profile://x.md", "file")).toMatchObject({ok: true});
        expect(await after.create(`profiles://${WRITER}/y.md`, "file")).toMatchObject({ok: false, code: "permission-denied"});
    });

    test("输出 5：虚拟根列出说明与带全局地址的条目，读根得到文字，写根被拒；docs:// 读得到 SDK 的作者文档", async () => {
        const w = await world();
        const {id, resources} = await open(w);
        const listed = await resources.list("sessions://");
        expect(listed.ok && "kind" in listed.value && listed.value.entries.some((entry) => entry.address === `sessions://${id}`)).toBe(true);
        const text = await resources.read("profiles://");
        expect(text.ok && text.value.text).toContain(`profiles://${WRITER}`);
        expect(await resources.write("sessions://", "x", {hash: "0"})).toMatchObject({ok: false, code: "permission-denied"});
        expect(await resources.realPath("skills://")).toMatchObject({ok: false, code: "unsupported-capability"});

        const readme = await resources.read("docs://builtin/sdk/README.md");
        expect(readme.ok && readme.value.text).toContain("docs/exports.md");
        expect(await resources.read("docs://builtin/sdk/docs/exports.md")).toMatchObject({ok: true});
        const spec = readme.ok ? /\]\((specs\/[^)#]+)/u.exec(readme.value.text)?.[1] : undefined;
        expect(spec).toBeDefined();
        expect(await resources.read(`docs://builtin/sdk/${spec as string}`)).toMatchObject({ok: true});
        expect(await resources.read("docs://agent/addresses.md")).toMatchObject({ok: true});
        // `docs://` 没有写能力：在授权之前就拒绝。
        expect(await resources.create("docs://agent/x.md", "file")).toMatchObject({ok: false, code: "unsupported-capability"});
    });
});

describe("按需建目录与临时目录", () => {
    test("输出 6：真实路径与第一次写入建好 home、Profile 笔记目录与临时目录；被拒的请求不建目录", async () => {
        const w = await world();
        const {id, resources} = await open(w);
        const home = await resources.realPath("session://");
        expect(home).toEqual({ok: true, value: {path: join(await realpath(w.stateRoot), "agent", "sessions", id, "home")}});
        const temp = await resources.realPath("tmp://");
        expect(temp.ok && (await lstat(temp.value.path)).isDirectory()).toBe(true);
        expect(await resources.create(`profiles://${EDITOR}/x.md`, "file")).toMatchObject({ok: false, code: "permission-denied"});
        expect(await lstat(join(w.stateRoot, "agent", "profiles", EDITOR)).catch(() => null)).toBeNull();
    });

    test("验收 4：归档时不删临时目录；重启时只删本状态根分区里已归档的会话的目录，另一个状态根的不受影响", async () => {
        const at = join(root, `restart-${String((counter += 1))}`);
        const first = await world(at);
        const kept = await open(first);
        const archived = await open(first);
        expect(await put(kept.resources, "tmp://keep.txt", "留")).toMatchObject({ok: true});
        expect(await put(archived.resources, "tmp://gone.txt", "删")).toMatchObject({ok: true});
        const goneDir = await archived.resources.realPath("tmp://");
        if (!goneDir.ok) throw new Error(goneDir.code);
        expect((await archived.session.archive({commandId: cid(), archived: true})).ok).toBe(true);
        expect((await lstat(goneDir.value.path)).isDirectory()).toBe(true);

        // 另一个状态根：它的启动扫描不碰第一个状态根的分区。
        const other = await world();
        const otherSession = await open(other);
        expect(await put(otherSession.resources, "tmp://mine.txt", "别人的")).toMatchObject({ok: true});

        await first.close();
        worlds.splice(worlds.indexOf(first), 1);
        const again = await world(at);
        const reopened = await open(again);
        expect(await lstat(goneDir.value.path).catch(() => null)).toBeNull();
        expect(await reopened.resources.read(`temps://${kept.id}/keep.txt`)).toMatchObject({ok: true, value: {text: "留"}});
        expect(await otherSession.resources.read("tmp://mine.txt")).toMatchObject({ok: true, value: {text: "别人的"}});
    });
});

describe("内核的资源接口", () => {
    test("输出 9：内核的 resolve 交回全局地址；read 不存在为空、别的失败抛出", async () => {
        const w = await world();
        const {id, resources} = await open(w);
        expect(await put(resources, "session://note.md", "笔记")).toMatchObject({ok: true});
        // 内核的接口由同一个资源视图包出（agent.ts 的 `resources`）：这里核对包装的规则。
        const kernel = kernelResources(resources);
        expect(await kernel.read("session://note.md")).toBe("笔记");
        expect(await kernel.read("session://missing.md")).toBeUndefined();
        expect(kernel.resolve("session://note.md")).toBe(`sessions://${id}/home/note.md`);
        expect(kernel.resolve("session://../x")).toBe("session://../x");
        await expect(kernel.read("docs://")).resolves.toContain("产品文档");
        // 不存在为空，别的失败（这里是会话目录里不露出的文件）抛出，不当作不存在。
        expect(await kernel.read("sessions://nobody/home/x")).toBeUndefined();
        await expect(kernel.read(`sessions://${id}/index.json`)).rejects.toThrow("protected-path");
    });
});

