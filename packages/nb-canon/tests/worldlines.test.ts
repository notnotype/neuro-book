import {createHash} from "node:crypto";
import {rm} from "node:fs/promises";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type Fork, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {affectedLines, touchedOf} from "../src/lines/affected";
import {lineTable} from "../src/lines/table";
import {editInPlace} from "../src/world/edits";
import {renderEntryForAgent} from "../src/render/entry";
import {createWorldReadView} from "../src/service/reads";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {openTestService} from "./fixtures/service";
import {PANEL, PERSON} from "./fixtures/world";

/** 回溯时随回溯者保留的字段（输出 7 的缺省）：回溯次数带过去，别的不带。 */
const ROLLBACK: ComponentDeclaration = {id: "test.rollback", label: "回溯", namespace: "rb", version: 1, fields: [{id: "次数", label: "次数", kind: "number", carry: true}, {id: "别的", label: "别的", kind: "number"}]};
const CHAPTERS = ["ch1", "ch2", "ch3", "ch4"];
function options(residentLines?: number): WorldOptions {
    return {order: new ChapterOrder(CHAPTERS), registry: buildRegistry([PANEL, PERSON, ROLLBACK]), reductions: () => undefined, chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex"), ...(residentLines === undefined ? {} : {residentLines})};
}
let sequence = 0;
const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `wl-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "世界线", baseVersion, puts});
function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
const problems = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.path, problem.reason ?? null]) : [JSON.stringify(result.ok ? "ok" : result.failure)]);
const person = (id: string, name: string): Entry => ({id, type: "人物", parent: null, folder: "人物", order: 0, init: {name, aliases: [], summary: "", text: [], data: {panel: {type: "canon.panel", version: 1, enabled: true, fields: {存款: 20000, 魔力上限: null, 魔力: null, 物品: []}}, rb: {type: "test.rollback", version: 1, enabled: true, fields: {次数: 1, 别的: 0}}}}});
const at = (chapter: string, key: number, line?: string) => ({kind: "chapter" as const, chapter, key, ...(line === undefined ? {} : {line})});
const written = (id: string, placement: StoryChangeDraft["at"], patches: Patch[] = [], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id, kind: "written", text: id, at: placement, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra});
const spend = (entry: string, value: number): Patch => ({op: "add", at: {entry, path: "panel.存款"}, value});

/** 主线：星瑕存款两万；第 2 章 c1、c2（同键、写得更晚的 c2b）、c3；第 3 章计划 p1（分叉之前写下）。 */
function base(residentLines?: number) {
    const opened = ok(World.empty(options(residentLines)).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}], 0), "t"));
    const xia = opened.ids["tmp:xia"]!;
    const story = ok(opened.world.publish(request([
        {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
        {ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [spend(xia, -5000)])},
        {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30))},
        {ref: {kind: "change", id: "tmp:p1"}, after: {...written("tmp:p1", at("ch3", 5)), kind: "plan"}},
    ], 1), "t"));
    const later = ok(story.world.publish(request([{ref: {kind: "change", id: "tmp:c2b"}, after: written("tmp:c2b", at("ch2", 20))}], 2), "t"));
    return {world: later.world, xia, c1: story.ids["tmp:c1"]!, c2: story.ids["tmp:c2"]!, c3: story.ids["tmp:c3"]!, p1: story.ids["tmp:p1"]!, c2b: later.ids["tmp:c2b"]!};
}

/** 在 `world` 上从主线 c2 分出一条分支，同一请求里在新线上记一条第 3 章的变更。 */
function forked(world: World, cut: string, extra: {kind?: "written" | "plan"; patches?: Patch[]} = {}) {
    const fork: StoryChangeDraft = {...written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut, type: "branch"}}), kind: extra.kind ?? "written"};
    return ok(world.publish(request([
        {ref: {kind: "change", id: "tmp:f"}, after: fork},
        {ref: {kind: "change", id: "tmp:own"}, after: {...written("tmp:own", at("ch3", 1, "tmp:l"), extra.patches ?? []), kind: extra.kind ?? "written"}},
    ], world.version), "t"));
}

describe("canon.worldlines 输出 1、2、3：线表与线视图的成员", () => {
    test("分叉与新线上的记录同一请求里写下：线 id 由程序发（l 前缀），记录的 at.line 跟着换；线在两种模式下都存在", () => {
        const {world, c2, xia} = base();
        const result = forked(world, c2, {patches: [spend(xia, -1000)]});
        const line = result.ids["tmp:l"]!;
        expect(line).toMatch(/^l\d+$/u);
        // 子线上的花钱不进主线：主线第 4 章末尾仍是两万减五千。
        const read = result.world.line().engine.entry(xia, {kind: "chapter", chapter: "ch4", edge: "end"}, "actual");
        expect(read !== null && read !== "chapter-not-found" && read.namespaces.panel!.fields.存款!.value).toBe(15000);
        expect(result.world.data.changes.get(result.ids["tmp:own"]!)!.at).toEqual(at("ch3", 1, line));
        expect(result.world.data.changes.get(result.ids["tmp:f"]!)!.fork!.line).toBe(line);
        const table = lineTable(result.world.data, result.world.options.order);
        expect(table.exists(line, "actual")).toBe(true);
        expect(table.lines.get(line)).toMatchObject({parent: "main", planned: false, unbuildable: null});
    });

    test("继承按安放的全序：不晚于切口的进子线，与切口同键、写得更晚的不进；分叉之前写下的计划进；子线自己的记录要键严格大于切口", () => {
        const {world, c1, c2, c3, p1, c2b} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const table = lineTable(result.world.data, result.world.options.order);
        expect([c1, c2, c2b, c3, p1, result.ids["tmp:own"]!].map((id) => table.visible(line, id))).toEqual([true, true, false, false, true, true]);
        // 主线看不到子线上的记录。
        expect(table.visible("main", result.ids["tmp:own"]!)).toBe(false);
        // 分叉之后在主线写下的计划不进子线。
        const after = ok(result.world.publish(request([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch3", 6)), kind: "plan"}}], result.world.version), "t"));
        expect(lineTable(after.world.data, after.world.options.order).visible(line, after.ids["tmp:p2"]!)).toBe(false);
    });

    test("计划分叉定义的线只在按计划模式下存在；分叉撤销以后线在两种模式下都不存在", () => {
        const {world, c2} = base();
        const planned = forked(world, c2, {kind: "plan"});
        const line = planned.ids["tmp:l"]!;
        const table = lineTable(planned.world.data, planned.world.options.order);
        expect([table.exists(line, "actual"), table.exists(line, "planned")]).toEqual([false, true]);
        const fork = planned.world.data.changes.get(planned.ids["tmp:f"]!)!;
        const undone = ok(planned.world.publish(request([{ref: {kind: "change", id: fork.id}, after: {...structuredClone(fork), status: "undone"}}], planned.world.version), "t"));
        const gone = lineTable(undone.world.data, undone.world.options.order);
        expect([gone.exists(line, "actual"), gone.exists(line, "planned")]).toEqual([false, false]);
    });

    test("切口所在章不在章序里：线存在但不可建，原因 cut-unplaced；子线什么都看不到（输出 18）", () => {
        const {world, c2} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const without = lineTable(result.world.data, new ChapterOrder(["ch1", "ch3", "ch4"]));
        expect(without.lines.get(line)?.unbuildable).toBe("cut-unplaced");
        expect(without.visible(line, result.ids["tmp:own"]!)).toBe(false);
    });
});

describe("canon.worldlines 失败与恢复、边界与兼容：写入时的线", () => {
    test("安放在不存在的线上：ref-invalid，原因 line-not-found；条目的出场带线：type-mismatch", () => {
        const {world, xia} = base();
        expect(problems(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1, "l404"))}], world.version), "t"))).toEqual([["ref-invalid", "at.line", "line-not-found"]]);
        const entry = world.data.entries.get(xia)!;
        expect(problems(world.publish(request([{ref: {kind: "entry", id: xia}, after: {...structuredClone(entry), appears: at("ch2", 1, "l1")}}], world.version), "t"))).toEqual([["type-mismatch", "appears.line", null]]);
    });

    test("写明主线的 line 与不写存下的完全相同（只有主线的作品日志逐字节不变）", () => {
        const {world} = base();
        const plain = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1))}], world.version), "t"));
        const named = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1, "main"))}], world.version), "t"));
        expect(JSON.stringify(named.revision.ops)).toBe(JSON.stringify(plain.revision.ops));
    });

    test("重放以后线 id 不复用：之后再分叉发的是新号", () => {
        const {world, c2, c3} = base();
        const first = forked(world, c2);
        const replayed = World.replay(first.world.revisions, first.world.options);
        const second = forked(replayed, c3);
        expect(second.ids["tmp:l"]).not.toBe(first.ids["tmp:l"]);
    });
});

describe("canon.worldlines 输出 7、14、18：分叉的校验与缺省带什么", () => {
    /** 在主线上写一条分叉（缺省：从 c2 分出的分支，安放在第 2 章键 40）。 */
    const attempt = (world: World, fork: Partial<Fork>, extra: Partial<StoryChangeDraft> = {}) => world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", ...extra, fork: {line: "tmp:l", name: "分支", parent: "main", cut: "", type: "branch", ...fork} as Fork})}], world.version), "t");
    const paths = (result: WriteResult) => problems(result).map(([code, path]) => `${String(code)}:${String(path)}`);

    test("父线、切口、触发处、往回多久、安放与结束点不合规定：invalid-fork 指出哪一项", () => {
        const {world, c1, c2, c3, p1} = base();
        expect(paths(attempt(world, {cut: c2}, {patches: [spend("e1", -1)]}))).toContain("invalid-fork:patches");
        expect(paths(attempt(world, {cut: c2, parent: "l404"}))).toEqual(expect.arrayContaining(["invalid-fork:fork.parent", "invalid-fork:at.line"]));
        expect(paths(attempt(world, {cut: p1}))).toContain("invalid-fork:fork.cut");
        expect(paths(attempt(world, {cut: c1, trigger: c2}))).toContain("invalid-fork:fork.trigger");
        expect(paths(attempt(world, {cut: c2, trigger: c1, type: "rollback"}))).toContain("invalid-fork:fork.trigger");
        expect(paths(attempt(world, {cut: c2, back: {min: 1, max: 1, unit: "day"}}))).toContain("invalid-fork:fork.back");
        expect(paths(attempt(world, {cut: c3}, {at: at("ch2", 25)}))).toContain("invalid-fork:at");
        expect(paths(attempt(world, {cut: c1, trigger: c3, type: "rollback"}, {at: at("ch2", 25)}))).toContain("invalid-fork:at");
        expect(paths(attempt(world, {cut: c2, end: "stop"}))).toContain("invalid-fork:fork.endAt");
        expect(paths(attempt(world, {cut: c2, carry: [{entry: "e1", path: "panel.物品[x]"}]}))).toContain("invalid-fork:fork.carry[0]");
        expect(paths(attempt(world, {cut: c2, carry: [{entry: "e1", path: "panel.没有"}]}))).toContain("invalid-fork:fork.carry[0]");
        expect(paths(world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork"})}], world.version), "t"))).toContain("invalid-fork:fork");
        expect(attempt(world, {cut: c2}).ok).toBe(true);
    });

    test("线 id 不能自己起：已有的报 line-taken，没有的报 invalid-fork", () => {
        const {world, c2, c3} = base();
        const first = forked(world, c2);
        const line = first.ids["tmp:l"]!;
        expect(paths(attempt(first.world, {cut: c3, line}, {at: at("ch2", 45)}))).toContain("line-taken:fork.line");
        expect(paths(attempt(first.world, {cut: c3, line: "l999"}, {at: at("ch2", 45)}))).toContain("invalid-fork:fork.line");
    });

    test("回溯没给 carry：按切口处 who 身上声明了 carry 的字段补上并存下；别的种类存空列表", () => {
        const {world, xia, c1, c3} = base();
        const rollback = ok(attempt(world, {cut: c1, trigger: c3, type: "rollback", who: xia}, {at: at("ch2", 35)}));
        expect(rollback.world.data.changes.get(rollback.ids["tmp:f"]!)!.fork!.carry).toEqual([{entry: xia, path: "rb.次数"}]);
        const branch = ok(attempt(world, {cut: c1, who: xia}, {at: at("ch2", 35)}));
        expect(branch.world.data.changes.get(branch.ids["tmp:f"]!)!.fork!.carry).toEqual([]);
    });

    test("让已有的线不可建的写入拒收：把切口改成未排章（输出 18）", () => {
        const {world, c2} = base();
        const result = forked(world, c2);
        const cut = result.world.data.changes.get(c2)!;
        expect(paths(result.world.publish(request([{ref: {kind: "change", id: c2}, after: {...structuredClone(cut), at: {kind: "unscheduled"}}}], result.world.version), "t"))).toContain("invalid-fork:fork");
    });
});

describe("canon.worldlines 输出 2、6、验收 1：线视图与带过去的值", () => {
    const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});
    const value = (world: World, line: string, entry: string, path: string, chapter: string) => {
        const read = world.line(line)?.engine.entry(entry, end(chapter), "actual");
        if (read === undefined || read === null || read === "chapter-not-found") return undefined;
        const [namespace, field] = path.split(".") as [string, string];
        return {value: read.namespaces[namespace]?.fields[field]?.value, incomplete: read.namespaces[namespace]?.fields[field]?.incomplete?.reason};
    };

    /** 回溯：切口 c1、触发处 c3；主线在 c3 用掉一次回溯（rb.次数 1 → 0）、c2 花掉五千；子线自己在第 3 章再花一千。 */
    function rollback() {
        const {world, xia, c1, c3} = base();
        const used = ok(world.publish(request([{ref: {kind: "change", id: c3}, after: {...structuredClone(world.data.changes.get(c3)!), patches: [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 0}]}}], world.version), "t"));
        const forked = ok(used.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: c1, trigger: c3, type: "rollback", who: xia} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"), [spend(xia, -1000)])},
        ], used.world.version), "t"));
        return {world: forked.world, xia, c1, line: forked.ids["tmp:r1"]!, fork: forked.ids["tmp:f"]!, own: forked.ids["tmp:own"]!};
    }

    test("回溯：子线回到切口的存款、带过去触发处的回溯次数，接着算自己的记录；主线照旧", () => {
        const {world, xia, line, fork} = rollback();
        expect(value(world, "main", xia, "panel.存款", "ch3")).toEqual({value: 15000, incomplete: undefined});
        expect(value(world, "main", xia, "rb.次数", "ch3")).toEqual({value: 0, incomplete: undefined});
        expect(value(world, line, xia, "panel.存款", "ch3")).toEqual({value: 19000, incomplete: undefined});
        expect(value(world, line, xia, "rb.次数", "ch3")).toEqual({value: 0, incomplete: undefined});
        // 子线看得到切口之前的共同过去：第 1 章末尾两条线一样。
        expect(value(world, line, xia, "panel.存款", "ch1")).toEqual(value(world, "main", xia, "panel.存款", "ch1"));
        // 带过去的那一步在来历里的身份是定义这条线的分叉。
        const steps = world.line(line)!.engine.origins({entry: xia, path: "rb.次数"}, end("ch3"), "actual");
        expect(steps !== "chapter-not-found" && steps.map((step) => (step.kind === "patch" ? `${step.change}:${String(step.result)}` : step.kind))).toEqual(["init", `${fork}:0`]);
    });

    test("父线上不完整的值带过去仍不完整，原因 carried-incomplete（输出 6）", () => {
        const {world, xia, c1, c3} = base();
        // 初值改成一千：c2 花五千套不上，存款从 c2 起不完整（改初值不拒收，进待处理）。
        const entry = world.data.entries.get(xia)!;
        const poorer = structuredClone(entry);
        poorer.init.data.panel!.fields.存款 = 1000;
        const broken = ok(world.publish(request([{ref: {kind: "entry", id: xia}, after: poorer}], world.version), "t"));
        const forked = ok(broken.world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: c1, trigger: c3, type: "rollback", carry: [{entry: xia, path: "panel.存款"}]} as Fork})}], broken.world.version), "t"));
        const line = forked.ids["tmp:r1"]!;
        expect(value(forked.world, "main", xia, "panel.存款", "ch3")?.incomplete).toBeDefined();
        expect(value(forked.world, line, xia, "panel.存款", "ch3")?.incomplete).toBe("carried-incomplete");
    });

    test("孙线的切口是子线自己的记录：子线带过去的值进孙线；孙线的切口与子线同一条：不进（全序比，DS 2）", () => {
        const {world, xia, c1, line, own} = rollback();
        const deeper = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:g1"}, after: written("tmp:g1", at("ch3", 5, line), [], {nature: "fork", fork: {line: "tmp:r2", name: "孙", parent: line, cut: own, type: "branch"} as Fork})},
        ], world.version), "t"));
        const r2 = deeper.ids["tmp:r2"]!;
        expect(value(deeper.world, r2, xia, "rb.次数", "ch4")).toEqual({value: 0, incomplete: undefined});
        expect(value(deeper.world, r2, xia, "panel.存款", "ch4")).toEqual({value: 19000, incomplete: undefined});
        expect(deeper.world.line(r2)!.synthetic.size).toBe(2);
        // 与子线同一个切口 c1：子线带过去的值排在切口之后，不进这条线。
        const sibling = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:g2"}, after: written("tmp:g2", at("ch3", 6, line), [], {nature: "fork", fork: {line: "tmp:r3", name: "同切口", parent: line, cut: c1, type: "branch"} as Fork})},
        ], world.version), "t"));
        const r3 = sibling.ids["tmp:r3"]!;
        expect(sibling.world.line(r3)!.synthetic.size).toBe(1);
        expect(value(sibling.world, r3, xia, "rb.次数", "ch4")).toEqual({value: 1, incomplete: undefined});
    });
});

describe("canon.worldlines 输出 4、验收 2：计划跨线", () => {
    test("分叉之前写下的计划进子线；子线兑现它只在子线上算已兑现；分叉之后在主线写的计划不进子线；取消计划看得到它的线都跟着变", () => {
        const {world, c2, p1} = base();
        const forkedWorld = forked(world, c2);
        const line = forkedWorld.ids["tmp:l"]!;
        const fulfilled = ok(forkedWorld.world.publish(request([{ref: {kind: "change", id: "tmp:fx"}, after: written("tmp:fx", at("ch3", 8, line), [], {links: [{kind: "fulfills", plan: p1}]})}], forkedWorld.world.version), "t"));
        const after = ok(fulfilled.world.publish(request([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch3", 9)), kind: "plan"}}], fulfilled.world.version), "t"));
        const end = {kind: "chapter" as const, chapter: "ch4", edge: "end" as const};
        const progress = (target: World, on: string, plan: string) => target.line(on)!.engine.progress(plan, end);
        expect([progress(after.world, "main", p1), progress(after.world, line, p1)]).toEqual(["unfulfilled", "fulfilled"]);
        expect(after.world.line(line)!.records.changes.has(after.ids["tmp:p2"]!)).toBe(false);
        const plan = after.world.data.changes.get(p1)!;
        const cancelled = ok(after.world.publish(request([{ref: {kind: "change", id: p1}, after: {...structuredClone(plan), status: "undone"}}], after.world.version), "t"));
        expect([progress(cancelled.world, "main", p1), progress(cancelled.world, line, p1)]).toEqual(["cancelled", "cancelled"]);
    });
});

describe("canon.worldlines 输出 1、6、project 方法表 lines：按线的读取视图", () => {
    test("快照里的视图 onLine 读到子线；来历里带过去的那一步是 carried；计划线在实际模式下 line-not-found；lines 给出线树", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "view");
        const service = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const {xia} = {xia: (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!};
            const story = await publish([
                {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
                {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30), [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 0}])},
            ]);
            const forks = await publish([
                {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: story["tmp:c1"]!, trigger: story["tmp:c3"]!, type: "rollback", who: xia} as Fork})},
                {ref: {kind: "change", id: "tmp:if"}, after: {...written("tmp:if", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:if1", name: "如果", parent: "main", cut: story["tmp:c1"]!, type: "if"} as Fork}), kind: "plan"}},
            ]);
            const [r1, if1] = [forks["tmp:r1"]!, forks["tmp:if1"]!];
            const view = service.snapshot().view;
            expect(view.lines().map((line) => [line.id, line.exists.actual, line.exists.planned])).toEqual([[r1, true, true], [if1, false, true]]);
            expect(view.onLine(if1)).toEqual({code: "line-not-found"});
            expect("code" in view.onLine(if1, "planned")).toBe(false);
            const child = view.onLine(r1);
            if ("code" in child) throw new Error(child.code);
            expect(child.line).toBe(r1);
            expect(view.onLine(r1)).toBe(child);
            // 服务的读取按位置的线（输出 12）：不存在的线 line-not-found。
            const onChild = service.entry(xia, {kind: "chapter", chapter: "ch3", edge: "end", line: r1}, "actual");
            expect(typeof onChild !== "string" && onChild.view?.namespaces.rb?.fields.次数?.value).toBe(0);
            expect(service.entry(xia, {kind: "chapter", chapter: "ch3", edge: "end", line: "l404"}, "actual")).toBe("line-not-found");
            expect(service.pending({position: {kind: "chapter", chapter: "ch3", edge: "end", line: "l404"}})).toBe("line-not-found");
            expect(typeof service.pending({position: {kind: "chapter", chapter: "ch3", edge: "end", line: r1}})).toBe("object");
            // 带令牌：令牌的线上读；位置写了别的线被拒（project 输出 24）；不存在的线开不了。
            const opened = service.openView({viewer: null, line: r1, until: {kind: "chapter", chapter: "ch3", edge: "end"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const viewed = service.viewed(opened.token);
            const bounded = viewed.entry(xia, undefined, "actual");
            expect(typeof bounded !== "string" && bounded.view?.namespaces.rb?.fields.次数?.value).toBe(0);
            expect(viewed.entry(xia, {kind: "chapter", chapter: "ch3", edge: "end", line: "main"}, "actual")).toBe("view-denied");
            expect(service.openView({viewer: null, line: "l404", until: {kind: "chapter", chapter: "ch3", edge: "end"}, purpose: "writer"})).toEqual({code: "line-not-found"});
            const steps = child.origins({entry: xia, path: "rb.次数"}, {kind: "chapter", chapter: "ch3", edge: "end"}, "actual");
            expect(steps !== "chapter-not-found" && steps.at(-1)).toMatchObject({kind: "carried", fork: forks["tmp:f"], line: "main", change: story["tmp:c3"], value: 0});
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.worldlines 失败与恢复、验收 3：写入时的线规则", () => {
    test("子线上安放在切口之前或就在切口上：line-out-of-bounds；兑现子线看不到的计划：plan-not-visible；计划线上记已写的：line-planned", () => {
        const {world, c2, p1} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const write = (target: World, draft: StoryChangeDraft) => target.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: draft}], target.version), "t");
        const codes = (outcome: WriteResult) => problems(outcome).map(([code]) => code);
        expect(codes(write(result.world, written("tmp:x", at("ch2", 20, line))))).toContain("line-out-of-bounds");
        expect(codes(write(result.world, written("tmp:x", at("ch2", 5, line))))).toContain("line-out-of-bounds");
        expect(write(result.world, written("tmp:x", at("ch2", 21, line))).ok).toBe(true);
        // 分叉之后在主线写的计划，子线看不到：兑现它拒收。
        const later = ok(result.world.publish(request([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch3", 9)), kind: "plan"}}], result.world.version), "t"));
        expect(codes(write(later.world, written("tmp:x", at("ch3", 10, line), [], {links: [{kind: "fulfills", plan: later.ids["tmp:p2"]!}]})))).toContain("plan-not-visible");
        expect(write(later.world, written("tmp:x", at("ch3", 10, line), [], {links: [{kind: "fulfills", plan: p1}]})).ok).toBe(true);
        const planned = forked(world, c2, {kind: "plan"});
        const plannedLine = planned.ids["tmp:l"]!;
        expect(codes(write(planned.world, written("tmp:x", at("ch3", 2, plannedLine))))).toContain("line-planned");
        expect(write(planned.world, {...written("tmp:x", at("ch3", 2, plannedLine)), kind: "plan"}).ok).toBe(true);
    });
});

describe("canon.worldlines 输出 1、3、model 输出 16：线的待处理", () => {
    const kinds = (target: World, line: string) => {
        const items = target.pending({kind: "chapter", chapter: "ch4", edge: "end", line});
        return typeof items === "string" ? [items] : items.filter((item) => item.kind.startsWith("line-")).map((item) => `${item.kind}:${"ref" in item ? item.ref.id : ""}`);
    };

    test("切口挪到子线记录之后：那条记录越界、只在它所在的线上列；撤销分叉：线上的记录成“线不存在”，在主线上也列", () => {
        const {world, c2} = base();
        const result = forked(world, c2);
        const [line, own] = [result.ids["tmp:l"]!, result.ids["tmp:own"]!];
        const cut = result.world.data.changes.get(c2)!;
        const moved = ok(result.world.publish(request([{ref: {kind: "change", id: c2}, after: {...structuredClone(cut), at: at("ch3", 5)}}], result.world.version), "t"));
        expect(kinds(moved.world, line)).toEqual([`line-out-of-bounds:${own}`]);
        expect(kinds(moved.world, "main")).toEqual([]);
        const fork = result.world.data.changes.get(result.ids["tmp:f"]!)!;
        const undone = ok(result.world.publish(request([{ref: {kind: "change", id: fork.id}, after: {...structuredClone(fork), status: "undone"}}], result.world.version), "t"));
        expect(kinds(undone.world, "main")).toEqual([`line-missing:${own}`]);
    });
});

describe("canon.worldlines 输出 17、revisions 输出 4：受影响的线与 brokenOn", () => {
    const end = (line: string) => ({kind: "chapter" as const, chapter: "ch4", edge: "end" as const, line});
    /** 改前、改后两份世界之间，这次写入影响到的线。 */
    const affected = (before: World, result: Extract<WriteResult, {ok: true}>) => [...affectedLines({data: before.data, order: before.options.order}, {data: result.world.data, order: result.world.options.order}, touchedOf(result.revision.ops, false))].sort();
    const editText = (world: World, id: string, text: string) => {
        const value = structuredClone(world.data.changes.get(id)!);
        return ok(world.publish(request([{ref: {kind: "change", id}, after: {...value, text}}], world.version), "t"));
    };

    test("改条目的初值让子线上的记录套不上：记在 brokenOn 与线上的待处理里，主线的 broken 不含它；重放以后根因不变", () => {
        const {world, xia, c2} = base();
        const result = forked(world, c2, {patches: [spend(xia, -14000)]});
        const [line, own] = [result.ids["tmp:l"]!, result.ids["tmp:own"]!];
        const entry = structuredClone(result.world.data.entries.get(xia)!);
        entry.init.data.panel!.fields.存款 = 10000;
        const edit = ok(result.world.publish(request([{ref: {kind: "entry", id: xia}, after: entry}], result.world.version), "t"));
        expect(edit.revision.impact.broken).toEqual([]);
        expect(edit.revision.impact.brokenOn).toEqual([{line, change: own}]);
        const root = {kind: "cannot-apply" as const, root: edit.revision.id, changes: [own]};
        expect(edit.world.pending(end(line))).toContainEqual(root);
        expect(World.replay(edit.world.revisions, options()).pending(end(line))).toContainEqual(root);
    });

    test("改主线上在依赖范围里的记录：继承来的与子线自己的记录都可能套不上，各记在这条线上", () => {
        const {world, xia, c1, c2, c3, c2b} = base();
        const result = forked(world, c2, {patches: [spend(xia, -14000)]});
        const [line, own] = [result.ids["tmp:l"]!, result.ids["tmp:own"]!];
        const edit = ok(result.world.publish(request([{ref: {kind: "change", id: c1}, after: {...structuredClone(result.world.data.changes.get(c1)!), patches: [spend(xia, -16000)]}}], result.world.version), "t"));
        expect(edit.revision.impact.broken).toContain(c2);
        expect(edit.revision.impact.brokenOn?.map((item) => item.line)).toEqual(Array(edit.revision.impact.brokenOn?.length).fill(line));
        expect(edit.revision.impact.brokenOn?.map((item) => item.change).sort()).toEqual([c2, own].sort());
        // 范围之外的（切口之后写下的 c3、同键写得更晚的 c2b）不影响子线。
        expect(affected(result.world, editText(result.world, c3, "改"))).toEqual([]);
        expect(affected(result.world, editText(result.world, c2b, "改"))).toEqual([]);
        expect(affected(result.world, editText(result.world, c2, "改"))).toEqual([line]);
    });

    test("只改计划、只改别的线、孙线的范围到父线自己的切口为止；条目初值与章序影响所有线", () => {
        const {world, xia, c1, c2, p1, c2b} = base();
        const result = forked(world, c2, {patches: [spend(xia, -1000)]});
        const [line, own] = [result.ids["tmp:l"]!, result.ids["tmp:own"]!];
        // 孙线：切口是子线自己的记录 own。
        const grand = ok(result.world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: written("tmp:g", at("ch3", 50, line), [], {nature: "fork", fork: {line: "tmp:gl", name: "孙线", parent: line, cut: own, type: "branch"}})}], result.world.version), "t"));
        const grandLine = grand.ids["tmp:gl"]!;
        const [{world: w}] = [grand];
        expect(affected(w, editText(w, p1, "改"))).toEqual([]);
        expect(affected(w, editText(w, c1, "改"))).toEqual([line, grandLine].sort());
        // c2b 晚于切口，子线与孙线都读不到。
        expect(affected(w, editText(w, c2b, "改"))).toEqual([]);
        expect(affected(w, editText(w, own, "改"))).toEqual([line, grandLine].sort());
        // 分叉记录写在子线上、晚于孙线的切口：孙线读不到它，只有它所在的子线受影响。
        expect(affected(w, editText(w, grand.ids["tmp:g"]!, "改"))).toEqual([line]);
        // 另一条兄弟线上的记录不影响这条。
        const sibling = ok(w.publish(request([
            {ref: {kind: "change", id: "tmp:s"}, after: written("tmp:s", at("ch2", 41), [], {nature: "fork", fork: {line: "tmp:sl", name: "兄弟", parent: "main", cut: c1, type: "branch"}})},
            {ref: {kind: "change", id: "tmp:sown"}, after: written("tmp:sown", at("ch3", 2, "tmp:sl"))},
        ], w.version), "t"));
        const [sl, sown] = [sibling.ids["tmp:sl"]!, sibling.ids["tmp:sown"]!];
        expect(affected(sibling.world, editText(sibling.world, sown, "改"))).toEqual([sl]);
        expect(affected(sibling.world, editText(sibling.world, own, "改"))).toEqual([line, grandLine].sort());
        // 条目的初值：每条线都受影响；改章序同理。
        const entry = structuredClone(w.data.entries.get(xia)!);
        entry.init.summary = "改";
        const edited = ok(w.publish(request([{ref: {kind: "entry", id: xia}, after: entry}], w.version), "t"));
        expect(affected(w, edited)).toEqual([line, grandLine].sort());
        const renamed = ok(w.publish(request([{ref: {kind: "entry", id: xia}, after: {...structuredClone(w.data.entries.get(xia)!), folder: "别处"}}], w.version), "t"));
        expect(affected(w, renamed)).toEqual([]);
    });

    test("带过去的值读到触发处：触发处之前、切口之后的主线记录，对子线和切口是子线自己记录的孙线都有影响", () => {
        const {world, xia, c1, c2, c3} = base();
        const forkedLine = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: c1, trigger: c3, type: "rollback", who: xia} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"))},
        ], world.version), "t"));
        const [line, own] = [forkedLine.ids["tmp:r1"]!, forkedLine.ids["tmp:own"]!];
        const grand = ok(forkedLine.world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: written("tmp:g", at("ch3", 50, line), [], {nature: "fork", fork: {line: "tmp:gl", name: "孙线", parent: line, cut: own, type: "branch"}})}], forkedLine.world.version), "t"));
        const grandLine = grand.ids["tmp:gl"]!;
        expect(affected(grand.world, editText(grand.world, c2, "改"))).toEqual([line, grandLine].sort());
    });
});

describe("canon.worldlines 输出 11、验收 7、8：跨线的还原依赖", () => {
    const meta = (title: string) => ({requestId: `rv-${String(++sequence)}`, by: {kind: "author" as const}, title});

    test("还原新建线的分叉：线上以后的修订与后代线上的修订都是依赖；连同还原以后线不存在", () => {
        const {world, c2} = base();
        const created = forked(world, c2);
        const [line, fork] = [created.ids["tmp:l"]!, created.revision.id];
        const second = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:s"}, after: written("tmp:s", at("ch3", 5, line))}], created.world.version), "t"));
        const third = ok(second.world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: written("tmp:g", at("ch3", 50, line), [], {nature: "fork", fork: {line: "tmp:gl", name: "孙线", parent: line, cut: created.ids["tmp:own"]!, type: "branch"}})}], second.world.version), "t"));
        const grandLine = third.ids["tmp:gl"]!;
        const onGrand = ok(third.world.publish(request([{ref: {kind: "change", id: "tmp:h"}, after: written("tmp:h", at("ch4", 1, grandLine))}], third.world.version), "t"));
        // 主线上不碰这条线的修订不是依赖。
        const unrelated = ok(onGrand.world.publish(request([{ref: {kind: "change", id: "tmp:m"}, after: written("tmp:m", at("ch4", 2))}], onGrand.world.version), "t"));
        const refused = unrelated.world.revert(fork, false, meta("还原分叉"), "t");
        expect(refused).toMatchObject({ok: false, failure: {code: "has-dependents", dependents: [onGrand.revision.id, third.revision.id, second.revision.id]}});
        const reverted = ok(unrelated.world.revert(fork, true, meta("还原分叉"), "t") as WriteResult);
        expect(reverted.world.line(line)).toBeUndefined();
        expect(reverted.world.line(grandLine)).toBeUndefined();
        expect(reverted.world.pending({kind: "chapter", chapter: "ch4", edge: "end", line})).toBe("line-not-found");
        expect(reverted.world.data.changes.has(unrelated.ids["tmp:m"]!)).toBe(true);
    });

    test("撤销父线上被子线继承的一件事：还原有依赖；改成撤销时预览列出子线上套不上的，发布后根因是这次撤销，子线上其余的照常", () => {
        const {world, xia, c2} = base();
        const umbrella = ok(world.publish(request([{ref: {kind: "change", id: "tmp:u"}, after: written("tmp:u", at("ch2", 15), [{op: "listAdd", at: {entry: xia, path: "panel.物品"}, value: {id: "伞", label: "伞", 数量: 1}}])}], world.version), "t"));
        const created = forked(umbrella.world, c2);
        const line = created.ids["tmp:l"]!;
        const broken = ok(created.world.publish(request([
            {ref: {kind: "change", id: "tmp:wind"}, after: written("tmp:wind", at("ch3", 10, line), [{op: "listRemove", at: {entry: xia, path: "panel.物品"}, value: "伞"}])},
            {ref: {kind: "change", id: "tmp:fine"}, after: written("tmp:fine", at("ch3", 11, line))},
        ], created.world.version), "t"));
        const refused = broken.world.revert(umbrella.revision.id, false, meta("还原记账"), "t");
        expect(refused).toMatchObject({ok: false, failure: {code: "has-dependents", dependents: [broken.revision.id]}});
        const wind = broken.ids["tmp:wind"]!;
        const undone = structuredClone(broken.world.data.changes.get(umbrella.ids["tmp:u"]!)!);
        const undo = request([{ref: {kind: "change", id: undone.id}, after: {...undone, status: "undone" as const}}], broken.world.version);
        expect(broken.world.preview(undo, "t")).toMatchObject({ok: true, revision: {impact: {brokenOn: [{line, change: wind}]}}});
        const result = ok(broken.world.publish(undo, "t"));
        expect(result.revision.impact.brokenOn).toEqual([{line, change: wind}]);
        expect(result.world.pending({kind: "chapter", chapter: "ch4", edge: "end", line})).toContainEqual({kind: "cannot-apply", root: result.revision.id, changes: [wind]});
    });
});

describe("canon.worldlines 输出 19、revisions 输出 8：子线上的就地改", () => {
    const end = (chapter: string, line: string) => ({kind: "chapter" as const, chapter, edge: "end" as const, line});
    const valueOf = (world: World, line: string, entry: string, path: string, chapter: string) => {
        const read = world.line(line)!.engine.entry(entry, end(chapter, line), "actual");
        if (read === null || read === "chapter-not-found") throw new Error("not found");
        const [namespace, field] = path.split(".") as [string, string];
        return read.namespaces[namespace]!.fields[field]!.value;
    };

    test("剧情变化就地改：新建的变更安放在读取位置的线上，键晚于切口；这条线的值变了，主线不变；末尾落在本线视图里所有记录之后、切口所在的章落在切口之后", () => {
        const {world, xia, c2} = base();
        const created = forked(world, c2, {patches: [spend(xia, -1000)]});
        const line = created.ids["tmp:l"]!;
        const edit = (position: ReturnType<typeof end>, value: number, read: number, version: number) =>
            editInPlace(created.world, {requestId: `ed-${String(++sequence)}`, by: {kind: "author"}, position, at: {entry: xia, path: "panel.存款"}, value, read: {value: read, version}, intent: "story"}, "t");
        const result = edit(end("ch3", line), 13000, 14000, created.world.version);
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        const record = [...result.world.data.changes.values()].find((change) => change.text === "就地改")!;
        // 末尾在本线视图里所有记录之后：含继承来的计划（ch3 键 5）。
        expect(record.at).toEqual({kind: "chapter", chapter: "ch3", key: 6, line});
        expect(valueOf(result.world, line, xia, "panel.存款", "ch4")).toBe(13000);
        expect(valueOf(result.world, "main", xia, "panel.存款", "ch4")).toBe(15000);
        // 切口所在的章：键落在切口之后（ch2 键 20），不与继承来的同章记录混。
        const inCut = edit(end("ch2", line), 14500, 15000, created.world.version);
        if (!inCut.ok) throw new Error(JSON.stringify(inCut.failure));
        expect([...inCut.world.data.changes.values()].find((change) => change.text === "就地改")!.at).toEqual({kind: "chapter", chapter: "ch2", key: 21, line});
        // 线不存在：line-not-found。
        expect(edit(end("ch3", "l404"), 1, 1, created.world.version)).toEqual({ok: false, failure: {code: "line-not-found"}});
    });

    test("创作修改改带过去的值：拒收 carried-value；记一条剧情变化照常", () => {
        const {world, xia, c1, c3} = base();
        const used = ok(world.publish(request([{ref: {kind: "change", id: c3}, after: {...structuredClone(world.data.changes.get(c3)!), patches: [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 0}]}}], world.version), "t"));
        const forkedLine = ok(used.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: c1, trigger: c3, type: "rollback", who: xia} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"))},
        ], used.world.version), "t"));
        const line = forkedLine.ids["tmp:r1"]!;
        const input = {requestId: "", by: {kind: "author" as const}, position: end("ch3", line), at: {entry: xia, path: "rb.次数"}, value: 1, read: {value: 0, version: forkedLine.world.version}};
        const refused = editInPlace(forkedLine.world, {...input, requestId: `ed-${String(++sequence)}`}, "t");
        expect(refused.ok === false && refused.failure).toMatchObject({code: "validation-failed", problems: [{code: "carried-value"}]});
        const story = editInPlace(forkedLine.world, {...input, requestId: `ed-${String(++sequence)}`, intent: "story"}, "t");
        if (!story.ok) throw new Error(JSON.stringify(story.failure));
        expect(valueOf(story.world, line, xia, "rb.次数", "ch4")).toBe(1);
    });
});

describe("canon.worldlines 输出 8、9、验收 4、5：写入以后与从头建一致，常驻与淘汰", () => {
    /** 一个世界上各条线的读取结果（两种模式、每章开头与末尾、待处理、每条记录套没套上），与从头重放出的世界逐条线比。 */
    function snapshot(world: World, lines: readonly string[]): string[] {
        return lines.map((line) => {
            const view = world.line(line);
            if (view === undefined) return "absent";
            const out: unknown[] = [];
            for (const entry of world.data.entries.keys()) {
                for (const chapter of CHAPTERS) {
                    for (const edge of ["start", "end"] as const) {
                        for (const mode of ["actual", "planned"] as const) out.push(view.engine.entry(entry, {kind: "chapter", chapter, edge, line}, mode));
                    }
                }
            }
            out.push(view.engine.pending({kind: "chapter", chapter: "ch4", edge: "end", line}));
            for (const id of [...view.records.changes.keys()].sort()) out.push([id, view.engine.outcome(id)]);
            return JSON.stringify(out);
        });
    }
    const matchesReplay = (world: World, lines: readonly string[]) => expect(snapshot(world, lines)).toEqual(snapshot(World.replay(world.revisions, world.options), lines));
    const updated = (world: World) => world.lines.updates.map((update) => `${update.line}:${update.reasons.join("+")}`);

    /** 主线 c1（ch2 键 10）、c2（20）、c3（30）；r1 从 c1 分出，自己 own1（ch3 键 1）；r2 从 r1 在 own1 处分出，自己 own2（ch3 键 20）。读过 r1、r2。 */
    function tree(residentLines?: number) {
        const {world, xia, c1, c2, c3} = base(residentLines);
        const first = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:f1"}, after: written("tmp:f1", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "一", parent: "main", cut: c1, type: "branch"}})},
            {ref: {kind: "change", id: "tmp:own1"}, after: written("tmp:own1", at("ch3", 1, "tmp:r1"), [spend(xia, -1000)])},
        ], world.version), "t"));
        const r1 = first.ids["tmp:r1"]!;
        const second = ok(first.world.publish(request([
            {ref: {kind: "change", id: "tmp:f2"}, after: written("tmp:f2", at("ch3", 10, r1), [], {nature: "fork", fork: {line: "tmp:r2", name: "二", parent: r1, cut: first.ids["tmp:own1"]!, type: "branch"}})},
            {ref: {kind: "change", id: "tmp:own2"}, after: written("tmp:own2", at("ch3", 20, "tmp:r2"), [spend(xia, -2000)])},
        ], first.world.version), "t"));
        const r2 = second.ids["tmp:r2"]!;
        for (const line of [r1, r2]) second.world.line(line);
        return {world: second.world, xia, c1, c2, c3, r1, r2, own1: first.ids["tmp:own1"]!, own2: second.ids["tmp:own2"]!, fork1: first.ids["tmp:f1"]!};
    }
    const patch = (world: World, id: string, patches: Patch[]) => ok(world.publish(request([{ref: {kind: "change", id}, after: {...structuredClone(world.data.changes.get(id)!), patches}}], world.version), "t"));

    test("改的记录没落进子线的视图、也没改带过去的值：子线不更新，沿用同一个引擎；只改子线自己的记录：只更新它与看得到它的后代", () => {
        const {world, xia, c2, r1, r2, own2} = tree();
        const lines = ["main", r1, r2];
        // c2 在切口之后，r1、r2 看不到。
        const main = patch(world, c2, [spend(xia, -4000)]);
        expect(updated(main.world)).toEqual([]);
        expect(main.world.line(r1)!.engine).toBe(world.line(r1)!.engine);
        expect(main.world.line(r2)!.engine).toBe(world.line(r2)!.engine);
        matchesReplay(main.world, lines);
        // 只改 r2 上的一条记录。
        const own = patch(main.world, own2, [spend(xia, -2500)]);
        expect(updated(own.world)).toEqual([`${r2}:records`]);
        expect(own.world.line(r1)!.engine).toBe(main.world.line(r1)!.engine);
        matchesReplay(own.world, lines);
        // 改到 r1 与 r2 都继承的记录（c1 是 r1 的切口，两条都看得到）：两条都更新。
        const shared = patch(own.world, world.line(r1)!.records.changes.keys().next().value!, [spend(xia, -100)]);
        expect(updated(shared.world)).toEqual([`${r1}:records`, `${r2}:records`]);
        matchesReplay(shared.world, lines);
    });

    test("条目的初值、分叉改名、挪切口、调章序：各自的原因；改名不重建；定义变了与章序变了的丢掉重建，结果与重放相同", () => {
        const {world, xia, c1, r1, r2, fork1} = tree();
        const lines = ["main", r1, r2];
        const entry = structuredClone(world.data.entries.get(xia)!);
        entry.init.summary = "改";
        const edited = ok(world.publish(request([{ref: {kind: "entry", id: xia}, after: entry}], world.version), "t"));
        expect(updated(edited.world)).toEqual([`${r1}:entries`, `${r2}:entries`]);
        matchesReplay(edited.world, lines);
        // 改分叉的名字：线表变、视图不重建。
        const fork = structuredClone(edited.world.data.changes.get(fork1)!);
        const renamed = ok(edited.world.publish(request([{ref: {kind: "change", id: fork1}, after: {...fork, fork: {...fork.fork!, name: "新名字"}}}], edited.world.version), "t"));
        expect(updated(renamed.world)).toEqual([]);
        expect(renamed.world.line(r1)!.engine).toBe(edited.world.line(r1)!.engine);
        expect(renamed.world.line(r2)!.engine).toBe(edited.world.line(r2)!.engine);
        matchesReplay(renamed.world, lines);
        // 挪切口 c1 到 c2 之后同一章靠后的位置：r1、r2 的定义变了，丢掉；算“让哪些记录套不上”要它们改后的结果，所以当场从头建。
        const cut = structuredClone(renamed.world.data.changes.get(c1)!);
        const moved = ok(renamed.world.publish(request([{ref: {kind: "change", id: c1}, after: {...cut, at: at("ch2", 25)}}], renamed.world.version), "t"));
        expect(updated(moved.world).sort()).toEqual([`${r1}:structural+built`, `${r2}:structural+built`]);
        matchesReplay(moved.world, lines);
        // 章序调整：全部丢掉。
        const reordered = moved.world.reorder(new ChapterOrder(["ch1", "ch2", "ch4", "ch3"]), "t", "ro-1");
        if (reordered === null || !reordered.ok) throw new Error("reorder");
        matchesReplay(reordered.world, lines);
    });

    test("子线上的核对点改了：只更新这条线与看得到它的后代，结果与重放相同", () => {
        const {world, xia, r1, r2} = tree();
        const check = {id: "tmp:k", at: {entry: xia, path: "panel.存款"}, value: 18000, told: {source: "note" as const}, place: {kind: "chapter" as const, chapter: "ch3", key: 30, line: r1}};
        const added = ok(world.publish(request([{ref: {kind: "check", id: "tmp:k"}, after: check}], world.version), "t"));
        expect(updated(added.world)).toEqual([`${r1}:records`]);
        expect(added.world.line(r2)!.engine).toBe(world.line(r2)!.engine);
        matchesReplay(added.world, ["main", r1, r2]);
        const id = added.ids["tmp:k"]!;
        const edited = ok(added.world.publish(request([{ref: {kind: "check", id}, after: {...structuredClone(added.world.data.checks.get(id)!), value: 17000}}], added.world.version), "t"));
        expect(updated(edited.world)).toEqual([`${r1}:records`]);
        matchesReplay(edited.world, ["main", r1, r2]);
    });

    test("带过去的值变了而没有记录进视图：只因 carry 更新", () => {
        const {world, xia, c1, c3} = base();
        const used = ok(world.publish(request([{ref: {kind: "change", id: c3}, after: {...structuredClone(world.data.changes.get(c3)!), patches: [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 0}]}}], world.version), "t"));
        const created = ok(used.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: c1, trigger: c3, type: "rollback", who: xia} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"))},
        ], used.world.version), "t"));
        const line = created.ids["tmp:r1"]!;
        created.world.line(line);
        const next = patch(created.world, c3, [{op: "set", at: {entry: xia, path: "rb.次数"}, value: 5}]);
        // c3 在切口之后、触发处上：不在 r1 的记录里，但它带过去的值变了。
        expect(updated(next.world)).toEqual([`${line}:carry`]);
        matchesReplay(next.world, ["main", line]);
        const read = next.world.line(line)!.engine.entry(xia, {kind: "chapter", chapter: "ch4", edge: "end", line}, "actual");
        expect(read !== null && read !== "chapter-not-found" && read.namespaces.rb!.fields.次数!.value).toBe(5);
    });

    test("常驻与淘汰：最近使用最早的先淘汰，再读时与淘汰前逐字相同；当前线与它的祖先线常驻；祖先线随后代一起读到、一起淘汰", () => {
        const {world, c1} = base(2);
        // 五条从主线分出的线。
        const forks = [1, 2, 3, 4, 5].map((n) => ({ref: {kind: "change" as const, id: `tmp:f${String(n)}`}, after: written(`tmp:f${String(n)}`, at("ch2", 40 + n), [], {nature: "fork", fork: {line: `tmp:l${String(n)}`, name: `线${String(n)}`, parent: "main", cut: c1, type: "branch"}})}));
        const created = ok(world.publish(request(forks, world.version), "t"));
        const lines = [1, 2, 3, 4, 5].map((n) => created.ids[`tmp:l${String(n)}`]!);
        const full = created.world;
        const before = snapshot(full, lines);
        const built = () => full.lines.builtLines.map((item) => item.line);
        for (const line of lines.slice(0, 3)) full.line(line);
        expect(built()).toEqual(lines.slice(1, 3));
        full.line(lines[3]!);
        expect(built()).toEqual([lines[2]!, lines[3]!]);
        // 当前线常驻，不占名额。
        full.lines.setCurrent(lines[2]!);
        full.line(lines[4]!);
        expect(built()).toEqual([lines[2]!, lines[3]!, lines[4]!].sort());
        expect(full.lines.builtLines.find((item) => item.line === lines[2])).toMatchObject({resident: true});
        expect(snapshot(full, lines)).toEqual(before);
    });
});

describe("canon.worldlines 输出 6、canon.time 输出 6：线上的时间与回溯到的那一刻", () => {
    const basis = {kind: "author" as const};
    const after = (of: string, days: number) => ({kind: "after" as const, of, gap: {min: days, max: days, unit: "day" as const}, basis});
    /** 主线：c2 在 c1 之后一天，c3 在 c2 之后两天（全书只有相对的说法）。c1 是切口，c3 是触发处。 */
    function timed(extra: Partial<StoryChangeDraft> = {}) {
        const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}], 0), "t"));
        const xia = opened.ids["tmp:xia"]!;
        const first = ok(opened.world.publish(request([{ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))}], 1), "t"));
        const c1 = first.ids["tmp:c1"]!;
        const second = ok(first.world.publish(request([{ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [], {when: [after(c1, 1)]})}], 2), "t"));
        const c2 = second.ids["tmp:c2"]!;
        const third = ok(second.world.publish(request([{ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30), [], {when: [after(c2, 2)], ...extra})}], 3), "t"));
        return {world: third.world, xia, c1, c2, c3: third.ids["tmp:c3"]!};
    }
    const rollbackOn = (world: World, xia: string, cut: string, trigger: string, back: Fork["back"], own: StoryChangeDraft["when"] = []) => ok(world.publish(request([
        {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r", name: "回溯", parent: "main", cut, trigger, ...(back === undefined ? {} : {back}), type: "rollback", who: xia} as Fork})},
        {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r"), [], {when: own})},
    ], world.version), "t"));
    const items = (world: World, line: string) => world.time("actual", line).items.map((item) => `${item.kind}${"reason" in item ? `:${item.reason}` : ""}`);

    test("子线自己的事件不早于回溯到的那一刻：往回半天，子线上第一件事定在触发处减半天之前就打架；晚于它不打架；主线不受影响", () => {
        const {world, xia, c1, c3} = timed();
        // 触发处比切口晚三天，往回十二小时：R 在切口之后两天半。
        const back = {min: 12, max: 12, unit: "hour" as const};
        const early = rollbackOn(world, xia, c1, c3, back, [after(c1, 1)]);
        const line = early.ids["tmp:r"]!;
        expect(items(early.world, line)).toEqual(["time-conflict"]);
        expect(items(early.world, "main")).toEqual([]);
        const late = rollbackOn(world, xia, c1, c3, back, [after(c1, 3)]);
        expect(items(late.world, late.ids["tmp:r"]!)).toEqual([]);
        // 往回多久是一段范围（六到十八小时）：R 在切口之后两天又六小时到两天又十八小时之间，第六十小时（两天半）的事件可以不早于它。
        const ranged = rollbackOn(world, xia, c1, c3, {min: 6, max: 18, unit: "hour"}, [{kind: "after", of: c1, gap: {min: 60, max: 60, unit: "hour"}, basis}]);
        expect(items(ranged.world, ranged.ids["tmp:r"]!)).toEqual([]);
        // 回溯到的那一刻不是事件：不出现在时间的网络事件里。
        expect(late.world.time("actual", late.ids["tmp:r"]!).built.network.events.some((id) => id.startsWith("~"))).toBe(false);
        // 待处理里也一样，且按读取位置截取到切口之后才列。
        const pending = early.world.pending({kind: "chapter", chapter: "ch4", edge: "end", line});
        expect(typeof pending === "string" ? [] : pending.filter((item) => item.kind === "time-conflict")).toHaveLength(1);
    });

    test("切口一定晚于回溯到的那一刻、父线上触发处不可确定、往回多久的词不在词表里：各成一条 fork-time-mismatch，写明原因", () => {
        const {world, xia, c1, c3} = timed();
        // 往回五天，触发处只比切口晚三天：R 比切口早两天。
        const far = rollbackOn(world, xia, c1, c3, {min: 5, max: 5, unit: "day"});
        expect(items(far.world, far.ids["tmp:r"]!)).toEqual(["fork-time-mismatch:cut-after-back"]);
        const word = rollbackOn(world, xia, c1, c3, {word: "不在词表里的词"});
        expect(items(word.world, word.ids["tmp:r"]!)).toEqual(["fork-time-mismatch:word-missing"]);
        // 触发处自己有两条互相打架的说法：它所在的分量不可确定。
        const broken = timed({when: [after("c2", 2), after("c2", 5)]});
        const undetermined = rollbackOn(broken.world, broken.xia, broken.c1, broken.c3, {min: 12, max: 12, unit: "hour"});
        expect(items(undetermined.world, undetermined.ids["tmp:r"]!)).toContain("fork-time-mismatch:parent-undetermined");
        const pending = far.world.pending({kind: "chapter", chapter: "ch4", edge: "end", line: far.ids["tmp:r"]!});
        expect(typeof pending === "string" ? [] : pending.filter((item) => item.kind === "fork-time-mismatch")).toHaveLength(1);
    });
});

describe("canon.worldlines 输出 12、13、16、验收 6：活页夹章讲的线", () => {
    const end3 = {kind: "chapter" as const, chapter: "ch3", edge: "end" as const};
    const start3 = {kind: "chapter" as const, chapter: "ch3", edge: "start" as const};
    const hintCodes = (service: Awaited<ReturnType<typeof openTestService>>, position = end3) => {
        const page = service.pending({position, group: "hints"});
        return typeof page === "string" ? [page] : page.items.flatMap((item) => (item.kind === "hint" ? [item.hint.code] : []));
    };
    async function setup() {
        const root = await createTestTmpRoot("nb-canon-worldlines", "binder");
        const texts = new Map(CHAPTERS.map((chapter) => [chapter, chapter === "ch3" ? "第一段\n第二段\n第三段\n第四段\n第五段" : ""]));
        const service = await openTestService(root, {texts, chapters: CHAPTERS, registry: options().registry});
        const publish = async (puts: WriteRequest["puts"]) => {
            const result = await service.publish(request(puts, service.status().version));
            if (!result.ok) throw new Error(JSON.stringify(result.failure));
            return result.ids;
        };
        const xia = (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
        // 新讲述不带 id（程序发）。
        const telling = (_name: string, quote: string) => ({source: "chapter" as const, chapter: "ch3", quote}) as never;
        const story = await publish([
            {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10), [], {told: [telling("t1", "第一段"), telling("t1b", "第三段")]})},
            {ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [spend(xia, -5000)], {told: [telling("t2", "第二段"), telling("t3", "第四段")]})},
        ]);
        const forked = await publish([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "分支", parent: "main", cut: story["tmp:c1"]!, type: "branch", end: "return", endAt: "tmp:own"} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"), [spend(xia, -1000)], {told: [telling("t4", "第五段")]})},
            {ref: {kind: "change", id: "tmp:if"}, after: {...written("tmp:if", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:if1", name: "如果", parent: "main", cut: story["tmp:c1"]!, type: "if"} as Fork}), kind: "plan"}},
        ]);
        return {root, service, xia, r1: forked["tmp:r1"]!, if1: forked["tmp:if1"]!, own: forked["tmp:own"]!, c1: story["tmp:c1"]!, c2: story["tmp:c2"]!};
    }
    const deposit = (service: Awaited<ReturnType<typeof openTestService>>, xia: string, position: typeof end3 | typeof start3) => {
        const read = service.entry(xia, position, "actual");
        return typeof read === "string" || read === null ? read : read.view?.namespaces.panel?.fields.存款?.value;
    };

    test("第 3 章分两段：起讲主线，第 3 段起讲分支。不写线读末尾读到分支、读开头读到主线；讲述所在的段讲的线看不到这条记录时给 telling-line-mismatch", async () => {
        const {root, service, xia, r1, if1} = await setup();
        try {
            expect([deposit(service, xia, end3), deposit(service, xia, start3)]).toEqual([15000, 15000]);
            await service.setChapters(CHAPTERS, new Map([["ch3", [{from: 1, line: "main"}, {from: 3, line: r1}]]]));
            expect([deposit(service, xia, end3), deposit(service, xia, start3)]).toEqual([19000, 15000]);
            // `lines` 方法：读过的分支已建。
            expect(service.lines().lines.map((line) => [line.id, line.built])).toEqual([[r1, true], [if1, false]]);
            // 写了线的位置不被章讲的线改写。
            expect(deposit(service, xia, {...end3, line: "main"} as typeof end3)).toBe(15000);
            // 第 4 段在分支那一段里，c2（只在主线上）的这处讲述分支看不到；第 3 段也在分支的段里，但 c1 在切口之前、分支看得到；第 2 段在主线的段里；第 5 段是分支自己的记录。
            expect(hintCodes(service)).toEqual(["telling-line-mismatch"]);
            // 待处理也按章讲的线：位置不写线时在分支上。
            const pending = service.pending({position: end3});
            expect(typeof pending).toBe("object");
            await service.setChapters(CHAPTERS);
            expect(hintCodes(service)).toEqual([]);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("changes 的筛选：安放在哪条线、只列某条线视图里的、安放的范围（被抹掉的那段）；套没套上按 worldline 算，不在它视图里的为 null；带令牌时只看令牌的线", async () => {
        const {root, service, xia, r1, own, c1, c2} = await setup();
        try {
            const ids = (result: ReturnType<typeof service.changes>) => (typeof result === "string" ? [result] : result.items.map((item) => item.change.id));
            expect(ids(service.changes({placedOn: r1}))).toEqual([own]);
            expect(ids(service.changes({inView: r1}))).toEqual([c1, own]);
            // 被抹掉的那段：切口之后、触发处之前（含）；切口自己不算。
            expect(ids(service.changes({placedOn: "main", range: {after: c1, through: c2}}))).toEqual([c2]);
            const main = service.changes({worldline: "main"});
            const onBranch = service.changes({worldline: r1});
            if (typeof main === "string" || typeof onBranch === "string") throw new Error("line");
            const outcome = (page: typeof main, id: string) => page.items.find((item) => item.change.id === id)?.outcome;
            expect([outcome(main, c2) !== null, outcome(main, own)]).toEqual([true, null]);
            expect([outcome(onBranch, c2), outcome(onBranch, own) !== null]).toEqual([null, true]);
            expect(main.items.find((item) => item.change.id === own)?.placedOn).toBe(r1);
            expect(service.changes({worldline: "l404"})).toBe("line-not-found");
            const opened = service.openView({viewer: null, line: r1, until: {kind: "chapter", chapter: "ch4", edge: "end"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const viewed = service.viewed(opened.token);
            expect(ids(viewed.changes({}) as ReturnType<typeof service.changes>)).toEqual([c1, own]);
            expect(viewed.changes({worldline: "main"})).toBe("view-denied");
            void xia;
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("讲的线不存在：这一段按主线算并给诊断 binder-line-unknown；讲计划线：实际模式按最近的实际祖先线算并提示 binder-line-planned，按计划模式读计划线；章晚于结束的线的 endAt：binder-line-ended", async () => {
        const {root, service, xia, r1, if1} = await setup();
        try {
            const diagnostics = () => service.status().diagnostics.flatMap((item) => ((item as {code?: string}).code === "binder-line-unknown" ? [item] : []));
            await service.setChapters(CHAPTERS, new Map([["ch3", [{from: 1, line: "l404"}]]]));
            expect(diagnostics()).toEqual([{code: "binder-line-unknown", chapter: "ch3", from: 1, line: "l404"}]);
            expect(deposit(service, xia, end3)).toBe(15000);
            await service.setChapters(CHAPTERS, new Map([["ch3", [{from: 1, line: if1}]]]));
            expect(diagnostics()).toEqual([]);
            expect(hintCodes(service)).toContain("binder-line-planned");
            expect(deposit(service, xia, end3)).toBe(15000);
            // 分支在 ch3 的 own 之后结束（return），第 4 章还讲它。
            await service.setChapters(CHAPTERS, new Map([["ch4", [{from: 1, line: r1}]]]));
            expect(hintCodes(service, {kind: "chapter", chapter: "ch4", edge: "end"} as typeof end3)).toContain("binder-line-ended");
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.worldlines 输出 10、验收 3：预览的波及面", () => {
    test("把切口挪到原来在切口之后的记录之后：预览列出因此越界的子线记录、变得看得到的计划与它们在线上的进展；不动线的写入没有波及面", () => {
        const {world, c1, c2, xia} = base();
        const created = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c1, type: "branch"}})},
            {ref: {kind: "change", id: "tmp:mid"}, after: written("tmp:mid", at("ch2", 15, "tmp:l"), [spend(xia, -100)])},
        ], world.version), "t"));
        const [line, mid, fork] = [created.ids["tmp:l"]!, created.ids["tmp:mid"]!, created.ids["tmp:f"]!];
        // 分叉之后在主线写下、安放在原切口与新切口之间的计划：改前看不到，改后看得到。
        const later = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch2", 18)), kind: "plan"}}], created.world.version), "t"));
        const p2 = later.ids["tmp:p2"]!;
        const move = request([{ref: {kind: "change", id: fork}, after: (() => {
            const value = structuredClone(later.world.data.changes.get(fork)!);
            return {...value, fork: {...value.fork!, cut: c2}};
        })()}], later.world.version);
        const preview = later.world.preview(move, "t");
        expect(preview.ok && preview.blast).toEqual({
            outOfBounds: [{line, ref: {kind: "change", id: mid}}],
            plans: [{plan: p2, line, visible: true}],
            progress: [{line, plan: p2, before: null, after: "unfulfilled"}],
            chapters: [],
        });
        // 预览不发布：世界没变。
        expect(later.world.data.changes.get(fork)!.fork!.cut).toBe(c1);
        // 只加一条普通记录：没有波及面。
        const plain = later.world.preview(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 9))}], later.world.version), "t");
        expect(plain.ok && plain.blast).toBeUndefined();
    });
});

describe("canon.worldlines 验收 9：计划线的兑现与撤销", () => {
    test("计划分叉开出线：实际模式读不到、记已写的被拒；写下兑现它的已写分叉以后能记账；撤销已写分叉：线变回计划线，已写记录各成 line-planned，根因是这次撤销", () => {
        const {world, c1, xia} = base();
        const planned = forked(world, c1, {kind: "plan"});
        const [line, plan] = [planned.ids["tmp:l"]!, planned.ids["tmp:f"]!];
        const table = (target: World) => lineTable(target.data, target.options.order);
        expect([table(planned.world).exists(line, "actual"), table(planned.world).exists(line, "planned")]).toEqual([false, true]);
        expect(planned.world.line(line)).toBeDefined();
        expect(problems(planned.world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 20, line))}], planned.world.version), "t")).map(([code]) => code)).toContain("line-planned");
        // 写下兑现它的已写分叉（同一个 line、同一个 parent，切口可以不同）。
        const fulfilled = ok(planned.world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: written("tmp:g", at("ch2", 45), [], {nature: "fork", fork: {line, name: "兑现", parent: "main", cut: c1, type: "if"}, links: [{kind: "fulfills", plan}]})}], planned.world.version), "t"));
        expect(table(fulfilled.world).exists(line, "actual")).toBe(true);
        const booked = ok(fulfilled.world.publish(request([{ref: {kind: "change", id: "tmp:y"}, after: written("tmp:y", at("ch3", 20, line), [spend(xia, -300)])}], fulfilled.world.version), "t"));
        const record = booked.ids["tmp:y"]!;
        // 撤销已写分叉。
        const fork = structuredClone(booked.world.data.changes.get(fulfilled.ids["tmp:g"]!)!);
        const undone = ok(booked.world.publish(request([{ref: {kind: "change", id: fork.id}, after: {...fork, status: "undone" as const}}], booked.world.version), "t"));
        expect([table(undone.world).exists(line, "actual"), table(undone.world).exists(line, "planned")]).toEqual([false, true]);
        for (const mode of ["actual", "planned"] as const) {
            const pending = undone.world.pending({kind: "chapter", chapter: "ch4", edge: "end"}, mode);
            const items = typeof pending === "string" ? [] : pending.filter((item) => item.kind === "line-planned");
            expect(items).toEqual([{kind: "line-planned", ref: {kind: "change", id: record}, line, root: undone.revision.id}]);
        }
        expect(undone.world.line(line)!.records.changes.has(record)).toBe(false);
    });
});


describe("canon.worldlines 实现审查 I4 之后：子线上的写入校验与按线的读取", () => {
    const end = (chapter: string, line?: string) => ({kind: "chapter" as const, chapter, edge: "end" as const, ...(line === undefined ? {} : {line})});

    test("子线上套不上的已写记录被拒（constraint-violated），主线同样；由核对点推出的依据按子线的值复算", () => {
        const {world, c1, xia} = base();
        const text = "余额显示一万九";
        const checked = world.withOptions({...world.options, chapterText: () => text});
        const created = ok(checked.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c1, type: "branch"}})}], checked.version), "t"));
        const line = created.ids["tmp:l"]!;
        const tooMuch = (placed?: string) => request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1, placed), [spend(xia, -50000)])}], created.world.version);
        expect(problems(created.world.publish(tooMuch(), "t")).map(([code]) => code)).toContain("constraint-violated");
        expect(problems(created.world.publish(tooMuch(line), "t")).map(([code]) => code)).toContain("constraint-violated");
        // 子线切口在 c1，存款还是两万；核对点写一万九，记一笔 -1000 由它推出：主线是一万五，推不出，子线推得出。
        const derived = (placed?: string) => request([
            {ref: {kind: "check", id: "tmp:k"}, after: {id: "tmp:k", at: {entry: xia, path: "panel.存款"}, value: 19000, told: {source: "chapter", chapter: "ch3", quote: text}, place: at("ch3", 5, placed)}},
            {ref: {kind: "change", id: "tmp:y"}, after: written("tmp:y", at("ch3", 1, placed), [{op: "add", at: {entry: xia, path: "panel.存款"}, value: -1000, basis: {kind: "derived", check: "tmp:k"}}])},
        ], created.world.version);
        expect(problems(created.world.publish(derived(), "t")).map(([code]) => code)).toContain("basis-mismatch");
        expect(created.world.publish(derived(line), "t").ok).toBe(true);
    });

    test("时间说法的 of 要在记录所在线的视图里：指向兄弟线上的变更被拒", () => {
        const {world, c1} = base();
        const forkOf = (id: string, name: string, cut: string) => ({ref: {kind: "change", id: `tmp:f-${id}`} as const, after: written(`tmp:f-${id}`, at("ch2", 40 + id.length), [], {nature: "fork", fork: {line: `tmp:${id}`, name, parent: "main", cut, type: "branch"}})});
        const created = ok(world.publish(request([forkOf("a", "甲", c1), forkOf("b", "乙", c1)], world.version), "t"));
        const [a, b] = [created.ids["tmp:a"]!, created.ids["tmp:b"]!];
        const onA = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:ra"}, after: written("tmp:ra", at("ch3", 1, a))}], created.world.version), "t"));
        const statement = [{kind: "after" as const, of: onA.ids["tmp:ra"]!, gap: {min: 1, max: 1, unit: "day" as const}, basis: {kind: "author" as const}}];
        const onB = onA.world.publish(request([{ref: {kind: "change", id: "tmp:rb"}, after: written("tmp:rb", at("ch3", 2, b), [], {when: statement})}], onA.world.version), "t");
        expect(problems(onB)).toEqual([["invalid-time", "when[0].of", null]]);
        expect(onA.world.publish(request([{ref: {kind: "change", id: "tmp:rc"}, after: written("tmp:rc", at("ch3", 2, a), [], {when: statement})}], onA.world.version), "t").ok).toBe(true);
    });

    test("活页夹讲子线、位置不写线：就地改读、排序与安放都在子线上，结果与显式写线一样", () => {
        const {world, c1, xia} = base();
        const created = ok(world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c1, type: "branch"}})}], world.version), "t"));
        const line = created.ids["tmp:l"]!;
        const told = created.world.withOptions({...created.world.options, chapterLines: new Map([["ch3", [{line, from: 1}]]])});
        const read = told.lineAt(end("ch3"))!.engine.entry(xia, end("ch3"), "actual");
        if (read === null || read === "chapter-not-found") throw new Error("not found");
        expect(read.namespaces.panel!.fields.存款!.value).toBe(20000);
        const result = editInPlace(told, {requestId: `ed-${String(++sequence)}`, by: {kind: "author"}, position: end("ch3"), at: {entry: xia, path: "panel.存款"}, value: 18000, read: {value: 20000, version: told.version}, intent: "story"}, "t");
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        const record = [...result.world.data.changes.values()].find((change) => change.text === "就地改")!;
        expect(record.at).toMatchObject({chapter: "ch3", line});
        const main = result.world.line().engine.entry(xia, end("ch3"), "actual");
        expect(main !== null && main !== "chapter-not-found" && main.namespaces.panel!.fields.存款!.value).toBe(15000);
    });

    test("渲染与回写按读取位置的线：子线渲染子线的值，读不到的线得 line-not-found", () => {
        const {world, c1, xia} = base();
        const entry = structuredClone(world.data.entries.get(xia)!);
        entry.init.text = [{id: "b1", source: "存款 {panel.存款}"}];
        const texted = ok(world.publish(request([{ref: {kind: "entry", id: xia}, after: entry}], world.version), "t")).world;
        const created = ok(texted.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c1, type: "branch"}})}], texted.version), "t"));
        const line = created.ids["tmp:l"]!;
        const onChild = renderEntryForAgent(created.world, xia, end("ch3", line), "actual");
        const onMain = renderEntryForAgent(created.world, xia, end("ch3"), "actual");
        expect(typeof onChild !== "string" && onChild?.blocks[0]?.text).toContain("20000");
        expect(typeof onMain !== "string" && onMain?.blocks[0]?.text).toContain("15000");
        expect(renderEntryForAgent(created.world, xia, end("ch3", "l404"), "actual")).toBe("line-not-found");
    });

    test("带令牌的 presence、tellings 只给令牌那条线视图里的；服务的 presence 可指定线；读计划线的实际模式得 line-not-found；视图读过的线不因缓存而逃过淘汰", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "i4");
        const texts = new Map(CHAPTERS.map((chapter) => [chapter, chapter === "ch2" ? "星瑕在码头看见了沉船。" : ""]));
        const service = await openTestService(root, {texts, chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const xia = (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const story = await publish([
                {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
                {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30), [], {cast: [{who: xia, role: "present"}], told: [{source: "chapter", chapter: "ch2", quote: "看见了沉船"}]})},
            ]);
            const forks = await publish([
                ...[1, 2, 3, 4, 5].map((i) => ({ref: {kind: "change", id: `tmp:f${String(i)}`} as const, after: written(`tmp:f${String(i)}`, at("ch2", 40 + i), [], {nature: "fork", fork: {line: `tmp:r${String(i)}`, name: `分支${String(i)}`, parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})})),
                {ref: {kind: "change", id: "tmp:if"}, after: {...written("tmp:if", at("ch2", 50), [], {nature: "fork", fork: {line: "tmp:if1", name: "如果", parent: "main", cut: story["tmp:c1"]!, type: "if"} as Fork}), kind: "plan"}},
            ]);
            const r1 = forks["tmp:r1"]!;
            // 令牌在 r1 上：c3 在主线切口之后，不在 r1 的视图里。
            const opened = service.openView({viewer: null, line: r1, until: end("ch3"), purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const viewed = service.viewed(opened.token);
            const presence = viewed.presence(xia, {});
            const tellings = viewed.tellings({});
            expect(typeof presence !== "string" && presence.items.map((item) => item.change.id)).toEqual([]);
            expect(typeof tellings !== "string" && tellings.items.map((item) => item.owner.id)).toEqual([]);
            // 不带令牌：主线上看得到 c3；指定线 r1 看不到。
            const onMain = service.presence(xia, {});
            const onChild = service.presence(xia, {line: r1});
            expect(typeof onMain !== "string" && onMain.items.map((item) => item.change.id)).toEqual([story["tmp:c3"]!]);
            expect(typeof onChild !== "string" && onChild.items.length).toBe(0);
            expect(service.presence(xia, {line: "l404"})).toBe("line-not-found");
            // 计划线在实际模式下读不到（输出 1）。
            const planned = {kind: "chapter" as const, chapter: "ch3", edge: "end" as const, line: forks["tmp:if1"]!};
            expect(service.entry(xia, planned, "actual")).toBe("line-not-found");
            expect(service.pending({position: planned})).toBe("line-not-found");
            expect(typeof service.entry(xia, planned, "planned")).toBe("object");
            // 一份快照视图读过五条线：被淘汰的线再经缓存着的视图读，也重新进已建的线里，名额仍是三条加常驻的。
            const view = service.snapshot().view;
            const lines = [1, 2, 3, 4, 5].map((i) => forks[`tmp:r${String(i)}`]!);
            const views = lines.map((line) => {
                const found = view.onLine(line);
                if ("code" in found) throw new Error(found.code);
                found.entry(xia, end("ch3"), "actual");
                return found;
            });
            const builtOf = () => service.status().lines.built.map((item) => item.line);
            expect(builtOf()).not.toContain(lines[0]!);
            views[0]!.entry(xia, end("ch3"), "actual");
            expect(builtOf()).toContain(lines[0]!);
            expect(builtOf().length).toBeLessThanOrEqual(3);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("线已由已写分叉定义以后，再写一条兑现同一计划的已写分叉得 line-taken", () => {
        const {world, c1, c2} = base();
        const plannedFork = ok(world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: {...written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "如果", parent: "main", cut: c1, type: "if"}}), kind: "plan"}}], world.version), "t"));
        const [line, plan] = [plannedFork.ids["tmp:l"]!, plannedFork.ids["tmp:f"]!];
        const writtenFork = (id: string, cut: string, key: number) => written(id, at("ch2", key), [], {nature: "fork", fork: {line, name: id, parent: "main", cut, type: "if"}, links: [{kind: "fulfills", plan}]});
        const first = ok(plannedFork.world.publish(request([{ref: {kind: "change", id: "tmp:g"}, after: writtenFork("tmp:g", c1, 45)}], plannedFork.world.version), "t"));
        const second = first.world.publish(request([{ref: {kind: "change", id: "tmp:h"}, after: writtenFork("tmp:h", c2, 46)}], first.world.version), "t");
        expect(problems(second).map(([code]) => code)).toContain("line-taken");
    });

    test("发布时受影响的线多于名额：status 里同一条线只出现一项，刚增量更新过的线不被淘汰重建", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "i4-updates");
        const service = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const xia = (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const story = await publish([{ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))}]);
            const ids = await publish([1, 2, 3, 4, 5].map((i) => ({ref: {kind: "change", id: `tmp:f${String(i)}`} as const, after: written(`tmp:f${String(i)}`, at("ch2", 40 + i), [], {nature: "fork", fork: {line: `tmp:r${String(i)}`, name: `分支${String(i)}`, parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})})));
            const view = service.snapshot().view;
            for (let i = 1; i <= 5; i += 1) {
                const found = view.onLine(ids[`tmp:r${String(i)}`]!);
                if (!("code" in found)) found.entry(xia, end("ch3"), "actual");
            }
            const entry = structuredClone(service.snapshot().view.entries().find((candidate) => candidate.id === xia)!);
            entry.init.data.panel!.fields.存款 = 25000;
            await publish([{ref: {kind: "entry", id: xia}, after: entry}]);
            const updated = service.status().lines.updated.map((item) => item.line);
            expect(new Set(updated).size).toBe(updated.length);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.worldlines 实现审查 I4 omp 份：当前线、服务的 time、视图的默认范围、未排章与重复线 id", () => {
    const end = (chapter: string, line?: string) => ({kind: "chapter" as const, chapter, edge: "end" as const, ...(line === undefined ? {} : {line})});

    test("活页夹最新一章讲子线：这条线算当前线、常驻，不占名额；服务的 time 可指定线，线读不到得 line-not-found", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "i4-omp");
        const service = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const xia = (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const story = await publish([{ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))}]);
            const forks = await publish([1, 2, 3, 4, 5].map((i) => ({ref: {kind: "change", id: `tmp:f${String(i)}`} as const, after: written(`tmp:f${String(i)}`, at("ch2", 40 + i), [], {nature: "fork", fork: {line: `tmp:r${String(i)}`, name: `分支${String(i)}`, parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})})));
            const lines = [1, 2, 3, 4, 5].map((i) => forks[`tmp:r${String(i)}`]!);
            const own = await publish([{ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, lines[0]!), [spend(xia, -1000)])}]);
            await service.setChapters(CHAPTERS, new Map([["ch4", [{line: lines[0]!, from: 1}]]]));
            // 读到别的四条线：名额三条，当前线 r1 不被淘汰。
            const view = service.snapshot().view;
            for (const line of lines) {
                const found = view.onLine(line);
                if (!("code" in found)) found.entry(xia, end("ch3"), "actual");
            }
            const built = service.status().lines.built;
            expect(built.find((item) => item.line === lines[0]!)).toEqual({line: lines[0]!, resident: true});
            const query = {kind: "event" as const, change: own["tmp:own"]!};
            const onChild = service.time(query, "actual", undefined, 50, lines[0]!);
            const onMain = service.time(query, "actual", undefined, 50, "main");
            if (typeof onChild === "string" || typeof onMain === "string") throw new Error("time failed");
            expect(JSON.stringify(onChild.answer)).not.toBe(JSON.stringify(onMain.answer));
            // 缺省取当前线（r1）。
            const byDefault = service.time(query);
            expect(typeof byDefault !== "string" && JSON.stringify(byDefault.answer)).toBe(JSON.stringify(onChild.answer));
            expect(service.time(query, "actual", undefined, 50, "l404")).toBe("line-not-found");
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("子线的读取视图默认只列这条线看得到的变更：分叉之后主线才写的计划不在", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "i4-omp-view");
        const service = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]);
            const story = await publish([{ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))}]);
            const forks = await publish([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 20), [], {nature: "fork", fork: {line: "tmp:r", name: "分支", parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})}]);
            const later = await publish([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch3", 5)), kind: "plan"}}]);
            const child = service.snapshot().view.onLine(forks["tmp:r"]!);
            if ("code" in child) throw new Error(child.code);
            const ids = child.changes({kind: "plan"}).map((change) => change.id);
            expect(ids).not.toContain(later["tmp:p2"]!);
            expect(service.snapshot().view.changes({kind: "plan"}).map((change) => change.id)).toContain(later["tmp:p2"]!);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("同一请求里两条已写分叉占同一个临时线 id：line-taken；已写分叉与子线上的已写记录都要排章", () => {
        const {world, c1, c2} = base();
        const fork = (id: string, cut: string, key: number, line = "tmp:l", placement: StoryChangeDraft["at"] = at("ch2", key)) => ({ref: {kind: "change", id: `tmp:${id}`} as const, after: written(`tmp:${id}`, placement, [], {nature: "fork", fork: {line, name: id, parent: "main", cut, type: "branch"} as Fork})});
        expect(problems(world.publish(request([fork("a", c1, 40), fork("b", c2, 41)], world.version), "t")).map(([code, path]) => [code, path])).toEqual([["line-taken", "fork.line"]]);
        // 已写分叉不排章：没有位置判断晚不晚于切口。
        expect(problems(world.publish(request([fork("a", c1, 40, "tmp:l", {kind: "unscheduled"})], world.version), "t")).map(([code, path]) => [code, path])).toEqual([["invalid-fork", "at"]]);
        // 子线上的已写记录不排章；计划可以。
        const created = ok(world.publish(request([fork("a", c1, 40)], world.version), "t"));
        const line = created.ids["tmp:l"]!;
        const unscheduled = (kind: "written" | "plan") => request([{ref: {kind: "change", id: "tmp:u"}, after: {...written("tmp:u", {kind: "unscheduled", line}), kind}}], created.world.version);
        expect(problems(created.world.publish(unscheduled("written"), "t")).map(([code]) => code)).toContain("line-out-of-bounds");
        expect(created.world.publish(unscheduled("plan"), "t").ok).toBe(true);
    });
});

describe("读取视图：按计划模式的 chapterEntries、chapterLines、render（阶段 E 的前置读取）", () => {
    test("只有计划的章：实际模式没有涉及的条目，按计划模式有；分段的章给出各段的线，没分段的给章开头那条线；render 按读取位置的线", () => {
        const {world, c1, xia} = base();
        const bro = ok(world.publish(request([{ref: {kind: "entry", id: "tmp:bro"}, after: person("tmp:bro", "哥哥")}], world.version), "t"));
        const entryId = bro.ids["tmp:bro"]!;
        const planned = ok(bro.world.publish(request([{ref: {kind: "change", id: "tmp:p4"}, after: {...written("tmp:p4", at("ch4", 5), [spend(xia, -100)], {involves: [entryId]}), kind: "plan"}}], bro.world.version), "t"));
        const withText = structuredClone(planned.world.data.entries.get(xia)!);
        withText.init.text = [{id: "b1", source: "存款 {panel.存款}"}];
        const texted = ok(planned.world.publish(request([{ref: {kind: "entry", id: xia}, after: withText}], planned.world.version), "t")).world;
        const forked = ok(texted.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 40), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c1, type: "branch"}})}], texted.version), "t"));
        const line = forked.ids["tmp:l"]!;
        const told = forked.world.withOptions({...forked.world.options, chapterLines: new Map([["ch3", [{line: "main", from: 1}, {line, from: 3}]]])});
        const view = createWorldReadView(told, new Map());
        expect(view.chapterEntries("ch4")).toEqual([]);
        expect(view.chapterEntries("ch4", "planned")).toEqual([xia, entryId].sort());
        expect(view.chapterLines("ch3")).toEqual([{line: "main", from: 1}, {line, from: 3}]);
        expect(view.chapterLines("ch4")).toEqual([{line: "main", from: 1}]);
        // 渲染按读取位置的线：子线上存款是切口前的两万，主线是一万五。
        const renderedOn = (on?: string) => {
            const rendered = view.render(xia, {kind: "chapter", chapter: "ch3", edge: "end", ...(on === undefined ? {} : {line: on})}, "actual");
            return typeof rendered === "string" || rendered === null ? rendered : rendered.blocks[0]?.text;
        };
        expect(renderedOn(line)).toContain("20000");
        expect(renderedOn("main")).toContain("15000");
        // 位置不写线时按这张视图的线（主线的视图）；活页夹讲的线只在服务的方法级读取里起作用。
        expect(renderedOn()).toContain("15000");
        expect(renderedOn("l404")).toBe("line-not-found");
    });
});

describe("canon.worldlines 输出 3（补）：结束的线", () => {
    test("end 为 stop、return 的线：安放晚于 endAt 的新记录得 line-ended，endAt 本身、更早的记录与主线不受影响", () => {
        for (const end of ["stop", "return"] as const) {
            const {world, c2} = base();
            const result = forked(world, c2);
            const line = result.ids["tmp:l"]!;
            const fork = result.world.data.changes.get(result.ids["tmp:f"]!)!;
            const ended = ok(result.world.publish(request([{ref: {kind: "change", id: fork.id}, after: {...structuredClone(fork), fork: {...fork.fork!, end, endAt: result.ids["tmp:own"]!}}}], result.world.version), "t"));
            const attempt = (id: string, placement: StoryChangeDraft["at"]) => {
                const result = ended.world.publish(request([{ref: {kind: "change", id: `tmp:${id}`}, after: written(`tmp:${id}`, placement)}], ended.world.version), "t");
                return result.ok ? ["ok"] : problems(result).map(([code, path]) => `${String(code)}:${String(path)}`);
            };
            // 同章里键更大、更晚的章：都晚于 endAt（子线自己的记录在第 3 章键 1）。
            expect(attempt("later", at("ch3", 2, line))).toEqual(["line-ended:at"]);
            expect(attempt("next", at("ch4", 1, line))).toEqual(["line-ended:at"]);
            // 早于 endAt 的（第 2 章键 50 晚于切口 c2）照常；主线上同一位置也照常。
            expect(attempt("earlier", at("ch2", 50, line))).toEqual(["ok"]);
            expect(attempt("main", at("ch3", 2))).toEqual(["ok"]);
        }
    });
});

describe("canon.worldlines 输出 4（补）：替换只在它写下的线上", () => {
    test("分叉之后在主线写的替换不进子线：主线上旧计划 replaced，子线上照旧 unfulfilled；子线上写的替换只替代子线上的", () => {
        const {world, c2, p1} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const end = {kind: "chapter" as const, chapter: "ch4", edge: "end" as const};
        const progress = (target: World, on: string) => target.line(on)!.engine.progress(p1, end);
        const replacement = (id: string, placement: StoryChangeDraft["at"]) => ({ref: {kind: "change" as const, id: `tmp:${id}`}, after: {...written(`tmp:${id}`, placement, [], {links: [{kind: "replaces", plan: p1}]}), kind: "plan" as const}});
        const onMain = ok(result.world.publish(request([replacement("rm", at("ch3", 9))], result.world.version), "t"));
        expect([progress(onMain.world, "main"), progress(onMain.world, line)]).toEqual(["replaced", "unfulfilled"]);
        const onChild = ok(result.world.publish(request([replacement("rc", at("ch3", 9, line))], result.world.version), "t"));
        expect([progress(onChild.world, "main"), progress(onChild.world, line)]).toEqual(["unfulfilled", "replaced"]);
    });
});

describe("canon.worldlines 输出 6（补）：语义档与列表的带过去、计划模式、不适用的地址", () => {
    const KNOW: ComponentDeclaration = {id: "test.know", label: "认得", namespace: "know", version: 1, fields: [{id: "认得", label: "认得", kind: "list", keyedBy: "ref", item: [{id: "看法", label: "看法", kind: "text", precision: "semantic"}]}]};
    const withKnow = (): WorldOptions => ({...options(), registry: buildRegistry([PANEL, PERSON, ROLLBACK, KNOW])});
    const attitude = "character.态度";
    const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});
    const read = (world: World, line: string, entry: string, chapter: string, mode: "actual" | "planned" = "actual") => {
        const found = world.line(line)!.engine.entry(entry, end(chapter), mode);
        if (found === null || found === "chapter-not-found") throw new Error("no entry");
        return found.namespaces;
    };
    const note = (entry: string, path: string, value: string): Patch => ({op: "note", at: {entry, path}, value});

    /** 星瑕的态度是语义档（起点“冷淡”），认得列表里有星瑾一行（看法也是语义档）；回溯的切口 c1、触发处 c3，之间的 c2、c2b 往两处各记一笔，触发处之后的 c4 不带过去。 */
    function carrying(skipped: readonly string[] = []) {
        const knower = (id: string): Entry => {
            const entry = person(id, "星瑕");
            entry.init.data.character = {type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}};
            entry.init.data.know = {type: KNOW.id, version: 1, enabled: true, fields: {认得: []}};
            return entry;
        };
        const opened = ok(World.empty(withKnow()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: knower("tmp:xia")}, {ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")}], 0), "t"));
        const [xia, jin] = [opened.ids["tmp:xia"]!, opened.ids["tmp:jin"]!];
        const story = ok(opened.world.publish(request([
            {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
            {ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [note(xia, attitude, "软了一点"), {op: "listAdd", at: {entry: xia, path: "know.认得"}, value: {id: jin, 看法: "陌生"}}])},
            {ref: {kind: "change", id: "tmp:c2b"}, after: written("tmp:c2b", at("ch2", 25), [note(xia, `know.认得[${jin}].看法`, "起疑")])},
            {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30))},
            {ref: {kind: "change", id: "tmp:c4"}, after: written("tmp:c4", at("ch3", 2), [note(xia, attitude, "之后的事")])},
        ], opened.world.version), "t"));
        const carry = [{entry: xia, path: attitude}, {entry: xia, path: "know.认得"}, ...skipped.map((path) => ({entry: xia, path}))];
        const rolled = ok(story.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: story.ids["tmp:c1"]!, trigger: story.ids["tmp:c3"]!, type: "rollback", carry} as Fork})},
            {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"), [note(xia, attitude, "子线自己的事")])},
        ], story.world.version), "t"));
        return {world: rolled.world, xia, jin, line: rolled.ids["tmp:r1"]!, fork: rolled.ids["tmp:f"]!};
    }

    test("语义档带父线在触发处的起点与起点之后的事件，列表按元素带、元素的语义档子字段同样；触发处之后父线上的事件不带过去，子线自己的事接在后面", () => {
        const {world, xia, jin, line} = carrying();
        expect(read(world, "main", xia, "ch3").character!.fields.态度!.value).toBe("冷淡；之后：软了一点；之后的事");
        expect(read(world, line, xia, "ch3").character!.fields.态度).toMatchObject({value: "冷淡；之后：软了一点；子线自己的事", notReduced: true});
        // 切口 c1 处列表里还没有这一行，子线上有它是带过去的：行里的看法同样带起点与起点之后的事件。
        expect(read(world, line, xia, "ch3").know!.fields.认得!.value).toMatchObject([{id: jin, 看法: "陌生；之后：起疑"}]);
        expect(world.line(line)!.synthetic.size).toBe(1);
    });

    test("按计划模式读子线时带过去的值仍是实际模式的值：分叉之后在主线上切口与触发处之间写的计划不带过去", () => {
        const {world, xia, line} = carrying();
        const planned = ok(world.publish(request([{ref: {kind: "change", id: "tmp:p"}, after: {...written("tmp:p", at("ch2", 15), [note(xia, attitude, "计划里的")]), kind: "plan"}}], world.version), "t"));
        expect(read(planned.world, "main", xia, "ch3", "planned").character!.fields.态度!.value).toContain("计划里的");
        for (const mode of ["actual", "planned"] as const) expect(read(planned.world, line, xia, "ch3", mode).character!.fields.态度!.value).toBe("冷淡；之后：软了一点；子线自己的事");
    });

    test("命名空间没启用、已去掉的地址在切口处读不到：写入不拒收，其余的地址照带，不出待处理", () => {
        const knower = (id: string, data: Record<string, unknown>): Entry => {
            const entry = person(id, "阿七");
            Object.assign(entry.init.data, data);
            return entry;
        };
        const opened = ok(World.empty(withKnow()).publish(request([{ref: {kind: "entry", id: "tmp:a"}, after: knower("tmp:a", {
            character: {type: PERSON.id, version: 1, enabled: false, fields: {外观: null, 状态: null, 态度: "冷淡"}},
            know: {type: KNOW.id, version: 1, enabled: true, removed: true, fields: {认得: []}},
        })}], 0), "t"));
        const a = opened.ids["tmp:a"]!;
        const story = ok(opened.world.publish(request([
            {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
            {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30), [{op: "set", at: {entry: a, path: "rb.次数"}, value: 0}])},
        ], opened.world.version), "t"));
        const carry = [{entry: a, path: attitude}, {entry: a, path: "know.认得"}, {entry: a, path: "rb.次数"}];
        const rolled = ok(story.world.publish(request([{ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut: story.ids["tmp:c1"]!, trigger: story.ids["tmp:c3"]!, type: "rollback", carry} as Fork})}], story.world.version), "t"));
        const line = rolled.ids["tmp:r1"]!;
        // 跳过的项不能让带过去的那一件事套不上，也不能出待处理；读不到的命名空间仍然读不到。
        expect(rolled.world.pending({kind: "chapter", chapter: "ch3", edge: "end", line})).toEqual([]);
        const namespaces = read(rolled.world, line, a, "ch3");
        expect(Object.keys(namespaces)).toEqual(["panel", "rb"]);
        expect(namespaces.rb!.fields.次数).toEqual({value: 0});
    });
});

describe("canon.worldlines 输出 18（补）：不可建的各种原因与服务层的表现", () => {
    /** 记录 a、b、c 各在第 1、2、3 章，之后用 `forks` 在 ch4 或 ch3 写分叉；章序调整另用 `ChapterOrder` 算线表。 */
    function spread() {
        const opened = ok(World.empty(options()).publish(request([
            {ref: {kind: "change", id: "tmp:a"}, after: written("tmp:a", at("ch1", 10))},
            {ref: {kind: "change", id: "tmp:b"}, after: written("tmp:b", at("ch2", 10))},
            {ref: {kind: "change", id: "tmp:c"}, after: written("tmp:c", at("ch3", 10))},
        ], 0), "t"));
        return {world: opened.world, a: opened.ids["tmp:a"]!, b: opened.ids["tmp:b"]!, c: opened.ids["tmp:c"]!};
    }
    const fork = (world: World, id: string, line: string, spec: Partial<Fork> & {cut: string}, placement: StoryChangeDraft["at"]) => ok(world.publish(request([{ref: {kind: "change", id: `tmp:${id}`}, after: written(`tmp:${id}`, placement, [], {nature: "fork", fork: {line: `tmp:${line}`, name: line, parent: "main", type: "branch", ...spec} as Fork})}], world.version), "t"));
    const reasons = (world: World, chapters: readonly string[]) => [...lineTable(world.data, new ChapterOrder(chapters)).lines.values()].map((entry) => [entry.id, entry.unbuildable, entry.exists.actual]);

    test("章序调整以后：触发处没安放、触发处不晚于切口、回溯的分叉早于触发处，各有自己的原因，线读不到", () => {
        const {world, a, b} = spread();
        const rolled = fork(world, "f", "r1", {cut: a, trigger: b, type: "rollback"}, at("ch3", 5));
        const line = rolled.ids["tmp:r1"]!;
        expect(reasons(rolled.world, CHAPTERS)).toEqual([[line, null, true]]);
        expect(reasons(rolled.world, ["ch1", "ch3", "ch4"])).toEqual([[line, "trigger-unplaced", true]]);
        expect(reasons(rolled.world, ["ch2", "ch1", "ch3", "ch4"])).toEqual([[line, "trigger-not-after-cut", true]]);
        expect(reasons(rolled.world, ["ch1", "ch3", "ch2", "ch4"])).toEqual([[line, "fork-before-trigger", true]]);
        const table = lineTable(rolled.world.data, new ChapterOrder(["ch1", "ch3", "ch2", "ch4"]));
        expect(table.visible(line, rolled.ids["tmp:f"]!)).toBe(false);
    });

    test("章序调整以后：切口、触发处不在父线视图里，原因 cut-not-visible、trigger-not-visible；父线不可建时子线随它", () => {
        const {world, a, b, c} = spread();
        const first = fork(world, "f1", "l1", {cut: b}, at("ch4", 1));
        const l1 = first.ids["tmp:l1"]!;
        const second = fork(first.world, "f2", "l2", {cut: a, parent: l1}, at("ch4", 2, l1));
        const l2 = second.ids["tmp:l2"]!;
        // 第 2 章排到第 1 章之前，a 就晚于 l1 的切口 b。
        expect(reasons(second.world, ["ch2", "ch1", "ch3", "ch4"])).toEqual([[l1, null, true], [l2, "cut-not-visible", true]]);
        // 第 2 章没安放：l1 的切口没安放，l2 随它。
        expect(reasons(second.world, ["ch1", "ch3", "ch4"])).toEqual([[l1, "cut-unplaced", true], [l2, "cut-unplaced", true]]);
        const third = fork(world, "f1", "l1", {cut: c}, at("ch4", 1));
        const m1 = third.ids["tmp:l1"]!;
        const fourth = fork(third.world, "f2", "l2", {cut: a, trigger: b, type: "rollback", parent: m1}, at("ch4", 2, m1));
        const m2 = fourth.ids["tmp:l2"]!;
        expect(reasons(fourth.world, ["ch1", "ch3", "ch2", "ch4"])).toEqual([[m1, null, true], [m2, "trigger-not-visible", true]]);
    });

    test("日志里父线链成环：环上的线与后代线不可建，原因 cycle，两种模式下都不存在", () => {
        const {world, b} = spread();
        const first = fork(world, "f1", "l1", {cut: b}, at("ch4", 1));
        const l1 = first.ids["tmp:l1"]!;
        const second = fork(first.world, "f2", "l2", {cut: b, parent: l1}, at("ch4", 2, l1));
        const l2 = second.ids["tmp:l2"]!;
        const f1 = first.ids["tmp:f1"]!;
        // 写入会拒收这样的改动，所以直接重放一次改父线的修订，造出日志里本来就有的情形。
        const looped = World.replay([
            ...second.world.revisions,
            {...second.world.revisions.at(-1)!, id: "r99", version: second.world.version + 1, requestId: "legacy", ops: [{ref: {kind: "change", id: f1}, kind: "modify", fields: [{path: "fork.parent", before: "main", after: l2}]}]},
        ], second.world.options);
        expect(reasons(looped, CHAPTERS)).toEqual([[l1, "cycle", false], [l2, "cycle", false]]);
        expect(lineTable(looped.data, looped.options.order).exists(l1, "planned")).toBe(false);
    });

    test("服务层：读取得 line-not-found 并带原因，安放在上面的记录成带原因的 line-missing，lines 给出 unbuildable", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "unbuildable");
        const service = await openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const xia = (await publish([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const story = await publish([{ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))}]);
            const forks = await publish([
                {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "分支", parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})},
                {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"), [spend(xia, -1000)])},
            ]);
            const [line, own] = [forks["tmp:r1"]!, forks["tmp:own"]!];
            const here = {kind: "chapter" as const, chapter: "ch3", edge: "end" as const};
            expect(service.lines().lines.map((item) => [item.id, item.unbuildable])).toEqual([[line, null]]);
            expect(service.snapshot().view.onLine(line)).toMatchObject({line});
            // 第 2 章不在章序里，切口没安放。
            await service.setChapters(["ch1", "ch3", "ch4"]);
            expect(service.lines().lines.map((item) => [item.id, item.unbuildable])).toEqual([[line, "cut-unplaced"]]);
            expect(service.snapshot().view.onLine(line)).toEqual({code: "line-not-found", reason: "cut-unplaced"});
            expect(service.entry(xia, {...here, line}, "actual")).toBe("line-not-found");
            const pending = service.pending({position: {...here, line: "main"}});
            const missing = typeof pending === "string" ? [] : pending.items.flatMap((entry) => (entry.kind === "canon" && entry.item.kind === "line-missing" ? [entry.item] : []));
            expect(missing.map((item) => [item.ref.id, item.line, item.reason])).toEqual([[own, line, "cut-unplaced"]]);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.worldlines 输出 13（补）：读者读过的讲述不分线", () => {
    test("第 3 章第 1 段起讲主线、第 3 段起讲分支：只在主线上的记录的讲述（第 2、4 段）与分支自己的讲述，在第 3 章末尾都算读过；读到第 2 段时只算前两段", async () => {
        const root = await createTestTmpRoot("nb-canon-worldlines", "readers");
        const texts = new Map(CHAPTERS.map((chapter) => [chapter, chapter === "ch3" ? "第一段\n第二段\n第三段\n第四段\n第五段" : ""]));
        const service = await openTestService(root, {texts, chapters: CHAPTERS, registry: options().registry});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const telling = (quote: string) => ({source: "chapter" as const, chapter: "ch3", quote}) as never;
            const story = await publish([
                {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10), [], {told: [telling("第一段"), telling("第三段")]})},
                {ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [], {told: [telling("第二段"), telling("第四段")]})},
            ]);
            const forks = await publish([
                {ref: {kind: "change", id: "tmp:f"}, after: written("tmp:f", at("ch2", 35), [], {nature: "fork", fork: {line: "tmp:r1", name: "分支", parent: "main", cut: story["tmp:c1"]!, type: "branch"} as Fork})},
                {ref: {kind: "change", id: "tmp:own"}, after: written("tmp:own", at("ch3", 1, "tmp:r1"), [], {told: [telling("第五段")]})},
            ]);
            await service.setChapters(CHAPTERS, new Map([["ch3", [{from: 1, line: "main"}, {from: 3, line: forks["tmp:r1"]!}]]]));
            const quotes = (until: {chapter: string; edge?: "start" | "end"; paragraph?: number}) => {
                const page = service.tellings({until: until as never});
                return typeof page === "string" ? [page] : page.items.map((item) => item.telling.quote);
            };
            expect(quotes({chapter: "ch3", edge: "end"})).toEqual(["第一段", "第二段", "第三段", "第四段", "第五段"]);
            expect(quotes({chapter: "ch3", paragraph: 2})).toEqual(["第一段", "第二段"]);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});
