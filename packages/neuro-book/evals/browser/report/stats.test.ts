import {describe, expect, test} from "bun:test";

import {bootstrapMean, bootstrapPairedDiff, conservativeVariance, equalWeightMean, median, quantile, repeatAdvice, repeatsNeeded, rescaled, summarizeTask} from "./stats";

/** 两次 0 与 100 放大之后的两个值：50 ± 50 × sqrt(2)。 */
const LOW = 50 - 50 * Math.SQRT2;
const HIGH = 50 + 50 * Math.SQRT2;

function close(interval: {lower: number; upper: number}): [number, number] {
    return [Number(interval.lower.toFixed(6)), Number(interval.upper.toFixed(6))];
}

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
    test("重抽前把偏差放大 sqrt(n/(n−1))：重抽均值的方差回到样本方差除以 n 的口径；只有 1 次的不变", () => {
        expect(rescaled([0, 100])).toEqual([LOW, HIGH]);
        const five = rescaled([0, 100, 100, 100, 100]);
        const m = five.reduce((a, b) => a + b, 0) / 5;
        // 放大后按“除以 n”算的方差，等于原来的样本方差（除以 n − 1）：2000。
        expect(five.reduce((sum, x) => sum + (x - m) ** 2, 0) / 5).toBeCloseTo(2000, 9);
        expect(rescaled([40])).toEqual([40]);
    });

    test("在题内对各次运行重抽样：一题两次 0 与 100，重抽的均值只有三种，区间是最低到最高", () => {
        // 若误对题重抽样，只有一题时每次都抽到同一题，均值恒为 50，区间缩成一点。
        expect(close(bootstrapMean([{taskId: "a", scores: [0, 100]}]))).toEqual(close({lower: LOW, upper: HIGH}));
    });

    test("两题各题等权：一题波动、一题恒为 50，均分在两者的平均上波动", () => {
        expect(close(bootstrapMean([{taskId: "a", scores: [0, 100]}, {taskId: "b", scores: [50, 50]}]))).toEqual(close({lower: (LOW + 50) / 2, upper: (HIGH + 50) / 2}));
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

    test("配对差在两边都重抽样：一边恒定、另一边 0 与 100 时，差的区间跟着那一边波动", () => {
        expect(close(bootstrapPairedDiff([{taskId: "a", scores: [0, 100]}], [{taskId: "a", scores: [100]}]).interval)).toEqual(close({lower: LOW - 100, upper: HIGH - 100}));
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
