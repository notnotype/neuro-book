/**
 * 待处理视图（pending-view.ts、PendingViewHost.vue；docs/specs/canon/author-ui.md 输出 23、25、26，验收 5 的界面部分）接在
 * 进程内的真实世界上：canon 的浏览器入口把视图与状态栏条目交给工作台的贡献点，测试插件（`testing/page-stand-in.ts`）收下，
 * 测试按工作台的做法给视图一份 `context` 挂上。数据都经另一个窗口发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ref} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import type {PageStandIn} from "../testing/page-stand-in";
import {change, check, person, publish} from "../testing/world-fixtures";
import {PENDING_VIEW} from "./commands";
import {PENDING_COUNT_ITEM} from "./plugin";
import {canonCatalogs} from "./text";

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

/** 一个存款 1000 的人，第 1 章一笔估计的 +200，第 2 章正文写 500：算出来 1200，对不上。返回人与核对点的正式 id。 */
async function mismatch(canon: CanonClient, name: string): Promise<{readonly entry: string; readonly check: string}> {
    const someone = person(name);
    const entry = (await publish(canon, [someone]))[someone.id]!;
    await publish(canon, [change(entry, "1", `${name}领了工资`, 200, {kind: "estimate", note: "大概两百"})]);
    const written = check(entry, "2", 500);
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
});
