import {createHash} from "node:crypto";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildDiagnosticRegistry, buildMarkRegistry, buildRegistry, ChapterOrder, type DiagnosticDeclaration, type Entry, type MarkDeclaration, type StoryChange, type StoryChangeDraft, type TellingDraft, type WriteRequest} from "../src/index";
import {nodeFiles, WorldService, type ServicePorts} from "../src/node/index";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {memoryLock} from "./fixtures/faulty-files";
import {PERSON} from "./fixtures/world";

/** 仿剧情插件的“揭示”：挂在讲述上，指向一个知识点。 */
const REVEAL: MarkDeclaration = {
    id: "nbook.plot.reveal",
    version: 1,
    label: "揭示",
    attachTo: ["telling"],
    schema: {type: "object", properties: {point: {type: "string"}, mode: {enum: ["hint", "explicit"]}}, required: ["point", "mode"], additionalProperties: false},
    refs: [{path: "point", targets: ["知识点"]}],
};
/** 挂在剧情变更上，载荷里有一组线与一组节点，节点里引用另一条剧情变更。 */
const SCENE: MarkDeclaration = {
    id: "nbook.plot.scene",
    version: 1,
    label: "场景",
    attachTo: ["change"],
    schema: {
        type: "object",
        description: "注释类关键字照收",
        properties: {lines: {type: "array", items: {type: "string"}}, nodes: {type: "array", items: {type: "object", properties: {after: {type: "string"}}}}},
        additionalProperties: false,
    },
    refs: [{path: "lines[]", kind: "line"}, {path: "nodes[].after", kind: "change"}],
};
const plot = (declaration: MarkDeclaration) => ({plugin: "nbook.plot", declaration});

describe("canon.components 输出 17：标注种类的登记", () => {
    const rejected = (declaration: Record<string, unknown>) => buildMarkRegistry([plot({...REVEAL, ...declaration} as MarkDeclaration)]).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]);

    test("合规的声明登记，版本表按 id 排", () => {
        const registry = buildMarkRegistry([plot(SCENE), plot(REVEAL)]);
        expect(registry.diagnostics).toEqual([]);
        expect(registry.versions).toEqual([["nbook.plot.reveal", 1], ["nbook.plot.scene", 1]]);
    });

    test("前缀不是声明者的那条不登记，也不连累本来的那条；同一 id 声明两次的全部不登记", () => {
        const borrowed = buildMarkRegistry([plot(REVEAL), {plugin: "acme.other", declaration: REVEAL}]);
        expect(borrowed.byKind(REVEAL.id)?.version).toBe(1);
        expect(borrowed.diagnostics.map((diagnostic) => [diagnostic.plugin, diagnostic.path])).toEqual([["acme.other", "id"]]);
        const twice = buildMarkRegistry([plot(REVEAL), plot({...REVEAL, version: 2})]);
        expect(twice.byKind(REVEAL.id)).toBeUndefined();
        expect(twice.diagnostics).toHaveLength(2);
    });

    test("schema 只收白名单关键字；additionalProperties 只能是 false；不能声明 kind、version", () => {
        expect(rejected({schema: {type: "object", properties: {point: {type: "string", pattern: "^e"}}}})).toEqual([["mark-declaration-invalid", "schema.properties.point.pattern"]]);
        expect(rejected({schema: {type: "object", properties: {point: {type: "string"}}, additionalProperties: true}})).toEqual([["mark-declaration-invalid", "schema.additionalProperties"]]);
        expect(rejected({schema: {type: "object", properties: {kind: {type: "string"}, point: {type: "string"}}}})).toEqual([["mark-declaration-invalid", "schema.properties.kind"]]);
    });

    test("refs 的路径只经过 properties 与 items、指到字符串，同一路径一次；targets 只与 entry 同用；attachTo 非空", () => {
        expect(rejected({schema: {type: "object", properties: {point: {anyOf: [{type: "string"}, {type: "null"}]}}}})).toEqual([["mark-declaration-invalid", "refs[0].path"]]);
        expect(rejected({schema: {type: "object", properties: {point: {type: "number"}}}})).toEqual([["mark-declaration-invalid", "refs[0].path"]]);
        expect(rejected({refs: [{path: "point"}, {path: "point"}]})).toEqual([["mark-declaration-invalid", "refs[1].path"]]);
        expect(rejected({refs: [{path: "point", kind: "change", targets: ["知识点"]}]})).toEqual([["mark-declaration-invalid", "refs[0].targets"]]);
        expect(rejected({attachTo: []})).toEqual([["mark-declaration-invalid", "attachTo"]]);
    });
});

describe("canon.model 诊断的登记", () => {
    const LEAK: DiagnosticDeclaration = {id: "nbook.plot.leak", version: 1, level: "pending", label: "知情越界", key: ["objects", "telling"]};
    const codes = (declaration: Record<string, unknown>) => buildDiagnosticRegistry([{plugin: "nbook.plot", declaration: {...LEAK, ...declaration} as DiagnosticDeclaration}]).diagnostics.map((diagnostic) => diagnostic.path);

    test("前缀与重复按两步判；级别、稳定键的组成部分按表查", () => {
        const registry = buildDiagnosticRegistry([{plugin: "nbook.plot", declaration: LEAK}, {plugin: "acme.other", declaration: LEAK}]);
        expect(registry.byId(LEAK.id)).toMatchObject({plugin: "nbook.plot", key: ["objects", "telling"]});
        expect(registry.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.plugin])).toEqual([["diagnostic-declaration-invalid", "acme.other"]]);
        expect(buildDiagnosticRegistry([{plugin: "nbook.plot", declaration: LEAK}, {plugin: "nbook.plot", declaration: LEAK}]).byId(LEAK.id)).toBeUndefined();
        expect(codes({level: "error"})).toEqual(["level"]);
        expect(codes({key: []})).toEqual(["key"]);
        expect(codes({key: ["objects", "where"]})).toEqual(["key[1]"]);
    });
});

/* ---------- 写入（model.md 输出 28） ---------- */

function options(marks = buildMarkRegistry([plot(REVEAL), plot(SCENE)])): WorldOptions {
    return {
        order: new ChapterOrder(["ch1", "ch2"]),
        registry: buildRegistry([PERSON]),
        marks,
        reductions: () => undefined,
        chapterText: () => "她把钟拨慢了一刻。",
        digest: (text) => createHash("sha256").update(text).digest("hex"),
    };
}

let sequence = 0;
const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `mark-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "标注", baseVersion, puts});
const entry = (id: string, type: string, name: string): Entry => ({id, type, parent: null, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {}}});
const change = (told: TellingDraft[], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id: "tmp:c", kind: "written", text: "讲到", at: {kind: "chapter", chapter: "ch1", key: 0}, told, involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra});
const telling = (marks: TellingDraft["marks"]): TellingDraft => ({source: "chapter", chapter: "ch1", quote: "拨慢了一刻", marks});

function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
type Failed = {readonly ok: false; readonly failure: {readonly code: string; readonly problems?: readonly {readonly code: string; readonly path?: string; readonly reason?: string}[]}};
/** 校验不过的详情：`[码, 位置, 细分原因]`。世界与世界服务的写入结果都能传进来。 */
const problems = (result: {readonly ok: true} | Failed) => (!result.ok && result.failure.code === "validation-failed" ? (result.failure.problems ?? []).map((problem) => [problem.code, problem.path, problem.reason].filter((part) => part !== undefined)) : []);

/** 知识点 e1、人物 e2，版本 1。 */
function start(marks?: ReturnType<typeof buildMarkRegistry>): World {
    return ok(World.empty(options(marks)).publish(request([
        {ref: {kind: "entry", id: "tmp:k"}, after: entry("tmp:k", "知识点", "哥哥能回溯")},
        {ref: {kind: "entry", id: "tmp:p"}, after: entry("tmp:p", "人物", "星瑕")},
    ], 0), "t")).world;
}
const put = (draft: StoryChangeDraft) => [{ref: {kind: "change" as const, id: draft.id}, after: draft}];

describe("canon.model 输出 28：新加或改过的标注按登记校验", () => {
    test("种类不在、版本对不上、挂错对象、载荷不合 schema，各自拒收", () => {
        const world = start();
        expect(problems(world.publish(request(put(change([telling([{kind: "nbook.plot.nothing", version: 1}])])), 1), "t"))).toEqual([["mark-kind-unknown", "told[t1].marks[0]"]]);
        expect(problems(world.publish(request(put(change([telling([{kind: REVEAL.id, version: 2, point: "e1", mode: "hint"}])])), 1), "t"))).toEqual([["mark-version-unsupported", "told[t1].marks[0]"]]);
        expect(problems(world.publish(request(put(change([], {marks: [{kind: REVEAL.id, version: 1, point: "e1", mode: "hint"}]})), 1), "t"))).toEqual([["mark-invalid", "marks[0]"]]);
        expect(problems(world.publish(request(put(change([telling([{kind: REVEAL.id, version: 1, point: "e1"}])])), 1), "t"))).toEqual([["mark-invalid", "told[t1].marks[0]"]]);
    });

    test("载荷里的引用按声明的种类查：知识点的种类不对、剧情变更不存在、线不存在都是 ref-invalid；数组里的每一项都查", () => {
        const world = start();
        expect(problems(world.publish(request(put(change([telling([{kind: REVEAL.id, version: 1, point: "e2", mode: "hint"}])])), 1), "t"))).toEqual([["ref-invalid", "told[t1].marks[0].point", "ref-type-mismatch"]]);
        expect(problems(world.publish(request(put(change([], {marks: [{kind: SCENE.id, version: 1, lines: ["main", "fork-1"], nodes: [{after: "c99"}]}]})), 1), "t"))).toEqual([
            ["ref-invalid", "marks[0].lines[1]", "line-not-found"],
            ["ref-invalid", "marks[0].nodes[0].after", "change-missing"],
        ]);
        expect(ok(world.publish(request(put(change([], {marks: [{kind: SCENE.id, version: 1, lines: ["main"], nodes: [{}]}]})), 1), "t")).ok).toBe(true);
    });

    test("同一请求新建知识点并在揭示里引用它：临时 id 换成正式 id；还原新建它的修订牵连写揭示的修订", () => {
        const world = start();
        const created = ok(world.publish(request([
            {ref: {kind: "entry", id: "tmp:k2"}, after: entry("tmp:k2", "知识点", "钟是坏的")},
            ...put(change([telling([{kind: REVEAL.id, version: 1, point: "tmp:k2", mode: "explicit"}])])),
        ], 1), "t"));
        const point = created.ids["tmp:k2"]!;
        const stored = created.world.data.changes.get(created.ids["tmp:c"]!)!;
        expect(stored.told[0]!.marks).toEqual([{kind: REVEAL.id, version: 1, point, mode: "explicit"}]);
        const another = ok(created.world.publish(request([{ref: {kind: "entry", id: "tmp:k3"}, after: entry("tmp:k3", "知识点", "第三个")}], 2), "t"));
        const marked = ok(another.world.publish(request(put(change([telling([{kind: REVEAL.id, version: 1, point: another.ids["tmp:k3"]!, mode: "hint"}])])), 3), "t"));
        expect(marked.world.dependents(another.revision.id)).toEqual([another.revision.id, marked.revision.id]);
    });
});

/* ---------- 场景 6：插件停用与换版本（经世界服务） ---------- */

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-marks");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

async function open(texts: Map<string, string>): Promise<WorldService> {
    const ports: ServicePorts = {
        files: nodeFiles,
        lock: memoryLock(),
        logDir: join(root, ".nbook", "world", "log"),
        sideDir: join(root, ".nbook", "world"),
        cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
        chapterText: (chapter) => texts.get(chapter),
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => 0,
        now: () => new Date(0).toISOString(),
    };
    const service = await WorldService.open(ports, {chapters: ["ch1", "ch2"], registry: buildRegistry([PERSON]), marks: buildMarkRegistry([plot(REVEAL)])});
    if ("code" in service) throw new Error(service.code);
    services.push(service);
    return service;
}

describe("canon.components 验收场景 6：标注种类的版本", () => {
    test("缺字段的揭示拒收；停用后已存的照常读到、带 mark-kind-unknown，再加被拒收，改原句照常可以；以版本 2 回来后只读", async () => {
        const texts = new Map([["ch1", "她把钟拨慢了一刻。钟停了。"]]);
        const service = await open(texts);
        const publish = async (puts: WriteRequest["puts"]) => service.publish(request(puts, service.status().version));
        const point = await publish([{ref: {kind: "entry", id: "tmp:k"}, after: entry("tmp:k", "知识点", "钟是坏的")}]);
        if (!point.ok) throw new Error("no point");
        const k = point.ids["tmp:k"]!;

        expect(problems(await publish(put(change([telling([{kind: REVEAL.id, version: 1, point: k}])]))))).toEqual([["mark-invalid", "told[t1].marks[0]"]]);
        const written = await publish(put(change([telling([{kind: REVEAL.id, version: 1, point: k, mode: "hint"}])])));
        if (!written.ok) throw new Error(JSON.stringify(written.failure));
        const id = written.ids["tmp:c"]!;
        const before = service.status().inputDigest;

        await service.setRegistries({marks: buildMarkRegistry([])});
        expect(service.status().inputDigest).not.toBe(before);
        expect(service.object({kind: "change", id}).markHints).toEqual([{code: "mark-kind-unknown", path: "told[t1].marks[0]", kind: REVEAL.id}]);
        const [item] = (service.tellings({mark: REVEAL.id}) as {items: {telling: {marks?: unknown}; hints?: unknown}[]}).items;
        expect(item).toMatchObject({telling: {marks: [{kind: REVEAL.id, point: k, mode: "hint"}]}, hints: [{code: "mark-kind-unknown", mark: 0}]});

        const stored = () => service.object({kind: "change", id}).object as StoryChange;
        const withTold = (told: StoryChange["told"]) => [{ref: {kind: "change" as const, id}, after: {...stored(), told}}];
        const added = withTold([{...stored().told[0]!, marks: [...stored().told[0]!.marks!, {kind: REVEAL.id, version: 1, point: k, mode: "explicit"}]}]);
        expect(problems(await publish(added))).toEqual([["mark-kind-unknown", "told[t1].marks[1]"]]);
        expect((await publish(withTold([{...stored().told[0]!, quote: "钟停了"}]))).ok).toBe(true);

        await service.setRegistries({marks: buildMarkRegistry([plot({...REVEAL, version: 2})])});
        expect(service.object({kind: "change", id}).markHints).toEqual([{code: "mark-version-unsupported", path: "told[t1].marks[0]", kind: REVEAL.id}]);
        const edited = withTold([{...stored().told[0]!, marks: [{kind: REVEAL.id, version: 1, point: k, mode: "explicit"}]}]);
        expect(problems(await publish(edited))).toEqual([["mark-version-unsupported", "told[t1].marks[0]"]]);
    });
});
