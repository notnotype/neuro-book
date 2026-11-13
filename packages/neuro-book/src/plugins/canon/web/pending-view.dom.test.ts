/**
 * 待处理视图（pending-view.ts、PendingViewHost.vue；docs/specs/canon/author-ui.md 输出 23、25、26，验收 5 的界面部分）接在
 * 进程内的真实世界上：canon 的浏览器入口把视图与状态栏条目交给工作台的贡献点，测试插件（`testing/page-stand-in.ts`）收下，
 * 测试按工作台的做法给视图一份 `context` 挂上。数据都经另一个窗口发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import type {PageStandIn} from "../testing/page-stand-in";
import {change, check, person, publish, publishWith} from "../testing/world-fixtures";
import {PENDING_VIEW} from "./commands";
import {createPendingView, pendingViewState, pickFirstPending} from "./pending-view";
import type {PendingTarget} from "./pending";
import {PENDING_COUNT_ITEM} from "./plugin";
import {canonCatalogs} from "./text";
import {createCanonWorld} from "./world";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const global = {provide: provideText(port)};

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "pending-view");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="入学"/><chapter id="2" title="打工"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

async function setup(): Promise<{mine: CanonNodeWindow; other: CanonNodeWindow; standIn: PageStandIn; open: () => Promise<ReturnType<typeof mount>>}> {
    venue = await canonNodeWorld(tmp);
    const standIn = pageStandIn();
    const mine = await venue.window("mine", [standIn.plugin]);
    const other = await venue.window("other");
    const component = await standIn.view(PENDING_VIEW).implementation.load();
    return {
        mine,
        other,
        standIn,
        open: async () => {
            const context = {id: PENDING_VIEW, generation: 1, visible: ref(true), location: ref("panel")} as unknown as ViewContext;
            const view = mount(component, {props: {context}, global, attachTo: document.body});
            cleanups.push(() => view.unmount());
            return view;
        },
    };
}

/** 一个存款 1000 的人，第 1 章一笔估计的 +200，第 `chapter` 章正文写 500：算出来 1200，对不上。返回人与核对点的正式 id。 */
async function mismatch(canon: CanonClient, name: string, chapter = "2"): Promise<{readonly entry: string; readonly check: string}> {
    const someone = person(name);
    const entry = (await publish(canon, [someone]))[someone.id]!;
    await publish(canon, [change(entry, "1", `${name}领了工资`, 200, {kind: "estimate", note: "大概两百"})]);
    const written = check(entry, chapter, 500);
    return {entry, check: (await publish(canon, [written]))[written.ref.id]!};
}

/** 把核对点改成对得上的数。 */
async function settle(canon: CanonClient, id: string, value: number): Promise<void> {
    const stored = await canon.call("object", {ref: {kind: "check", id}});
    if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
    await publish(canon, [{ref: {kind: "check", id}, after: {...(stored.value.object as object), value}}]);
}

const rows = (view: ReturnType<typeof mount>): string[] => view.findAll("[data-pending-group='pending'] [data-pending-row-text]").map((row) => row.text());
const selectedText = (view: ReturnType<typeof mount>): string | null => view.find("[data-pending-row][aria-current='true'] [data-pending-row-text]").element?.textContent ?? null;
const detailTitle = (view: ReturnType<typeof mount>): string | null => view.find("[data-pending-detail-title]").element?.textContent ?? null;

describe("待处理视图", () => {
    it("核对点不符：一行写地址与两个数，打开时选中它；详情有原句、两个数与嫌疑（估计的标出来、初值点开条目）；改对以后这一条消失、条数与状态栏一起变（验收 5）", async () => {
        const {other, standIn, open} = await setup();
        const star = await mismatch(other.canon, "星瑕");
        const view = await open();
        await waitUntil("一行", () => rows(view).length === 1);
        expect(rows(view)).toEqual(["星瑕的存款对不上：正文写 500，算出来是 1,200"]);
        expect(view.get("[data-pending-row-place]").text()).toBe("第 2 章");
        expect(view.get("[data-pending-group='pending'] [data-pending-count]").text()).toBe("1");

        await waitUntil("选中第一条", () => selectedText(view) !== null && view.find("[data-suspect]").exists() && view.get("[data-suspect]").text().includes("领了工资"));
        expect(view.get("[data-pending-detail-quote]").text()).toContain("“余额 500”");
        expect(view.find("[data-pending-open-chapter]").exists()).toBe(false);
        expect([...view.get("[data-pending-detail-facts]").element.querySelectorAll("dd")].map((value) => value.textContent)).toEqual(["500", "1,200"]);
        const suspects = view.findAll("[data-suspect]");
        expect(suspects.map((item) => item.get("[data-suspect-open]").text())).toEqual(["改这一笔", "打开条目"]);
        expect(suspects[0]!.find("[data-suspect-estimate]").exists()).toBe(true);
        expect(port.t(standIn.statusItem(PENDING_COUNT_ITEM).implementation.text())).toBe("待处理 1");

        await settle(other.canon, star.check, 1200);
        await waitUntil("这一条消失", () => rows(view).length === 0 && view.find("[data-pending-group='pending'] [data-pending-empty]").exists());
        expect(view.get("[data-pending-group='pending'] [data-pending-count]").text()).toBe("0");
        expect(view.find("[data-pending-no-selection]").exists()).toBe(true);
        expect(port.t(standIn.statusItem(PENDING_COUNT_ITEM).implementation.text())).toBe("待处理 0");
    });

    it("上下键移动时详情跟着换；选中的那一条消失以后选它原来位置上的那一条", async () => {
        const {other, open} = await setup();
        await mismatch(other.canon, "星瑕");
        const second = await mismatch(other.canon, "星瑾");
        const view = await open();
        await waitUntil("两行", () => rows(view).length === 2);
        await waitUntil("选中第一条", () => selectedText(view) === rows(view)[0]);

        const first = view.findAll("[data-pending-group='pending'] [data-pending-row]")[0]!;
        (first.element as HTMLElement).focus();
        await first.trigger("keydown", {key: "ArrowDown"});
        await waitUntil("详情换成第二条", () => detailTitle(view) === rows(view)[1]);
        expect(selectedText(view)).toBe(rows(view)[1]);

        // 选中的是第二条（位置 1）；它消失以后，原来位置 1 上没有了，不选。
        const kept = rows(view)[0];
        await settle(other.canon, second.check, 1200);
        await waitUntil("只剩一条", () => rows(view).length === 1);
        expect(rows(view)).toEqual([kept]);
        await waitUntil("不选", () => view.find("[data-pending-no-selection]").exists());
    });

    it("选中的第一条消失以后选它原来位置上的那一条（原来的第二条）", async () => {
        const {other, open} = await setup();
        const first = await mismatch(other.canon, "星瑕");
        await mismatch(other.canon, "星瑾");
        const view = await open();
        await waitUntil("两行", () => rows(view).length === 2);
        await waitUntil("选中第一条", () => selectedText(view) === rows(view)[0]);
        const next = rows(view)[1];
        await settle(other.canon, first.check, 1200);
        await waitUntil("选中原来的第二条", () => rows(view).length === 1 && selectedText(view) === next);
        expect(detailTitle(view)).toBe(next);
    });

    it("“只是提示”“已处理”默认收起、写条数；展开以后读出来", async () => {
        const {other, open} = await setup();
        await mismatch(other.canon, "星瑕");
        const view = await open();
        await waitUntil("一行", () => rows(view).length === 1);
        expect(view.findAll("[data-pending-toggle]").map((toggle) => toggle.attributes("aria-expanded"))).toEqual(["true", "false", "false"]);
        expect(view.get("[data-pending-group='handled'] [data-pending-count]").text()).toBe("0");
        await view.get("[data-pending-group='handled'] [data-pending-toggle]").trigger("click");
        await waitUntil("已处理展开", () => view.find("[data-pending-group='handled'] [data-pending-empty]").exists());
        expect(view.get("[data-pending-group='handled'] [data-pending-empty]").text()).toBe("还没有处理过的");
    });

    it("别的调用方独占写入时写出是谁；强行解除要二次确认，确认以后它的独占结束、这一行消失；失败时对话框不关、写出原因", async () => {
        const {mine, other, open} = await setup();
        await mismatch(other.canon, "星瑕");
        const view = await open();
        await waitUntil("一行", () => rows(view).length === 1);

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("写出是谁", () => view.find("[data-pending-busy]").exists());
        expect(view.get("[data-pending-busy]").text()).toContain("第 3 章记账正在独占写入");

        const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[data-break-exclusive-dialog]");
        const confirm = (): HTMLButtonElement | undefined => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "强行解除");
        await view.get("[data-pending-break]").trigger("click");
        await waitUntil("二次确认", () => dialog() !== null);
        confirm()!.click();
        await waitUntil("对话框关了、这一行消失", () => dialog() === null && !view.find("[data-pending-busy]").exists());
        expect((await other.canon.call("status", {})).ok && ((await other.canon.call("status", {})) as {value: {exclusive: unknown}}).value.exclusive).toBeNull();

        // 再独占一次，这次解除时本窗口断开：对话框不关、写出原因。
        const again = await other.canon.hold("第 4 章记账");
        if (!again.ok) throw new Error(JSON.stringify(again.failure));
        await waitUntil("写出是谁", () => view.find("[data-pending-busy]").exists() && view.get("[data-pending-busy]").text().includes("第 4 章记账"));
        await view.get("[data-pending-break]").trigger("click");
        await waitUntil("二次确认", () => dialog() !== null && confirm() !== undefined && !confirm()!.disabled);
        mine.disconnect();
        confirm()!.click();
        await waitUntil("写出原因", () => document.body.querySelector("[role='dialog'] [role='alert']") !== null, {timeoutMs: 10_000});
        expect(dialog()).not.toBeNull();
        await again.value.release();
    });
    it("停放时不重读；停放期间来了新的一条，show-pending 以后回到前台选中它，不按读取层留着的旧结果选（输出 25、26）", async () => {
        const {mine, other} = await setup();
        const counted = countedClient(mine.canon);
        const world = createCanonWorld(counted.client);
        cleanups.push(() => world.dispose());
        const state = pendingViewState();
        const component = await createPendingView({world: () => world, state, open: () => undefined, openChapter: () => undefined}).load();
        const visible = ref(true);
        const view = mount(component, {props: {context: {id: PENDING_VIEW, generation: 1, visible, location: ref("panel")} as unknown as ViewContext}, global, attachTo: document.body});
        cleanups.push(() => view.unmount());
        await waitUntil("读到了空的一组", () => view.find("[data-pending-group='pending'] [data-pending-empty]").exists());

        visible.value = false;
        await nextTick();
        const before = counted.calls.filter((call) => call.method === "pending").length;
        await mismatch(other.canon, "星瑕");
        const version = (await other.canon.call("status", {}));
        if (!version.ok) throw new Error(JSON.stringify(version.failure));
        await waitUntil("本窗口知道了新版本", () => world.status.value.data?.version === version.value.version);
        expect(counted.calls.filter((call) => call.method === "pending").length).toBe(before);

        pickFirstPending(state);
        visible.value = true;
        await waitUntil("选中新来的那一条", () => rows(view).length === 1 && selectedText(view) === rows(view)[0]);
        expect(counted.calls.filter((call) => call.method === "pending").length).toBeGreaterThan(before);
    });

    it("选中的那条还在、前面多了一条：记下它现在的位置；之后它消失，选它消失前位置上的那一条", async () => {
        const {other, open} = await setup();
        await mismatch(other.canon, "甲", "2");
        const second = await mismatch(other.canon, "乙", "2");
        await mismatch(other.canon, "丙", "2");
        const view = await open();
        await waitUntil("三行", () => rows(view).length === 3);
        const row = view.findAll("[data-pending-group='pending'] [data-pending-row]")[1]!;
        (row.element as HTMLElement).focus();
        await waitUntil("选中第二条", () => selectedText(view) === rows(view)[1]);
        const picked = rows(view)[1];

        // 第 1 章多了一条，排到最前：选中的那条成了第三条。
        await mismatch(other.canon, "丁", "1");
        await waitUntil("四行", () => rows(view).length === 4);
        expect(selectedText(view)).toBe(picked);
        const after = rows(view)[3];
        await settle(other.canon, second.check, 1200);
        await waitUntil("选中它后面那一条", () => rows(view).length === 3 && selectedText(view) === after);
    });

    it("待定写原因与说明、链到它的详情页；套不上写根因与原因（读根因那条的结局）", async () => {
        const {mine, other} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const heldId = `tmp:held`;
        await publish(other.canon, [{ref: {kind: "change", id: heldId}, after: {id: heldId, kind: "written", text: "她把存款都取了出来", at: {kind: "chapter", chapter: "1", key: 1}, told: [{source: "note", quote: "取光了"}], involves: [id], lines: [], links: [], status: "held", held: {reason: "unsure", note: "不知道取了多少"}, by: {kind: "author"}, patches: []}}]);
        // 第 2 章加两百亿（套得上）；之后在第 1 章把存款设成九百亿：第 2 章那条加完超出精确档的范围，套不上了。
        const brokenId = `tmp:broken`;
        await publish(other.canon, [{ref: {kind: "change", id: brokenId}, after: {id: brokenId, kind: "written", text: "中了两百亿", at: {kind: "chapter", chapter: "2", key: 1}, told: [], involves: [id], lines: [], links: [], status: "active", by: {kind: "author"}, patches: [{op: "add", at: {entry: id, path: "panel.存款"}, value: 2e10}]}}]);
        const richId = `tmp:rich`;
        await publishWith(other.canon, [{ref: {kind: "change", id: richId}, after: {id: richId, kind: "written", text: "继承了一大笔遗产", at: {kind: "chapter", chapter: "1", key: 2}, told: [], involves: [id], lines: [], links: [], status: "active", by: {kind: "author"}, patches: [{op: "set", at: {entry: id, path: "panel.存款"}, value: 9e10}]}}], "继承了遗产");

        const world = createCanonWorld(mine.canon);
        cleanups.push(() => world.dispose());
        const opened: PendingTarget[] = [];
        const component = await createPendingView({world: () => world, state: pendingViewState(), open: (target) => void opened.push(target), openChapter: () => undefined}).load();
        const view = mount(component, {props: {context: {id: PENDING_VIEW, generation: 1, visible: ref(true), location: ref("panel")} as unknown as ViewContext}, global, attachTo: document.body});
        cleanups.push(() => view.unmount());
        // 行先写种类，读到那条情节以后换成它的文字。
        await waitUntil("两行写出情节", () => rows(view).join("|") === "“她把存款都取了出来”待定|“中了两百亿”套不上了").catch((error: unknown) => {
            throw new Error(`${String(error)}；实际：${rows(view).join("|")}`);
        });

        await waitUntil("待定的详情", () => view.find("[data-pending-detail-facts]").exists());
        expect(view.get("[data-pending-detail-facts]").text().replace(/\s+/gu, "")).toBe("原因写入者没把握：不知道取了多少");
        await view.get("[data-pending-detail-links] button").trigger("click");

        const broken = view.findAll("[data-pending-group='pending'] [data-pending-row]")[1]!;
        (broken.element as HTMLElement).focus();
        await waitUntil("套不上的原因", () => view.find("[data-pending-detail-facts]").exists() && view.get("[data-pending-detail-facts]").text().includes("改完的数超出了范围"));
        // 根因是把存款设成九百亿的那次修订：写它的标题，链到它的回执。
        await waitUntil("根因的标题", () => view.get("[data-pending-detail-facts]").text().includes("继承了遗产"));
        expect([...view.get("[data-pending-detail-facts]").element.querySelectorAll("dt")].map((term) => `${term.textContent ?? ""}：${term.nextElementSibling?.textContent ?? ""}`)).toEqual(["原因：改完的数超出了范围", "让它套不上的那次改动：“继承了遗产”"]);
        for (const button of view.findAll("[data-pending-detail-links] button")) await button.trigger("click");
        expect(opened.map((target) => target.kind)).toEqual(["change", "change", "receipt"]);
    });

    it("窗口没有绑定项目时写一句“打开作品后可用”", async () => {
        const component = await createPendingView({world: () => null, state: pendingViewState(), open: () => undefined, openChapter: () => undefined}).load();
        const view = mount(component, {global});
        cleanups.push(() => view.unmount());
        expect(view.text()).toBe("打开作品后可用");
    });
});
