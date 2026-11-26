/**
 * 窗口在看的线（docs/specs/canon/author-ui.md 输出 34）接在进程内的真实世界服务上：一主一子两条线，状态栏条目、公开状态与条目页的
 * 读取跟着窗口的线，标签标题不跟；分叉撤销以后回到按章节自动。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {effectScope, reactive} from "vue";
import type {Component} from "vue";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {StoryChangeDraft, WriteRequest} from "@notnotype/nb-canon";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {EditorPageContext} from "nbook/plugins/editor/web/pages";
import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonReadsKey} from "../shared/contracts";
import type {CanonReads} from "../shared/reads";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWorld} from "../testing/node-world";
import {pageStandIn} from "../testing/page-stand-in";
import {change, person, publish} from "../testing/world-fixtures";
import {ENTRY_PAGE} from "./commands";
import type {EntryPageState} from "./entry-page";
import {LINE_ITEM} from "./plugin";
import {canonCatalogs} from "./text";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const silent = {error: () => undefined};

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "window-line");
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

/** 窗口里的公开状态与读取服务：一个只取服务的测试插件。 */
function services(): {readonly plugin: PluginDefinition; readonly state: (key: string) => unknown; readonly reads: () => CanonReads} {
    let state: PublicStateService | null = null;
    let reads: CanonReads | null = null;
    return {
        plugin: {id: "test.line-user", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: publicStateKey}, {key: canonReadsKey}], activate: (context) => {
            state = context.services.require(publicStateKey);
            reads = context.services.require(canonReadsKey);
            return {};
        }}]},
        state: (key) => {
            const read = state!.read(key);
            return read.status === "undeclared" ? undefined : read.value;
        },
        reads: () => reads!,
    };
}

/** 一条没有补丁的变更，用来做分叉。 */
function bare(id: string, chapter: string, key: number): StoryChangeDraft {
    return {id, kind: "written", text: "分叉", at: {kind: "chapter", chapter, key}, told: [], involves: [], lines: [], links: [], status: "active", by: {kind: "author"}, patches: []};
}

describe("窗口在看的线", () => {
    it("一主一子：状态栏写按章节自动；选了子线，条目页按子线读、标签标题仍是缺省位置的名字；分叉撤销以后回到按章节自动", async () => {
        venue = await canonNodeWorld(tmp);
        const standIn = pageStandIn();
        const used = services();
        const diagnostics = createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: "mine"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
        await venue.window("mine", [diagnostics, statePlugin, standIn.plugin, used.plugin]);
        const other = await venue.window("other");

        const star = person("星瑾");
        const starId = (await publish(other.canon, [star]))[star.id]!;
        const cut = change(starId, "1", "切口", 0);
        const cutId = (await publish(other.canon, [cut]))[cut.ref.id]!;
        // 子线在第 1 章分出；第 2 章主线上花掉 100，子线上花掉 500 并改了名字。
        const sub = change(starId, "2", "子线上花掉", -500);
        const subAfter = sub.after as StoryChangeDraft;
        const forked: WriteRequest["puts"] = [
            {ref: {kind: "change", id: "tmp:fork"}, after: {...bare("tmp:fork", "1", 900), nature: "fork", fork: {line: "tmp:line", name: "回溯以后", parent: "main", cut: cutId, type: "branch"}}},
            {ref: sub.ref, after: {...subAfter, at: {kind: "chapter", chapter: "2", key: 1, line: "tmp:line"}, patches: [...subAfter.patches, {op: "set", at: {entry: starId, path: "entry.name"}, value: "星瑾（回溯）"}]}},
            change(starId, "2", "主线上花掉", -100),
        ];
        const ids = await publish(other.canon, forked);
        const line = ids["tmp:line"]!;

        const item = standIn.statusItem(LINE_ITEM);
        expect(item.declaration).toMatchObject({alignment: "right", command: {id: "nbook.canon.pick-line"}, when: {requires: ["nbook.canon/lineReady"]}});
        await waitUntil("读到线表，有两条线", () => used.state("nbook.canon/lineReady") === true && used.reads().lineOptions.value.length === 2);
        expect(used.reads().lineOptions.value).toEqual([{id: "main", name: null, depth: 0}, {id: line, name: "回溯以后", depth: 1}]);
        expect(port.t(item.implementation.text())).toBe("故事线：按章节自动");
        expect(used.state("nbook.canon/line")).toBe("");

        const page = standIn.page<EntryPageState>(ENTRY_PAGE);
        const component: Component = await page.load();
        const context: EditorPageContext<EntryPageState> = {recent: [], arg: starId, state: reactive(page.initialState!(starId))};
        const wrapper = mount(component, {props: {context}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => wrapper.unmount());
        // 缺省位置是第 2 章末尾，按章节自动读的是主线。
        await waitUntil("主线上的值", () => wrapper.find("[data-value]").exists() && wrapper.find("[data-value]").text().includes("900"));
        expect(page.title!(starId)).toBe("星瑾");
        // 页头的“在看”：按章节自动时写这一页实际读的线。
        expect(wrapper.get("[data-view-point]").text()).toContain("第 2 章末尾 · 主线");

        used.reads().setLine(line);
        expect(used.state("nbook.canon/line")).toBe(line);
        expect(port.t(item.implementation.text())).toBe("故事线：回溯以后");
        await waitUntil("子线上的值", () => wrapper.find("[data-value]").text().includes("500"));
        expect(wrapper.text()).toContain("星瑾（回溯）");
        // 标签标题按缺省位置、不带窗口的线读。
        expect(page.title!(starId)).toBe("星瑾");

        // 撤掉分叉：子线不在了，回到按章节自动，下一次选线时要说一句。
        const stored = await other.canon.call("object", {ref: {kind: "change", id: ids["tmp:fork"]!}});
        if (!stored.ok) throw new Error(JSON.stringify(stored.failure));
        await publish(other.canon, [{ref: {kind: "change", id: ids["tmp:fork"]!}, after: {...(stored.value.object as StoryChangeDraft), status: "undone"}}]);
        await waitUntil("回到按章节自动", () => used.state("nbook.canon/line") === "");
        expect(used.reads().lineOptions.value).toEqual([{id: "main", name: null, depth: 0}]);
        expect(port.t(item.implementation.text())).toBe("故事线：主线");
        await waitUntil("回到主线上的值", () => wrapper.find("[data-value]").text().includes("900"));
        // 只剩主线：“在看”不提线。
        expect(wrapper.get("[data-view-point]").text()).not.toContain("主线");
    });

    it("别的插件经服务拿到的页头与位置：标题与“在看”；位置的值换成读取位置时带上窗口的线", async () => {
        venue = await canonNodeWorld(tmp);
        const used = services();
        const diagnostics = createDiagnosticsPlugin({location: "browser", store: createDiagnosticsStore({identity: {location: "browser", instanceId: "mine"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
        await venue.window("mine", [diagnostics, statePlugin, used.plugin]);
        const other = await venue.window("other");
        const star = person("星瑾");
        const starId = (await publish(other.canon, [star]))[star.id]!;
        const cut = change(starId, "1", "切口", 0);
        const cutId = (await publish(other.canon, [cut]))[cut.ref.id]!;
        const ids = await publish(other.canon, [{ref: {kind: "change", id: "tmp:fork"}, after: {...bare("tmp:fork", "1", 900), nature: "fork", fork: {line: "tmp:line", name: "回溯以后", parent: "main", cut: cutId, type: "branch"}}}]);
        const line = ids["tmp:line"]!;
        await waitUntil("读到两条线", () => used.reads().lineOptions.value.length === 2);

        const scope = effectScope();
        cleanups.push(() => scope.stop());
        const chosen = {value: ""};
        const position = scope.run(() => used.reads().usePosition(() => chosen.value))!;
        await waitUntil("读到章表", () => position.value !== null);
        expect(position.value).toEqual({position: {kind: "chapter", chapter: "2", edge: "end"}, line: "main"});
        used.reads().setLine(line);
        expect(position.value).toEqual({position: {kind: "chapter", chapter: "2", edge: "end", line}, line});

        const head = mount(used.reads().PageHead, {props: {title: "谁知道什么", position: "1:start", wide: true}, global: {provide: provideText(port)}, attachTo: document.body});
        cleanups.push(() => head.unmount());
        await waitUntil("页头画出来", () => head.find("[data-page-head]").exists() && head.text().includes("第 1 章开头"));
        expect(head.find("h1").text()).toBe("谁知道什么");
        // 窗口固定看着子线：“在看”写线名，带分支的样子。
        expect(head.get("[data-view-point]").text()).toContain("第 1 章开头 · 回溯以后");
    });
});
