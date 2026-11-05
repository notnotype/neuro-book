import {createHash} from "node:crypto";
import {rm} from "node:fs/promises";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type Fork, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {lineTable} from "../src/lines/table";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {openTestService} from "./fixtures/service";
import {PANEL, PERSON} from "./fixtures/world";

/** 回溯时随回溯者保留的字段（输出 7 的缺省）：回溯次数带过去，别的不带。 */
const ROLLBACK: ComponentDeclaration = {id: "test.rollback", label: "回溯", namespace: "rb", version: 1, fields: [{id: "次数", label: "次数", kind: "number", carry: true}, {id: "别的", label: "别的", kind: "number"}]};
const CHAPTERS = ["ch1", "ch2", "ch3", "ch4"];
function options(): WorldOptions {
    return {order: new ChapterOrder(CHAPTERS), registry: buildRegistry([PANEL, PERSON, ROLLBACK]), reductions: () => undefined, chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex")};
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
function base() {
    const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}], 0), "t"));
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
            const steps = child.origins({entry: xia, path: "rb.次数"}, {kind: "chapter", chapter: "ch3", edge: "end"}, "actual");
            expect(steps !== "chapter-not-found" && steps.at(-1)).toMatchObject({kind: "carried", fork: forks["tmp:f"], line: "main", change: story["tmp:c3"], value: 0});
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});
