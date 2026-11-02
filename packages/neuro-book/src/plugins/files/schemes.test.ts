/**
 * 方案注册、挂载方案与服务端文件服务（docs/specs/workspace/resources.md 输出“挂载方案”、状态表的“挂载点”、验收 1、2、4、8、
 * 10）：真实服务端内核实例装真实的 `nbook.files`，测试插件经贡献点注册挂载方案、经 `serverFilesKey` 调用；文件在真实临时
 * 目录里，时间用场地的手动时钟推进。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {lstat, mkdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {filesBackendPlugin} from "./backend/plugin";
import {IDLE_CLOSE_MS, MOUNT_SOFT_LIMIT} from "./backend/mounted";
import {descriptor} from "./plugin";
import {userFilesContract} from "./shared/contracts";
import type {WatchMessage} from "./shared/contracts";
import {SCHEMES_POINT, serverFilesKey} from "./shared/schemes";
import type {MountedSchemeSpec, SchemeCaller, SchemeCapability, ServerFiles} from "./shared/schemes";
import {files, probe, probePlugin} from "./testing/scene";
import {filesBrowserPlugin} from "./web/plugin";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "schemes");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 测试方案的规则：挂载点 `<container>/<名>/`，`a`、`b`、`c` 存在于声明中；`home` 随写入建好。`secret*` 不可读写（受保护），
 * `vault/` 下的 `.key` 文件受保护（目录本身可读），`locked/` 下只读；Agent 只能写与自己会话同名的挂载点。
 */
function notesSpec(container: string, capabilities: readonly SchemeCapability[] = ["read", "write", "list", "realPath"]): MountedSchemeSpec {
    return {
        capabilities,
        container,
        root: () => ({description: "测试用的笔记", entries: [{name: "a", title: "甲"}, {name: "b", meta: {kind: "测试"}}]}),
        mount: (name) => (["a", "b", "c"].includes(name) ? {create: true, ensure: ["home"]} : null),
        authorize: (caller: SchemeCaller, mount, operation, path) => {
            if (path.startsWith("secret") || /^vault\/.*\.key$/u.test(path)) return "protected-path";
            const writing = operation === "write" || operation === "create";
            if (writing && path.startsWith("locked")) return "permission-denied";
            if (writing && caller.agent !== null && caller.agent.session !== mount) return "permission-denied";
            return true;
        },
    };
}

function schemePlugin(id: string, scheme: string, spec: () => MountedSchemeSpec): PluginDefinition {
    return {id, entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        contributions: [{capability: SCHEMES_POINT, id: scheme, declaration: {}}],
        activate: () => ({contributions: {[SCHEMES_POINT]: {[scheme]: spec()}}}),
    })]};
}

/** 取服务端文件服务的测试插件；id 为 `nbook.agent` 的那个可以注明代表哪个会话。 */
function consumerPlugin(id: string, holder: {files: ServerFiles | null}): PluginDefinition {
    return {id, entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: serverFilesKey}],
        activate: (context) => {
            holder.files = context.services.require(serverFilesKey);
            return {};
        },
    })]};
}

interface Scene {
    readonly world: SettingsWorld;
    readonly root: string;
    readonly container: string;
    readonly agent: ServerFiles;
    readonly other: ServerFiles;
}

async function scene(options: {readonly extra?: ReadonlyArray<PluginDefinition>; readonly spec?: (container: string) => MountedSchemeSpec} = {}): Promise<Scene> {
    counter += 1;
    const root = join(tmp, `w${String(counter)}`);
    const container = join(root, "mounts");
    await mkdir(container, {recursive: true});
    const agent = {files: null as ServerFiles | null};
    const other = {files: null as ServerFiles | null};
    const world = await settingsWorld(root, [
        definitionAt("server", descriptor, filesBackendPlugin),
        schemePlugin("nbook.test-notes", "notes", () => (options.spec ?? notesSpec)(container)),
        consumerPlugin("nbook.agent", agent),
        consumerPlugin("x.other", other),
        ...(options.extra ?? []),
    ]);
    worlds.push(world);
    if (agent.files === null || other.files === null) throw new Error("测试插件没有激活");
    return {world, root, container, agent: agent.files, other: other.files};
}

const asAgent = (session: string) => ({as: {agent: {session, profile: "p"}}});

describe("挂载方案", () => {
    test("验收 1：虚拟根列出说明与带全局地址的条目，读根得到文字，写根被拒，根没有真实路径；未注册的方案 unknown-scheme", async () => {
        const {agent} = await scene();
        expect(await agent.list("notes://")).toEqual({ok: true, value: {kind: "virtual", description: "测试用的笔记", entries: [{name: "a", title: "甲", address: "notes://a"}, {name: "b", meta: {kind: "测试"}, address: "notes://b"}]}});
        const read = await agent.read("notes://");
        expect(read.ok && read.value.text).toBe("测试用的笔记\n\n- notes://a 甲\n- notes://b（kind: 测试）");
        expect(await agent.write("notes://", "x", {hash: "0"})).toMatchObject({ok: false, code: "permission-denied"});
        expect(await agent.realPath("notes://")).toMatchObject({ok: false, code: "unsupported-capability"});
        expect(await agent.read("nowhere://x")).toMatchObject({ok: false, code: "unknown-scheme"});
        expect(await agent.read("notes://zzz/x")).toMatchObject({ok: false, code: "not-found"});
        expect(await agent.read("notes://a/../b")).toMatchObject({ok: false, code: "invalid-address"});
    });

    test("物化：目录不存在时读 not-found、列出为空；取真实路径与新建建好挂载点与 home；被拒的请求不建目录", async () => {
        const {agent, container} = await scene();
        expect(await agent.read("notes://a/home/x.md")).toMatchObject({ok: false, code: "not-found"});
        expect(await agent.list("notes://a")).toEqual({ok: true, value: {folder: "plain", contentRoot: null, entries: []}});
        expect(await agent.list("notes://a/home")).toEqual({ok: true, value: {folder: "plain", contentRoot: null, entries: []}});
        // 会话 a 写 b：按挂载点名拒绝，b 的目录没有被建出来。
        expect(await agent.create("notes://b/home/x.md", "file", asAgent("a"))).toMatchObject({ok: false, code: "permission-denied"});
        expect(await lstat(join(container, "b")).catch(() => null)).toBeNull();
        // 已中止的请求也不建目录。
        const aborted = AbortSignal.abort();
        expect(await agent.create("notes://b/home/x.md", "file", {...asAgent("b"), signal: aborted})).toMatchObject({ok: false, code: "cancelled"});
        expect(await lstat(join(container, "b")).catch(() => null)).toBeNull();

        expect(await agent.create("notes://a/home/x.md", "file", asAgent("a"))).toEqual({ok: true, value: {}});
        expect((await stat(join(container, "a", "home"))).isDirectory()).toBe(true);
        const real = await agent.realPath("notes://c/home", asAgent("c"));
        expect(real).toEqual({ok: true, value: {path: join(container, "c", "home"), kind: "directory"}});
    });

    test("物化：ensure 的位置已经是文件或链接时不覆盖，为 not-a-directory", async () => {
        const {agent, container} = await scene();
        await mkdir(join(container, "a"));
        await writeFile(join(container, "a", "home"), "我是文件");
        expect(await agent.create("notes://a/home/x.md", "file", asAgent("a"))).toMatchObject({ok: false, code: "not-a-directory"});
        expect(await readFile(join(container, "a", "home"), "utf8")).toBe("我是文件");
    });

    test("读写：按基线保存，冲突带当前基线；.content 是普通目录，新建不写清单", async () => {
        const {agent, container} = await scene();
        expect(await agent.create("notes://a/home/x.md", "file", asAgent("a"))).toMatchObject({ok: true});
        const empty = await agent.read("notes://a/home/x.md", asAgent("a"));
        if (!empty.ok) throw new Error(empty.code);
        expect(await agent.write("notes://a/home/x.md", "第一版", empty.value.baseline, asAgent("a"))).toMatchObject({ok: true});
        expect(await agent.write("notes://a/home/x.md", "第二版", empty.value.baseline, asAgent("a"))).toMatchObject({ok: false, code: "conflict", current: {hash: expect.any(String)}});
        expect(await readFile(join(container, "a", "home", "x.md"), "utf8")).toBe("第一版");

        expect(await agent.create("notes://a/home/book.content", "directory", asAgent("a"))).toMatchObject({ok: true});
        expect(await agent.create("notes://a/home/book.content/ch1.md", "file", asAgent("a"))).toMatchObject({ok: true});
        expect(await lstat(join(container, "a", "home", "book.content", "content.xml")).catch(() => null)).toBeNull();
        const listed = await agent.list("notes://a/home");
        expect(listed.ok && "folder" in listed.value && listed.value.entries.find((entry) => entry.name === "book.content")).toMatchObject({kind: "directory", folder: "plain"});
    });

    test("授权：受保护与只读位置；经链接落到受保护位置与直接访问相同；列出不露出受保护的项与指向它的链接", async () => {
        const {agent, container} = await scene();
        await mkdir(join(container, "a", "locked"), {recursive: true});
        await writeFile(join(container, "a", "secret.txt"), "机密");
        await writeFile(join(container, "a", "locked", "doc.md"), "只读");
        await writeFile(join(container, "a", "open.md"), "公开");
        await symlink(join(container, "a", "secret.txt"), join(container, "a", "alias.txt"));

        expect(await agent.read("notes://a/secret.txt")).toMatchObject({ok: false, code: "protected-path"});
        expect(await agent.read("notes://a/alias.txt")).toMatchObject({ok: false, code: "protected-path"});
        const doc = await agent.read("notes://a/locked/doc.md");
        if (!doc.ok) throw new Error(doc.code);
        expect(await agent.write("notes://a/locked/doc.md", "改", doc.value.baseline, asAgent("a"))).toMatchObject({ok: false, code: "permission-denied"});
        const listed = await agent.list("notes://a");
        expect(listed.ok && listed.value.entries.map((entry) => entry.name).sort()).toEqual(["locked", "open.md"]);

        // 目录链接：经别名列出时，子项按它实际所在的位置（链接目标下）判定。
        await mkdir(join(container, "a", "vault"));
        await writeFile(join(container, "a", "vault", "x.key"), "钥匙");
        await writeFile(join(container, "a", "vault", "ok.md"), "可以看");
        await symlink(join(container, "a", "vault"), join(container, "a", "door"));
        const viaAlias = await agent.list("notes://a/door");
        expect(viaAlias.ok && viaAlias.value.entries.map((entry) => entry.name)).toEqual(["ok.md"]);
        expect(await agent.read("notes://a/door/x.key")).toMatchObject({ok: false, code: "protected-path"});
    });

    test("未声明的能力为 unsupported-capability", async () => {
        const {agent} = await scene({spec: (container) => notesSpec(container, ["read", "list"])});
        expect(await agent.create("notes://a/home/x.md", "file", asAgent("a"))).toMatchObject({ok: false, code: "unsupported-capability"});
        expect(await agent.realPath("notes://a")).toMatchObject({ok: false, code: "unsupported-capability"});
        expect(await agent.list("notes://")).toMatchObject({ok: true});
    });
});

describe("代表会话写", () => {
    test("验收 10：nbook.agent 注明会话的写入，订阅方看到来源为该会话；别的插件注明为 invalid-input", async () => {
        const {world, agent, other} = await scene();
        const window = probe();
        await world.window("w1", [definitionAt("browser", descriptor, filesBrowserPlugin), probePlugin("x.explorer", "browser", window)], {bound: false});
        const messages: WatchMessage[] = [];
        files(window).watch("user", (message) => messages.push(message));
        await waitUntil("user:// 的订阅就绪", () => messages.some((message) => message.kind === "ready"));

        expect(await other.create("user://x.md", "file", asAgent("s1"))).toMatchObject({ok: false, code: "invalid-input"});
        expect(await agent.create("user://x.md", "file", asAgent("s1"))).toMatchObject({ok: true});
        await waitUntil("新建事件带会话来源", () => {
            world.clock.advance(100);
            return messages.some((message) => message.kind === "batch" && message.events.some((event) => event.path === "x.md" && event.source.kind === "agent" && event.source.session === "s1"));
        });
        // 不注明会话的服务端写入照常，来源是系统。
        expect(await other.create("user://y.md", "file")).toMatchObject({ok: true});
    });

    test("合同升版：旧版本的 user:// 订阅方得 version-changed", async () => {
        const {world} = await scene();
        const window = probe();
        await world.window("w1", [definitionAt("browser", descriptor, filesBrowserPlugin), probePlugin("x.explorer", "browser", window)], {bound: false});
        const old = defineRemoteService({...userFilesContract, version: 5});
        if (window.remote === null) throw new Error("窗口没有激活");
        expect(await window.remote.use(old).events.changes.subscribe({}, () => undefined)).toMatchObject({ok: false, code: "version-changed"});
    });
});

describe("注册与寿命", () => {
    test("验收 4：非内置插件、保留名、重复注册都只拒绝这一条；方案的插件关闭后不可用", async () => {
        const {world, agent, container} = await scene({extra: [
            schemePlugin("x.thirdparty", "third", () => notesSpec("/nonexistent")),
            schemePlugin("nbook.test-dup", "notes", () => notesSpec("/nonexistent")),
            schemePlugin("nbook.test-reserved", "user", () => notesSpec("/nonexistent")),
        ]});
        const rejected = world.diagnostics("hub").query({}).records.filter((record) => record.event === "files.scheme.rejected");
        expect(rejected.map((record) => (record.data as {scheme: string}).scheme).sort()).toEqual(["third", "user"]);
        expect(await agent.read("third://a")).toMatchObject({ok: false, code: "unknown-scheme"});
        // 两个插件注册同一个方案：平台按贡献 id 重复把两条都拒绝（runtime/plugins.md 输出 15），不分先后，都到不了接收者。
        expect(world.hub.plugins.diagnostics().some((item) => item.reason === "receiver-connected" && item.capability === SCHEMES_POINT)).toBe(true);
        expect(await agent.realPath("notes://a")).toMatchObject({ok: false, code: "unknown-scheme"});

        await mkdir(join(container, "later"));
        const scope = world.hub.root.createChild("later scheme");
        expect(world.hub.plugins.register(schemePlugin("nbook.test-later", "later", () => ({...notesSpec(container), mount: () => ({create: false})})), {scope})).toMatchObject({status: "accepted"});
        expect(await world.hub.plugins.activate({plugin: "nbook.test-later", entry: "server"})).toMatchObject({status: "activated"});
        expect(await agent.list("later://later")).toMatchObject({ok: true});
        await scope.close();
        expect(await agent.list("later://later")).toMatchObject({ok: false, code: "unknown-scheme"});
    });

    test("验收 8：挂载点空闲满 5 分钟关闭，之后按新目录重开；打开中的挂载点认着原来的目录", async () => {
        const {world, agent, container} = await scene();
        expect(await agent.create("notes://a/one.md", "file", asAgent("a"))).toMatchObject({ok: true});
        // 外部把挂载点的目录换成新的：还开着的挂载点认原目录，报根不在，不改投。
        await rm(join(container, "a"), {recursive: true});
        await mkdir(join(container, "a"));
        await writeFile(join(container, "a", "two.md"), "新");
        expect(await agent.read("notes://a/two.md")).toMatchObject({ok: false, code: "root-gone"});
        world.clock.advance(IDLE_CLOSE_MS);
        await waitUntil("空闲关闭后按新目录重开", async () => (await agent.read("notes://a/two.md")).ok);
    });

    test("容器被换成链接：重新打开挂载点时不跟着链接打开到别处", async () => {
        const {world, agent, container, root} = await scene();
        expect(await agent.realPath("notes://a")).toMatchObject({ok: true});
        world.clock.advance(IDLE_CLOSE_MS);
        const elsewhere = join(root, "elsewhere");
        await mkdir(join(elsewhere, "a"), {recursive: true});
        await writeFile(join(elsewhere, "a", "x.md"), "别处");
        await rm(container, {recursive: true});
        await symlink(elsewhere, container);
        await waitUntil("挂载点已经按容器不可用拒绝", async () => (await agent.read("notes://a/x.md")).ok === false);
        expect(await agent.read("notes://a/x.md")).toMatchObject({ok: false, code: "root-gone"});
    });

    test("验收 8：同时打开的超过上限时先关空闲最久的，第 65 个照开", async () => {
        const names = Array.from({length: MOUNT_SOFT_LIMIT + 1}, (_, index) => `m${String(index)}`);
        const {agent, container} = await scene({spec: (container) => ({...notesSpec(container), mount: (name) => (names.includes(name) ? {create: true} : null)})});
        for (const name of names.slice(0, MOUNT_SOFT_LIMIT)) expect(await agent.realPath(`notes://${name}`)).toMatchObject({ok: true});
        // 换掉最早打开的那个目录：它若还开着，读会报根不在。
        await rm(join(container, "m0"), {recursive: true});
        await mkdir(join(container, "m0"));
        await writeFile(join(container, "m0", "x.md"), "新");
        expect(await agent.realPath(`notes://${names[MOUNT_SOFT_LIMIT] as string}`)).toMatchObject({ok: true});
        await waitUntil("最早的挂载点被关闭、按新目录重开", async () => (await agent.read("notes://m0/x.md")).ok);
    });
});
