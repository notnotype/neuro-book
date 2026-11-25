/**
 * 条目页的附加分页（docs/specs/canon/author-ui.md 输出 9、36）接在进程内的真实世界服务上：别的插件经 `canon.entry-tabs` 交的分页，
 * 条目启用了 `requires` 的类型才出，排在数据分页之后、“情节”之前；组件收到 context（条目、位置）。声明只收浏览器入口、要有 `requires`。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {defineComponent, h, reactive} from "vue";
import type {Component, PropType} from "vue";

import type {Entry} from "@notnotype/nb-canon";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {EditorPageContext} from "nbook/plugins/editor/web/pages";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {CANON_ENTRY_TABS_POINT, validateEntryTabContribution} from "../shared/entry-tabs";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {change, person, publish} from "../testing/world-fixtures";
import {ENTRY_PAGE} from "./commands";
import type {EntryTabContext} from "./component-views";
import type {EntryPageState} from "./entry-page";
import {canonCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "entry-tabs");
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

const StoryTab: Component = defineComponent({
    props: {context: {type: Object as PropType<EntryTabContext>, required: true}},
    setup: (props) => () => h("div", {"data-test-tab": ""}, `${props.context.entry}|${JSON.stringify(props.context.position)}`),
});

/** 给人物交一个附加分页“经历”的测试插件。 */
const tabsPlugin: PluginDefinition = {
    id: "test.tabs",
    entries: [{
        id: "browser", location: "browser", activationEvents: ["onStartup"],
        contributions: [
            {capability: CANON_ENTRY_TABS_POINT, id: "test.tabs.story", declaration: {title: "经历", requires: "nbook.canon.person"}},
            {capability: CANON_ENTRY_TABS_POINT, id: "test.tabs.trail", declaration: {title: "足迹", requires: "nbook.canon.person", needsChanges: true}},
        ],
        activate: () => ({contributions: {[CANON_ENTRY_TABS_POINT]: {"test.tabs.story": {load: async () => StoryTab}, "test.tabs.trail": {load: async () => StoryTab}}}}),
    }],
};

const tabNames = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll('[role="tab"]').map((tab) => tab.text().replace(/\s+/gu, " ").trim());

describe("条目页的附加分页", () => {
    it("启用了 requires 的类型才出，排在数据分页之后、情节之前；组件收到条目与位置", async () => {
        venue = await canonNodeWorld(tmp);
        const standIn = pageStandIn();
        await venue.window("mine", [standIn.plugin, tabsPlugin]);
        const other = await venue.window("other");
        const star = person("星瑾");
        // 只有面板、没有人物类型的条目。
        const base = person("钥匙");
        const key: Entry = {...base, init: {...base.init, data: {panel: base.init.data.panel!}}};
        const ids = await publish(other.canon, [star, key]);

        const page = standIn.page<EntryPageState>(ENTRY_PAGE);
        const component: Component = await page.load();
        const open = (id: string): ReturnType<typeof mount> => {
            const context: EditorPageContext<EntryPageState> = {recent: [], arg: id, state: reactive(page.initialState!(id))};
            const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
            cleanups.push(() => wrapper.unmount());
            return wrapper;
        };

        const starPage = open(ids[star.id]!);
        // 作品里还没有剧情变更：“情节”与声明了 needsChanges 的“足迹”不出，“经历”照出（输出 9、36）。
        await waitUntil("经历出来", () => tabNames(starPage).includes("经历"));
        expect(tabNames(starPage).some((name) => name.startsWith("情节") || name === "足迹")).toBe(false);
        await publish(other.canon, [change(ids[star.id]!, "1", "买了书", -100)]);
        await waitUntil("有了剧情变更以后出来", () => tabNames(starPage).some((name) => name.startsWith("情节")) && tabNames(starPage).includes("足迹"));
        const names = tabNames(starPage);
        expect(names.indexOf("足迹")).toBe(names.findIndex((name) => name.startsWith("情节")) - 1);
        expect(names.indexOf("经历")).toBe(names.indexOf("足迹") - 1);
        expect(names.indexOf("经历")).toBeGreaterThan(names.indexOf("面板"));

        await starPage.findAll('[role="tab"]').find((tab) => tab.text().trim() === "经历")!.trigger("click");
        await waitUntil("分页的组件挂上", () => starPage.find("[data-test-tab]").exists());
        expect(starPage.find("[data-test-tab]").text()).toBe(`${ids[star.id]!}|${JSON.stringify({kind: "chapter", chapter: "1", edge: "end"})}`);

        const keyPage = open(ids[key.id]!);
        await waitUntil("分页出来", () => tabNames(keyPage).some((name) => name.startsWith("情节")));
        expect(tabNames(keyPage)).not.toContain("经历");
    });

    it("声明校验：只收浏览器入口；要有 requires", () => {
        const at = {plugin: "p", entry: "e", capability: CANON_ENTRY_TABS_POINT, id: "p.story"};
        expect(validateEntryTabContribution({...at, location: "browser", declaration: {requires: "nbook.canon.person"}} as never)).toBeNull();
        expect(validateEntryTabContribution({...at, location: "server", declaration: {requires: "nbook.canon.person"}} as never)).toContain("browser");
        expect(validateEntryTabContribution({...at, location: "browser", declaration: {}} as never)).toContain("invalid declaration");
    });
});
