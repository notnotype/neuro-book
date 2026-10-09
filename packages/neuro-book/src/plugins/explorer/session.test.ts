/**
 * 资源管理器的会话、偏好记录与命令（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”，验收 4、16；
 * docs/specs/workbench/commands.md 的“命令目录（资源管理器）”）：文件来自真实的 Files 场地，偏好记录在真实的 Storage
 * 场地（真实 SQLite），两处都是真实内核实例。命令经真实的命令表执行；声明用命令系统登记时的同一份校验。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {commandDeclarationProblems, createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {CommandRegistry} from "nbook/plugins/commands/shared/registry";
import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";

import {descriptor} from "./plugin";
import {COLLAPSE_ALL_COMMAND, EXPLORER_COMMAND_DECLARATIONS, explorerCommands, REFRESH_FILES_COMMAND, RENAME_COMMAND, TOGGLE_MANIFESTS_COMMAND} from "./web/commands";
import {EXPANDED_LIMIT, explorerStoreFor, limitBranches} from "./web/preferences";
import type {ExplorerStore} from "./web/preferences";
import {createExplorerSession} from "./web/session";
import type {ExplorerSession} from "./web/session";
import {explorerState} from "./web/state";

let tmp = "";
let counter = 0;
const cleanups: Array<() => Promise<ReadonlyArray<unknown>>> = [];
const sessions: ExplorerSession[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-explorer", "session");
});

afterEach(async () => {
    for (const session of sessions.splice(0)) session.dispose();
    const results = [];
    for (const close of cleanups.splice(0)) results.push(...(await close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Worlds {
    readonly scene: Scene;
    readonly storage: StorageWorld;
    readonly tap: LinkTap;
}

async function worlds(): Promise<Worlds> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const tap = createLinkTap();
    const scene = await filesScene(join(root, "files"), {project: {"plain/a.md": "A", "plain/sub/b.md": "B", "lore.content/content.xml": "<content/>"}, user: {"notes.md": "U"}}, {wrapLink: tap.wrap});
    cleanups.push(async () => {
        const closed = await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
        return closed;
    });
    const storage = await storageWorld(join(root, "storage"), []);
    cleanups.push(() => storage.close());
    // 项目作用域的记录由项目实例里的 Storage 拥有。
    await storage.project(1, []);
    return {scene, storage, tap};
}

/** 在 Storage 场地里以 `nbook.explorer` 的身份开一个窗口，返回建资源管理器 store 的函数（记录地址与产品一致）。 */
async function storeFactory(world: StorageWorld, id: string, client: string): Promise<() => ExplorerStore> {
    return (await storeWindow(world, id, client)).create;
}

/** 同 `storeFactory`，另带窗口的 Storage 链路（断线与重连）。 */
async function storeWindow(world: StorageWorld, id: string, client: string): Promise<{readonly create: () => ExplorerStore; readonly link: WorldWindow}> {
    const hosted: {create: (() => ExplorerStore) | null} = {create: null};
    const plugin: PluginDefinition = {
        id: descriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                const diagnostics = context.services.require(diagnosticsKey);
                hosted.create = () => explorerStoreFor(true).create(context, {storage, diagnostics});
                return {};
            },
        }],
    };
    const link = await world.window(id, client, [plugin], {bound: true});
    const create = hosted.create as (() => ExplorerStore) | null;
    if (create === null) throw new Error("没有激活");
    return {create, link};
}

function registry(session: ExplorerSession): CommandRegistry {
    const commands = createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
        throw error;
    }});
    const implementations = explorerCommands(session, () => "zh-CN");
    for (const [id, declaration] of Object.entries(EXPLORER_COMMAND_DECLARATIONS)) {
        // `when` 读产品的公开状态，这里的本地命令表没有那些键：只登记声明的其余部分。
        const {when: _when, ...rest} = declaration;
        const registered = commands.register({id, source: descriptor.id, declaration: rest, run: (args) => (implementations[id] as {run: (args: unknown) => never}).run(args)});
        if (!registered.ok) throw new Error(registered.reason);
    }
    return commands;
}

function session(at: Worlds, createStore: () => ExplorerStore): ExplorerSession {
    const created = createExplorerSession({files: files(at.scene.window), commands: {execute: async () => ({ok: false, code: "unknown-command", reason: "测试里没有编辑器"})}, bound: true, createStore, report: (error) => {
        throw error;
    }});
    sessions.push(created);
    return created;
}

const view = {id: "nbook.explorer", generation: 1, visible: shallowRef(true)};

async function listed(at: Worlds, current: ExplorerSession, address: string): Promise<void> {
    await waitUntil(`${address} 列出`, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return current.controller.value?.rows.value.some((row) => row.id === address) ?? false;
    });
}

describe("Spec workbench.commands 命令目录（资源管理器）：声明", () => {
    it("声明通过命令系统的校验；when 只引用资源管理器声明的公开键", () => {
        const declared = new Set((Object.keys(explorerState.declarations) as Array<keyof typeof explorerState.declarations>).map((name) => explorerState.key(name)));
        for (const [id, declaration] of Object.entries(EXPLORER_COMMAND_DECLARATIONS)) {
            expect(commandDeclarationProblems(id, descriptor.id, declaration), id).toEqual([]);
            for (const key of declaration.when?.requires ?? []) expect(declared.has(key), key).toBe(true);
        }
    });
});

describe("Spec workbench.files-explorer 新应用的插件、命令与界面：会话与命令", () => {
    it("视图挂上之前命令为 unavailable；挂上并首读结束后可用；刷新带错的代次为 stale-target", async () => {
        const at = await worlds();
        const current = session(at, await storeFactory(at.storage, "w", "c"));
        const commands = registry(current);
        expect(await commands.execute(COLLAPSE_ALL_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "资源管理器尚未打开"});
        // 视图没挂上之前不打开偏好记录、不列目录。
        expect(current.store.value).toBeNull();
        expect(at.tap.requests.filter((request) => request.method === "list")).toEqual([]);

        current.attach(view);
        await listed(at, current, "project://plain");
        expect(await commands.execute(REFRESH_FILES_COMMAND, {viewId: "nbook.explorer", generation: 2})).toEqual({ok: false, code: "stale-target", reason: "资源管理器视图已重建"});
        const before = at.tap.requests.filter((request) => request.method === "list").length;
        expect(await commands.execute(REFRESH_FILES_COMMAND, {viewId: "nbook.explorer", generation: 1})).toEqual({ok: true, value: null});
        // 在途的列出结束后才重列：等新的列出请求发出。
        await waitUntil("刷新后重新列出", () => at.tap.requests.filter((request) => request.method === "list").length > before);
        expect(await commands.execute(TOGGLE_MANIFESTS_COMMAND)).toEqual({ok: true, value: null});
        expect(current.controller.value?.showManifests.value).toBe(true);
    });

    it("需要界面输入的命令要求视图可见；可见时按选择核对，不合格的原因说明", async () => {
        const at = await worlds();
        const current = session(at, await storeFactory(at.storage, "w", "c"));
        const commands = registry(current);
        const visible = shallowRef(false);
        current.attach({id: "nbook.explorer", generation: 1, visible});
        await listed(at, current, "project://plain");
        expect(await commands.execute(RENAME_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "资源管理器没有显示"});
        // 不需要输入的命令不看可见性。
        expect(await commands.execute(COLLAPSE_ALL_COMMAND)).toEqual({ok: true, value: null});
        visible.value = true;
        expect(await commands.execute(RENAME_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "没有选中可以操作的项"});
        current.controller.value!.contextSelect("project://plain");
        expect(await commands.execute(RENAME_COMMAND)).toEqual({ok: true, value: null});
        expect(current.controller.value!.editing.value).toMatchObject({mode: "rename", address: "project://plain"});
    });

    it("显示偏好与两棵树的展开写进记录；同一客户端的下一个会话按记录恢复（项目树、用户资产树、显示清单文件）", async () => {
        const at = await worlds();
        const first = session(at, await storeFactory(at.storage, "w1", "c"));
        first.attach(view);
        await listed(at, first, "project://plain");
        const controller = first.controller.value!;
        controller.model.expand("project://plain");
        controller.model.expand("user://");
        first.setShowManifests(true);
        const store = first.store.value!;
        await waitUntil("三条记录保存完", () => store.state.preferences.base?.status === "ok" && store.state.expanded?.base?.status === "ok" && store.state.userExpanded.base?.status === "ok" && store.state.preferences.save.state === "idle" && store.state.expanded.save.state === "idle" && store.state.userExpanded.save.state === "idle" && store.state.expanded.queue === 0 && store.state.userExpanded.queue === 0 && store.state.preferences.queue === 0);
        expect(store.state.expanded?.base).toMatchObject({value: {paths: ["", "plain"]}});
        expect(store.state.userExpanded.base).toMatchObject({value: {paths: [""]}});

        const second = session(at, await storeFactory(at.storage, "w2", "c"));
        second.attach(view);
        await waitUntil("第二个会话的控制器建立", () => second.controller.value);
        expect([...second.controller.value!.model.expanded.value]).toEqual(["project://", "project://plain", "user://"]);
        expect(second.controller.value!.showManifests.value).toBe(true);
        await listed(at, second, "project://plain/a.md");
        await listed(at, second, "user://notes.md");
        await waitUntil("收起全部", async () => (await registry(second).execute(COLLAPSE_ALL_COMMAND)).ok);
        expect([...second.controller.value!.model.expanded.value]).toEqual(["project://", "user://"]);
    });
});

describe("Spec workbench.files-explorer 持久化：按分支淘汰", () => {
    it("超出上限时从最早展开的开始去掉，连同记录里它的后代；方案根不淘汰", () => {
        expect(limitBranches(["project://a", "project://b", "project://a/x", "project://c"], 3)).toEqual(["project://b", "project://c"]);
        expect(limitBranches(["project://", "project://a", "project://b"], 3)).toEqual(["project://", "project://a", "project://b"]);
        // 方案根是全部地址的祖先，不淘汰。
        expect(limitBranches(["user://", "project://a", "project://b"], 2)).toEqual(["user://", "project://b"]);
        const many = Array.from({length: EXPANDED_LIMIT + 5}, (_, index) => `project://d${String(index)}`);
        expect(limitBranches(many, EXPANDED_LIMIT)).toEqual(many.slice(5));
    });
});

describe("Spec workbench.files-explorer 验收 16：保存暂停时的重试与放弃", () => {
    it("Storage 断线时展开没保存上：视图得到“未保存”；暂停期间的展开只改显示、合并成最后一份；重连后重试提交最后一份", async () => {
        const at = await worlds();
        const {create, link} = await storeWindow(at.storage, "w1", "c");
        const current = session(at, create);
        current.attach(view);
        await listed(at, current, "project://plain");
        const store = current.store.value!;
        const expanded = store.state.expanded!;
        await waitUntil("记录就绪", () => expanded.ready && expanded.save.state === "idle" && expanded.queue === 0);

        link.disconnect();
        current.controller.value!.model.expand("project://plain");
        await waitUntil("保存暂停", () => current.problem.value?.kind === "unsaved");
        await listed(at, current, "project://plain/sub");
        current.controller.value!.model.expand("project://plain/sub");
        current.controller.value!.model.collapse("project://plain/sub");
        current.controller.value!.model.expand("project://lore.content");
        expect(expanded.display.paths).toEqual(["", "plain", "lore.content"]);
        expect(expanded.queue).toBe(1);
        // 显示偏好同样：暂停后来回切换只记最后一份，不在队列里堆积。
        const preferences = store.state.preferences;
        current.setShowManifests(true);
        await waitUntil("显示偏好的保存暂停", () => preferences.save.state === "failed" || preferences.save.state === "unknown");
        for (const show of [false, true, false, true]) current.setShowManifests(show);
        expect(preferences.queue).toBe(1);
        expect(preferences.display.showManifests).toBe(true);

        await link.reconnect();
        await current.retryPreferences();
        await waitUntil("最后一份保存上", () => expanded.save.state === "idle" && expanded.queue === 0 && expanded.base?.status === "ok" && expanded.base.value.paths.length === 3 && preferences.queue === 0 && preferences.save.state === "idle");
        expect(preferences.base).toMatchObject({value: {showManifests: true}});
        expect(expanded.base).toMatchObject({value: {paths: ["", "plain", "lore.content"]}});
        expect(current.problem.value).toBeNull();
    });

    it("放弃：没保存上的修改丢掉，记录的显示与树都回到已保存的值", async () => {
        const at = await worlds();
        const {create, link} = await storeWindow(at.storage, "w1", "c");
        const current = session(at, create);
        current.attach(view);
        await listed(at, current, "project://plain");
        const store = current.store.value!;
        const expanded = store.state.expanded!;
        await waitUntil("记录就绪", () => expanded.ready && expanded.save.state === "idle" && expanded.queue === 0);

        link.disconnect();
        current.controller.value!.model.expand("project://plain");
        await waitUntil("保存暂停", () => current.problem.value?.kind === "unsaved");
        current.controller.value!.model.expand("project://lore.content");
        current.setShowManifests(true);
        // 在途的队首不能放弃（store.md）：等显示偏好的保存也停下来。
        const preferences = store.state.preferences;
        await waitUntil("显示偏好的保存暂停", () => preferences.save.state === "failed" || preferences.save.state === "unknown");
        current.discardPreferences();
        expect(expanded.display.paths).toEqual([""]);
        expect(current.controller.value!.showManifests.value).toBe(false);
        expect(current.problem.value).toBeNull();
        // 树也回到记录：放弃的展开不再显示，之后也不会被存回去。
        expect([...current.controller.value!.model.expanded.value]).toEqual(["project://"]);
    });

    it("首读失败时照常浏览：期间的展开没保存上；重连后点一次“重新读取”就重开记录并保存暂停的修改", async () => {
        const at = await worlds();
        const {create, link} = await storeWindow(at.storage, "w1", "c");
        link.disconnect();
        const current = session(at, create);
        current.attach(view);
        await waitUntil("首读失败后照常建控制器", () => current.controller.value !== null && current.problem.value?.kind === "unread");
        await listed(at, current, "project://plain");
        current.controller.value!.model.expand("project://plain");
        const expanded = current.store.value!.state.expanded!;
        await waitUntil("修改停在队里", () => expanded.queue > 0 && expanded.save.state !== "saving");

        await link.reconnect();
        await current.retryPreferences();
        await waitUntil("一次重试就保存上", () => expanded.queue === 0 && expanded.save.state === "idle" && expanded.base?.status === "ok");
        expect(expanded.base).toMatchObject({value: {paths: ["", "plain"]}});
        expect(current.problem.value).toBeNull();
        expect([...current.controller.value!.model.expanded.value]).toEqual(["project://", "project://plain"]);
    });
});
