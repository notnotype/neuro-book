import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type Entry, type StoryChangeDraft, type WriteRequest} from "../src/index";
import type {WorldService} from "../src/node/index";
import {openTestService} from "./fixtures/service";
import {PANEL, PERSON} from "./fixtures/world";

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-views");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

const CHAPTERS = ["ch9", "ch10", "ch11"];
const TEXTS = new Map([["ch9", "她数了钱。"], ["ch10", "她又数了一遍。"], ["ch11", "钱不见了。"]]);

let sequence = 0;
async function write(service: WorldService, puts: WriteRequest["puts"]) {
    const result = await service.publish({requestId: `view-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "视图", baseVersion: service.status().version, puts});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.ids;
}

const person = (id: string, name: string): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: []}}}}});
const spend = (id: string, chapter: string, entry: string, amount: number, quote: string): StoryChangeDraft => ({id, kind: "written", text: `花了 ${String(amount)}`, at: {kind: "chapter", chapter, key: 0}, told: [{source: "chapter", chapter, quote}], involves: [entry], lines: [], links: [], patches: [{op: "add", at: {entry, path: "panel.存款"}, value: -amount}], status: "active", by: {kind: "author"}, cast: [{who: entry, role: "present"}]});

/** 星瑾与星瑕；星瑕在第 9、11 章各花一笔钱。 */
async function setup() {
    const service = await openTestService(root, {texts: TEXTS, chapters: CHAPTERS, registry: buildRegistry([PANEL, PERSON])});
    services.push(service);
    const people = await write(service, [{ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")}, {ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]);
    const [jin, xia] = [people["tmp:jin"]!, people["tmp:xia"]!];
    await write(service, [{ref: {kind: "change", id: "tmp:a"}, after: spend("tmp:a", "ch9", xia, 10, "她数了钱")}]);
    await write(service, [{ref: {kind: "change", id: "tmp:b"}, after: spend("tmp:b", "ch11", xia, 30, "钱不见了")}]);
    return {service, jin, xia};
}

const deposit = (read: unknown) => (read as {view: {namespaces: {panel: {fields: {存款: {value: number}}}}}}).view.namespaces.panel.fields.存款.value;

describe("canon.project 验收场景 8：视图", () => {
    test("写第 10 章的写手：读第 9 章末尾照常；读第 11 章、发布一次写入被拒，审计里有这两条；关掉以后令牌失效", async () => {
        const {service, jin, xia} = await setup();
        const opened = service.openView({viewer: jin, line: "main", until: {kind: "chapter", chapter: "ch10", edge: "start"}, purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
        const view = service.viewed(opened.token);
        expect(deposit(view.entry(xia, {kind: "chapter", chapter: "ch9", edge: "end"}))).toBe(90);
        expect(view.entry(xia, {kind: "chapter", chapter: "ch11", edge: "end"})).toBe("view-denied");
        expect(view.deny("publish")).toBe("view-denied");
        const audit = service.viewAudit();
        expect(audit !== "cursor-stale" && audit.items.map((item) => [item.viewer, item.purpose, item.method])).toEqual([[jin, "writer", "entry"], [jin, "writer", "publish"]]);

        service.closeView(opened.token);
        expect(view.entry(xia, {kind: "chapter", chapter: "ch9", edge: "end"})).toBe("view-denied");
    });
});

describe("canon.project 输出 24：带令牌的读取", () => {
    test("读取位置不写时夹到上限；列表只返回上限之前的安放与读过的讲述，范围晚于上限的拒", async () => {
        const {service, xia} = await setup();
        const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch10", edge: "end"}, purpose: "character"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
        const view = service.viewed(opened.token);
        expect(deposit(view.entry(xia, undefined))).toBe(90);
        const changes = view.changes({entry: xia});
        expect(changes !== "view-denied" && changes !== "cursor-stale" && changes.items.map((item) => item.change.at)).toEqual([{kind: "chapter", chapter: "ch9", key: 0}]);
        const tellings = view.tellings();
        expect(tellings !== "view-denied" && tellings !== "cursor-stale" && tellings.items.map((item) => item.telling.quote)).toEqual(["她数了钱"]);
        const presence = view.presence(xia);
        expect(presence !== "view-denied" && typeof presence !== "string" && presence.items.length).toBe(1);
        expect(view.changes({chapter: "ch11"})).toBe("view-denied");
        expect(view.tellings({to: "ch11"})).toBe("view-denied");
        expect(view.presence(xia, {to: "ch11"})).toBe("view-denied");
        // 不带令牌照常看得到全部。
        const all = service.changes({entry: xia});
        expect(all !== "cursor-stale" && all.items.length).toBe(2);
    });

    test("上限是章首：同一章里晚于它的讲述位置拒；计划的进展与按计划模式的在场按上限算，不漏上限之后的兑现", async () => {
        const {service, xia} = await setup();
        const ids = await write(service, [
            {ref: {kind: "change", id: "tmp:p"}, after: {id: "tmp:p", kind: "plan", text: "去取钱", at: {kind: "chapter", chapter: "ch10", key: 5}, told: [], involves: [xia], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, cast: [{who: xia, role: "present"}]}},
            {ref: {kind: "change", id: "tmp:w"}, after: {id: "tmp:w", kind: "written", text: "取了钱", at: {kind: "chapter", chapter: "ch11", key: 1}, told: [], involves: [xia], lines: [], links: [{kind: "fulfills", plan: "tmp:p"}], patches: [], status: "active", by: {kind: "author"}}},
        ]);
        const plan = ids["tmp:p"]!;
        const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch11", edge: "start"}, purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
        const view = service.viewed(opened.token);

        expect(view.tellings({until: {chapter: "ch11", paragraph: 1}})).toBe("view-denied");
        expect(view.tellings({until: {chapter: "ch11", edge: "end"}})).toBe("view-denied");
        expect(view.tellings({until: {chapter: "ch11", edge: "start"}})).not.toBe("view-denied");
        const audit = service.viewAudit();
        expect(audit !== "cursor-stale" && audit.items.map((item) => item.method)).toEqual(["tellings", "tellings"]);

        const plans = (progress: "fulfilled" | "unfulfilled") => {
            const page = view.changes({kind: "plan", progress});
            return page === "view-denied" || page === "cursor-stale" ? page : page.items.map((item) => item.change.id);
        };
        expect([plans("fulfilled"), plans("unfulfilled")]).toEqual([[], [plan]]);
        const whole = service.changes({kind: "plan", progress: "fulfilled"});
        expect(whole !== "cursor-stale" && whole.items.map((item) => item.change.id)).toEqual([plan]);
        const planned = view.presence(xia, {mode: "planned"});
        expect(planned !== "view-denied" && typeof planned !== "string" && planned.items.map((item) => item.change.id)).toContain(plan);
    });

    test("上限不在章序里、别的线：打不开", async () => {
        const {service} = await setup();
        expect(service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch99", edge: "end"}, purpose: "writer"})).toBe("chapter-not-found");
        expect(service.openView({viewer: null, line: "r1", until: {kind: "chapter", chapter: "ch10", edge: "end"}, purpose: "writer"})).toEqual({code: "line-not-found"});
    });
});

describe("canon.project 输出 24：视图不漏上限之后的事，审计记种类与被挡的对象", () => {
    test("带令牌读条目与渲染：上限之后才启用的命名空间不出现（不给值，也不说第几章起生效）", async () => {
        const {service, xia} = await setup();
        const entry = service.object({kind: "entry", id: xia}).object as Entry;
        // 星瑕的面板改成第 11 章才启用：不带令牌读第 10 章末尾，`upcoming` 里有它。
        await write(service, [{ref: {kind: "entry", id: xia}, after: {...entry, init: {...entry.init, data: {panel: {...entry.init.data.panel!, enabled: false}}}}}]);
        await write(service, [{ref: {kind: "change", id: "tmp:on"}, after: {id: "tmp:on", kind: "written", text: "启用面板", at: {kind: "chapter", chapter: "ch11", key: 5}, told: [], involves: [xia], lines: [], links: [], patches: [{op: "set", at: {entry: xia, path: "panel.启用"}, value: true}], status: "active", by: {kind: "author"}}}]);
        const plain = service.entry(xia, {kind: "chapter", chapter: "ch10", edge: "end"}, "actual");
        expect(plain !== "chapter-not-found" && plain.view?.upcoming.map((item) => item.namespace)).toEqual(["panel"]);
        const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch10", edge: "end"}, purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
        const read = service.viewed(opened.token).entry(xia, undefined);
        expect(typeof read !== "string" && read.view?.upcoming).toEqual([]);
    });

    test("被拒记成 denied；插件记的占位带被挡的对象；按看的人筛，游标是序号", async () => {
        const {service, jin, xia} = await setup();
        const writer = service.openView({viewer: jin, line: "main", until: {kind: "chapter", chapter: "ch10", edge: "start"}, purpose: "writer"});
        const other = service.openView({viewer: xia, line: "main", until: {kind: "chapter", chapter: "ch10", edge: "start"}, purpose: "character"});
        if (typeof writer === "string" || !("token" in writer) || typeof other === "string" || !("token" in other)) throw new Error("open");
        service.viewed(writer.token).deny("object");
        service.auditView(writer.token, {method: "entry", kind: "placeholder", blocked: [{kind: "entry", id: "e99"}]});
        service.viewed(other.token).deny("pending");
        const mine = service.viewAudit({viewer: jin}, undefined, 1);
        if (mine === "cursor-stale" || mine.cursor === undefined) throw new Error("no cursor");
        expect(mine.items.map((item) => item.kind)).toEqual(["denied"]);
        const rest = service.viewAudit({viewer: jin}, mine.cursor, 5);
        expect(rest !== "cursor-stale" && rest.items.map((item) => [item.kind, item.blocked])).toEqual([["placeholder", [{kind: "entry", id: "e99"}]]]);
        // 审计不是读取输入：写入以后旧游标照样接着读。
        await write(service, [{ref: {kind: "entry", id: "tmp:z"}, after: person("tmp:z", "路人")}]);
        expect(service.viewAudit({viewer: jin}, mine.cursor, 5)).toMatchObject({items: [{kind: "placeholder"}]});
    });
});

describe("项目内的快照", () => {
    test("视图与带令牌的读取建在同一份世界上，之后的发布不影响它；正文变了以后再用就抛错", async () => {
        const {service, xia} = await setup();
        const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch11", edge: "end"}, purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error("open");
        const snapshot = service.snapshot();
        const version = snapshot.view.version;
        await write(service, [{ref: {kind: "change", id: "tmp:c"}, after: spend("tmp:c", "ch11", xia, 5, "钱不见了")}]);
        expect(service.status().version).toBe(version + 1);
        expect(snapshot.view.changes({entry: xia})).toHaveLength(2);
        const viewed = snapshot.viewed(opened.token).changes({entry: xia});
        expect(viewed !== "view-denied" && viewed !== "cursor-stale" && viewed.version).toBe(version);
        TEXTS.set("ch9", "她把钱藏起来了。");
        service.textChanged("ch9");
        expect(() => snapshot.view.tellings()).toThrow();
        TEXTS.set("ch9", "她数了钱。");
    });
});

