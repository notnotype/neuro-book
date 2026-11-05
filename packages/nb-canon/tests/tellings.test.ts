import {createHash} from "node:crypto";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type StoryChange, type TellingDraft, type WriteRequest} from "../src/index";
import {nodeFiles, WorldService, type ServicePorts} from "../src/node/index";
import {memoryLock} from "./fixtures/faulty-files";
import {PERSON} from "./fixtures/world";

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-tellings");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

const lock = memoryLock();

/** 宿主的正文：测试直接改这张表，再像宿主一样调 `textChanged`。 */
async function open(texts: Map<string, string>): Promise<WorldService> {
    const ports: ServicePorts = {
        files: nodeFiles,
        lock,
        logDir: join(root, ".nbook", "world", "log"),
        sideDir: join(root, ".nbook", "world"),
        cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
        chapterText: (chapter) => texts.get(chapter),
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => 0,
        now: () => new Date(0).toISOString(),
    };
    const service = await WorldService.open(ports, {chapters: ["ch1", "ch2", "ch3"], registry: buildRegistry([PERSON])});
    if ("code" in service) throw new Error(service.code);
    services.push(service);
    return service;
}

let sequence = 0;
function change(told: TellingDraft[], extra: Partial<StoryChange> = {}): StoryChange {
    return {id: "tmp:c", kind: "written", text: "讲到", at: {kind: "chapter", chapter: told.find((telling) => telling.chapter !== undefined)?.chapter ?? "ch1", key: 0}, told: told as StoryChange["told"], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra};
}

/** 写一条新的剧情变更，返回它的 id。 */
async function tell(service: WorldService, told: TellingDraft[], extra: Partial<StoryChange> = {}): Promise<string> {
    const request: WriteRequest = {requestId: `tell-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "讲述", baseVersion: service.status().version, puts: [{ref: {kind: "change", id: "tmp:c"}, after: change(told, extra)}]};
    const result = await service.publish(request);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.ids["tmp:c"]!;
}

/** 改一条剧情变更的讲述（保留讲述的 id）。 */
async function retell(service: WorldService, id: string, edit: (told: StoryChange["told"]) => StoryChange["told"]) {
    const current = service.object({kind: "change", id}).object as StoryChange;
    const request: WriteRequest = {requestId: `retell-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "改讲述", baseVersion: service.status().version, puts: [{ref: {kind: "change", id}, after: {...current, told: edit(current.told)}}]};
    const result = await service.publish(request);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
}

function read(service: WorldService, filter: Parameters<WorldService["tellings"]>[0] = {}) {
    const result = service.tellings(filter);
    if (result === "cursor-stale") throw new Error("cursor-stale");
    return result.items;
}

describe("canon.model 输出 24、25：讲述的发生点与 id", () => {
    test("按段定位：空行不算段，段首尾的空白不算偏移；偏移按 UTF-16 码元", async () => {
        const texts = new Map([["ch1", "  第一段。\n\n第二段里，🌧她走进雨里。  \n"]]);
        const service = await open(texts);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "她走进雨里"}]);
        expect(read(service).map((item) => item.located)).toEqual([{kind: "found", occurrence: {chapter: "ch1", paragraph: 2, offset: 7}, count: 1}]);
    });

    test("原句出现三次、没给 nth：取第一处并提示 duplicate-quote；改成 nth 2 取第二处，提示消失，讲述的 id 不变", async () => {
        const texts = new Map([["ch2", "好。\n他说好，好吧。"]]);
        const service = await open(texts);
        const id = await tell(service, [{source: "chapter", chapter: "ch2", quote: "好"}]);
        const [first] = read(service);
        expect(first).toMatchObject({owner: {kind: "change", id}, path: "told", located: {occurrence: {paragraph: 1, offset: 0}, count: 3}, hints: [{code: "duplicate-quote"}]});
        await retell(service, id, (told) => told.map((telling) => ({...telling, nth: 2})));
        const [second] = read(service);
        expect(second?.telling.id).toBe(first?.telling.id);
        expect(second?.located).toMatchObject({occurrence: {paragraph: 2, offset: 2}});
        expect(second && "hints" in second).toBe(false);
    });

    test("正文以外的讲述没有发生点，排在生效的讲述后面，也不进“读过的”", async () => {
        const texts = new Map([["ch1", "她走进雨里。"]]);
        const service = await open(texts);
        await tell(service, [{source: "outline", chapter: "ch1", anchor: "大纲第一条"}]);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "她走进雨里"}]);
        expect(read(service).map((item) => item.located.kind)).toEqual(["found", "elsewhere"]);
        expect(read(service, {until: {chapter: "ch1", edge: "end"}}).map((item) => item.located.kind)).toEqual(["found"]);
    });
});

describe("canon.model 输出 26、验收场景 7：失联与重新生效", () => {
    test("作者删掉原句：讲述失联并提示 telling-lost，不在读过的里；改回这句，按新正文重新生效", async () => {
        const texts = new Map([["ch1", "前文。"], ["ch2", "开头。\n她把钟拨慢了一刻。"]]);
        const service = await open(texts);
        await tell(service, [{source: "chapter", chapter: "ch2", quote: "她把钟拨慢了一刻"}]);
        const end = {chapter: "ch2", edge: "end"} as const;
        expect(read(service, {until: end})).toHaveLength(1);

        texts.set("ch2", "开头。\n她没有动那座钟。");
        service.textChanged("ch2");
        expect(read(service)).toMatchObject([{located: {kind: "lost", reason: "quote-not-found"}, hints: [{code: "telling-lost", detail: "quote-not-found"}]}]);
        expect(read(service, {until: end})).toEqual([]);
        expect(read(service, {effective: false})).toHaveLength(1);

        texts.set("ch2", "开头。\n又过了一会儿。\n她把钟拨慢了一刻。");
        service.textChanged("ch2");
        expect(read(service, {until: end})).toMatchObject([{located: {kind: "found", occurrence: {paragraph: 3, offset: 0}}}]);
    });

    test("nth 超出、章不在章序里、取不到正文，各带自己的原因", async () => {
        const texts = new Map([["ch1", "好，好。"], ["ch2", "雨。"], ["ch3", "风。"]]);
        const service = await open(texts);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "好", nth: 2}]);
        await tell(service, [{source: "chapter", chapter: "ch2", quote: "雨"}]);
        await tell(service, [{source: "chapter", chapter: "ch3", quote: "风"}]);
        texts.set("ch1", "好。");
        texts.delete("ch3");
        service.textChanged();
        await service.setChapters(["ch1", "ch3"]);
        expect(read(service).map((item) => [item.telling.chapter, item.located.kind === "lost" ? item.located.reason : item.located.kind])).toEqual([
            ["ch1", "nth-exceeds"],
            ["ch2", "chapter-missing"],
            ["ch3", "text-unavailable"],
        ]);
    });
});

describe("canon.model 输出 27：讲述的先后与读过的", () => {
    test("按章序、段、段内偏移排，同一点按讲述 id；讲述位置按段、章首、章末截取", async () => {
        const texts = new Map([["ch1", "甲在前。乙在后。\n丙。"], ["ch2", "丁。"]]);
        const service = await open(texts);
        await tell(service, [{source: "chapter", chapter: "ch2", quote: "丁"}]);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "乙在后"}, {source: "chapter", chapter: "ch1", quote: "丙"}]);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "甲在前"}]);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "甲在前"}]);
        const quotes = (filter: Parameters<WorldService["tellings"]>[0] = {}) => read(service, filter).map((item) => item.telling.quote);
        expect(quotes()).toEqual(["甲在前", "甲在前", "乙在后", "丙", "丁"]);
        const sameSpot = read(service).slice(0, 2).map((item) => Number(item.telling.id.slice(1)));
        expect(sameSpot[0]!).toBeLessThan(sameSpot[1]!);
        expect(quotes({until: {chapter: "ch1", paragraph: 1}})).toEqual(["甲在前", "甲在前", "乙在后"]);
        expect(quotes({until: {chapter: "ch2", edge: "start"}})).toEqual(["甲在前", "甲在前", "乙在后", "丙"]);
        expect(quotes({until: {chapter: "ch1", edge: "start"}})).toEqual([]);
        expect(quotes({from: "ch2", to: "ch2"})).toEqual(["丁"]);
    });

    test("按条目筛：涉及它的剧情变更的讲述；翻页按同样的先后接着给", async () => {
        const texts = new Map([["ch1", "一。二。三。"]]);
        const service = await open(texts);
        const created = await service.publish({requestId: "person", by: {kind: "author"}, what: "edit", title: "人", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:p"}, after: {id: "tmp:p", type: "人物", parent: null, folder: "", order: 0, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {}}}}]});
        if (!created.ok) throw new Error(JSON.stringify(created.failure));
        const person = created.ids["tmp:p"]!;
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "三"}], {involves: [person]});
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "二"}]);
        await tell(service, [{source: "chapter", chapter: "ch1", quote: "一"}], {involves: [person]});
        expect(read(service, {entry: person}).map((item) => item.telling.quote)).toEqual(["一", "三"]);

        const first = service.tellings({}, undefined, 2);
        if (first === "cursor-stale" || first.cursor === undefined) throw new Error("no cursor");
        const rest = service.tellings({}, first.cursor, 2);
        if (rest === "cursor-stale") throw new Error("cursor-stale");
        expect([...first.items, ...rest.items].map((item) => item.telling.quote)).toEqual(["一", "二", "三"]);
    });
});
