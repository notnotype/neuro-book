/**
 * 回执页与还原（receipt-page.ts、ReceiptPageHost.vue、RevertHost.vue；docs/specs/canon/author-ui.md 输出 18、20、22，验收 3、6）
 * 接在进程内的真实世界上：canon 的浏览器入口把回执页交给编辑器的贡献点、把还原对话框交给工作台的页面浮层，测试插件
 * （`testing/page-stand-in.ts`）收下它们，测试挂上页面与浮层。数据都经真实的世界服务发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";

import type {Entry} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {person, publish, publishWith} from "../testing/world-fixtures";
import {RECEIPT_PAGE} from "./commands";
import {canonCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "receipt-page");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="2"><chapter id="1" title="入学"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

async function setup(): Promise<{other: CanonNodeWindow; page: EditorPageImplementation; open: (revision: string) => Promise<ReturnType<typeof mount>>}> {
    venue = await canonNodeWorld(tmp);
    const standIn = pageStandIn();
    await venue.window("mine", [standIn.plugin]);
    const other = await venue.window("other");
    const page = standIn.page(RECEIPT_PAGE);
    const component = await page.load();
    // 还原的对话框挂在页面根上（工作台的页面浮层），同产品。
    const overlay = mount(await standIn.overlay("nbook.canon.revert").load(), {global: {provide: provideText(port)}, attachTo: document.body});
    cleanups.push(() => overlay.unmount());
    const open = async (revision: string): Promise<ReturnType<typeof mount>> => {
        const wrapper = mount(component, {props: {context: {recent: [], arg: revision, state: reactive({})}}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        return wrapper;
    };
    return {other, page, open};
}

/** 改星瑕的外观（与存款）一次，标题是 `title`。 */
async function restyle(canon: CanonClient, id: string, look: string, title: string, money?: number): Promise<string> {
    const stored = await canon.call("object", {ref: {kind: "entry", id}});
    if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
    const entry = stored.value.object as Entry;
    const data = entry.init.data;
    const after: Entry = {...entry, init: {...entry.init, data: {...data, character: {...data.character!, fields: {...data.character!.fields, 外观: look}}, panel: {...data.panel!, fields: money === undefined ? data.panel!.fields : {...data.panel!.fields, 存款: money}}}}};
    return (await publishWith(canon, [after], title)).revision;
}

async function look(canon: CanonClient, id: string): Promise<unknown> {
    const stored = await canon.call("object", {ref: {kind: "entry", id}});
    if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
    return (stored.value.object as Entry).init.data.character!.fields.外观;
}

/** 一行里各段的文字用空格隔开。 */
const cells = (element: Element): string => [...element.children].map((child) => child.textContent?.replace(/\s+/gu, " ").trim() ?? "").filter((part) => part !== "").join(" ");
const dialog = (): HTMLElement | null => document.body.querySelector<HTMLElement>("[data-revert-dialog]");
const dialogButton = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === label);
const buttonByText = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll("button").find((button) => button.text() === label);

describe("回执页", () => {
    it("标题、谁、什么时候、种类；修改列出字段的改前改后与带来的变化；标签标题与面包屑；找不到时写一句", async () => {
        const {other, page, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const revision = await restyle(other.canon, id, "银发", "改外观", 1500);

        const wrapper = await open(revision);
        await waitUntil("回执", () => wrapper.find("[data-receipt-item]").exists() && wrapper.text().includes("存款"));
        expect(wrapper.get("h1").text()).toBe("改外观");
        expect(wrapper.get("[data-receipt-meta]").text()).toMatch(/^作者 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 编辑$/u);
        const section = wrapper.get("[data-receipt-section='modify']");
        expect(section.get("h2").text()).toBe("修改");
        expect(section.get("[data-receipt-item] button").text()).toBe("星瑕");
        expect(section.findAll("dl").map((list) => [...list.element.querySelectorAll("dt")].map((term) => `${term.textContent ?? ""}：${term.nextElementSibling?.textContent?.replace(/\s+/gu, " ").trim() ?? ""}`))).toEqual([["外观：黑发 → 银发", "存款：1,000 → 1,500"]]);
        expect(wrapper.get("[data-receipt-impact]").text()).toContain("星瑕的存款：1,000 → 1,500");
        expect(page.title!(revision)).toBe("改外观");
        expect(page.breadcrumbs!(revision)?.map((crumb) => crumb.label)).toEqual([{kind: "text", ns: "nbook.canon", key: "views.entries.title"}, {kind: "text", ns: "nbook.canon", key: "receipt.revisionsCrumb"}, "改外观"]);
        expect(page.breadcrumbs!(revision)?.[1]?.command).toEqual({id: "nbook.view.open", args: {viewId: "nbook.canon.revisions"}});

        const missing = await open("no-such-revision");
        await waitUntil("找不到", () => missing.text().includes("找不到这次改动"));
        expect(missing.find("button").exists()).toBe(false);
    });

    it("还原这次修订：对话框写带来的变化，确认后值回到原样、页顶有提示；提示里的“撤销”再还原回去；还原的回执写还原的是哪一次", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const revision = await restyle(other.canon, id, "银发", "改外观");

        const wrapper = await open(revision);
        await waitUntil("回执", () => wrapper.find("[data-receipt-item]").exists());
        await buttonByText(wrapper, "还原这次修订")!.trigger("click");
        await waitUntil("对话框的预览", () => dialog()?.dataset.phase === "ready");
        expect(document.body.querySelector("[role='dialog'] h2, [role='dialog'] [id]")?.textContent ?? "").toContain("还原“改外观”？");
        await waitUntil("带来的变化写名字", () => dialog()?.querySelector("[data-revert-impact]")?.textContent?.includes("星瑕的外观：银发 → 黑发") ?? false);
        dialogButton("还原")!.click();
        await waitUntil("对话框关了", () => dialog() === null);
        expect(await look(other.canon, id)).toBe("黑发");
        await waitUntil("页顶的提示", () => wrapper.find("[data-notice-bar]").exists());
        expect(wrapper.get("[data-notice-bar]").text()).toContain("还原“改外观”");

        await buttonByText(wrapper, "撤销")!.trigger("click");
        expect(wrapper.find("[data-notice-bar]").exists()).toBe(false);
        await waitUntil("撤销的预览", () => dialog()?.dataset.phase === "ready");
        dialogButton("还原")!.click();
        await waitUntil("对话框关了", () => dialog() === null);
        expect(await look(other.canon, id)).toBe("银发");

        const listed = await other.canon.call("revisions", {limit: 3});
        if (!listed.ok) throw new Error(JSON.stringify(listed.failure));
        const [undo, first] = listed.value.items;
        expect(undo!.title).toBe("还原“还原“改外观””");
        const receipt = await open(first!.id);
        await waitUntil("还原的是哪一次", () => receipt.find("[data-receipt-reverted]").exists() && receipt.get("[data-receipt-reverted]").text().includes("改外观"));
        expect(receipt.get("[data-receipt-reverted]").text()).toBe("还原的是：改外观");
    });

    it("有依赖的还原（验收 6）：A 之后 B 改过同一个字段，还原 A 时列出 B，连同一起还原后都回到 A 之前", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const first = await restyle(other.canon, id, "银发", "改成银发");
        await restyle(other.canon, id, "红发", "改成红发");

        const wrapper = await open(first);
        await waitUntil("回执", () => wrapper.find("[data-receipt-item]").exists());
        expect(wrapper.text()).toContain("后面有 1 次改动依赖它");
        await buttonByText(wrapper, "还原这次修订")!.trigger("click");
        await waitUntil("依赖它的修订", () => dialog()?.querySelector("[data-revert-dependents]")?.textContent?.includes("改成红发") ?? false);
        expect(dialogButton("还原")).toBeUndefined();
        dialogButton("连同这些一起还原")!.click();
        await waitUntil("对话框关了", () => dialog() === null);
        expect(await look(other.canon, id)).toBe("黑发");
        expect(wrapper.get("[data-notice-bar]").text()).toContain("还原“改成银发”与之后的 1 次改动");
    });

    it("别的调用方独占写入时“还原这次修订”不可用并写出它申请时给的那句，释放以后恢复", async () => {
        const {other, open} = await setup();
        const star = person("星瑕");
        const id = (await publish(other.canon, [star]))[star.id]!;
        const revision = await restyle(other.canon, id, "银发", "改外观");
        const wrapper = await open(revision);
        await waitUntil("回执", () => wrapper.find("[data-receipt-item]").exists());

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("不可用", () => buttonByText(wrapper, "还原这次修订")!.attributes("disabled") !== undefined);
        expect(wrapper.get("[data-revert-blocked]").text()).toContain("第 3 章记账");
        await lease.value.release();
        await waitUntil("恢复", () => buttonByText(wrapper, "还原这次修订")!.attributes("disabled") === undefined);
        expect(cells(wrapper.get("header").element)).not.toContain("第 3 章记账");
    });
});
