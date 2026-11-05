/**
 * 世界服务在真实项目子进程里（docs/specs/canon/project.md 输出 1、10、13、18、21、23）：服务端实例、路由与项目
 * 管理器是真实的，项目子进程跑项目宿主的测试入口（产品插件里含 `nbook.canon` 的项目入口），窗口是本进程里的浏览器
 * 内核实例，装 `nbook.canon` 的浏览器入口，经进程内链路绑定项目。目录监视是异步的：等可观察的结果，不按时长等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {replaceLocked} from "nbook/backend/locked-replace";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowProjectKey} from "nbook/shared/projects";

import {CANON_BUDGET_BYTES, canonClientKey} from "./shared/contracts";
import type {CanonClient, CanonEvent} from "./shared/contracts";
import {publish, serverPlugins, until, version, windowOf} from "./testing/harness";
import {CANON_PROBE_ID, PROBE_DIAGNOSTIC, PROBE_MARK} from "./testing/probe-plugin";
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

let sequence = 0;
function person(name: string, extra: Partial<Entry["init"]> = {}): WriteRequest {
    const id = `tmp:${String(++sequence)}`;
    const entry: Entry = {id, type: "nbook.canon.person", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}, ...extra}};
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: name, baseVersion: 0, puts: [{ref: {kind: "entry", id}, after: entry}]};
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
        expect(found).toMatchObject({ok: true, value: {version: 1, found: {星瑕: Object.values(result.value.ids)}}});
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

/** 活页夹三章，正文各一段；章节文件名按活页夹的写法（`00001-…md`）。 */
describe("canon.time 输出 4、8、16：作品设置里的历法", () => {
    it("项目层设置里的自定义历法生效：时间查询按它回答，最近一次合法的历法存进 .nbook；改成不合法的以后照样用它；清空设置回到公历、存下的删掉", async () => {
        const royal = {version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: [{id: "frost", name: "霜月", days: 30}], eras: [{id: "royal", name: "王历", start: 1}]};
        let book = "";
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            book = paths.project.path;
            await threeChapters(paths);
            await mkdir(join(paths.project.path, ".nbook"), {recursive: true});
            await writeFile(join(paths.project.path, ".nbook", "settings.json"), JSON.stringify({"nbook.canon/calendar": royal}));
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        const eras = async () => {
            const read = await window.canon.call("time", {query: {kind: "calendar"}});
            return read.ok ? ((read.value.answer as {eras?: {id: string}[]}).eras ?? []).map((era) => era.id) : [];
        };
        await until(async () => (await eras()).includes("royal"));
        const created = await publish(window.canon, {requestId: "dated", by: {kind: "author"}, what: "edit", title: "定日子", baseVersion: await version(window.canon), puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "那一天", at: {kind: "chapter", chapter: "1", key: 0}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, when: [{kind: "date", era: "royal", year: 612, month: "frost", day: 5, basis: {kind: "author"}}]}}]});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const event = await window.canon.call("time", {query: {kind: "event", change: created.value.ids["tmp:c"]!}});
        expect(event.ok && (event.value.answer as {start: {text: string}}).start.text).toBe("王历612年霜月5日");
        const stored = join(book, ".nbook", "world", "calendar.json");
        await until(async () => existsSync(stored));
        // 设置改坏：照样用最近一次合法的那一份，不退回公历。
        await writeFile(join(book, ".nbook", "settings.json"), JSON.stringify({"nbook.canon/calendar": {...royal, months: []}}));
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.diagnostics.some((item) => (item as {code: string}).code === "calendar-invalid");
        });
        expect(await eras()).toEqual(["royal"]);
        // 清空设置：不填时用公历，存下的那份删掉（之后重启也不会再用它）。
        await writeFile(join(book, ".nbook", "settings.json"), JSON.stringify({}));
        await until(async () => !existsSync(stored));
        expect(await eras()).toEqual(["ad"]);
        await window.close();
        keep.release();
    }, 30_000);
});

async function threeChapters(paths: {readonly project: {readonly path: string}}): Promise<void> {
    const dir = join(paths.project.path, "manuscripts.binder");
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, "binder.xml"), '<binder nextId="4"><chapter id="1" title="一"/><chapter id="2" title="二"/><chapter id="3" title="三"/></binder>');
    await writeFile(join(dir, "00001-一.md"), "她把钟拨慢了一刻。\n");
    await writeFile(join(dir, "00002-二.md"), "雨下了一夜。\n");
    await writeFile(join(dir, "00003-三.md"), "天亮了。\n");
}

/** 一条安放在第 1 章、讲述“她把钟拨慢了一刻”的剧情变更；`marks` 给讲述带标注。 */
function told(baseVersion: number, marks?: readonly unknown[]): WriteRequest {
    const id = `tmp:c${String(++sequence)}`;
    return {requestId: `req-${String(sequence)}`, by: {kind: "author"}, what: "edit", title: "讲述", baseVersion, puts: [{ref: {kind: "change", id}, after: {id, kind: "written", text: "拨钟", at: {kind: "chapter", chapter: "1", key: 0}, told: [{source: "chapter", chapter: "1", quote: "她把钟拨慢了一刻", ...(marks === undefined ? {} : {marks})}], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}}}]};
}

async function rewriteChapter(h: ProjectHarness, file: string, text: string): Promise<void> {
    // 与文件服务保存章节同一个原子替换（nbook.files 的 rooted.ts 也用它）：写临时文件再改名。
    const result = await replaceLocked(join(h.project.path, "manuscripts.binder", file), {lockPath: join(h.project.path, ".nbook", "locks", "chapter.lock"), decide: () => ({write: text}), report: () => undefined});
    expect(result.ok).toBe(true);
}

describe("canon.project：正文快照、视图与插件的登记", () => {
    it("输出 25、P2 第 8 条：原子替换保存章节后，讲述按新正文失联、世界版本不变、读取输入的摘要变了，收到 textChanged", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);
        const written = await window.canon.publish(told(await version(window.canon)));
        if (!written.ok) throw new Error(JSON.stringify(written.failure));
        const seen: CanonEvent[] = [];
        expect((await window.canon.subscribe((event) => seen.push(event))).ok).toBe(true);
        const before = await window.canon.call("status", {});
        if (!before.ok) throw new Error(before.failure.code);

        await rewriteChapter(h, "00001-一.md", "她没有动那座钟。\n");
        await until(async () => {
            const page = await window.canon.call("tellings", {});
            return page.ok && page.value.items.some((item) => item.located.kind === "lost");
        });
        const after = await window.canon.call("status", {});
        if (!after.ok) throw new Error(after.failure.code);
        expect(after.value.version).toBe(before.value.version);
        expect(after.value.inputDigest).not.toBe(before.value.inputDigest);
        await until(() => seen.some((event) => event.kind === "textChanged" && event.chapter === "1"));

        await window.close();
        keep.release();
    }, 30_000);

    it("输出 24、场景 8：带视图令牌读上限之后、读不许带令牌的方法、写入都被拒并记审计；写手的窗口关掉后令牌失效", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const writer = await windowOf(h, "browser-1", "profile-1");
        const author = await windowOf(h, "browser-2", "profile-2");
        await until(async () => (await reorders(writer.canon)) === 1);
        const created = await publish(author.canon, person("星瑕"));
        if (!created.ok) throw new Error(created.failure.code);
        const xia = created.value.ids[Object.keys(created.value.ids)[0]!]!;

        const opened = await writer.canon.call("openView", {viewer: xia, line: "main", until: {kind: "chapter", chapter: "2", edge: "start"}, purpose: "writer"});
        if (!opened.ok) throw new Error(JSON.stringify(opened.failure));
        const view = opened.value.token;
        expect((await writer.canon.call("entry", {id: xia, mode: "actual", view})).ok).toBe(true);
        expect(await writer.canon.call("entry", {id: xia, position: {kind: "chapter", chapter: "3", edge: "end"}, mode: "actual", view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await writer.canon.call("object", {ref: {kind: "entry", id: xia}, view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        expect(await writer.canon.call("publish", {request: {...person("又一个"), baseVersion: await version(author.canon)}, view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        // 别的调用方拿着写手的令牌读：按不存在的令牌拒，审计里看的人记成不知道（不借用写手那张视图）。
        expect(await author.canon.call("entry", {id: xia, mode: "actual", view})).toMatchObject({ok: false, failure: {code: "view-denied"}});
        const audit = await author.canon.call("viewAudit", {});
        expect(audit.ok && audit.value.items.map((item) => [item.method, item.viewer])).toEqual([["entry", xia], ["object", xia], ["publish", xia], ["entry", null]]);
        expect(view).not.toMatch(/^view-\d+$/u);

        // 令牌的寿命是申请它的调用方实例：窗口关掉（实例失效）时入口关掉它打开的视图。只断链路时实例还在、可以重连。
        const status = async () => {
            const read = await author.canon.call("status", {});
            return read.ok ? read.value.openViews : -1;
        };
        expect(await status()).toBe(1);
        await writer.close();
        await until(async () => (await status()) === 0);

        await author.close();
        keep.release();
    }, 30_000);

    it("components 输出 17、model 输出 34：插件声明的标注种类与诊断经贡献点登记，诊断的计算经项目内接口登记", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: threeChapters, env: {NBOOK_TEST_PLUGINS: CANON_PROBE_ID}});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        await until(async () => (await reorders(window.canon)) === 1);
        const created = await publish(window.canon, person("哥哥"));
        if (!created.ok) throw new Error(created.failure.code);
        const brother = created.value.ids[Object.keys(created.value.ids)[0]!]!;

        // 登记了的种类：载荷不合 schema 拒收，合的收下。
        expect(await window.canon.publish(told(await version(window.canon), [{kind: PROBE_MARK, version: 1}]))).toMatchObject({ok: false, failure: {code: "validation-failed"}});
        expect((await window.canon.publish(told(await version(window.canon), [{kind: PROBE_MARK, version: 1, point: brother}]))).ok).toBe(true);

        await rewriteChapter(h, "00001-一.md", "钟还在走。\n");
        await until(async () => {
            const page = await window.canon.call("pending", {});
            return page.ok && page.value.items.some((item) => item.kind === "finding" && item.diagnostic === PROBE_DIAGNOSTIC);
        });
        const page = await window.canon.call("pending", {});
        expect(page.ok && page.value.complete).toBe(true);

        await window.close();
        keep.release();
    }, 30_000);
});

