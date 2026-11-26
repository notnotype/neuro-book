/**
 * 变更详情页（change-page.ts、ChangePageHost.vue、change-edit.ts；docs/specs/canon/author-ui.md 输出 21、29）接在进程内的真实世界
 * 上：canon 的浏览器入口把页面交给编辑器的贡献点，测试插件（`testing/page-stand-in.ts`）收下它，按编辑器的做法给每个标签一份
 * `context`。数据都经真实的世界服务发布。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";

import type {StoryChange, StoryChangeDraft} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {nextId, person, publish} from "../testing/world-fixtures";
import type {ChangePageState} from "./change-page";
import {CHANGE_PAGE} from "./commands";
import {canonCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "change-page");
    const binder = join(tmp, "Book", "manuscripts.binder");
    await mkdir(binder, {recursive: true});
    await writeFile(join(binder, "binder.xml"), '<binder nextId="3"><chapter id="1"/><chapter id="2"/></binder>');
    await writeFile(join(binder, "00001-入学.md"), "店长塞给她两百块。\n");
    await writeFile(join(binder, "00002-打工.md"), "她数了数钱。\n");
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

interface Opened {
    readonly wrapper: ReturnType<typeof mount>;
    readonly state: ChangePageState;
    remount(): ReturnType<typeof mount>;
}

async function setup(): Promise<{other: CanonNodeWindow; page: EditorPageImplementation<ChangePageState>; open: (id: string) => Opened}> {
    venue = await canonNodeWorld(tmp);
    const standIn = pageStandIn();
    await venue.window("mine", [standIn.plugin]);
    const other = await venue.window("other");
    const page = standIn.page<ChangePageState>(CHANGE_PAGE);
    const component = await page.load();
    const open = (id: string): Opened => {
        const context = {recent: [], arg: id, state: reactive(page.initialState!(id))};
        const mountOnce = (): ReturnType<typeof mount> => {
            const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
            cleanups.push(() => wrapper.unmount());
            return wrapper;
        };
        return {wrapper: mountOnce(), state: context.state, remount: mountOnce};
    };
    return {other, page, open};
}

type Basis = StoryChangeDraft["patches"][number]["basis"];

/** 星瑕，与第 1 章一条“领了工资”：存款 +200（依据缺省是估计），性格改成银发；原句在第 1 章正文。 */
async function sample(canon: CanonClient, extra: Partial<StoryChangeDraft> = {}, basis: Basis = {kind: "estimate", note: "大概两百"}): Promise<{star: string; change: string}> {
    const draft = person("星瑕");
    const star = (await publish(canon, [draft]))[draft.id]!;
    const id = `tmp:${nextId()}`;
    const after: StoryChangeDraft = {
        id, kind: "written", text: "领了工资", at: {kind: "chapter", chapter: "1", key: 1}, told: [{source: "chapter", chapter: "1", quote: "店长塞给她两百块"}], involves: [star], lines: [], links: [], status: "active", by: {kind: "author"},
        patches: [
            {op: "add", at: {entry: star, path: "panel.存款"}, value: 200, basis},
            {op: "set", at: {entry: star, path: "character.性格"}, value: "银发"},
        ],
        ...extra,
    };
    const change = (await publish(canon, [{ref: {kind: "change", id}, after}]))[id]!;
    return {star, change};
}

async function money(canon: CanonClient, star: string): Promise<unknown> {
    const read = await canon.call("entry", {id: star, position: {kind: "chapter", chapter: "2", edge: "end"}, mode: "actual"});
    if (!read.ok) throw new Error(JSON.stringify(read.failure));
    return read.value.view?.namespaces.panel?.fields.存款?.value;
}

/** 元素里各个叶子的文字用空格隔开（叶子之间在页面上是间距，不是空格）。 */
const words = (element: Element): string => [...element.querySelectorAll("*")].filter((node) => node.children.length === 0).map((node) => node.textContent?.trim() ?? "").filter((part) => part !== "").join(" ");
const buttonByText = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll("button").find((button) => button.text() === label);

describe("变更详情页", () => {
    it("文字、安放、已写、生效；原句与出处；涉及的条目；每一处改动与依据；标签标题与面包屑；找不到时写一句", async () => {
        const {other, page, open} = await setup();
        const {change} = await sample(other.canon);
        const {wrapper} = open(change);
        await waitUntil("详情", () => wrapper.find("h1").exists() && wrapper.text().includes("星瑕的存款"));
        expect(wrapper.get("h1").text()).toBe("领了工资");
        expect(words(wrapper.get("[data-change-meta]").element)).toBe("第 1 章 · 已写 · 生效");
        expect(words(wrapper.get("[data-change-quote]").element)).toBe("“店长塞给她两百块” 第 1 章正文 打开这一章");
        expect(wrapper.get("[data-change-involved]").text()).toContain("星瑕");
        expect(wrapper.findAll("[data-change-patch]").map((row) => words(row.element))).toEqual(["星瑕的存款 +200 依据：估计：大概两百 改", "星瑕的性格 → 银发"]);
        expect(page.title!(change)).toBe("领了工资");
        expect(page.breadcrumbs!(change)?.map((crumb) => crumb.label)).toEqual([{kind: "text", ns: "nbook.canon", key: "views.entries.title"}, "第 1 章", "领了工资"]);
        expect(page.breadcrumbs!(change)?.slice(1).every((crumb) => crumb.command === undefined)).toBe(true);

        // 测试窗口里没有文件服务：找不到这一章的文件，写一句。
        await buttonByText(wrapper, "打开这一章")!.trigger("click");
        await waitUntil("没找到文件", () => wrapper.text().includes("没找到这一章的文件"));

        const missing = open("no-such-change").wrapper;
        await waitUntil("找不到", () => missing.text().includes("找不到这条情节"));
    });

    it("改一处的值：确认条写会写回这条情节与带来的变化；保存后存款跟着变、顶上有提示、焦点回到“改”；切走再回来填的值还在", async () => {
        const {other, open} = await setup();
        const {star, change} = await sample(other.canon);
        const opened = open(change);
        await waitUntil("“改”", () => opened.wrapper.find("[data-edit-patch='0']").exists());
        await opened.wrapper.get("[data-edit-patch='0']").trigger("click");
        await waitUntil("确认条", () => opened.wrapper.find("[data-confirm-bar]").exists());
        expect(opened.wrapper.get("[data-confirm-bar] h3").text()).toBe("改星瑕的存款");
        await opened.wrapper.get("[data-confirm-bar] input").setValue("500");
        await waitUntil("预览", () => opened.wrapper.find("[data-confirm-bar][data-previewed]").exists());
        expect(opened.wrapper.get("[data-confirm-preview]").text()).toContain("会写回这条情节");
        expect(opened.wrapper.get("[data-edit-impact]").text()).toContain("星瑕的存款：1,200 → 1,500");

        opened.wrapper.unmount();
        const again = opened.remount();
        await waitUntil("回来以后确认条还在", () => again.find("[data-confirm-bar] input").exists());
        expect((again.get("[data-confirm-bar] input").element as HTMLInputElement).value).toBe("500");
        await waitUntil("重新预览", () => buttonByText(again, "保存")?.attributes("disabled") === undefined);
        await buttonByText(again, "保存")!.trigger("click");
        await waitUntil("改了那一笔", () => again.findAll("[data-change-patch]")[0]?.text().includes("+500") ?? false);
        expect(again.find("[data-confirm-bar]").exists()).toBe(false);
        expect(await money(other.canon, star)).toBe(1500);
        expect(again.get("[data-notice-bar]").text()).toContain("改“领了工资”里星瑕的存款那一笔");
        await waitUntil("焦点回到“改”", () => document.activeElement?.getAttribute("data-edit-patch") === "0");
    });

    it("每一处改动按操作写出改了什么：记一句、加别名，不只写地址", async () => {
        const {other, open} = await setup();
        const {change} = await sample(other.canon, {});
        const stored = await other.canon.call("object", {ref: {kind: "change", id: change}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        const found = stored.value.object as StoryChange;
        const star = found.involves[0]!;
        await publish(other.canon, [{ref: {kind: "change", id: change}, after: {...found, patches: [
            {op: "note", at: {entry: star, path: "character.现在的状态"}, value: "被救了一次"},
            {op: "aliasAdd", at: {entry: star, path: "entry.aliases"}, value: "小瑕"},
        ]}}]);
        const {wrapper} = open(change);
        await waitUntil("改动", () => wrapper.findAll("[data-change-patch]").length === 2 && wrapper.text().includes("星瑕的"));
        expect(wrapper.findAll("[data-change-patch]").map((row) => words(row.element))).toEqual(["星瑕的现在的状态：记“被救了一次”", "星瑕的别名：加上 小瑕"]);
    });

    it("改了以后校验不过（依据是原文，原文里没有这个数）：写第一条原因，保存不可用", async () => {
        const {other, open} = await setup();
        const {change} = await sample(other.canon, {}, {kind: "quote", quote: "两百块"});
        const {wrapper} = open(change);
        await waitUntil("“改”", () => wrapper.find("[data-edit-patch='0']").exists());
        await wrapper.get("[data-edit-patch='0']").trigger("click");
        await waitUntil("确认条", () => wrapper.find("[data-confirm-bar]").exists());
        await wrapper.get("[data-confirm-bar] input").setValue("500");
        await waitUntil("校验不过", () => wrapper.find("[data-confirm-bar] [role='alert']").exists() && wrapper.get("[data-confirm-bar] [role='alert']").text().startsWith("没有通过检查："));
        expect(buttonByText(wrapper, "保存")!.attributes("disabled")).toBeDefined();
    });

    it("读出以后这条情节被别处改过：写“这个对象刚被改过”，以新的为准重新预览，再点保存才写进去", async () => {
        const {other, open} = await setup();
        const {star, change} = await sample(other.canon);
        const {wrapper} = open(change);
        await waitUntil("“改”", () => wrapper.find("[data-edit-patch='0']").exists());
        await wrapper.get("[data-edit-patch='0']").trigger("click");
        await waitUntil("确认条", () => wrapper.find("[data-confirm-bar]").exists());
        await wrapper.get("[data-confirm-bar] input").setValue("300");
        await waitUntil("预览", () => buttonByText(wrapper, "保存")?.attributes("disabled") === undefined);

        const stored = await other.canon.call("object", {ref: {kind: "change", id: change}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        await publish(other.canon, [{ref: {kind: "change", id: change}, after: {...(stored.value.object as StoryChange), text: "领了打工的工资"}}]);
        await waitUntil("这个对象刚被改过", () => wrapper.find("[data-confirm-bar] [role='alert']").exists() && wrapper.get("[data-confirm-bar] [role='alert']").text().includes("这个对象刚被改过"));
        await waitUntil("新的文字", () => wrapper.get("h1").text() === "领了打工的工资");
        await waitUntil("重新预览", () => buttonByText(wrapper, "保存")?.attributes("disabled") === undefined);
        await buttonByText(wrapper, "保存")!.trigger("click");
        await waitUntil("写进去了", () => !wrapper.find("[data-confirm-bar]").exists());
        expect(await money(other.canon, star)).toBe(1300);
        const after = await other.canon.call("object", {ref: {kind: "change", id: change}});
        expect(after.ok && (after.value.object as StoryChange).text).toBe("领了打工的工资");
    });

    it("待定的变更：页头写原因；“改成生效”先预览再发布，之后是生效；写不了时不可用", async () => {
        const {other, open} = await setup();
        const {star, change} = await sample(other.canon, {status: "held", held: {reason: "conflict", note: "和第 2 章的余额对不上"}});
        const {wrapper} = open(change);
        await waitUntil("待定", () => wrapper.find("[data-change-held]").exists());
        expect(wrapper.get("[data-change-meta]").text()).toContain("待定");
        expect(wrapper.get("[data-change-held]").text()).toContain("待定：与设定冲突。和第 2 章的余额对不上");
        expect(await money(other.canon, star)).toBe(1000);

        const lease = await other.canon.hold("第 3 章记账");
        if (!lease.ok) throw new Error(JSON.stringify(lease.failure));
        await waitUntil("不可用", () => buttonByText(wrapper, "改成生效")?.attributes("disabled") !== undefined);
        expect(buttonByText(wrapper, "改成生效")!.attributes("title")).toContain("第 3 章记账");
        await lease.value.release();
        await waitUntil("恢复", () => buttonByText(wrapper, "改成生效")?.attributes("disabled") === undefined);

        await buttonByText(wrapper, "改成生效")!.trigger("click");
        await waitUntil("预览", () => wrapper.find("[data-change-activation] li").exists());
        expect(wrapper.get("[data-change-activation]").text()).toContain("星瑕的存款：1,000 → 1,200");
        await wrapper.get("[data-change-activation]").findAll("button").find((button) => button.text() === "改成生效")!.trigger("click");
        await waitUntil("生效了", () => !wrapper.find("[data-change-held]").exists());
        expect(wrapper.get("[data-change-meta]").text()).toContain("生效");
        expect(await money(other.canon, star)).toBe(1200);
        expect(wrapper.get("[data-notice-bar]").text()).toContain("把“领了工资”改成生效");
    });
});
