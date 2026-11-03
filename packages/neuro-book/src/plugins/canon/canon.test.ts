/**
 * 世界服务在真实项目子进程里（docs/specs/canon/project.md 输出 1、10、13、18、21、23）：服务端实例、路由与项目
 * 管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.canon` 的项目入口），窗口是本进程里的浏览器
 * 内核实例，装 `nbook.canon` 的浏览器入口，经进程内链路绑定项目。目录监视是异步的：等可观察的结果，不按时长等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {replaceLocked} from "nbook/backend/locked-replace";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import {CANON_BUDGET_BYTES, canonClientKey} from "./shared/contracts";
import type {CanonClient, CanonEvent} from "./shared/contracts";
import {canonBrowserPlugin} from "./web/plugin";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "project-child");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function serverPlugins(): PluginDefinition[] {
    const silent = {error: () => undefined};
    return [createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)})];
}

interface TestWindow {
    readonly canon: CanonClient;
    /** 断开窗口的链路（不停窗口实例）。 */
    disconnect(): void;
    close(): Promise<void>;
}

/** 绑定 `book` 的窗口：浏览器内核实例，装 `nbook.canon` 的浏览器入口与一个用世界客户端的插件。 */
async function windowOf(h: ProjectHarness, id: string, client: string): Promise<TestWindow> {
    let canon: CanonClient | null = null;
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: {project: "book"}});
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    const binding = node.binding!;
    const app = createApplication(
        {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: {id: binding.id, name: binding.name, generation: binding.generation}})}],
            plugins: [
                canonBrowserPlugin,
                {id: "app.writer", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}], activate: (context) => {
                    canon = context.services.require(canonClientKey);
                    return {};
                }}]},
            ],
            gates: [],
            remote: node,
        },
    );
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {
        canon: canon!,
        disconnect: () => pair.left.close(),
        close: async () => {
            await app.stop();
            pair.left.close();
        },
    };
}

/** 等一个异步才成立的条件（目录监视、事件推送）；10 秒内不成立就失败。 */
async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error("等待的条件 10 秒内没有成立");
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

let sequence = 0;
function person(name: string, extra: Partial<Entry["init"]> = {}): WriteRequest {
    const id = `tmp:${String(++sequence)}`;
    const entry: Entry = {id, type: "nbook.canon.person", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}, ...extra}};
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion: 0, puts: [{ref: {kind: "entry", id}, after: entry}]};
}

async function version(canon: CanonClient): Promise<number> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    return status.value.version;
}

async function publish(canon: CanonClient, request: WriteRequest, token?: string) {
    return canon.publish({...request, baseVersion: await version(canon)}, token);
}

async function binder(h: ProjectHarness, xml: string): Promise<void> {
    await mkdir(join(h.project.path, "manuscripts.binder"), {recursive: true});
    const result = await replaceLocked(join(h.project.path, "manuscripts.binder", "binder.xml"), {lockPath: join(h.project.path, ".nbook", "locks", "binder.lock"), decide: () => ({write: xml}), report: () => undefined});
    expect(result.ok).toBe(true);
}

async function reorders(canon: CanonClient): Promise<number> {
    const page = await canon.call("revisions", {filter: {by: "system"}});
    if (!page.ok) throw new Error(page.failure.code);
    return page.value.items.filter((item) => item.what === "reorder").length;
}

describe("canon.project：世界服务在项目子进程里", () => {
    it("输出 1、13、21：两个窗口共用项目里的一个世界；一边发布，另一边收到 changed 后读到；日志与锁在 .nbook 下", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const first = await windowOf(h, "browser-1", "profile-1");
        const second = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await second.canon.subscribe((event) => seen.push(event))).ok).toBe(true);

        const result = await publish(first.canon, person("星瑕"));
        if (!result.ok) throw new Error(result.failure.code);
        expect(result.value.version).toBe(1);
        await until(() => seen.some((event) => event.kind === "changed" && event.version === 1));
        const found = await second.canon.call("lookup", {names: ["星瑕"], position: {kind: "initial"}});
        expect(found).toEqual({ok: true, value: {version: 1, found: {星瑕: Object.values(result.value.ids)}}});
        expect(existsSync(join(h.project.path, ".nbook", "world", "log", "000001.jsonl"))).toBe(true);
        expect(existsSync(join(h.project.path, ".nbook", "locks"))).toBe(true);

        await first.close();
        await second.close();
        keep.release();
    }, 30_000);

    it("输出 10：独占期间别的窗口写入得到 busy；持有窗口的链路断开，独占随租约订阅结束", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const task = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await author.canon.subscribe((event) => seen.push(event))).ok).toBe(true);

        const held = await task.canon.hold("第 5 章记账");
        if (!held.ok) throw new Error(held.failure.code);
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: false, failure: {code: "busy", holder: "第 5 章记账"}});
        expect(await publish(task.canon, person("白灵"), held.value.token)).toMatchObject({ok: true});

        task.disconnect();
        await until(() => seen.some((event) => event.kind === "exclusive" && event.holder === null));
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: true});

        await task.close();
        await author.close();
        keep.release();
    }, 30_000);

    it("输出 10：独占被强行解除时持有方收到一次结束；自己释放不算结束；持有窗口停止时独占结束", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const task = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        const seen: CanonEvent[] = [];
        expect((await author.canon.subscribe((event) => seen.push(event))).ok).toBe(true);
        const holderNull = () => seen.filter((event) => event.kind === "exclusive" && event.holder === null).length;

        const ends: string[] = [];
        const first = await task.canon.hold("第 5 章记账", (reason) => ends.push(reason));
        if (!first.ok) throw new Error(first.failure.code);
        expect(first.value.expires).toBeGreaterThan(0);
        expect((await first.value.renew()).ok).toBe(true);
        expect((await author.canon.call("breakExclusive", {})).ok).toBe(true);
        await until(() => ends.length > 0);
        expect(ends).toEqual(["ended"]);
        expect(await publish(author.canon, person("星瑾"))).toMatchObject({ok: true});

        const second = await task.canon.hold("第 6 章记账", (reason) => ends.push(reason));
        if (!second.ok) throw new Error(second.failure.code);
        expect(await second.value.release()).toEqual({ok: true, value: null});
        expect(await publish(author.canon, person("白灵"))).toMatchObject({ok: true});

        const third = await task.canon.hold("第 7 章记账");
        if (!third.ok) throw new Error(third.failure.code);
        const before = holderNull();
        await task.close();
        await until(() => holderNull() > before);
        expect(await publish(author.canon, person("彗"))).toMatchObject({ok: true});
        expect(ends).toEqual(["ended"]);

        await author.close();
        keep.release();
    }, 30_000);

    it("订阅：释放后不再收到事件；没有绑定项目的窗口调用得到 no-project", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        const released: CanonEvent[] = [];
        const kept: CanonEvent[] = [];
        const subscription = await window.canon.subscribe((event) => released.push(event));
        if (!subscription.ok) throw new Error(subscription.failure.code);
        expect((await window.canon.subscribe((event) => kept.push(event))).ok).toBe(true);
        expect((await publish(window.canon, person("星瑕"))).ok).toBe(true);
        await until(() => released.some((event) => event.kind === "changed") && kept.some((event) => event.kind === "changed"));
        subscription.value.release();
        expect((await publish(window.canon, person("星瑾"))).ok).toBe(true);
        await until(() => kept.filter((event) => event.kind === "changed").length === 2);
        expect(released.filter((event) => event.kind === "changed")).toHaveLength(1);
        await window.close();

        let unbound: CanonClient | null = null;
        const app = createApplication(
            {identity: {location: "browser", instanceId: "browser-unbound", client: "profile-9"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: null})}],
                plugins: [canonBrowserPlugin, {id: "app.writer", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}], activate: (context) => {
                    unbound = context.services.require(canonClientKey);
                    return {};
                }}]}],
                gates: [],
                remote: createRemoteNode({instance: {id: "browser-unbound", kind: "browser", role: "client", project: null, client: "profile-9"}}),
            },
        );
        expect(await app.startup).toMatchObject({status: "available"});
        expect(await unbound!.call("status", {})).toMatchObject({ok: false, failure: {code: "no-project"}});
        expect(await unbound!.hold("记账")).toMatchObject({ok: false, failure: {code: "no-project"}});
        await app.stop();
        keep.release();
    }, 30_000);

    it("输出 18：请求超过预算时不发出；结果超过预算回 too-large；列表按预算缩小一页", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins()});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");

        expect(await publish(window.canon, person("大", {summary: "字".repeat(Math.ceil(CANON_BUDGET_BYTES / 3) + 10)}))).toEqual({ok: false, failure: {code: "too-large"}});
        expect(await version(window.canon)).toBe(0);

        // 三个名字各约 400 KiB 的条目：一页三条超过预算，缩成两条以下，带游标接着读。
        for (const mark of ["甲", "乙", "丙"]) expect((await publish(window.canon, person(mark.repeat(135_000)))).ok).toBe(true);
        const page = await window.canon.call("tree", {parent: null});
        if (!page.ok) throw new Error(page.failure.code);
        expect(page.value.items.length).toBeLessThan(3);
        expect(page.value.cursor).toBeDefined();

        // 渲染给作者的语法树比源文大得多：源文在预算内，渲染结果超过预算。粗体之间留空格：连写的 `**粗****粗**…`
        // 在 micromark 里解析时间按平方增长（1 万个约 3 秒）。
        const bold = await publish(window.canon, person("粗", {text: [{id: "b1", source: "**粗** ".repeat(30_000)}]}));
        if (!bold.ok) throw new Error(bold.failure.code);
        const id = Object.values(bold.value.ids)[0]!;
        expect(await window.canon.call("render", {entry: id, position: {kind: "initial"}, mode: "actual", audience: "author"})).toEqual({ok: false, failure: {code: "too-large"}});

        await window.close();
        keep.release();
    }, 60_000);

    it("输出 9、23：活页夹清单给出章序；清单写坏不改章序、写诊断；改好后照常；加锁替换清单两次，两次都收到新章序", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            await mkdir(join(paths.project.path, "manuscripts.binder"), {recursive: true});
            await writeFile(join(paths.project.path, "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="一"/><chapter id="2" title="二"/></binder>');
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);

        await binder(h, "<binder><chapter id=");
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.diagnostics.some((item) => (item as {code?: string}).code === "binder-invalid");
        });
        expect(await reorders(window.canon)).toBe(1);
        expect((await window.canon.call("pending", {position: {kind: "chapter", chapter: "2", edge: "end"}})).ok).toBe(true);

        await binder(h, '<binder nextId="3"><chapter id="2" title="二"/><chapter id="1" title="一"/></binder>');
        await until(async () => (await reorders(window.canon)) === 2);
        await binder(h, '<binder nextId="4"><group title="卷一"><chapter id="2" title="二"/><chapter id="1" title="一"/></group><chapter id="3" title="三"/></binder>');
        await until(async () => (await reorders(window.canon)) === 3);
        expect((await window.canon.call("pending", {position: {kind: "chapter", chapter: "3", edge: "end"}})).ok).toBe(true);

        await window.close();
        keep.release();
    }, 30_000);
});
