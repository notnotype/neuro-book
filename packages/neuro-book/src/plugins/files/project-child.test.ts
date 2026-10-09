/**
 * `project://` 在真实项目子进程里（docs/specs/workspace/resources.md 验收 6，files.md 验收 5、7 的服务侧）：服务端
 * 实例、路由与项目管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.files` 的项目入口，用系统时钟），
 * 窗口是本进程里的浏览器内核实例，经进程内链路绑定项目。宽限期用注入时钟。
 *
 * 溢出用例暂停整个项目子进程（`SIGSTOP`），连同 Bun 的原生监视线程：只堵 JavaScript 回调时原生线程照样读走 inotify
 * 队列，造不出溢出。暂停期间创建的文件数超过 `/proc/sys/fs/inotify/max_queued_events`。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import type {FileChange, FilesService, WatchMessage} from "./shared/contracts";
import {hash, probe, probePlugin} from "./testing/scene";
import {filesBrowserPlugin} from "./web/plugin";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "project-child");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Window {
    readonly files: FilesService;
    close(): Promise<void>;
}

/** 绑定 `book` 的窗口：浏览器内核实例，装 `nbook.files` 的浏览器入口与测试插件 `x.<id>`。 */
async function windowOf(h: ProjectHarness, id: string): Promise<Window> {
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client: `client-${id}`}, bind: {project: "book"}});
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    const binding = node.binding!;
    const silent = {error: () => undefined};
    const tester = probe();
    const plugins: PluginDefinition[] = [
        createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: id}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        filesBrowserPlugin,
        probePlugin(`x.${id}`, "browser", tester),
    ];
    const app = createApplication(
        {identity: {location: "browser", instanceId: id, client: `client-${id}`}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: {id: binding.id, name: binding.name, generation: binding.generation}})}],
            plugins,
            gates: [],
            remote: node,
            delegation: (plugin) => plugin === "nbook.files",
        },
    );
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {
        files: tester.files!,
        close: async () => {
            await app.stop();
            pair.left.close();
        },
    };
}

function watching(window: Window): {readonly messages: WatchMessage[]; readonly release: () => void; readonly changes: () => FileChange[]} {
    const messages: WatchMessage[] = [];
    const release = window.files.watch("project", (message) => messages.push(message));
    return {messages, release, changes: () => messages.flatMap((message) => (message.kind === "batch" ? message.events : []))};
}

describe("Spec workspace.resources 项目子进程里的 project://", () => {
    it("两个窗口共用项目：读写、写入与外部修改的通知；关掉一个窗口，另一个照常读写与收到通知", async () => {
        const h = await projectHarness(tmp);
        await writeFile(join(h.project.path, "chapter.md"), "初稿");
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const first = await windowOf(h, "w1");
        const second = await windowOf(h, "w2");
        const seen = watching(second);
        await waitUntil("订阅就绪", () => seen.messages.some((message) => message.kind === "ready"));

        expect(await first.files.read("project://chapter.md")).toEqual({ok: true, value: {text: "初稿", baseline: {hash: hash("初稿")}}});
        expect(await first.files.write("project://chapter.md", "二稿", {hash: hash("初稿")})).toMatchObject({ok: true});
        await waitUntil("写作者的保存事件", () => seen.changes().some((change) => change.path === "chapter.md" && change.source.kind === "user"));
        expect(seen.changes()).toContainEqual({type: "changed", path: "chapter.md", source: {kind: "user", plugin: "x.w1"}});

        await first.close();
        await writeFile(join(h.project.path, "notes.md"), "外部");
        await waitUntil("外部修改的通知", () => seen.changes().some((change) => change.path === "notes.md" && change.source.kind === "external"));
        expect(await second.files.write("project://chapter.md", "三稿", {hash: hash("二稿")})).toMatchObject({ok: true});
        expect(await readFile(join(h.project.path, "chapter.md"), "utf8")).toBe("三稿");

        seen.release();
        await second.close();
        keep.release();
    }, 30_000);

    it("项目代次结束（子进程崩溃）：旧窗口的请求失败、订阅以结束收场；新代次的窗口读到磁盘上的内容", async () => {
        const h = await projectHarness(tmp);
        await writeFile(join(h.project.path, "chapter.md"), "初稿");
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        const pid = await h.ready(1);
        const old = await windowOf(h, "w1");
        const seen = watching(old);
        await waitUntil("订阅就绪", () => seen.messages.some((message) => message.kind === "ready"));
        expect(await old.files.write("project://chapter.md", "二稿", {hash: hash("初稿")})).toMatchObject({ok: true});

        // 窗口自己的绑定也持有项目：放掉测试的租约不会结束代次，所以让子进程崩溃。
        process.kill(pid, "SIGKILL");
        await revoked(keep);
        await waitUntil("旧窗口的订阅结束", () => seen.messages.some((message) => message.kind === "ended"));
        expect(seen.messages.filter((message) => message.kind === "ended")).toHaveLength(1);
        const stale = await old.files.read("project://chapter.md");
        expect(stale.ok).toBe(false);

        const again = leaseOf(await h.manager.acquire("book", "test"));
        expect(again.generation).toBe(2);
        await h.ready(2);
        const fresh = await windowOf(h, "w2");
        expect(await fresh.files.read("project://chapter.md")).toMatchObject({ok: true, value: {text: "二稿"}});
        await old.close();
        await fresh.close();
        again.release();
    }, 30_000);

    it("inotify 队列溢出：订阅收到 resync，溢出期间新建的子目录随后的修改仍能收到（监视已重建）", async () => {
        const limit = Number(await readFile("/proc/sys/fs/inotify/max_queued_events", "utf8"));
        const h = await projectHarness(tmp);
        // 灌满队列的目录要在监视建立前就在：暂停期间新建的目录还没加上监视，往里写不产生事件。放在控制目录里，事件
        // 进得了 inotify 队列、却不进文件服务的待处理批（不触发“一批路径过多”的 resync）。
        await mkdir(join(h.project.path, ".nbook", "flood"), {recursive: true});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        const pid = await h.ready(1);
        const window = await windowOf(h, "w1");
        const seen = watching(window);
        await waitUntil("订阅就绪", () => seen.messages.some((message) => message.kind === "ready"));

        process.kill(pid, "SIGSTOP");
        try {
            for (let index = 0; index <= limit; index += 1) await writeFile(join(h.project.path, ".nbook", "flood", `f${String(index)}.md`), "");
            await mkdir(join(h.project.path, "missed", "deep"), {recursive: true});
            await writeFile(join(h.project.path, "missed", "deep", "chapter.md"), "溢出期间");
        } finally {
            process.kill(pid, "SIGCONT");
        }
        await waitUntil("溢出后的 resync", () => seen.messages.some((message) => message.kind === "resync"), {timeoutMs: 20_000});
        await writeFile(join(h.project.path, "missed", "deep", "chapter.md"), "溢出之后");
        await waitUntil("溢出期间新建目录里的修改", () => seen.changes().some((change) => change.path === "missed/deep/chapter.md"), {timeoutMs: 10_000});

        seen.release();
        await window.close();
        keep.release();
    }, 60_000);
});
