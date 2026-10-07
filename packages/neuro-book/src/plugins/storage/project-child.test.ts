/**
 * project 分区在真实项目子进程里（docs/specs/storage/persistence.md 场景 1、3、7、8）：服务端实例、路由与项目
 * 管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.storage` 的项目入口），窗口是本进程里的
 * 浏览器内核实例，经进程内链路绑定项目。宽限期用注入时钟。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {alive, GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";
import {collectServiceKeys} from "nbook/shared/service-keys";
import {defineRecord} from "nbook/shared/storage";
import type {RecordHandle, StorageService} from "nbook/shared/storage";

import {createStorageServerPlugin} from "./server/plugin";
import {storageKey} from "./shared/contracts";
import {createStorageBrowserPlugin} from "./web/plugin";

const board = defineRecord({key: "board", scope: "project", locality: "shared", version: 1, schema: Type.Object({text: Type.String()}, {additionalProperties: false})});

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-storage", "project-child");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function serverPlugins(stateRoot: string): PluginDefinition[] {
    const silent = {error: () => undefined};
    return [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        createStorageServerPlugin({location: "server", storage: storageKey, path: join(stateRoot, "storage", "user.sqlite")}),
    ];
}

/** 绑定 `book` 的窗口：浏览器内核实例，装 `nbook.storage` 的浏览器入口与一个用 Storage 的插件。 */
async function windowOf(h: ProjectHarness, id: string, client: string): Promise<{readonly storage: StorageService; close(): Promise<void>}> {
    let storage: StorageService | null = null;
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: {project: "book"}});
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    const binding = node.binding!;
    const plugins: PluginDefinition[] = [
        createStorageBrowserPlugin({storage: storageKey, windowProject: windowProjectKey}),
        {id: "app.notes", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: storageKey}], activate: (context) => {
            storage = context.services.require(storageKey);
            return {};
        }}]},
    ];
    const app = createApplication(
        {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            keys: collectServiceKeys(plugins, [windowProjectKey]),
            capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: {id: binding.id, name: binding.name, generation: binding.generation}})}],
            plugins,
            gates: [],
            remote: node,
            delegation: (plugin) => plugin === "nbook.storage",
        },
    );
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {
        storage: storage!,
        close: async () => {
            await app.stop();
            pair.left.close();
        },
    };
}

async function opened(storage: StorageService): Promise<RecordHandle<{text: string}>> {
    const result = await storage.open(board);
    if (!result.ok) throw new Error(`打开失败：${result.code} ${result.detail}`);
    return result.handle;
}

describe("Spec storage.persistence：project 分区在项目子进程里", () => {
    it("两个窗口经代理共用项目里的记录；项目子进程退出时关库；下一代项目实例读到磁盘上的值", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(join(tmp, "hub-state"))});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        const pid = await h.ready(1);
        const library = join(h.project.path, ".nbook", "storage.sqlite");

        const first = await windowOf(h, "browser-1", "profile-1");
        const second = await windowOf(h, "browser-2", "profile-2");
        expect(await (await opened(first.storage)).save({text: "项目里的"}, {expect: null})).toMatchObject({ok: true});
        expect(await (await opened(second.storage)).read()).toMatchObject({status: "ok", value: {text: "项目里的"}});
        expect(existsSync(library)).toBe(true);
        expect(existsSync(`${library}-wal`)).toBe(true);

        await first.close();
        await second.close();
        keep.release();
        h.clock.advance(GRACE_MS);
        await revoked(keep);
        expect(alive(pid)).toBe(false);
        // 最后一个连接关库时 SQLite 收回 WAL 文件：子进程在退出前关了库。
        expect(existsSync(`${library}-wal`)).toBe(false);

        const again = leaseOf(await h.manager.acquire("book", "test"));
        expect(again.generation).toBe(2);
        await h.ready(2);
        const third = await windowOf(h, "browser-3", "profile-3");
        expect(await (await opened(third.storage)).read()).toMatchObject({status: "ok", value: {text: "项目里的"}});
        await third.close();
        again.release();
    }, 30_000);
});
