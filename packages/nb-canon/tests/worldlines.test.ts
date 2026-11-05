import {createHash} from "node:crypto";
import {rm} from "node:fs/promises";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type Fork, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {affectedLines, touchedOf} from "../src/lines/affected";
import {lineTable} from "../src/lines/table";
import {editInPlace} from "../src/world/edits";
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
        expect(updated(moved.world).sort()).toEqual([`${r1}:built`, `${r1}:structural`, `${r2}:built`, `${r2}:structural`]);
        matchesReplay(moved.world, lines);
        // 章序调整：全部丢掉。
        const reordered = moved.world.reorder(new ChapterOrder(["ch1", "ch2", "ch4", "ch3"]), "t", "ro-1");
        if (reordered === null || !reordered.ok) throw new Error("reorder");
        matchesReplay(reordered.world, lines);
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
