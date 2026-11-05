import {describe, expect, test} from "bun:test";

import {assembleNetwork, compileCalendar, dateRange, DEFAULT_FUZZY, lowerStatement, solveNetwork, type Calendar, type NetworkConstraint, type Statement} from "../src/index";

const origin = {kind: "origin"} as const;
const start = (id: string) => ({kind: "event", id, edge: "start"}) as const;
const between = (from: NetworkConstraint["from"], to: NetworkConstraint["to"], lo: number, hi: number, ref: string): NetworkConstraint => ({from, to, lo, hi, ref});

function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * 参照实现：一个共用的元年加全部事件的 Floyd-Warshall。全部可行时，与按分量各带一份元年的求法结果相同（每个分量的解可以平移）。
 */
function floyd(events: readonly string[], constraints: readonly NetworkConstraint[]) {
    const index = new Map(events.map((id, i) => [id, i + 1]));
    const n = events.length + 1;
    const d = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => (i === j ? 0 : Number.POSITIVE_INFINITY)));
    const at = (ref: NetworkConstraint["from"]) => (ref.kind === "origin" ? 0 : index.get(ref.id)!);
    for (const c of constraints) {
        const [u, v] = [at(c.from), at(c.to)];
        if (Number.isFinite(c.hi)) d[u]![v] = Math.min(d[u]![v]!, c.hi);
        if (Number.isFinite(c.lo)) d[v]![u] = Math.min(d[v]![u]!, -c.lo);
    }
    for (let k = 0; k < n; k += 1) for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) if (d[i]![k]! + d[k]![j]! < d[i]![j]!) d[i]![j] = d[i]![k]! + d[k]![j]!;
    return {d, index};
}

describe("canon.time 输出 1、10：网络与参照实现对拍", () => {
    test("随机的可行网络（日期、之后、之前、无穷的上界）：每件事的范围、两件事的差都与 Floyd-Warshall 相同", () => {
        for (let seed = 1; seed <= 60; seed += 1) {
            const rnd = seeded(seed);
            const events = Array.from({length: 2 + Math.floor(rnd() * 7)}, (_, i) => `c${String(i)}`);
            // 先定一组隐藏的时刻，再围着它出约束：一定可行。
            const time = new Map(events.map((id) => [id, Math.floor(rnd() * 1000)]));
            const constraints: NetworkConstraint[] = [];
            for (let k = 0; k < Math.floor(rnd() * 10); k += 1) {
                const ref = `s${String(k)}`;
                const b = events[Math.floor(rnd() * events.length)]!;
                const width = () => Math.floor(rnd() * 50);
                if (rnd() < 0.35) {
                    const value = time.get(b)!;
                    constraints.push(between(origin, start(b), value - width(), rnd() < 0.2 ? Number.POSITIVE_INFINITY : value + width(), ref));
                } else {
                    const a = events[Math.floor(rnd() * events.length)]!;
                    if (a === b) continue;
                    const diff = time.get(b)! - time.get(a)!;
                    constraints.push(between(start(a), start(b), diff - width(), rnd() < 0.2 ? Number.POSITIVE_INFINITY : diff + width(), ref));
                }
            }
            const network = solveNetwork({events, constraints});
            const {d, index} = floyd(events, constraints);
            expect(network.conflicts).toEqual([]);
            for (const id of events) {
                const range = network.range(id);
                if (range.state !== "ok") continue;
                const v = index.get(id)!;
                const source = range.anchored ? 0 : index.get(range.relativeTo!)!;
                expect([range.lo, range.hi], `种子 ${String(seed)} 事件 ${id}`).toEqual([0 - d[v]![source]!, d[source]![v]!]);
            }
            for (const a of events) for (const b of events) {
                const result = network.between(a, b);
                if (result.state !== "ok") continue;
                const [u, v] = [index.get(a)!, index.get(b)!];
                expect([result.lo, result.hi], `种子 ${String(seed)} ${a}→${b}`).toEqual([0 - d[v]![u]!, d[u]![v]!]);
            }
        }
    });

    test("同一份输入算两次逐字相同（输出 10）", () => {
        const constraints = [between(origin, start("a"), 0, 100, "s1"), between(start("a"), start("b"), 5, 10, "s2"), between(origin, start("b"), 0, 120, "s3")];
        expect(JSON.stringify(solveNetwork({events: ["a", "b"], constraints}).range("b"))).toBe(JSON.stringify(solveNetwork({events: ["a", "b"], constraints}).range("b")));
    });
});

describe("canon.time 输出 2、验收 3：打架与局部降级", () => {
    test("A 在 B 之后三天、B 在 C 之后两天、A 在 C 之前：三件事都不可确定，一条打架列出三条说法；另一组照常", () => {
        const day = 1440;
        const constraints = [
            between(start("B"), start("A"), 3 * day, 3 * day, "A 在 B 之后三天"),
            between(start("C"), start("B"), 2 * day, 2 * day, "B 在 C 之后两天"),
            between(start("A"), start("C"), 0, Number.POSITIVE_INFINITY, "A 在 C 之前"),
            between(origin, start("D"), 10 * day, 11 * day - 1, "D 的日期"),
            between(start("D"), start("E"), day, day, "E 在 D 之后一天"),
        ];
        const network = solveNetwork({events: ["A", "B", "C", "D", "E"], constraints});
        expect(network.conflicts).toEqual([{refs: ["A 在 B 之后三天", "B 在 C 之后两天", "A 在 C 之前"], events: expect.arrayContaining(["A", "B", "C"])}]);
        for (const id of ["A", "B", "C"]) expect(network.range(id)).toEqual({state: "conflict", conflicts: [0]});
        expect(network.range("E")).toMatchObject({state: "ok", anchored: true, lo: 11 * day, hi: 12 * day - 1, earliest: {refs: ["D 的日期", "E 在 D 之后一天"]}});
    });

    test("两条日期互相矛盾只影响那一件事（分量不经元年连起来）；一个分量里几个互不相干的环各报一条", () => {
        const network = solveNetwork({events: ["a", "b"], constraints: [between(origin, start("a"), 0, 10, "早"), between(origin, start("a"), 20, 30, "晚"), between(origin, start("b"), 0, 10, "b 的日期")]});
        expect(network.conflicts).toEqual([{refs: ["早", "晚"], events: ["a"]}]);
        expect(network.range("b")).toMatchObject({state: "ok", lo: 0, hi: 10});
        const twice = solveNetwork({events: ["x", "y", "z"], constraints: [
            between(start("x"), start("y"), 5, 5, "y=x+5"), between(start("y"), start("x"), 0, Number.POSITIVE_INFINITY, "x 在 y 之后"),
            between(start("y"), start("z"), 1, 1, "z=y+1"), between(origin, start("z"), 0, 0, "z 是 0"), between(origin, start("z"), 9, 9, "z 是 9"),
        ]});
        expect(twice.conflicts.map((conflict) => conflict.refs.length)).toEqual([2, 2]);
    });

    test("一条说法自己成的环（出生的那件事上写他三岁）：打架记在说法所在的事上，不是分量里安放最早的那件", () => {
        const network = solveNetwork({events: ["early", "E"], constraints: [between(start("E"), start("early"), 0, Number.POSITIVE_INFINITY, "early 在 E 之后"), between(start("E"), start("E"), 3, 3, "E 时三岁")]});
        expect(network.conflicts).toEqual([{refs: ["E 时三岁"], events: ["E"]}]);
    });
});

describe("canon.time 输出 1：依据", () => {
    test("最晚由一条直接的日期定下时，依据取跳数少的那条（不走绕远的同长路径）", () => {
        const network = solveNetwork({events: ["a", "b"], constraints: [between(origin, start("a"), 0, 100, "a 的日期"), between(start("a"), start("b"), 0, 50, "b 在 a 之后"), between(origin, start("b"), 0, 150, "b 的日期")]});
        expect(network.range("b")).toMatchObject({state: "ok", lo: 0, hi: 150, latest: {refs: ["b 的日期"], total: 1}});
    });

    test("没有锚的分量：范围相对安放最早的那件事", () => {
        const network = solveNetwork({events: ["p", "q"], constraints: [between(start("p"), start("q"), 2880, 2880, "第二天")]});
        expect(network.range("q")).toMatchObject({state: "ok", anchored: false, relativeTo: "p", lo: 2880, hi: 2880});
        expect(network.range("p")).toMatchObject({state: "ok", relativeTo: "p", lo: 0, hi: 0});
        expect(network.between("p", "q")).toEqual({state: "ok", lo: 2880, hi: 2880});
    });
});

describe("canon.time 输出 17：组网时的端点", () => {
    const author = {kind: "author"} as const;
    const compiled = compileCalendar({version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: [{id: "m1", name: "一月", days: 30}]});
    const lowered = (statements: Statement[]) => statements.map((statement, index) => ({ref: `s${String(index)}`, lowered: lowerStatement(statement, compiled, DEFAULT_FUZZY)}));

    test("of 不是事件：不进网络、不报；变更已经不存在：target-missing；马甲按本体；几件出生事件：birth-ambiguous；没有出生事件：不进、不报", () => {
        const assembled = assembleNetwork({
            events: [
                {id: "c1", statements: lowered([{kind: "after", of: "plan9", basis: author}, {kind: "after", of: "gone", basis: author}])},
                {id: "c2", statements: lowered([{kind: "birth", who: "mask", basis: author}])},
                {id: "c3", statements: lowered([{kind: "age", who: "hero", years: {min: 15, max: 15}, basis: author}, {kind: "age", who: "twin", years: {min: 1, max: 1}, basis: author}, {kind: "age", who: "nobody", years: {min: 1, max: 1}, basis: author}])},
                {id: "c4", statements: lowered([{kind: "birth", who: "twin", basis: author}])},
                {id: "c5", statements: lowered([{kind: "birth", who: "twin", basis: author}])},
            ],
            exists: (id) => id !== "gone",
            bodyOf: (id) => (id === "mask" ? "hero" : id),
        });
        expect(assembled.invalid).toEqual([{event: "c1", ref: "s1", reason: "target-missing"}, {event: "c3", ref: "s1", reason: "birth-ambiguous", involves: ["c4", "c5"]}]);
        expect(assembled.births.get("hero")).toEqual(["c2"]);
        expect(assembled.constraints).toEqual([{from: start("c2"), to: start("c3"), lo: 15 * 30, hi: 16 * 30 - 1, ref: "s0"}]);
    });

    test("没有 lasts 的事终点就是起点：别的说法指到它的终点，与指到起点相同，不会因此没了上界；写了 lasts 的才有自己的终点", () => {
        const end = (id: string) => ({kind: "event", id, edge: "end"}) as const;
        const day = 1440;
        const network = solveNetwork({events: ["X", "E", "F", "L", "G"], constraints: [
            between(origin, start("X"), 0, day - 1, "X 的日期"),
            between(end("X"), start("E"), day, 3 * day, "E 在 X 结束后一到三天"),
            between(start("X"), start("F"), day, 3 * day, "F 在 X 开始后一到三天"),
            between(origin, start("L"), 0, day - 1, "L 的日期"), between(start("L"), end("L"), 2 * day, 2 * day, "L 持续两天"),
            between(end("L"), start("G"), 0, 0, "G 在 L 结束时"),
        ]});
        expect(network.range("E")).toMatchObject({state: "ok", lo: day, hi: 4 * day - 1});
        expect(network.bounds("E")).toEqual(network.bounds("F"));
        expect(network.bounds("X", "end")).toEqual(network.bounds("X", "start"));
        expect(network.bounds("G")).toMatchObject({state: "ok", lo: 2 * day, hi: 3 * day - 1});
    });
});

describe("canon.time 验收 1：“5 日之后三天”落在 8 日", () => {
    test("王历 612 年霜月 5 日的事，三天之后的那件落在 8 日一整天", () => {
        const royal: Calendar = {version: 1, unit: "minute", hoursPerDay: 48, minutesPerHour: 60, months: Array.from({length: 12}, (_, i) => ({id: `r${String(i + 1)}`, name: `第${String(i + 1)}月`, days: 30})), leap: [{every: 3, months: {r12: 31}}], eras: [{id: "royal", name: "王历", start: 1}]};
        const compiled = compileCalendar(royal);
        const author = {kind: "author"} as const;
        const assembled = assembleNetwork({
            events: [
                {id: "x", statements: [{ref: "x0", lowered: lowerStatement({kind: "date", era: "royal", year: 612, month: "r12", day: 5, basis: author}, compiled, DEFAULT_FUZZY)}]},
                {id: "e", statements: [{ref: "e0", lowered: lowerStatement({kind: "after", of: "x", gap: {min: 3, max: 3, unit: "day"}, basis: author}, compiled, DEFAULT_FUZZY)}]},
            ],
            exists: () => true,
            bodyOf: (id) => id,
        });
        const day8 = dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 8}) as {lo: number; hi: number};
        expect(solveNetwork(assembled).range("e")).toMatchObject({state: "ok", lo: day8.lo, hi: day8.hi});
    });
});

describe("压力：反向次序的长链与带环的长链", () => {
    test("两千件事的链，按安放的逆序给说法：300 毫秒内算完；末端加一条矛盾的说法：整条链不可确定、一条打架", () => {
        const events = Array.from({length: 2000}, (_, i) => `c${String(i)}`);
        const chain = events.slice(1).map((id, i) => between(start(events[i]!), start(id), 1, 2, `链 ${String(i)}`)).reverse();
        const began = performance.now();
        const network = solveNetwork({events, constraints: [...chain, between(origin, start("c0"), 0, 0, "起点")]});
        expect(network.range("c1999")).toMatchObject({state: "ok", lo: 1999, hi: 3998});
        expect(performance.now() - began).toBeLessThan(300);
        const broken = solveNetwork({events, constraints: [...chain, between(origin, start("c0"), 0, 0, "起点"), between(origin, start("c1999"), 0, 10, "末端太早")]});
        expect(broken.conflicts).toHaveLength(1);
        expect(broken.range("c1000")).toMatchObject({state: "conflict"});
    });
});
