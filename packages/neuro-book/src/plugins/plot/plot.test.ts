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
import {GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";

import {plotWorldContract} from "./shared/contracts";
import {plotInstructionsContract} from "./shared/instructions";
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
        // 阶段 E 的读取：目标表、涉及本章的决策、开写前的视图、写手的上下文（经真实的项目子进程与远程合同）。
        expect(await plot.goals({})).toMatchObject({ok: true, value: {items: []}});
        expect(await plot.decisionsFor({chapter: "2"})).toMatchObject({ok: true, value: {items: []}});
        expect(await plot.decisionsFor({chapter: "99"})).toMatchObject({ok: false, code: "plot", detail: {code: "chapter-not-found"}});
        expect(await plot.beforeWriting({chapter: "2"})).toMatchObject({ok: true, value: {chapter: "2", lines: [{line: "main", overdue: []}]}});
        const brief = await plot.brief({chapter: "2", outline: "卫兵站岗，勇者经过", targetWords: 1500});
        if (!brief.ok) throw new Error(JSON.stringify(brief));
        const written = brief.value as {text: string; record: {pluginVersion: string; targetWords: number; previousDigest: string | null}};
        expect(written.text).toContain("## 细纲\n卫兵站岗，勇者经过");
        expect(written.text).toContain("## 目标字数\n1500");
        expect(written.text).toContain("## 上一章末尾\n国王与贤者说话。");
        expect(written.record).toMatchObject({targetWords: 1500, pluginVersion: expect.any(String)});
        expect(await plot.brief({chapter: "99", outline: "", targetWords: 1})).toMatchObject({ok: false, code: "plot", detail: {code: "chapter-not-found"}});
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

    it("写作指示快照的服务：能推（换内容后数据版本变、旧游标作废，同内容再推游标仍有效）；失败码经真实合同；推了快照以后读待处理仍完整、远程 brief 读到它", async () => {
        let instructions: RemoteUse<typeof plotInstructionsContract> | null = null;
        const instructionsCaller: PluginDefinition = {id: "test.instructions-caller", entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            instructions = context.remote.use(plotInstructionsContract);
            return {};
        }})]};
        const h = await projectHarness(tmp, {plugins: serverPlugins(), prepare: async (paths) => {
            const dir = join(paths.project.path, "manuscripts.binder");
            await mkdir(dir, {recursive: true});
            await writeFile(join(dir, "binder.xml"), '<binder nextId="2"><chapter id="1" title="一"/></binder>');
            await writeFile(join(dir, "00001-一.md"), "国王与贤者说话。\n");
        }});
        const keep = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(1);
        const caller = plotCaller();
        const window = await windowOf(h, "browser-2", "profile-2", [caller.plugin, instructionsCaller]);
        await until(async () => {
            const status = await window.canon.call("status", {});
            return status.ok && status.value.version >= 0;
        });
        const use = instructions!;
        const empty = await use.current({});
        if (!empty.ok) throw new Error(JSON.stringify(empty));
        const snapshot = {chapter: "1", version: "v1", tone: "冷"};
        const first = await use.put({chapter: "1", snapshot});
        if (!first.ok) throw new Error(JSON.stringify(first));
        expect(first.value.dataVersion).not.toBe(empty.value.dataVersion);
        // 同内容再推：数据版本不变。
        expect(await use.put({chapter: "1", snapshot})).toMatchObject({ok: true, value: {dataVersion: first.value.dataVersion}});
        // 数据版本报告给 canon：换内容以后读取输入变了，旧游标作废；同内容再推游标仍有效。
        const people = await publish(window.canon, {requestId: "p", by: {kind: "author"}, what: "edit", title: "人", baseVersion: 0, puts: [
            {ref: {kind: "entry", id: "tmp:a"}, after: drafts.person("tmp:a", "甲")},
            {ref: {kind: "entry", id: "tmp:b"}, after: drafts.person("tmp:b", "乙")},
        ]});
        expect(people.ok).toBe(true);
        const page = await window.canon.call("tree", {parent: null, limit: 1});
        if (!page.ok) throw new Error(JSON.stringify(page));
        const cursor = (page.value as {cursor?: string}).cursor;
        expect(cursor).toBeString();
        await use.put({chapter: "1", snapshot});
        expect((await window.canon.call("tree", {parent: null, limit: 1, cursor})).ok).toBe(true);
        await use.put({chapter: "1", snapshot: {...snapshot, tone: "暖"}});
        expect(await window.canon.call("tree", {parent: null, limit: 1, cursor})).toMatchObject({ok: false, failure: {code: "cursor-stale"}});
        // 失败码：base 对不上、章对不上。
        expect(await use.put({chapter: "1", snapshot: null, base: "不是当前版本"})).toMatchObject({ok: false, code: "plot", detail: {code: "instructions-conflict"}});
        expect(await use.put({chapter: "2", snapshot})).toMatchObject({ok: false, code: "plot", detail: {code: "chapter-mismatch"}});
        // 推了快照以后读待处理仍是完整的，远程 brief 读到表里的快照。
        const pending = await window.canon.call("pending", {});
        expect(pending.ok && pending.value.complete).toBe(true);
        const brief = await caller.plot().brief({chapter: "1", outline: "细纲", targetWords: 100});
        expect(brief.ok && (brief.value as {record: {instructionVersion: string | null}}).record.instructionVersion).toBe("v1");
        const before = await use.current({});
        await window.close();
        keep.release();
        // 重启：项目实例换一代，写作指示从项目记录读回，数据版本相同（同内容同版本，canon 的游标不因重启作废）。
        h.clock.advance(GRACE_MS);
        await revoked(keep);
        const again = leaseOf(await h.manager.acquire("book", "test"));
        await h.ready(2);
        const caller2 = plotCaller();
        const reopened = await windowOf(h, "browser-2b", "profile-2", [caller2.plugin, instructionsCaller]);
        await until(async () => {
            const status = await reopened.canon.call("status", {});
            return status.ok && status.value.version >= 0;
        });
        expect(await instructions!.current({})).toEqual(before);
        const afterRestart = await caller2.plot().brief({chapter: "1", outline: "细纲", targetWords: 100});
        expect(afterRestart.ok && (afterRestart.value as {text: string}).text).toContain("语气：暖");
        await reopened.close();
        again.release();
    }, 30_000);
});

