/**
 * `project://` 在真实项目子进程里（docs/specs/workspace/resources.md 验收 6，files.md 验收 5、7 的服务侧）：服务端
 * 实例、路由与项目管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.files` 的项目入口，用系统时钟），
 * 窗口是本进程里的浏览器内核实例，经进程内链路绑定项目。宽限期用注入时钟。
 *
 * 溢出用例暂停整个项目子进程（`SIGSTOP`），连同 Bun 的原生监视线程：只堵 JavaScript 回调时原生线程照样读走 inotify
 * 队列，造不出溢出。暂停期间创建的文件数超过 `/proc/sys/fs/inotify/max_queued_events`。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {holdLock} from "nbook/backend/locked-replace";
import {alive, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import type {FileChange, FilesService, WatchMessage} from "./shared/contracts";
import {hash, probe, probePlugin} from "./testing/scene";
import {filesBrowserPlugin} from "./web/plugin";

let tmp = "";
/** 本用例起的窗口与服务端场地：用例结束时（失败也一样）先关窗口，再停服务端实例，最后结束残留的项目子进程。 */
const windows: Window[] = [];
const harnesses: ProjectHarness[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "project-child");
});

afterEach(async () => {
    try {
        for (const window of windows.splice(0)) await window.close();
        for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
    } finally {
        killSpawnedProjects();
    }
});

async function harness(): Promise<ProjectHarness> {
    const created = await projectHarness(tmp);
    harnesses.push(created);
    return created;
}

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
    let closed = false;
    const window: Window = {
        files: tester.files!,
        close: async () => {
            if (closed) return;
            closed = true;
            await app.stop();
            pair.left.close();
        },
    };
    windows.push(window);
    return window;
}

function watching(window: Window): {readonly messages: WatchMessage[]; readonly release: () => void; readonly changes: () => FileChange[]} {
    const messages: WatchMessage[] = [];
    const release = window.files.watch("project", (message) => messages.push(message));
    return {messages, release, changes: () => messages.flatMap((message) => (message.kind === "batch" ? message.events : []))};
}

describe("Spec workspace.resources 项目子进程里的 project://", () => {
    it("两个窗口共用项目：读写、写入与外部修改的通知；关掉一个窗口，另一个照常读写与收到通知", async () => {
        const h = await harness();
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
        const h = await harness();
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

    // `SIGSTOP`、`/proc` 与 inotify 只在 Linux 上有。
    it.skipIf(process.platform !== "linux")("inotify 队列溢出：订阅收到 resync，溢出期间新建的子目录随后的修改仍能收到（监视已重建）", async () => {
        const limit = Number(await readFile("/proc/sys/fs/inotify/max_queued_events", "utf8"));
        const h = await harness();
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

    it("经窗口对子进程里的项目做一组操作：另一个窗口收到带来源的精确事件，没有外部回声", async () => {
        const h = await harness();
        await mkdir(join(h.project.path, "lore.content", "alice"), {recursive: true});
        await writeFile(join(h.project.path, "lore.content", "content.xml"), "<content>\n  <item name=\"alice\" title=\"爱丽丝\"/>\n</content>\n");
        await writeFile(join(h.project.path, "draft.md"), "D");
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const actor = await windowOf(h, "w1");
        const observer = await windowOf(h, "w2");
        const seen = watching(observer);
        await waitUntil("订阅就绪", () => seen.messages.some((message) => message.kind === "ready"));

        expect(await actor.files.create("project://lore.content/bob", "directory", {before: "alice"})).toEqual({ok: true, value: {}});
        expect(await actor.files.rename("project://lore.content/alice", "alicia")).toEqual({ok: true, value: {}});
        expect(await actor.files.move([{source: "project://draft.md", target: "project://lore.content/bob/draft.md"}]).result).toEqual({ok: true, value: {items: [{status: "done"}], manifests: []}});
        expect(await actor.files.delete([{address: "project://lore.content/alicia"}]).result).toEqual({ok: true, value: {items: [{status: "done"}], manifests: []}});
        expect(await readFile(join(h.project.path, "lore.content", "content.xml"), "utf8")).toBe("<content>\n  <item name=\"bob\">\n    <item name=\"draft.md\"/>\n  </item>\n</content>\n");

        // 屏障：外部写一个文件；它的通知到了，之前操作的回声也已处理完。
        await writeFile(join(h.project.path, "barrier.md"), "B");
        await waitUntil("屏障的通知", () => seen.changes().some((change) => change.path === "barrier.md"));
        const user = {kind: "user", plugin: "x.w1"} as const;
        expect(seen.changes().filter((change) => change.path !== "barrier.md")).toEqual([
            {type: "created", path: "lore.content/bob", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
            {type: "renamed", path: "lore.content/alicia", from: "lore.content/alice", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
            {type: "renamed", path: "lore.content/bob/draft.md", from: "draft.md", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
            {type: "deleted", path: "lore.content/alicia", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
        ]);
        seen.release();
        await actor.close();
        await observer.close();
        keep.release();
    }, 30_000);

    it("项目子进程收到停止：等在途批量的当前项结算后退出，后续项没有执行", async () => {
        const h = await harness();
        await mkdir(join(h.project.path, "lore.content", "alice"), {recursive: true});
        await writeFile(join(h.project.path, "lore.content", "content.xml"), "<content>\n  <item name=\"alice\"/>\n</content>\n");
        await writeFile(join(h.project.path, "draft.md"), "D");
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        const pid = await h.ready(1);
        const window = await windowOf(h, "w1");
        // 测试持有清单的写入锁：第一项提交文件后等这把锁，停在执行中。
        const locks = join(h.project.path, ".nbook", "locks", "files");
        await mkdir(locks, {recursive: true});
        const held = await holdLock(join(locks, `${createHash("sha256").update("lore.content/content.xml").digest("hex")}.lock`), () => undefined);
        if (!held.ok) throw new Error(held.detail);
        const handle = window.files.move([
            {source: "project://lore.content/alice", target: "project://lore.content/alice2"},
            {source: "project://draft.md", target: "project://moved.md"},
        ]);
        try {
            await waitUntil("第一项的文件已移动", () => lstat(join(h.project.path, "lore.content", "alice2")).then(() => true, () => false));
            process.kill(pid, "SIGTERM");
        } finally {
            await held.lock.release();
        }
        await waitUntil("项目子进程退出", () => !alive(pid), {timeoutMs: 10_000});
        expect(await readFile(join(h.project.path, "lore.content", "content.xml"), "utf8")).toContain("name=\"alice2\"");
        expect(await readFile(join(h.project.path, "draft.md"), "utf8")).toBe("D");
        expect(await lstat(join(h.project.path, "moved.md")).then(() => true, () => false)).toBe(false);
        await handle.result;
        await window.close();
        keep.release();
    }, 30_000);
});
