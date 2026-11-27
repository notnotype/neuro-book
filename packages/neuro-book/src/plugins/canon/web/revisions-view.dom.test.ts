/**
 * 改动记录视图（revisions-view.ts、RevisionsViewHost.vue；docs/specs/canon/author-ui.md 输出 18、22、24、26，验收 10、12）接在
 * 进程内的真实世界上：canon 的浏览器入口把视图交给工作台的贡献点、把还原对话框交给页面浮层，测试插件
 * （`testing/page-stand-in.ts`）收下它们，测试按工作台的做法给视图一份 `context` 挂上。工作台通知用真实的通知队列。数据都经
 * 另一个窗口发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";
import type {Ref} from "vue";

import type {Entry} from "@notnotype/nb-canon";
import {holdLock} from "@notnotype/nb-file-lock";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {notificationsKey} from "nbook/plugins/workbench/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {createNotifications} from "nbook/plugins/workbench/web/notifications";
import type {WindowNotifications} from "nbook/plugins/workbench/web/notifications";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {WORLD_LOCK} from "../backend/world-host";
import type {CanonClient} from "../shared/contracts";
import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {person, publish, publishWith} from "../testing/world-fixtures";
import {REVISIONS_VIEW} from "./commands";
import RevisionsView from "./components/revisions/RevisionsView.vue";
import {createRevertRequests} from "./revert";
import {ALL} from "./revisions";
import {createRevisionsView, revisionsViewState} from "./revisions-view";
import {canonCatalogs} from "./text";
import {createCanonWorld} from "./world";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void | Promise<void>> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "revisions-view");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="入学"/><chapter id="2" title="打工"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

interface Setup {
    readonly mine: CanonNodeWindow;
    readonly other: CanonNodeWindow;
    readonly notifications: WindowNotifications;
    /** 按工作台的做法挂上视图；`visible` 是它的 `context.visible`。 */
    open(): Promise<{readonly view: ReturnType<typeof mount>; readonly visible: Ref<boolean>}>;
}

async function setup(): Promise<Setup> {
    venue = await canonNodeWorld(tmp);
    const standIn = pageStandIn();
    // 工作台的通知服务：真实的通知队列（同 projects.test.ts）。服务键属于工作台，提供它的插件要用工作台的 id。
    const notifications = createNotifications(() => undefined, port);
    cleanups.push(() => notifications.dispose());
    const notifier: PluginDefinition = {id: "nbook.workbench", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [notificationsKey], activate: () => ({services: [provideService(notificationsKey, notifications)]})})]};
    const mine = await venue.window("mine", [standIn.plugin, notifier]);
    const other = await venue.window("other");
    // 还原的对话框挂在页面根上（工作台的页面浮层），同产品。
    const overlay = mount(await standIn.overlay("nbook.canon.revert").load(), {global, attachTo: document.body});
    cleanups.push(() => overlay.unmount());
    const component = await standIn.view(REVISIONS_VIEW).implementation.load();
    return {
        mine,
        other,
        notifications,
        open: async () => {
            const visible = ref(true);
            const context: ViewContext = {id: REVISIONS_VIEW, generation: 1, visible, location: ref("panel")} as unknown as ViewContext;
            const view = mount(component, {props: {context}, global, attachTo: document.body});
            cleanups.push(() => view.unmount());
            return {view, visible};
        },
    };
}

/** 改星瑕的性格一次，标题是 `title`。 */
async function restyle(canon: CanonClient, id: string, look: string, title: string): Promise<string> {
    const stored = await canon.call("object", {ref: {kind: "entry", id}});
    if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
    const entry = stored.value.object as Entry;
    const data = entry.init.data;
    return (await publishWith(canon, [{...entry, init: {...entry.init, data: {...data, character: {...data.character!, fields: {...data.character!.fields, 性格: look}}}}}], title)).revision;
}

async function stored(canon: CanonClient, id: string): Promise<Entry> {
    const read = await canon.call("object", {ref: {kind: "entry", id}});
    if (!read.ok) throw new Error(JSON.stringify(read.failure));
    return read.value.object as Entry;
}

const titles = (view: ReturnType<typeof mount>): string[] => view.findAll("[data-revision-title]").map((title) => title.text());
const rowOf = (view: ReturnType<typeof mount>, title: string) => view.findAll("[data-revision-row]").find((row) => row.get("[data-revision-title]").text() === title)!;
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[data-revert-dialog]");
const dialogButton = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === label);

describe("改动记录视图", () => {
    it("从新到旧列出，写标题、谁、什么时候与摘要；章序调整不能还原；还原删除以后条目回来（验收 10），没有页面挂着时提示是一条工作台通知（验收 12）", async () => {
        const {other, notifications, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await restyle(other.canon, id, "银发", "改外观");
        await publishWith(other.canon, [{...(await stored(other.canon, id)), deleted: true}], "删除星瑕");

        const {view} = await open();
        // 世界打开时记下活页夹的章序：系统写的第一次修订。
        await waitUntil("四次修订", () => titles(view).length === 4);
        expect(titles(view)).toEqual(["删除星瑕", "改外观", "写入", "章序调整"]);
        expect(rowOf(view, "改外观").get("[data-revision-meta]").text()).toMatch(/^作者 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · \d+ 处值变了$/u);
        expect(rowOf(view, "章序调整").get("[data-revision-meta]").text()).toMatch(/^系统 · /u);
        expect(rowOf(view, "章序调整").get("[data-revision-revert]").attributes("disabled")).toBeDefined();
        expect(rowOf(view, "章序调整").get("[data-revision-note]").text()).toBe("调整章序的改动不能还原");
        expect(rowOf(view, "写入").get("[data-revision-note]").text()).toBe("后面有 2 次改动依赖它");

        await rowOf(view, "删除星瑕").get("[data-revision-revert]").trigger("click");
        await waitUntil("对话框的预览", () => dialog()?.dataset.phase === "ready");
        dialogButton("还原")!.click();
        await waitUntil("对话框关了", () => dialog() === null);
        expect((await stored(other.canon, id)).deleted ?? false).toBe(false);
        await waitUntil("列表顶上是这次还原", () => titles(view)[0] === "还原“删除星瑕”");

        // 编辑区里没有条目页、回执页、变更详情页挂着：提示交给工作台通知，动作是“查看详情”。
        const [entry] = notifications.center.entries.value;
        expect(entry === undefined ? "" : `${port.t(entry.title ?? "")} ${port.t(entry.message)}`).toContain("还原“删除星瑕”");
        expect(entry?.action === undefined ? "" : port.t(entry.action.label)).toBe("查看详情");
    });

    it("被拒收（验收 12）：世界日志的锁被别的进程占着时，确认以后对话框不关、写出原因；锁放开以后再确认就还原了", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await restyle(other.canon, id, "银发", "改外观");
        const {view} = await open();
        await waitUntil("改外观", () => titles(view)[0] === "改外观");

        const held = await holdLock(join(venue!.project, ".nbook", "locks", WORLD_LOCK), () => undefined);
        if (!held.ok) throw new Error(held.detail);
        cleanups.push(() => held.lock.release());
        await rowOf(view, "改外观").get("[data-revision-revert]").trigger("click");
        await waitUntil("对话框的预览", () => dialog()?.dataset.phase === "ready");
        dialogButton("还原")!.click();
        await waitUntil("写出原因", () => dialog()?.textContent?.includes("另一个 NeuroBook 正在用这部作品") ?? false, {timeoutMs: 15_000});
        expect(dialog()).not.toBeNull();
        expect((await stored(other.canon, id)).init.data.character!.fields.性格).toBe("银发");

        await held.lock.release();
        dialogButton("还原")!.click();
        await waitUntil("对话框关了", () => dialog() === null, {timeoutMs: 15_000});
        expect((await stored(other.canon, id)).init.data.character!.fields.性格).toBe("黑发");
    }, 30_000);

    it("按写入者、按章筛；筛选留在窗口里，视图卸载再挂上还在", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        await publishWith(other.canon, [{...(await stored(other.canon, id)), init: {...(await stored(other.canon, id)).init, summary: "Agent 写的简介"}}], "Agent 改简介", {by: {kind: "agent", session: "s1"}});
        await publishWith(other.canon, [{...(await stored(other.canon, id)), init: {...(await stored(other.canon, id)).init, summary: "第 1 章以后"}}], "第 1 章记账", {chapter: "1"});

        const {view} = await open();
        await waitUntil("第 1 章记账", () => titles(view)[0] === "第 1 章记账");
        view.findComponent(RevisionsView).vm.$emit("update:writer", "agent");
        await waitUntil("只有 Agent 的", () => titles(view).join() === "Agent 改简介");

        view.findComponent(RevisionsView).vm.$emit("update:writer", ALL);
        view.findComponent(RevisionsView).vm.$emit("update:chapter", "1");
        await waitUntil("只有第 1 章的", () => titles(view).join() === "第 1 章记账");

        view.unmount();
        const again = await open();
        await waitUntil("还是只有第 1 章的", () => titles(again.view).join() === "第 1 章记账");
        expect(again.view.get("[data-revisions-chapter]").text()).toContain("第 1 章");
    });

    it("读了两页以后别处发布一次，按读出来的条数重读：新的在最上面，最旧的一条退到“再显示更多”后面；停放期间发布的，回到前台先显示留着的，同时读到新的", async () => {
        const {other, open} = await setup();
        for (let index = 1; index <= 55; index += 1) await publishWith(other.canon, [person(`人物${String(index)}`)], `第 ${String(index)} 次`);
        const listed = await other.canon.call("revisions", {limit: 100});
        if (!listed.ok) throw new Error(JSON.stringify(listed.failure));
        const total = listed.value.items.length;

        const {view, visible} = await open();
        await waitUntil("第一页", () => titles(view).length === 50);
        await view.get("[data-revisions-more]").trigger("click");
        await waitUntil("两页", () => titles(view).length === total);
        expect(view.find("[data-revisions-more]").exists()).toBe(false);

        await publishWith(other.canon, [person("新来的")], "新来的");
        await waitUntil("新的在最上面", () => titles(view)[0] === "新来的");
        expect(titles(view)).toHaveLength(total);
        expect(titles(view).at(-1)).toBe("第 1 次");
        expect(view.find("[data-revisions-more]").exists()).toBe(true);

        visible.value = false;
        await nextTick();
        // 停放时读取释放了，行留在屏幕上（回到前台时滚动位置还在）。
        expect(titles(view)).toHaveLength(total);
        await publishWith(other.canon, [person("停放时来的")], "停放时来的");
        visible.value = true;
        await nextTick();
        expect(titles(view)[0]).toBe("新来的");
        await waitUntil("回来以后读到新的", () => titles(view)[0] === "停放时来的");
    }, 60_000);
    it("停放时不读：别处发布一次，改动记录的读取次数不变；回到前台先显示留着的，同时读到新的（输出 26）", async () => {
        const {mine, other} = await setup();
        const counted = countedClient(mine.canon);
        const world = createCanonWorld(counted.client);
        cleanups.push(() => world.dispose());
        const component = await createRevisionsView({world: () => world, state: revisionsViewState(), revert: createRevertRequests(), receipt: () => undefined}).load();
        const visible = ref(true);
        const view = mount(component, {props: {context: {id: REVISIONS_VIEW, generation: 1, visible, location: ref("panel")} as unknown as ViewContext}, global, attachTo: document.body});
        cleanups.push(() => view.unmount());
        await waitUntil("章序调整", () => titles(view).length === 1);

        visible.value = false;
        await nextTick();
        const reads = (): number => counted.calls.filter((call) => call.method === "revisions").length;
        const before = reads();
        const published = await publishWith(other.canon, [person("停放时来的")], "停放时来的");
        await waitUntil("本窗口知道了新版本", () => world.status.value.data?.version === published.version);
        expect(reads()).toBe(before);
        expect(titles(view)).toEqual(["章序调整"]);

        visible.value = true;
        await nextTick();
        expect(titles(view)).toEqual(["章序调整"]);
        await waitUntil("读到新的", () => titles(view)[0] === "停放时来的");
        expect(reads()).toBeGreaterThan(before);
    });
});
