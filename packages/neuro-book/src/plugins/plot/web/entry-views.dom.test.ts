/**
 * 条目页上剧情的专门界面与附加分页（docs/specs/plot/author-ui.md 输出 16 到 19）接在进程内的真实世界服务、剧情项目入口与 canon 的
 * 条目页上：“知道什么”“目标与态度”“谁知道”替换通用字段表、各带一节这一页的通用字段；人物另有“经历”。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";
import type {Component} from "vue";

import type {Entry} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {canonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import type {CanonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import {pageStandIn} from "nbook/plugins/canon/testing/page-stand-in";
import {publish} from "nbook/plugins/canon/testing/world-fixtures";
import {ENTRY_PAGE} from "nbook/plugins/canon/web/commands";
import type {EntryPageState} from "nbook/plugins/canon/web/entry-page";
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import type {EditorPageContext} from "nbook/plugins/editor/web/pages";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {descriptor as storageDescriptor} from "nbook/plugins/storage/plugin";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {plotProjectPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {addRow, drafts, present} from "../testing/world";
import {plotBrowserPlugin} from "./plugin";
import {plotCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs, "nbook.plot": plotCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-plot", "entry-views");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="3"><chapter id="1" title="入学"/><chapter id="2" title="打工"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

/** 剧情的人物，另启用 canon 的人物类型（“经历”要它）与态度。 */
function person(id: string, name: string, attitudes: readonly Record<string, unknown>[] = []): Entry {
    const base = drafts.person(id, name);
    return {...base, init: {...base.init, data: {
        ...base.init.data,
        character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}},
        att: {type: "nbook.plot.attitude", version: 1, enabled: true, fields: {态度: attitudes}},
    }}};
}

/** 一行的几格（程度、名字、那句话、来处；没有的是空串）。 */
const cellsOf = (row: ReturnType<ReturnType<typeof mount>["find"]>, names: readonly string[]): string[] => names.map((name) => {
    const cell = row.find(`[data-cell="${name}"]`);
    return cell.exists() ? cell.text() : "";
});
const tabNames = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll('[role="tab"]').map((tab) => tab.text().replace(/\s+/gu, " ").trim());
const pick = async (wrapper: ReturnType<typeof mount>, name: string): Promise<void> => {
    await wrapper.findAll('[role="tab"]').find((tab) => tab.text().trim() === name)!.trigger("click");
};

/** 星瑕知道“哥哥就是星瑕”（第 1 章早餐时，星瑾也在场）；星瑾信错了；星瑾对星瑕的态度起因是这个秘密；星瑕有一个目标。 */
async function setup() {
    venue = await canonNodeWorld(tmp, {project: [definitionAt("project", storageDescriptor, storageBackendPlugin), definitionAt("project", descriptor, plotProjectPlugin)]});
    const standIn = pageStandIn();
    await venue.window("mine", [standIn.plugin, definitionAt("browser", descriptor, plotBrowserPlugin)]);
    const other = await venue.window("other");
    const ids = await publish(other.canon, [
        {ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")},
        {ref: {kind: "entry", id: "tmp:hui"}, after: person("tmp:hui", "彗")},
        {ref: {kind: "entry", id: "tmp:brother"}, after: drafts.point("tmp:brother", "哥哥就是星瑕", "tmp:xia")},
        {ref: {kind: "entry", id: "tmp:alive"}, after: drafts.point("tmp:alive", "父母没有死", null, {保密: "topSecret"})},
    ]);
    const more = await publish(other.canon, [
        {ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾", [{id: ids["tmp:xia"]!, 态度: "还在生气", 起因: {ref: ids["tmp:brother"]!}, 称呼: "哥哥"}])},
        {ref: {kind: "entry", id: "tmp:goal"}, after: drafts.goal("tmp:goal", "不让妹妹发现", ids["tmp:xia"]!)},
    ]);
    const all = {...ids, ...more};
    await publish(other.canon, [{ref: {kind: "change", id: "tmp:c1"}, after: drafts.change("tmp:c1", {kind: "chapter", chapter: "1", key: 1}, {text: "早餐", cast: [present(all["tmp:xia"]!), present(all["tmp:jin"]!)], patches: [
        addRow(all["tmp:xia"]!, all["tmp:brother"]!, {程度: "knows", 怎么知道: "witnessed"}),
        addRow(all["tmp:jin"]!, all["tmp:brother"]!, {程度: "misbelieves", 他以为的: "哥哥在外地"}),
    ]})}]);
    const page = standIn.page<EntryPageState>(ENTRY_PAGE);
    const component: Component = await page.load();
    const open = (id: string): ReturnType<typeof mount> => {
        const context: EditorPageContext<EntryPageState> = {recent: [], arg: id, state: reactive(page.initialState!(id))};
        const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        return wrapper;
    };
    return {ids: all, open};
}

describe("人物页", () => {
    it("知道什么：两组，程度写文字、来处写章；下面一节是这一页的通用字段", async () => {
        const {ids, open} = await setup();
        const wrapper = open(ids["tmp:xia"]!);
        await waitUntil("分页出来", () => tabNames(wrapper).some((name) => name.startsWith("情节")), {timeoutMs: 10_000});
        const names = tabNames(wrapper);
        expect(names).toEqual(expect.arrayContaining(["知道什么", "目标与态度", "经历"]));
        expect(names.indexOf("经历")).toBe(names.findIndex((name) => name.startsWith("情节")) - 1);

        await pick(wrapper, "知道什么");
        await waitUntil("知情出来", () => wrapper.findAll("[data-knowing-row]").length === 2, {timeoutMs: 10_000});
        // 一行依次是程度、秘密、怎么知道、来处。保密的事列出所有秘密：没有行的写“不知道”。
        const cells = wrapper.findAll("[data-knowing-row]").map((row) => cellsOf(row, ["degree", "name", "detail", "origin"]));
        expect(cells).toEqual(expect.arrayContaining([["知道", "哥哥就是星瑕", "当时在场", "第 1 章"], ["不知道", "父母没有死", "", ""]]));
        expect(wrapper.find("[data-knowing-view]").text()).toContain("字段");
        expect(wrapper.find("[data-knowing-view]").text()).toContain("听过的说法");
    });

    it("目标与态度：他的目标与态度表；经历按章、写同时在场的人", async () => {
        const {ids, open} = await setup();
        const xia = open(ids["tmp:xia"]!);
        await waitUntil("分页出来", () => tabNames(xia).includes("目标与态度"), {timeoutMs: 10_000});
        await pick(xia, "目标与态度");
        await waitUntil("目标出来", () => xia.text().includes("不让妹妹发现"), {timeoutMs: 10_000});

        await pick(xia, "经历");
        await waitUntil("经历出来", () => xia.findAll("[data-experience-item]").length === 1, {timeoutMs: 10_000});
        const experience = xia.find("[data-experience]").text();
        expect(experience).toContain("第 1 章");
        expect(experience).toContain("早餐");
        expect(experience).toContain("同时在场：星瑾");

        const jin = open(ids["tmp:jin"]!);
        await waitUntil("分页出来", () => tabNames(jin).includes("目标与态度"), {timeoutMs: 10_000});
        await pick(jin, "目标与态度");
        await waitUntil("态度出来", () => jin.find("[data-attitude-row]").exists(), {timeoutMs: 10_000});
        expect(jin.find("[data-attitude-row]").findAll("td").map((cell) => cell.text())).toEqual(["星瑕", "还在生气", "哥哥就是星瑕", "哥哥"]);
    });
});

describe("秘密页", () => {
    it("谁知道：保密档、有行的人、其余人数、读者、和它有关的态度；下面一节是通用字段", async () => {
        const {ids, open} = await setup();
        const wrapper = open(ids["tmp:brother"]!);
        await waitUntil("分页出来", () => tabNames(wrapper).includes("谁知道"), {timeoutMs: 10_000});
        await pick(wrapper, "谁知道");
        await waitUntil("谁知道出来", () => wrapper.findAll("[data-point-row]").length === 2, {timeoutMs: 10_000});
        const view = wrapper.find("[data-point-view]");
        expect(view.text()).toContain("保密");
        const cells = wrapper.findAll("[data-point-row]").map((row) => cellsOf(row, ["name", "degree", "detail", "origin"]));
        expect(cells).toEqual(expect.arrayContaining([["星瑾", "信错了", "哥哥在外地", "第 1 章"], ["星瑕", "知道", "当时在场", "第 1 章"]]));
        // 彗没有行；保密的秘密写“都不知道”。
        expect(wrapper.find("[data-point-rest]").text()).toBe("别的 1 个人都不知道");
        expect(wrapper.find("[data-point-reader]").text()).toBe("不知道");
        expect(wrapper.find("[data-point-related]").text()).toContain("星瑾对星瑕的态度是从它来的");
        expect(view.text()).toContain("读者要猜的问题");
    });
});
