/**
 * 伏笔账本与目标表两页（docs/specs/plot/author-ui.md 输出 11 到 15）接在进程内的真实世界服务与剧情项目入口上。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {reactive} from "vue";
import type {Component} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {canonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import type {CanonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import {pageStandIn} from "nbook/plugins/canon/testing/page-stand-in";
import {publish} from "nbook/plugins/canon/testing/world-fixtures";
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import type {EditorPageContext} from "nbook/plugins/editor/web/pages";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {descriptor as storageDescriptor} from "nbook/plugins/storage/plugin";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {plotProjectPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {MARK_IDS} from "../shared/declarations";
import {drafts} from "../testing/world";
import type {GoalsPageState, LedgerPageState} from "./pages";
import {GOALS_PAGE, LEDGER_PAGE, plotBrowserPlugin} from "./plugin";
import {plotCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs, "nbook.plot": plotCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-plot", "tables-pages");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="4"><chapter id="1" title="入学"/><chapter id="2" title="打工"/><chapter id="3" title="雨夜"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

async function setup() {
    venue = await canonNodeWorld(tmp, {project: [definitionAt("project", storageDescriptor, storageBackendPlugin), definitionAt("project", descriptor, plotProjectPlugin)]});
    const standIn = pageStandIn();
    await venue.window("mine", [standIn.plugin, definitionAt("browser", descriptor, plotBrowserPlugin)]);
    const other = await venue.window("other");
    const open = async <State extends object>(id: string) => {
        const page = standIn.page<State>(id);
        const component: Component = await page.load();
        const context: EditorPageContext<State> = {recent: [], state: reactive(page.initialState!(undefined)) as State};
        const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        return {wrapper, state: context.state};
    };
    return {other, open};
}

describe("伏笔账本", () => {
    it("接下来写下一步计划（第 2 章埋下），没有打算的用警告色；节点带画打算写的节点", async () => {
        const {other, open} = await setup();
        const ids = await publish(other.canon, [
            {ref: {kind: "entry", id: "tmp:doll"}, after: drafts.foreshadow("tmp:doll", "彗的魔偶")},
            {ref: {kind: "entry", id: "tmp:egg"}, after: drafts.foreshadow("tmp:egg", "星瑾不吃煎蛋")},
        ]);
        const node = {kind: MARK_IDS.node, version: 1, foreshadow: ids["tmp:doll"]!, role: "plant"};
        await publish(other.canon, [{ref: {kind: "change", id: "tmp:plan"}, after: drafts.change("tmp:plan", {kind: "chapter", chapter: "2", key: 1}, {kind: "plan", told: [{source: "outline", chapter: "2", anchor: "埋下魔偶", marks: [node]}]})}]);
        const {wrapper, state} = await open<LedgerPageState>(LEDGER_PAGE);
        // 缺省位置是最新一章（第 3 章）末尾：第 2 章的计划在它之前，按位置之前的位置读才有“接下来”。
        state.position = "1:end";
        await waitUntil("账本出来", () => wrapper.findAll("[data-ledger-row]").length === 2 && wrapper.text().includes("第 2 章埋下"), {timeoutMs: 10_000});
        const rows = wrapper.findAll("[data-ledger-row]");
        const doll = rows.find((row) => row.text().includes("彗的魔偶"))!;
        const egg = rows.find((row) => row.text().includes("星瑾不吃煎蛋"))!;
        expect(doll.find('[data-cell="next"]').text()).toBe("第 2 章埋下");
        expect(doll.findAll("[data-node]")).toHaveLength(1);
        expect(doll.find("[data-node]").attributes("aria-label")).toBe("第 2 章埋下，打算写");
        expect(egg.find('[data-cell="next"]').text()).toBe("没有打算");
        expect(egg.find('[data-cell="next"]').classes().join(" ")).toContain("status-warning");
    });
});

describe("目标表", () => {
    it("主要角色一组一组；缺省只列进行与受挫的，打开开关多出达成的；按人筛；收起一组", async () => {
        const {other, open} = await setup();
        const ids = await publish(other.canon, [
            {ref: {kind: "entry", id: "tmp:xia"}, after: drafts.person("tmp:xia", "星瑕")},
            {ref: {kind: "entry", id: "tmp:jin"}, after: drafts.person("tmp:jin", "星瑾")},
        ]);
        const goals = await publish(other.canon, [
            {ref: {kind: "entry", id: "tmp:hide"}, after: drafts.goal("tmp:hide", "不让妹妹发现", ids["tmp:xia"]!)},
            {ref: {kind: "entry", id: "tmp:cake"}, after: drafts.goal("tmp:cake", "吃到蛋糕", ids["tmp:xia"]!, {状态: "achieved"})},
        ]);
        await publish(other.canon, [{ref: {kind: "entry", id: "tmp:find"}, after: drafts.goal("tmp:find", "查出哥哥在瞒什么", ids["tmp:jin"]!, {状态: "blocked", 冲突: [{id: goals["tmp:hide"]!}]})}]);
        const {wrapper, state} = await open<GoalsPageState>(GOALS_PAGE);
        await waitUntil("目标表出来", () => wrapper.findAll("[data-goal-group]").length === 2, {timeoutMs: 10_000});
        expect(wrapper.findAll("[data-goal]").map((goal) => goal.text())).toEqual([
            expect.stringContaining("不让妹妹发现"),
            expect.stringContaining("查出哥哥在瞒什么"),
        ]);
        expect(wrapper.text()).toContain("和这些打架：星瑕：不让妹妹发现");
        expect(wrapper.text()).toContain("出场以后没动过");

        state.finished = true;
        await waitUntil("多出达成的", () => wrapper.text().includes("吃到蛋糕"));
        state.holder = ids["tmp:jin"]!;
        await waitUntil("只剩星瑾", () => wrapper.findAll("[data-goal-group]").length === 1);
        await wrapper.find("[data-goal-group] [aria-expanded]").trigger("click");
        expect(state.collapsed).toEqual([ids["tmp:jin"]!]);
        expect(wrapper.findAll("[data-goal]")).toHaveLength(0);
    });
});
