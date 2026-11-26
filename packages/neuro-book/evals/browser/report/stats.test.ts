import {describe, expect, test} from "bun:test";

import {bootstrapMean, bootstrapPairedDiff, conservativeVariance, equalWeightMean, median, quantile, repeatAdvice, repeatsNeeded, summarizeTask} from "./stats";

describe("每题的摘要与等权均分", () => {
    test("均值、样本方差（除以 n − 1）、全同分；只有 1 次时没有方差", () => {
        expect(summarizeTask({taskId: "a", scores: [0, 50, 100]})).toEqual({taskId: "a", n: 3, mean: 50, variance: 2500, allSame: false});
        expect(summarizeTask({taskId: "b", scores: [100, 100, 100, 100, 100]})).toEqual({taskId: "b", n: 5, mean: 100, variance: 0, allSame: true});
        expect(summarizeTask({taskId: "c", scores: [40]})).toEqual({taskId: "c", n: 1, mean: 40, variance: null, allSame: false});
    });

    test("各题等权：跑得多的题不多占分量", () => {
        // 按次数平均是 (0 + 0 + 0 + 100 + 100) / 5 = 40；各题等权是 (25 + 100) / 2。
        expect(equalWeightMean([{taskId: "a", scores: [0, 0, 0, 100]}, {taskId: "b", scores: [100]}])).toBe(62.5);
    });

    test("中位数与分位按相邻两数线性插值", () => {
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([])).toBeNull();
        expect(quantile([0, 10, 20, 30, 40], 0.1)).toBe(4);
    });
});

describe("题固定的区间", () => {
    test("在题内对各次运行重抽样：一题两次 0 与 100，重抽的均值只有 0、50、100，区间是 [0, 100]", () => {
        // 若误对题重抽样，只有一题时每次都抽到同一题，均值恒为 50，区间缩成一点。
        expect(bootstrapMean([{taskId: "a", scores: [0, 100]}])).toEqual({lower: 0, upper: 100});
    });

    test("两题各题等权：一题在 0、50、100 之间波动、一题恒为 50，均分只有 25、50、75", () => {
        expect(bootstrapMean([{taskId: "a", scores: [0, 100]}, {taskId: "b", scores: [50, 50]}])).toEqual({lower: 25, upper: 75});
    });

    test("每题都没有波动时区间缩成均分本身；种子一样，结果一样", () => {
        const tasks = [{taskId: "a", scores: [100, 100, 100]}, {taskId: "b", scores: [20, 20]}];
        expect(bootstrapMean(tasks)).toEqual({lower: 60, upper: 60});
        const varied = [{taskId: "a", scores: [0, 30, 60, 100, 100]}, {taskId: "b", scores: [20, 80, 80]}];
        expect(bootstrapMean(varied, {seed: 7})).toEqual(bootstrapMean(varied, {seed: 7}));
    });

    test("配对差只算两边都有的题，各题等权；没有波动时区间就是差本身", () => {
        const ours = [{taskId: "a", scores: [80, 80]}, {taskId: "b", scores: [100]}, {taskId: "only-ours", scores: [0]}];
        const baseline = [{taskId: "a", scores: [100, 100, 100]}, {taskId: "b", scores: [90, 90]}];
        expect(bootstrapPairedDiff(ours, baseline)).toEqual({mean: -5, interval: {lower: -5, upper: -5}, tasks: ["a", "b"]});
    });

    test("配对差在两边都重抽样：一边恒定、另一边 0 与 100 时，差的区间是 [−100, 0]", () => {
        expect(bootstrapPairedDiff([{taskId: "a", scores: [0, 100]}], [{taskId: "a", scores: [100]}]).interval).toEqual({lower: -100, upper: 0});
    });
});

describe("每题要跑几次", () => {
    test("半宽法与功效法照公式：σ̄² = 900、8 题时分别是 ⌈2 × (1.96/5)² × 900 / 8⌉ 与 ⌈2 × (2.8/5)² × 900 / 8⌉", () => {
        expect(repeatsNeeded(900, 8, 1.96)).toBe(Math.ceil(2 * (1.96 / 5) ** 2 * 900 / 8));
        expect(repeatsNeeded(900, 8, 1.96)).toBe(35);
        expect(repeatsNeeded(900, 8, 2.8)).toBe(71);
        expect(repeatsNeeded(0, 8, 2.8)).toBe(1);
    });

    test("全同分的题单列，并按“记 0”与“保守下界 100² × q(1 − q)、q = 1/(n + 2)”各算一遍；不到 2 次的题不进估算", () => {
        const summaries = [
            summarizeTask({taskId: "varied", scores: [0, 50, 100]}),
            summarizeTask({taskId: "perfect", scores: [100, 100, 100, 100, 100]}),
            summarizeTask({taskId: "once", scores: [70]}),
        ];
        const advice = repeatAdvice(summaries);
        expect(advice?.allSameTasks).toEqual(["perfect"]);
        expect(advice?.insufficientTasks).toEqual(["once"]);
        expect(advice?.recommended).toEqual({allSameVariance: "conservative", method: "power"});
        const [zero, conservative] = advice?.estimates ?? [];
        expect(zero?.meanVariance).toBe((2500 + 0) / 2);
        expect(conservativeVariance(5)).toBeCloseTo(10_000 * (1 / 7) * (6 / 7), 9);
        expect(conservative?.meanVariance).toBeCloseTo((2500 + conservativeVariance(5)) / 2, 9);
        expect(conservative?.power).toEqual({T8: repeatsNeeded(conservative?.meanVariance ?? 0, 8, 2.8), T24: repeatsNeeded(conservative?.meanVariance ?? 0, 24, 2.8)});
        expect(zero?.halfWidth).toEqual({T8: repeatsNeeded(1250, 8, 1.96), T24: repeatsNeeded(1250, 24, 1.96)});
        expect(repeatAdvice([summarizeTask({taskId: "once", scores: [70]})])).toBeNull();
    });
});
