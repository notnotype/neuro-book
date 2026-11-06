import {describe, expect, test} from "bun:test";

import {createIncrementalEngine} from "../src/engine/incremental";
import {createReferenceEngine} from "../src/engine/reference";
import type {Engine, EngineInputs} from "../src/engine/types";
import type {Patch} from "../src/index";
import {add, chapter, end, note, set, start, WorldBuilder} from "./fixtures/world";

/** 两种引擎对同一份输入的回答必须相同。 */
const ENGINES: ReadonlyArray<[string, (inputs: EngineInputs) => Engine]> = [
    ["参照实现", createReferenceEngine],
    ["增量引擎", createIncrementalEngine],
];

const panelOf = (engine: Engine, id: string, position: Parameters<Engine["entry"]>[1], mode: "actual" | "planned" = "actual") => {
    const view = engine.entry(id, position, mode);
    if (view === null || view === "chapter-not-found") throw new Error(`no view: ${String(view)}`);
    return view;
};

describe.each(ENGINES)("%s", (_name, createEngine) => {
    describe("canon.model 场景 4：前史与初值", () => {
        test("读初值是原来的值，读第 1 章开头已套上前史", () => {
            const world = new WorldBuilder().entry("e1", "父母", {character: {状态: "在家"}}).change("c1", {kind: "prehistory", order: 1}, [set("e1", "character.状态", "失踪")]);
            const engine = createEngine(world.inputs());
            expect(panelOf(engine, "e1", {kind: "initial"}).namespaces.character!.fields.状态!.value).toBe("在家");
            expect(panelOf(engine, "e1", start("ch1")).namespaces.character!.fields.状态!.value).toBe("失踪");
        });
    });

    describe("canon.model 场景 1：转账（输出 7、8）", () => {
        const world = () =>
            new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 1000}})
                .entry("jin", "星瑾", {panel: {存款: 0}})
                .change("c3", chapter("ch3"), [add("xia", "panel.存款", -2000), add("jin", "panel.存款", 2000)])
                .change("c5", chapter("ch5"), [set("xia", "panel.存款", 500)]);

        test("一边破了下限，整条不算数，两人的存款都不变，从这里起不完整，赋值后恢复", () => {
            const engine = createEngine(world().inputs());
            expect(engine.outcome("c3")).toEqual({applied: false, reason: "constraint-violated", failedPatch: -1});
            const ch3 = panelOf(engine, "xia", end("ch3"));
            expect(ch3.namespaces.panel!.fields.存款).toEqual({value: 1000, incomplete: {change: "c3", reason: "constraint-violated"}});
            expect(panelOf(engine, "jin", end("ch3")).namespaces.panel!.fields.存款!.value).toBe(0);
            expect(panelOf(engine, "xia", end("ch2")).namespaces.panel!.fields.存款).toEqual({value: 1000});
            expect(panelOf(engine, "xia", end("ch5")).namespaces.panel!.fields.存款).toEqual({value: 500});
            expect(engine.pending(end("ch6"))).toEqual([{kind: "cannot-apply", root: "c3", changes: ["c3"]}]);
        });

        test("前面修好以后诊断消失", () => {
            const fixed = world();
            fixed.entries.get("xia")!.init.data.panel!.fields.存款 = 40000;
            const engine = createEngine(fixed.inputs());
            expect(engine.outcome("c3")).toEqual({applied: true});
            expect(panelOf(engine, "jin", end("ch3")).namespaces.panel!.fields.存款).toEqual({value: 2000});
            expect(engine.pending(end("ch6"))).toEqual([]);
        });
    });

    describe("canon.model 场景 2：核对点与嫌疑区间（输出 11、12）", () => {
        const world = (second: number) =>
            new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 40000}}, {initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}}})
                .change("c2", chapter("ch2"), [add("xia", "panel.存款", second, {basis: {kind: "estimate", note: "估的"}})])
                .change("c3", chapter("ch3", 20), [add("xia", "panel.存款", 2000)])
                .check("k1", "xia", "panel.存款", 41800, chapter("ch3", 90));

        test("对不上进待处理，嫌疑记录里带估计的排第一；值旁边给出正文写的数", () => {
            const engine = createEngine(world(-300).inputs());
            expect(engine.pending(end("ch6"))).toEqual([{kind: "check-mismatch", check: "k1", at: {entry: "xia", path: "panel.存款"}, computed: 41700, written: 41800, suspects: ["c2", "init", "c3"]}]);
            expect(panelOf(engine, "xia", end("ch3")).namespaces.panel!.fields.存款).toEqual({value: 41700, textSays: 41800});
            expect(engine.pending(end("ch2"))).toEqual([]);
        });

        test("改对以后待处理消失；挂在变更之前的核对点比它之前的值，那条变更待定时回到 place 上比较", () => {
            const fixed = world(-200).check("k2", "xia", "panel.存款", 39800, chapter("ch3", 95), {anchor: {change: "c3", side: "before"}});
            let engine = createEngine(fixed.inputs());
            expect(engine.pending(end("ch6"))).toEqual([]);
            fixed.changes.set("c3", {...fixed.changes.get("c3")!, status: "held", held: {reason: "unsure", note: "不确定"}});
            engine = createEngine(fixed.inputs());
            const pending = engine.pending(end("ch6"));
            expect(pending).toContainEqual({kind: "held", change: "c3", reason: "unsure"});
            // c3 待定后存款停在 39800：k1（41800）对不上，k2 在 place 上比较 39800，对得上。
            expect(pending).toContainEqual(expect.objectContaining({kind: "check-mismatch", check: "k1", computed: 39800}));
            if (pending === "chapter-not-found") throw new Error("unexpected");
            expect(pending.some((item) => item.kind === "check-mismatch" && item.check === "k2")).toBe(false);
        });

        test("上一个对得上的核对点挂在某条变更之后：那条变更在它之前，不算嫌疑", () => {
            const anchored = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 40000}}, {initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}}})
                .change("c3", chapter("ch3", 20), [add("xia", "panel.存款", 2000)])
                .check("k2", "xia", "panel.存款", 42000, chapter("ch3", 95), {anchor: {change: "c3", side: "after"}})
                .change("c4", chapter("ch4"), [add("xia", "panel.存款", 100)])
                .check("k3", "xia", "panel.存款", 50000, chapter("ch5"));
            const engine = createEngine(anchored.inputs());
            expect(engine.pending(end("ch6"))).toEqual([{kind: "check-mismatch", check: "k3", at: {entry: "xia", path: "panel.存款"}, computed: 42100, written: 50000, suspects: ["c4"]}]);
        });

        test("上一个核对点也对不上：这条的区间从它起，它之前的记录只在它自己那条里列出", () => {
            const diverged = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 40000}}, {initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}}})
                .change("c2", chapter("ch2"), [add("xia", "panel.存款", -300)])
                .check("k2", "xia", "panel.存款", 39800, chapter("ch2", 90))
                .change("c3", chapter("ch3"), [add("xia", "panel.存款", 2000)])
                .check("k3", "xia", "panel.存款", 41800, chapter("ch3", 90));
            const engine = createEngine(diverged.inputs());
            expect(engine.pending(end("ch6"))).toEqual([
                {kind: "check-mismatch", check: "k2", at: {entry: "xia", path: "panel.存款"}, computed: 39700, written: 39800, suspects: ["init", "c2"]},
                {kind: "check-mismatch", check: "k3", at: {entry: "xia", path: "panel.存款"}, computed: 41700, written: 41800, suspects: ["c3"]},
            ]);
        });
    });

    describe("canon.model 场景 5：语义档（输出 9）", () => {
        const world = () =>
            new WorldBuilder()
                .entry("jin", "星瑾", {character: {态度: "冷淡"}})
                .change("c1", chapter("ch1"), [note("jin", "character.态度", "第 1 章：软了一点")])
                .change("c2", chapter("ch2"), [note("jin", "character.态度", "第 2 章：叫了一声哥")])
                .check("k3", "jin", "character.态度", 1, chapter("ch3"));

        test("缓存里有归纳时读到归纳，没有时读到起点加事件并标未归纳", () => {
            const plain = createEngine(world().inputs());
            expect(panelOf(plain, "jin", end("ch2")).namespaces.character!.fields.态度).toEqual({label: "现在的态度", value: "冷淡；之后：第 1 章：软了一点；第 2 章：叫了一声哥", notReduced: true, unreduced: {anchor: "冷淡", events: 2}});
            const cached = world();
            cached.reductions = (input) => (input.anchor === "冷淡" && input.events.length === 2 ? "开始缓和" : undefined);
            expect(panelOf(createEngine(cached.inputs()), "jin", end("ch2")).namespaces.character!.fields.态度).toEqual({label: "现在的态度", value: "开始缓和"});
        });

        test("正文写明的数是新的起点，之后从这里重新开始", () => {
            const engine = createEngine(world().inputs());
            expect(panelOf(engine, "jin", end("ch3")).namespaces.character!.fields.态度).toEqual({label: "现在的态度", value: "1"});
        });
    });

    describe("canon.model 输出 6、7：补丁的执行与不适用", () => {
        test("列表、别名、块的增删改", () => {
            const world = new WorldBuilder().entry("xia", "星瑕", {panel: {}}).change("c1", chapter("ch1"), [
                {op: "listAdd", at: {entry: "xia", path: "panel.物品"}, value: {id: "i1", label: "药", 数量: 2}},
                {op: "add", at: {entry: "xia", path: "panel.物品[i1].数量"}, value: 1},
                {op: "aliasAdd", at: {entry: "xia", path: "entry.aliases"}, value: "夜王"},
                {op: "addBlock", at: {entry: "xia", path: "text[b1]"}, value: {after: null, source: "第一段"}},
                {op: "addBlock", at: {entry: "xia", path: "text[b2]"}, value: {after: "b1", source: "第二段"}},
            ]).change("c2", chapter("ch2"), [
                {op: "replaceBlock", at: {entry: "xia", path: "text[b1]"}, value: "第一段改"},
                {op: "removeBlock", at: {entry: "xia", path: "text[b2]"}, value: null},
                {op: "listRemove", at: {entry: "xia", path: "panel.物品"}, value: "i1"},
            ]);
            const engine = createEngine(world.inputs());
            const ch1 = panelOf(engine, "xia", end("ch1"));
            expect(ch1.namespaces.panel!.fields.物品!.value).toEqual([{id: "i1", label: "药", 数量: 3}]);
            expect(ch1.aliases).toEqual(["夜王"]);
            expect(ch1.text).toEqual([{id: "b1", source: "第一段"}, {id: "b2", source: "第二段"}]);
            const ch2 = panelOf(engine, "xia", end("ch2"));
            expect(ch2.text).toEqual([{id: "b1", source: "第一段改"}]);
            expect(ch2.namespaces.panel!.fields.物品!.value).toEqual([]);
        });

        test("删不存在的元素、未知的数加减：整条套不上，原因写清", () => {
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {}})
                .change("c1", chapter("ch1"), [{op: "listRemove", at: {entry: "xia", path: "panel.物品"}, value: "i9"}])
                .change("c2", chapter("ch2"), [add("xia", "panel.魔力", 10)]);
            const engine = createEngine(world.inputs());
            expect(engine.outcome("c1")).toEqual({applied: false, reason: "element-missing", failedPatch: 0});
            expect(engine.outcome("c2")).toEqual({applied: false, reason: "unknown-value", failedPatch: 0});
        });

        test("命名空间在这个位置没启用：只跳过这个补丁，同一条的别的补丁照套（不适用）；启用前的位置给出起始值", () => {
            const world = new WorldBuilder().entry("xia", "星瑕", {panel: {存款: 100}, character: {状态: "在家"}});
            world.entries.get("xia")!.init.data.panel!.enabled = false;
            world
                .change("c2", chapter("ch2"), [add("xia", "panel.存款", 5), set("xia", "character.状态", "出门")])
                .change("c3", chapter("ch3"), [set("xia", "panel.启用", true), add("xia", "panel.存款", 10)]);
            const engine = createEngine(world.inputs());
            expect(engine.outcome("c2")).toEqual({applied: true});
            const ch2 = panelOf(engine, "xia", end("ch2"));
            expect(ch2.namespaces.panel).toBeUndefined();
            expect(ch2.namespaces.character!.fields.状态!.value).toBe("出门");
            expect(ch2.upcoming).toEqual([{namespace: "panel", from: chapter("ch3"), fields: {存款: 110, 魔力上限: null, 魔力: null, 物品: []}}]);
            expect(panelOf(engine, "xia", end("ch3")).namespaces.panel!.fields.存款!.value).toBe(110);
        });

        test("类型版本对不上：照常读到存下的值并标只读，对它的补丁不适用（canon.components 输出 11）", () => {
            const world = new WorldBuilder().entry("xia", "星瑕", {panel: {存款: 100}}).change("c1", chapter("ch1"), [add("xia", "panel.存款", 5)]);
            world.declarations = [{...world.declarations[0]!, version: 2}, world.declarations[1]!];
            const view = panelOf(createEngine(world.inputs()), "xia", end("ch1"));
            expect(view.namespaces.panel!.readOnly).toBe("component-version-unsupported");
            expect(view.namespaces.panel!.fields.存款!.value).toBe(100);
        });
    });

    describe("canon.model 输出 5、13：计划进展与按计划模式", () => {
        const world = () =>
            new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 1000}, character: {状态: "平常"}})
                .plan("p4", chapter("ch4"), [add("xia", "panel.存款", -300), set("xia", "character.状态", "救下风信子")]);

        test("没兑现的计划按计划读才算；安放在已写章节上的计划从下一章开头起算", () => {
            const noWritten = createEngine(world().inputs());
            expect(panelOf(noWritten, "xia", end("ch4"), "planned").namespaces.panel!.fields.存款!.value).toBe(700);
            expect(panelOf(noWritten, "xia", end("ch4")).namespaces.panel!.fields.存款!.value).toBe(1000);
            const written = createEngine(world().change("w4", chapter("ch4", 10), [set("xia", "character.状态", "出门")]).inputs());
            expect(panelOf(written, "xia", end("ch4"), "planned").namespaces.panel!.fields.存款!.value).toBe(1000);
            expect(panelOf(written, "xia", start("ch5"), "planned").namespaces.panel!.fields.存款!.value).toBe(700);
        });

        test("canon.model 场景 3：部分兑现与拆出；撤销兑现后原计划回来、拆出的一起不生效", () => {
            const base = world()
                .change("w4", chapter("ch4", 10), [add("xia", "panel.存款", -50)], {links: [{kind: "fulfills", plan: "p4"}]})
                .plan("p5", chapter("ch5", 0), [set("xia", "character.状态", "救下风信子")], {links: [{kind: "splitFrom", plan: "p4", by: "w4"}]});
            const engine = createEngine(base.inputs());
            expect(engine.progress("p4", end("ch4"))).toBe("fulfilled");
            expect(engine.progress("p4", start("ch4"))).toBe("unfulfilled");
            const ch5 = panelOf(engine, "xia", end("ch5"), "planned");
            expect(ch5.namespaces.panel!.fields.存款!.value).toBe(950);
            expect(ch5.namespaces.character!.fields.状态!.value).toBe("救下风信子");
            base.changes.set("w4", {...base.changes.get("w4")!, status: "undone", undoneReason: "撤销"});
            const undone = createEngine(base.inputs());
            expect(undone.progress("p4", end("ch6"))).toBe("unfulfilled");
            const after = panelOf(undone, "xia", end("ch5"), "planned");
            expect(after.namespaces.panel!.fields.存款!.value).toBe(700);
            expect(after.namespaces.character!.fields.状态!.value).toBe("救下风信子");
        });

        test("取消与被替代与位置无关", () => {
            const base = world().plan("p6", chapter("ch6"), [], {links: [{kind: "replaces", plan: "p4"}]});
            expect(createEngine(base.inputs()).progress("p4", start("ch1"))).toBe("replaced");
            base.changes.set("p4", {...base.changes.get("p4")!, status: "undone"});
            expect(createEngine(base.inputs()).progress("p4", start("ch1"))).toBe("cancelled");
        });
    });

    describe("canon.model 输出 16：按计划模式的待处理", () => {
        test("计划让后面的核对点对不上、计划自己套不上：只在按计划模式的待处理里，嫌疑区间里有那条计划", () => {
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 1000, 魔力: 10}})
                .plan("p2", chapter("ch2"), [add("xia", "panel.存款", -300)])
                .plan("p3", chapter("ch3", 10), [add("xia", "panel.魔力", -50)])
                .check("k4", "xia", "panel.存款", 1000, chapter("ch4", 90));
            const engine = createEngine(world.inputs());
            expect(engine.pending(end("ch5"))).toEqual([]);
            expect(engine.pending(end("ch5"), "planned")).toEqual([
                {kind: "cannot-apply", root: "p3", changes: ["p3"]},
                {kind: "check-mismatch", check: "k4", at: {entry: "xia", path: "panel.存款"}, computed: 700, written: 1000, suspects: ["init", "p2"]},
            ]);
            // 读取位置在计划之前：计划不计入，待处理照实际模式。
            expect(engine.pending(end("ch1"), "planned")).toEqual([]);
        });
    });

    describe("canon.model 输出 7、8 与失败表 cannot-apply：套不上的原因、跨字段约束标在哪里", () => {
        test.each<[string, string, Patch]>([
            ["类型不符（给数值字段赋文字）", "type-mismatch", set("xia", "panel.存款", "四万")],
            ["增一个已有的元素 id 套不上", "type-mismatch", {op: "listAdd", at: {entry: "xia", path: "panel.物品"}, value: {id: "i1", label: "药", 数量: 1}}],
            ["赋的数超出精确档的范围", "number-out-of-range", set("xia", "panel.存款", 1e11)],
            ["加的数超出精确档的范围", "number-out-of-range", add("xia", "panel.存款", 1e11)],
            ["加的数超过 4 位小数", "number-out-of-range", add("xia", "panel.存款", 0.00001)],
        ])("%s：整条套不上，原因是 %s，该地址从这里起不完整", (_name, reason, patch) => {
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 100, 物品: [{id: "i1", label: "药", 数量: 1}]}})
                .change("c1", chapter("ch1"), [patch]);
            const engine = createEngine(world.inputs());
            expect(engine.outcome("c1")).toMatchObject({applied: false, reason});
            expect(engine.pending(end("ch1"))).toEqual([{kind: "cannot-apply", root: "c1", changes: ["c1"]}]);
        });

        test("跨字段约束（魔力的 max 引用魔力上限）不满足：标不完整的是被约束的字段魔力，不只是补丁写的地址", () => {
            // c1 把上限调到 3，魔力 5 就超了：补丁写的是魔力上限，被约束的是魔力。
            const lowered = new WorldBuilder().entry("xia", "星瑕", {panel: {魔力上限: 10, 魔力: 5}}).change("c1", chapter("ch1"), [set("xia", "panel.魔力上限", 3)]);
            const engine = createEngine(lowered.inputs());
            expect(engine.outcome("c1")).toMatchObject({applied: false, reason: "constraint-violated"});
            const fields = panelOf(engine, "xia", end("ch1")).namespaces.panel!.fields;
            expect(fields.魔力).toEqual({value: 5, incomplete: {change: "c1", reason: "constraint-violated"}});
            expect(fields.魔力上限).toEqual({value: 10, incomplete: {change: "c1", reason: "constraint-violated"}});

            // c2 直接给魔力加到超过上限：只标魔力，上限本身没有被动。
            const exceeded = new WorldBuilder().entry("xia", "星瑕", {panel: {魔力上限: 10, 魔力: 5}}).change("c2", chapter("ch1"), [add("xia", "panel.魔力", 8)]);
            const exceededFields = panelOf(createEngine(exceeded.inputs()), "xia", end("ch1")).namespaces.panel!.fields;
            expect(exceededFields.魔力).toEqual({value: 5, incomplete: {change: "c2", reason: "constraint-violated"}});
            expect(exceededFields.魔力上限).toEqual({value: 10});
        });

        test("上限是未知时这一项不检查：加到多大都套得上", () => {
            const world = new WorldBuilder().entry("xia", "星瑕", {panel: {魔力上限: null, 魔力: 5}}).change("c1", chapter("ch1"), [add("xia", "panel.魔力", 1000)]);
            const engine = createEngine(world.inputs());
            expect(engine.outcome("c1")).toEqual({applied: true});
            expect(panelOf(engine, "xia", end("ch1")).namespaces.panel!.fields.魔力).toEqual({value: 1005});
        });
    });

    describe("canon.model 输出 11：不比较的两种情形", () => {
        test("核对点的地址在比较时点不完整：不比较，不成待处理；来历里记“无法核对”", () => {
            // c1 让存款低于下限而套不上，存款从第 1 章起不完整；第 2 章的核对点写的数与算出来的不同，也不报。
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 1000}})
                .change("c1", chapter("ch1"), [add("xia", "panel.存款", -5000)])
                .check("k1", "xia", "panel.存款", 777, chapter("ch2"));
            const engine = createEngine(world.inputs());
            expect(engine.pending(end("ch3"))).toEqual([{kind: "cannot-apply", root: "c1", changes: ["c1"]}]);
            expect(engine.origins({entry: "xia", path: "panel.存款"}, end("ch3"), "actual")).toEqual([
                {kind: "init", value: 1000},
                {kind: "check", check: "k1", written: 777, result: "skipped"},
            ]);
        });

        test("核对点所在的条目已删除：不比较，不成待处理", () => {
            const world = new WorldBuilder()
                .entry("old", "旧人", {panel: {存款: 5}}, {deleted: true})
                .entry("xia", "星瑕", {panel: {存款: 5}})
                .check("k1", "old", "panel.存款", 99, chapter("ch2"))
                .check("k2", "xia", "panel.存款", 99, chapter("ch2"));
            const engine = createEngine(world.inputs());
            // 没有被删的条目上同样的核对点会报，说明上面的不报不是核对点本身的问题。
            expect(engine.pending(end("ch3"))).toEqual([{kind: "check-mismatch", check: "k2", at: {entry: "xia", path: "panel.存款"}, computed: 5, written: 99, suspects: ["init"]}]);
        });
    });

    describe("canon.model 验收场景 6：删章", () => {
        const world = () =>
            new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 1000}})
                .change("c2", chapter("ch2"), [add("xia", "panel.存款", 200)])
                .change("c3", chapter("ch3"), [add("xia", "panel.存款", 30)]);
        const withoutCh2 = (builder: WorldBuilder) => {
            builder.chapters = builder.chapters.filter((id) => id !== "ch2");
            return builder;
        };

        test("安放在被删章上的变更不再套用，各成一条“章已删除”；第 3 章以后的值相应变化；读被删章得 chapter-not-found", () => {
            const before = createEngine(world().inputs());
            expect(panelOf(before, "xia", end("ch3")).namespaces.panel!.fields.存款).toEqual({value: 1230});
            expect(before.pending(end("ch6"))).toEqual([]);

            const engine = createEngine(withoutCh2(world()).inputs());
            expect(panelOf(engine, "xia", end("ch3")).namespaces.panel!.fields.存款).toEqual({value: 1030});
            expect(engine.pending(end("ch6"))).toEqual([{kind: "chapter-deleted", ref: {kind: "change", id: "c2"}}]);
            expect(engine.entry("xia", start("ch2"), "actual")).toBe("chapter-not-found");
        });

        test("把它们挪到第 3 章后，待处理消失，值回来", () => {
            const moved = withoutCh2(world());
            moved.changes.set("c2", {...moved.changes.get("c2")!, at: chapter("ch3", 90)});
            const engine = createEngine(moved.inputs());
            expect(engine.pending(end("ch6"))).toEqual([]);
            expect(panelOf(engine, "xia", end("ch3")).namespaces.panel!.fields.存款).toEqual({value: 1230});
        });
    });

    describe("canon.model 输出 14、15、16、20", () => {
        test("出场之前标尚未出场；删除的条目读到墓碑、对它的补丁套不上", () => {
            const world = new WorldBuilder()
                .entry("bai", "白灵", {}, {appears: chapter("ch3", 10)})
                .entry("old", "旧人", {panel: {存款: 1}}, {deleted: true})
                .change("c1", chapter("ch1"), [add("old", "panel.存款", 1)]);
            const engine = createEngine(world.inputs());
            expect(panelOf(engine, "bai", start("ch3")).appeared).toBe(false);
            expect(panelOf(engine, "bai", end("ch3")).appeared).toBe(true);
            expect(panelOf(engine, "old", end("ch1"))).toMatchObject({deleted: true, name: "旧人"});
            expect(engine.outcome("c1")).toEqual({applied: false, reason: "entry-missing", failedPatch: 0});
        });

        test("来历按先后列出初值、每一步与核对点", () => {
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 40000}}, {initBasis: {"panel.存款": {kind: "quote", quote: "四万"}}})
                .change("c2", chapter("ch2"), [add("xia", "panel.存款", -300, {basis: {kind: "estimate", note: "估"}})])
                .check("k3", "xia", "panel.存款", 39700, chapter("ch3"));
            const origins = createEngine(world.inputs()).origins({entry: "xia", path: "panel.存款"}, end("ch3"), "actual");
            expect(origins).toEqual([
                {kind: "init", value: 40000, basis: {kind: "quote", quote: "四万"}},
                {kind: "patch", change: "c2", op: "add", result: 39700, basis: {kind: "estimate", note: "估"}},
                {kind: "check", check: "k3", written: 39700, result: "ok"},
            ]);
        });

        test("待处理的排序：按位置，同一位置按种类，章已删除的排最后；读取位置指向不在章序里的章得到 chapter-not-found", () => {
            const world = new WorldBuilder()
                .entry("xia", "星瑕", {panel: {存款: 0}})
                .change("c1", chapter("ch1"), [add("xia", "panel.存款", -1)])
                .change("c2", chapter("gone"), [add("xia", "panel.存款", 1)])
                .change("c3", chapter("ch2"), [], {status: "held", held: {reason: "conflict", note: "金色与碧色"}});
            const engine = createEngine(world.inputs());
            expect(engine.pending(end("ch6"))).toEqual([
                {kind: "cannot-apply", root: "c1", changes: ["c1"]},
                {kind: "held", change: "c3", reason: "conflict"},
                {kind: "chapter-deleted", ref: {kind: "change", id: "c2"}},
            ]);
            expect(engine.pending(start("gone"))).toBe("chapter-not-found");
            expect(engine.chapterEntries("ch1")).toEqual(["xia"]);
        });
    });
});
