import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildDiagnosticRegistry, buildRegistry, type Decision, type DiagnosticDeclaration, type Entry, type StoryChangeDraft, type WriteRequest} from "../src/index";
import type {Finding, GroupItem, WorldService} from "../src/node/index";
import {PROJECT, sign, verify} from "./fixtures/authorization";
import {openTestService} from "./fixtures/service";
import {PANEL, PERSON} from "./fixtures/world";

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-diagnostics");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

const PLUGIN = "nbook.plot";
const declaration = (id: string, extra: Partial<DiagnosticDeclaration> = {}): DiagnosticDeclaration => ({id: `${PLUGIN}.${id}`, version: 1, level: "pending", label: id, key: ["detail"], ...extra});
const registryOf = (...declarations: DiagnosticDeclaration[]) => buildDiagnosticRegistry(declarations.map((item) => ({plugin: PLUGIN, declaration: item})));
const TEXTS = new Map([["ch1", "开头。"], ["ch2", "她把钟拨慢了一刻。\n钟停了。"], ["ch3", "雨。"]]);

async function open(declarations: readonly DiagnosticDeclaration[]): Promise<WorldService> {
    const service = await openTestService(root, {texts: TEXTS, chapters: ["ch1", "ch2", "ch3"], registry: buildRegistry([PANEL, PERSON]), diagnostics: registryOf(...declarations), project: PROJECT, verifyAuthorSource: verify});
    services.push(service);
    return service;
}

let sequence = 0;
async function write(service: WorldService, puts: WriteRequest["puts"], extra: Partial<WriteRequest> = {}) {
    const result = await service.publish({requestId: `diag-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "诊断", baseVersion: service.status().version, puts, ...extra});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}

const finding = (detail: string, extra: Partial<Finding> = {}): Finding => ({key: {detail}, objects: [], params: {}, ...extra});
const pageOf = (service: WorldService, query: Parameters<WorldService["pending"]>[0] = {}) => {
    const page = service.pending(query, undefined, 5000);
    if (typeof page === "string") throw new Error(page);
    return page;
};
const describeItem = (item: GroupItem) => (item.kind === "finding" ? `${item.diagnostic.slice(PLUGIN.length + 1)}:${String(item.finding.key.detail)}` : item.kind === "canon" ? item.item.kind : item.hint.code);

/** 作者带来源新建一条挂在这条发现上的已定决策（“有意为之”）。 */
async function accept(service: WorldService, diagnostic: string, key: Readonly<Record<string, unknown>>, version: number): Promise<string> {
    const decision: Decision = {id: "tmp:d", text: "有意为之", status: "decided", conclusion: "有意为之", about: [{kind: "diagnostic", id: diagnostic, key: {...key}, version}], hints: []};
    const request: WriteRequest = {requestId: `accept-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "有意为之", baseVersion: service.status().version, puts: [{ref: {kind: "decision", id: "tmp:d"}, after: decision}]};
    const result = await service.publish({...request, authorizations: [sign(request, "tmp:d", "new→decided")]});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.ids["tmp:d"]!;
}

describe("canon.model 验收场景 10：诊断与作者的处理", () => {
    test("标有意为之移到已处理；诊断升版本后重新报出并带旧决策；沿用后又已处理；停用插件后完整、另列，决策照存", async () => {
        const x = declaration("x");
        const service = await open([x]);
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {[x.id]: () => [finding("钟")]}});
        expect(pageOf(service).items.map(describeItem)).toEqual(["x:钟"]);

        const first = await accept(service, x.id, {detail: "钟"}, 1);
        expect(pageOf(service).items).toEqual([]);
        expect(pageOf(service, {group: "handled"}).items).toMatchObject([{kind: "finding", diagnostic: x.id, handledBy: first}]);

        await service.setRegistries({diagnostics: registryOf({...x, version: 2})});
        expect(pageOf(service).items).toMatchObject([{kind: "finding", diagnostic: x.id, earlierDecision: first}]);
        const second = await accept(service, x.id, {detail: "钟"}, 2);
        expect(pageOf(service, {group: "handled"}).items).toMatchObject([{handledBy: second}]);

        await service.setRegistries({diagnostics: registryOf()});
        const disabled = pageOf(service);
        expect([disabled.complete, disabled.disabled, disabled.items]).toEqual([true, [x.id], []]);
        expect(service.decisions({status: "decided"})).toMatchObject({items: [{decision: {id: first}}, {decision: {id: second}}]});
    });
});

describe("canon.model 输出 34：一次计算的结果怎样处理", () => {
    test("同一稳定键只留第一条并给提示；超过 1000 条截断、标不完整；级别为提示的进提示组", async () => {
        const many = declaration("many");
        const twice = declaration("twice");
        const soft = declaration("soft", {level: "hint"});
        const service = await open([many, twice, soft]);
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {
            [many.id]: () => Array.from({length: 1001}, (_, index) => finding(String(index).padStart(4, "0"))),
            [twice.id]: () => [finding("同一处", {params: {n: 1}}), finding("同一处", {params: {n: 2}})],
            [soft.id]: () => [finding("轻")],
        }});
        const page = pageOf(service);
        expect([page.complete, page.truncated, page.counts.pending]).toEqual([false, [many.id], 1001]);
        expect(page.items.filter((item) => item.kind === "finding" && item.diagnostic === twice.id)).toMatchObject([{finding: {params: {n: 1}}}]);
        expect(pageOf(service, {group: "hints"}).items.map(describeItem)).toEqual(["soft:轻", "diagnostic-duplicate-key"]);
    });

    test("一个诊断抛错、没登记计算、稳定键不合声明（含对象引用多了字段）：这几个没有结果并标不完整，别的诊断照常算", async () => {
        const [boom, missing, badKey, extraKey, fine] = [declaration("boom"), declaration("missing"), declaration("badkey"), declaration("extrakey", {key: ["objects"]}), declaration("fine")];
        const service = await open([boom, missing, badKey, extraKey, fine]);
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {
            [boom.id]: () => {
                throw new Error("坏了");
            },
            [badKey.id]: () => [{key: {objects: "不是列表"}, objects: [], params: {}}],
            [extraKey.id]: () => [{key: {objects: [{kind: "entry", id: "e1", 备注: "多出来的"}]}, objects: [], params: {}}],
            [fine.id]: () => [finding("好")],
        }});
        const page = pageOf(service);
        expect(page.complete).toBe(false);
        expect(page.unavailable.map((item) => [item.diagnostic, item.reason.split(":")[0]])).toEqual([[badKey.id, "invalid finding key"], [boom.id, "threw"], [extraKey.id, "invalid finding key"], [missing.id, "not-registered"]]);
        expect(page.items.map(describeItem)).toEqual(["fine:好"]);
        expect(service.status().diagnosticTimings.map((timing) => timing.diagnostic)).toEqual(expect.arrayContaining([boom.id, badKey.id, fine.id]));
    });

    test("计算耗时超过 200 毫秒的在 status 的 diagnosticTimings 里标 slow，快的不标（canon.project 输出 26）", async () => {
        const slow = declaration("slow");
        const quick = declaration("quick");
        const service = await open([slow, quick]);
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {
            [slow.id]: () => {
                // 真实地占用 250 毫秒：计时用的就是实际流逝的时间。
                for (const started = performance.now(); performance.now() - started < 250;);
                return [finding("慢")];
            },
            [quick.id]: () => [finding("快")],
        }});
        pageOf(service);
        const timings = new Map(service.status().diagnosticTimings.map((timing) => [timing.diagnostic, timing]));
        expect(timings.get(slow.id)).toMatchObject({slow: true});
        expect(timings.get(quick.id)).toBeDefined();
        expect(timings.get(quick.id)).not.toHaveProperty("slow");
    });

    test("计算拿到这次读取的只读世界与读取位置：在第 2 章末尾读，按讲述的发生点报", async () => {
        const told = declaration("told");
        const service = await open([told]);
        await write(service, [{ref: {kind: "change", id: "tmp:c"}, after: change("ch2", {told: [{source: "chapter", chapter: "ch2", quote: "钟停了"}]})}]);
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {
            [told.id]: (view, at) => view.tellings({until: at.kind === "chapter" ? {chapter: at.chapter, edge: "end"} : {chapter: "ch1", edge: "start"}}).map((item) => finding(item.telling.id, {at: {kind: "telling", telling: item.telling.id}})),
        }});
        expect(pageOf(service, {position: {kind: "chapter", chapter: "ch1", edge: "end"}}).items).toEqual([]);
        expect(pageOf(service, {position: {kind: "chapter", chapter: "ch2", edge: "end"}}).items).toMatchObject([{kind: "finding", occurrence: {chapter: "ch2", paragraph: 2, offset: 0}}]);
    });
});

const change = (chapter: string, extra: Partial<StoryChangeDraft> = {}, key = 0): StoryChangeDraft => ({id: "tmp:c", kind: "written", text: "一件事", at: {kind: "chapter", chapter, key}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra});

describe("canon.model 输出 16：三组的全序", () => {
    test("核对点取比较时点排序：挂靠的变更没套上时回到核对点自己的安放，不按挂靠的变更排", async () => {
        const service = await open([]);
        const made = await write(service, [{ref: {kind: "entry", id: "tmp:x"}, after: {id: "tmp:x", type: "人物", parent: null, folder: "", order: 0, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 0, 魔力上限: null, 魔力: null, 物品: []}}}}}}]);
        const entry = made.ids["tmp:x"]!;
        const held = await write(service, [{ref: {kind: "change", id: "tmp:c"}, after: change("ch1", {status: "held", held: {reason: "unsure", note: "没把握"}}, 10)}]);
        const check = (id: string, chapter: string, quote: string, extra: object = {}) => ({ref: {kind: "check" as const, id}, after: {id, at: {entry, path: "panel.存款"}, value: 100, told: {source: "chapter" as const, chapter, quote}, place: {kind: "chapter" as const, chapter, key: 1}, by: {kind: "author" as const}, ...extra}});
        await write(service, [
            check("tmp:anchored", "ch3", "雨", {anchor: {change: held.ids["tmp:c"]!, side: "after"}}),
            check("tmp:plain", "ch2", "钟停了"),
        ]);
        const quotes = pageOf(service, {position: {kind: "chapter", chapter: "ch3", edge: "end"}}).items.flatMap((item) => (item.kind === "canon" && item.item.kind === "check-mismatch" ? [service.world.data.checks.get(item.item.check)!.told.quote] : []));
        expect(quotes).toEqual(["钟停了", "雨"]);
    });

    test("前史在前；同一章里带安放的按排序键、带讲述发生点的在后；同一位置内核的在插件的前面；没有位置的最后", async () => {
        const order = declaration("order");
        const service = await open([order]);
        const held = await write(service, [{ref: {kind: "change", id: "tmp:c"}, after: change("ch2", {status: "held", held: {reason: "unsure", note: "没把握"}, told: [{source: "chapter", chapter: "ch2", quote: "钟停了"}]}, 10)}]);
        const telling = (held.world.data.changes.get(held.ids["tmp:c"]!)!.told[0]!).id;
        service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {[order.id]: () => [
            finding("没有位置"),
            finding("讲述", {at: {kind: "telling", telling}}),
            finding("同一位置", {at: {kind: "placement", placement: {kind: "chapter", chapter: "ch2", key: 10}}}),
            finding("排序键 3", {at: {kind: "placement", placement: {kind: "chapter", chapter: "ch2", key: 3}}}),
            finding("前史", {at: {kind: "placement", placement: {kind: "prehistory", order: 1}}}),
        ]}});
        expect(pageOf(service).items.map(describeItem)).toEqual(["order:前史", "order:排序键 3", "held", "order:同一位置", "order:讲述", "order:没有位置"]);
    });

    test("提示组里有内核自己的提示：讲述失联、原句重复、类型不在的 Component；各组总数与待定决策、未处理建议的条数", async () => {
        const service = await open([]);
        const person: Entry = {id: "tmp:p", type: "人物", parent: null, folder: "", order: 0, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}}}}};
        await write(service, [
            {ref: {kind: "entry", id: "tmp:p"}, after: person},
            {ref: {kind: "change", id: "tmp:c"}, after: change("ch2", {told: [{source: "chapter", chapter: "ch2", quote: "钟"}]})},
            {ref: {kind: "decision", id: "tmp:d"}, after: {id: "tmp:d", text: "钟的事", status: "pending", about: [], hints: []}},
        ]);
        await service.setRegistries({registry: buildRegistry([PANEL])});
        const page = pageOf(service, {group: "hints"});
        expect(page.items.map(describeItem)).toEqual(["duplicate-quote", "component-unknown"]);
        expect([page.counts, page.decisionsPending, page.suggestionsOpen]).toEqual([{pending: 0, hints: 2, handled: 0}, 1, 0]);
    });
});

describe("canon.model 输出 36：插件的数据版本是读取输入的一部分", () => {
    test("报告新的数据版本以后读取输入的摘要变了、旧游标作废，按新数据算；入口停止后登记失效", async () => {
        const data = declaration("data");
        const service = await open([data]);
        let answers = ["甲", "乙", "丙"];
        const stop = service.registerDiagnostics(PLUGIN, {dataVersion: "1", compute: {[data.id]: () => answers.map((answer) => finding(answer))}});
        const first = service.pending({}, undefined, 1);
        if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
        answers = ["丁"];
        service.reportDataVersion(PLUGIN, "2");
        expect(service.pending({}, first.cursor, 1)).toBe("cursor-stale");
        expect(pageOf(service).items.map(describeItem)).toEqual(["data:丁"]);
        expect(pageOf(service).inputDigest).not.toBe(first.inputDigest);
        stop();
        expect(pageOf(service).unavailable).toEqual([{diagnostic: data.id, reason: "not-registered"}]);
    });
});
