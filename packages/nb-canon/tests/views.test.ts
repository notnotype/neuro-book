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

    test("上限不在章序里、别的线：打不开", async () => {
        const {service} = await setup();
        expect(service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch99", edge: "end"}, purpose: "writer"})).toBe("chapter-not-found");
        expect(service.openView({viewer: null, line: "r1", until: {kind: "chapter", chapter: "ch10", edge: "end"}, purpose: "writer"})).toEqual({code: "line-not-found"});
    });
});
