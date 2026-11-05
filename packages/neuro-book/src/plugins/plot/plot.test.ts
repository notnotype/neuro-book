/**
 * 剧情插件在真实的项目子进程里（docs/specs/plot/knowledge.md、foreshadowing.md、goals.md 的“输入与前置条件”）：
 * 声明经 canon 的贡献点登记进世界，写得进带这些 Component 与标注的对象。纯计算的测试在 `core/` 旁边。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {buildMarkRegistry, buildRegistry} from "@notnotype/nb-canon";
import type {Entry, StoryChangeDraft, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {publish, serverPlugins, until, windowOf} from "nbook/plugins/canon/testing/harness";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";

import {plotWorldContract} from "./shared/contracts";
import {COMPONENT_IDS, DIAGNOSTIC_IDS, MARK_IDS, PLOT_COMPONENTS, PLOT_MARKS, PLOT_PLUGIN_ID} from "./shared/declarations";
import {drafts} from "./testing/world";

/** 窗口里的测试插件：拿到剧情插件远程合同的调用入口。 */
function plotCaller(): {readonly plugin: PluginDefinition; readonly plot: () => RemoteUse<typeof plotWorldContract>} {
    let use: RemoteUse<typeof plotWorldContract> | null = null;
    return {
        plugin: {id: "test.plot-caller", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            use = context.remote.use(plotWorldContract);
            return {};
        }})]},
        plot: () => use!,
    };
}

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plot", "project-child");
});
afterEach(() => {
    killSpawnedProjects();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("剧情插件的声明", () => {
    it("五个 Component 与六种标注种类在内核的登记里都合规（前缀是插件 id）", () => {
        expect(buildRegistry(PLOT_COMPONENTS).diagnostics).toEqual([]);
        const marks = buildMarkRegistry(PLOT_MARKS.map((declaration) => ({plugin: PLOT_PLUGIN_ID, declaration})));
        expect(marks.diagnostics).toEqual([]);
        expect(marks.versions.map(([id]) => id)).toEqual([MARK_IDS.guardAddress, MARK_IDS.guardReader, MARK_IDS.node, MARK_IDS.presentLearns, MARK_IDS.reveal, MARK_IDS.scene]);
    });

    it("项目子进程里剧情插件的类型与标注种类已登记：知识点、知情行与揭示都写得进去，载荷不合 schema 的揭示拒收", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            const dir = join(paths.project.path, "manuscripts.binder");
            await mkdir(dir, {recursive: true});
            await writeFile(join(dir, "binder.xml"), '<binder nextId="2"><chapter id="1" title="一"/></binder>');
            await writeFile(join(dir, "00001-一.md"), "国王与贤者说话。\n");
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const window = await windowOf(h, "browser-1", "profile-1");
        // 打开以后按活页夹发布一次章序调整。
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.version >= 1;
        });
        const point: Entry = {id: "tmp:k", type: "知识点", parent: null, folder: "", order: 0, init: {name: "勇者左手有星形的疤", aliases: [], summary: "勇者左手有星形的疤", text: [], data: {point: {type: COMPONENT_IDS.point, version: 1, enabled: true, fields: {保密: "secret", 规则: null, 表现: null, 揭穿: null, 读者问题: null}}}}};
        const king: Entry = {id: "tmp:king", type: "人物", parent: null, folder: "", order: 0, init: {name: "国王", aliases: [], summary: "", text: [], data: {know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}}}}};
        const talk: StoryChangeDraft = {id: "tmp:c", kind: "written", text: "国王与贤者谈勇者的特征", at: {kind: "unscheduled"}, told: [], involves: [], lines: [], links: [], patches: [{op: "listAdd", at: {entry: "tmp:king", path: "know.知情"}, value: {id: "tmp:k", 程度: "knows", 怎么知道: "witnessed"}}], status: "active", by: {kind: "author"}, marks: [{kind: MARK_IDS.presentLearns, version: 1, point: "tmp:k"}]};
        const request: WriteRequest = {requestId: "plot-1", by: {kind: "author"}, what: "edit", title: "知识点", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:k"}, after: point}, {ref: {kind: "entry", id: "tmp:king"}, after: king}, {ref: {kind: "change", id: "tmp:c"}, after: talk}]};
        const written = await publish(window.canon, request);
        expect(written.ok).toBe(true);
        const bad = await publish(window.canon, {...request, requestId: "plot-2", puts: [{ref: {kind: "change", id: "tmp:c"}, after: {...talk, marks: [{kind: MARK_IDS.presentLearns, version: 1}]}}]});
        expect(bad).toMatchObject({ok: false, failure: {code: "validation-failed"}});

        // 剧情插件登记的诊断经 canon 的待处理读到：第 1 章给国王加一行误信、没写他以为的，报“知情行不完整”。
        if (!written.ok) throw new Error("not written");
        const kingId = written.value.ids["tmp:king"]!;
        const pointId = written.value.ids["tmp:k"]!;
        const misbelief: StoryChangeDraft = {...talk, id: "tmp:m", marks: [], at: {kind: "chapter", chapter: "1", key: 0}, patches: [{op: "listAdd", at: {entry: kingId, path: "know.知情"}, value: {id: pointId, 程度: "misbelieves"}}]};
        const added = await publish(window.canon, {...request, requestId: "plot-3", puts: [{ref: {kind: "change", id: "tmp:m"}, after: misbelief}]});
        expect(added.ok).toBe(true);
        const pending = await window.canon.call("pending", {});
        expect(pending.ok && pending.value.items.map((item) => (item.kind === "finding" ? item.diagnostic : item.kind))).toContain(DIAGNOSTIC_IDS.knowingIncomplete);
        expect(pending.ok && pending.value.complete).toBe(true);
        await window.close();
        keep.release();
    }, 30_000);
});

describe("剧情插件的远程合同", () => {
    it("knowledge 输出 3、8、9：有效知情与经历的读取（不是目标的读冲突得到 not-found）；按视角开视图、读到占位，关掉以后句柄失效", async () => {
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            const dir = join(paths.project.path, "manuscripts.binder");
            await mkdir(dir, {recursive: true});
            await writeFile(join(dir, "binder.xml"), '<binder nextId="3"><chapter id="1" title="一"/><chapter id="2" title="二"/></binder>');
            await writeFile(join(dir, "00001-一.md"), "国王与贤者说话。\n");
            await writeFile(join(dir, "00002-二.md"), "卫兵站岗。\n");
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const caller = plotCaller();
        const window = await windowOf(h, "browser-1", "profile-1", [caller.plugin]);
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.version >= 1;
        });
        const people = await publish(window.canon, {requestId: "people", by: {kind: "author"}, what: "edit", title: "人", baseVersion: 0, puts: [
            {ref: {kind: "entry", id: "tmp:king"}, after: drafts.person("tmp:king", "国王")},
            {ref: {kind: "entry", id: "tmp:guard"}, after: drafts.person("tmp:guard", "卫兵")},
            {ref: {kind: "entry", id: "tmp:k"}, after: drafts.point("tmp:k", "勇者左手有星形的疤", null)},
            {ref: {kind: "entry", id: "tmp:k2"}, after: drafts.point("tmp:k2", "勇者怕水", null)},
        ]});
        if (!people.ok) throw new Error(JSON.stringify(people.failure));
        const [king, guard, k, k2] = [people.value.ids["tmp:king"]!, people.value.ids["tmp:guard"]!, people.value.ids["tmp:k"]!, people.value.ids["tmp:k2"]!];
        const talk = drafts.change("tmp:c", {kind: "chapter", chapter: "1", key: 0}, {cast: [{who: king, role: "present"}], marks: [{kind: MARK_IDS.presentLearns, version: 1, point: k}, {kind: MARK_IDS.presentLearns, version: 1, point: k2}]});
        expect((await publish(window.canon, {requestId: "talk", by: {kind: "author"}, what: "edit", title: "谈", baseVersion: 0, puts: [{ref: {kind: "change", id: "tmp:c"}, after: talk}]})).ok).toBe(true);

        const plot = caller.plot();
        expect(await plot.knowing({person: king, point: k})).toMatchObject({ok: true, value: {items: [{point: k, 程度: "knows", source: "present"}]}});
        expect(await plot.ledger({})).toMatchObject({ok: true, value: {items: []}});
        expect(await plot.experience({person: king})).toMatchObject({ok: true, value: {items: [{text: "tmp:c"}], uncast: 0}});
        // 列表分页（canon.project 输出 18）：一条一页时给游标，接着读到尽头；游标与查询绑定，换了人就作废。
        const first = await plot.knowing({person: king, limit: 1});
        if (!first.ok) throw new Error(JSON.stringify(first));
        const cursor = (first.value as {cursor?: string}).cursor;
        expect(cursor).toBeString();
        const second = await plot.knowing({person: king, limit: 1, cursor});
        const points = (value: unknown) => (value as {items: {point: string}[]}).items.map((row) => row.point);
        expect(second.ok && [...points(first.value), ...points(second.value)].sort()).toEqual([k, k2].sort());
        expect(second.ok && (second.value as {cursor?: string}).cursor).toBeUndefined();
        expect(await plot.knowing({person: guard, limit: 1, cursor})).toMatchObject({ok: false, code: "plot", detail: {code: "cursor-stale"}});
        expect(await plot.conflicts({goal: k})).toMatchObject({ok: false, code: "plot", detail: {code: "not-found"}});
        // 剧情插件声明的诊断都登记了计算：待处理是完整的。
        const pending = await window.canon.call("pending", {});
        expect(pending.ok && [pending.value.complete, pending.value.unavailable]).toEqual([true, []]);
        const opened = await plot.openViewpoint({viewer: guard, until: {kind: "chapter", chapter: "2", edge: "end"}, purpose: "writer"});
        if (!opened.ok) throw new Error(JSON.stringify(opened));
        const handle = (opened.value as {handle: string}).handle;
        expect(await plot.viewpointEntry({handle, id: k})).toMatchObject({ok: true, value: {kind: "placeholder", id: k}});
        expect(await plot.viewpointEntry({handle, id: king})).toMatchObject({ok: true, value: {kind: "entry"}});
        const audit = await window.canon.call("viewAudit", {viewer: guard});
        expect(audit.ok && audit.value.items.map((item) => item.kind)).toEqual(["placeholder"]);
        // 视角挂在线上：线不存在开不了；位置写了不存在的线读知情得 line-not-found。
        expect(await plot.openViewpoint({viewer: guard, until: {kind: "chapter", chapter: "2", edge: "end"}, purpose: "writer", line: "l404"})).toMatchObject({ok: false, code: "plot", detail: {code: "line-not-found"}});
        expect(await plot.knowing({person: king, position: {kind: "chapter", chapter: "2", edge: "end", line: "l404"}})).toMatchObject({ok: false, code: "plot", detail: {code: "line-not-found"}});
        expect((await plot.closeViewpoint({handle})).ok).toBe(true);
        expect(await plot.viewpointEntry({handle, id: k})).toMatchObject({ok: false, code: "plot", detail: {code: "view-denied"}});
        expect(await plot.viewpointExperience({handle: "viewpoint-never"})).toMatchObject({ok: false, code: "plot", detail: {code: "view-denied"}});
        // 拒绝也进同一份审计：关掉的句柄写得出看的人，从没有过的写成不知道。
        const after = await window.canon.call("viewAudit", {});
        expect(after.ok && after.value.items.map((item) => [item.kind, item.method, item.viewer])).toEqual([["placeholder", "viewpoint.entry", guard], ["denied", "viewpoint.entry", guard], ["denied", "viewpoint.experience", null]]);

        await window.close();
        keep.release();
    }, 30_000);
});

