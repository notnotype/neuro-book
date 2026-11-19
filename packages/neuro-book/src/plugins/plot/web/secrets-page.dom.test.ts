/**
 * “谁知道什么”一页与侧栏“剧情”（docs/specs/plot/author-ui.md 输出 1、6 到 10）接在进程内的真实世界服务与剧情项目入口上：
 * 按主体分组、缺省点名主要角色、程度写文字、分段筛选、侧栏的剧情线。
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
import {addRow, drafts} from "../testing/world";
import type {SecretsPageState} from "./pages";
import {plotBrowserPlugin, SECRETS_PAGE, SIDEBAR_VIEW} from "./plugin";
import {plotCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs, "nbook.plot": plotCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-plot", "secrets-page");
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

/** 星瑕（持有进行的目标，主要角色）、星瑾、彗；星瑕名下两个秘密，“父母”名下一个；星瑾信错了一个，彗知道一个。一条剧情线。 */
async function setup() {
    venue = await canonNodeWorld(tmp, {project: [definitionAt("project", storageDescriptor, storageBackendPlugin), definitionAt("project", descriptor, plotProjectPlugin)]});
    const standIn = pageStandIn();
    await venue.window("mine", [standIn.plugin, definitionAt("browser", descriptor, plotBrowserPlugin)]);
    const other = await venue.window("other");
    const ids = await publish(other.canon, [
        {ref: {kind: "entry", id: "tmp:xia"}, after: {...drafts.person("tmp:xia", "星瑕"), order: 1}},
        {ref: {kind: "entry", id: "tmp:parents"}, after: {...drafts.person("tmp:parents", "父母"), order: 2}},
        {ref: {kind: "entry", id: "tmp:jin"}, after: {...drafts.person("tmp:jin", "星瑾"), order: 3}},
        {ref: {kind: "entry", id: "tmp:hui"}, after: {...drafts.person("tmp:hui", "彗"), order: 4}},
        {ref: {kind: "entry", id: "tmp:brother"}, after: drafts.point("tmp:brother", "哥哥就是星瑕", "tmp:xia")},
        {ref: {kind: "entry", id: "tmp:prisoned"}, after: drafts.point("tmp:prisoned", "那几年是被软禁", "tmp:xia")},
        {ref: {kind: "entry", id: "tmp:alive"}, after: drafts.point("tmp:alive", "父母没有死", "tmp:parents", {保密: "topSecret"})},
        {ref: {kind: "entry", id: "tmp:goal"}, after: drafts.goal("tmp:goal", "不让妹妹发现", "tmp:xia")},
        {ref: {kind: "entry", id: "tmp:line"}, after: {...drafts.person("tmp:line", "做个好哥哥"), type: "剧情线"}},
    ]);
    await publish(other.canon, [{ref: {kind: "change", id: "tmp:c1"}, after: drafts.change("tmp:c1", {kind: "chapter", chapter: "1", key: 1}, {patches: [
        addRow(ids["tmp:xia"]!, ids["tmp:brother"]!, {程度: "knows"}),
        addRow(ids["tmp:hui"]!, ids["tmp:brother"]!, {程度: "knows"}),
        addRow(ids["tmp:jin"]!, ids["tmp:prisoned"]!, {程度: "misbelieves", 他以为的: "哥哥不想回家"}),
    ]})}]);
    return {standIn, ids};
}

describe("谁知道什么", () => {
    it("按主体分组、缺省点名主要角色、程度写文字；选“读者还不知道”只剩那几行", async () => {
        const {standIn, ids} = await setup();
        const page = standIn.page<SecretsPageState>(SECRETS_PAGE);
        const component: Component = await page.load();
        const context: EditorPageContext<SecretsPageState> = {recent: [], state: reactive(page.initialState!(undefined))};
        const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        await waitUntil("表出来", () => wrapper.findAll("[data-secret-row]").length === 3, {timeoutMs: 10_000});

        const groups = wrapper.findAll('th[scope="rowgroup"]').map((th) => th.text());
        expect(groups).toEqual(["关于星瑕", "关于父母"]);
        // 缺省点名主要角色（持有进行的目标的星瑕）。
        expect(wrapper.findAll('thead th[scope="col"]').map((th) => th.text())).toEqual(["秘密", "星瑕", "别的人", "读者", "打算怎么揭"]);
        const brother = wrapper.findAll("[data-secret-row]").find((row) => row.text().includes("哥哥就是星瑕"))!;
        expect(brother.find(`[data-cell="${ids["tmp:xia"]!}"]`).text()).toBe("知道");
        expect(brother.text()).toContain("彗（知道）");
        const prisoned = wrapper.findAll("[data-secret-row]").find((row) => row.text().includes("那几年是被软禁"))!;
        expect(prisoned.text()).toContain("星瑾（信错了）");
        expect(prisoned.text()).toContain("没有打算");
        expect(context.state.people).toBeNull();

        await wrapper.findAll('[role="radio"]').find((radio) => radio.text().startsWith("读者还不知道"))!.trigger("click");
        expect(context.state.segment).toBe("readerUnaware");
        await waitUntil("筛过", () => wrapper.findAll("[data-secret-row]").length === 3 && !wrapper.text().includes("读取中"));
        expect(page.breadcrumbs!(undefined)?.map((crumb) => port.t(crumb.label))).toEqual(["剧情", "谁知道什么"]);
    });

    it("侧栏：三张表与剧情线", async () => {
        const {standIn} = await setup();
        const view = standIn.view(SIDEBAR_VIEW);
        expect(view.declaration).toMatchObject({location: "sidebar", order: 20});
        const wrapper = mount(await view.implementation.load(), {global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        await waitUntil("剧情线出来", () => wrapper.text().includes("做个好哥哥"), {timeoutMs: 10_000});
        expect(wrapper.findAll("button").map((button) => button.text())).toEqual(["谁知道什么", "伏笔账本", "目标表", "做个好哥哥"]);
    });
});
