/**
 * 评测的统计（设计稿“怎么算‘接近 browser-use’”，t02 决定 5）。
 *
 * 题集当固定的：置信区间只算同一批题上重复运行的波动，结论只说“在这批题上”。
 * 做法是在每道题里对各次运行有放回地重抽样，算各题等权的均分（有两边时算配对差），取 2.5% 与 97.5% 分位；
 * 不对题重抽样（那是把题当成从更大的题库里抽出来的，结论要外推到别的网站，不是这里要回答的问题）。
 *
 * 有放回重抽 n 个的均值，方差是“除以 n”的口径，比样本方差（除以 n − 1，每题次数按它算）小：每题 5 次时区间窄约 11%。
 * 所以重抽之前先把每题各次相对均值的偏差放大 sqrt(n / (n − 1))，两边用同一个口径。只有 1 次的题没有偏差可放大。
 */

import {seededRandom} from "../sites/kit";

/** 一道题在一边的各次计分（0 到 100）。 */
export interface TaskScores {
    readonly taskId: string;
    readonly scores: readonly number[];
}

export interface TaskSummary {
    readonly taskId: string;
    readonly n: number;
    readonly mean: number;
    /** 样本方差（除以 n − 1）；不到 2 次时为 null。 */
    readonly variance: number | null;
    /** 各次同分（2 次以上才算）：方差是 0，但 5 次全对不等于它永远全对，另给保守算法。 */
    readonly allSame: boolean;
}

export interface Interval {
    readonly lower: number;
    readonly upper: number;
}

export interface BootstrapOptions {
    readonly resamples?: number;
    readonly seed?: number;
}

/** 判据的容差：配对差的 95% 置信区间下界不低于 −5 分（t02 决定 3）。 */
export const MARGIN = 5;
const Z_95 = 1.96;
/** 80% 功效对应的单侧分位。 */
const Z_POWER_80 = 0.84;
/** 外推的题数：第一阶段的 8 题，与本地整轮的 24 题。 */
export const PROJECTED_TASK_COUNTS = [8, 24] as const;

const DEFAULT_RESAMPLES = 10_000;
const DEFAULT_SEED = 20261126;

export function mean(values: readonly number[]): number {
    if (values.length === 0) throw new Error("mean of an empty list");
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** 已排好序的数的分位，相邻两个数之间线性插值（R 的第 7 种算法，numpy 的缺省）。 */
export function quantile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) throw new Error("quantile of an empty list");
    const h = (sorted.length - 1) * p;
    const lower = Math.floor(h);
    const a = sorted[lower] as number;
    const b = sorted[Math.min(lower + 1, sorted.length - 1)] as number;
    return a + (h - lower) * (b - a);
}

export function summarizeTask(task: TaskScores): TaskSummary {
    const {scores} = task;
    const average = mean(scores);
    const variance = scores.length < 2 ? null : scores.reduce((sum, score) => sum + (score - average) ** 2, 0) / (scores.length - 1);
    return {taskId: task.taskId, n: scores.length, mean: average, variance, allSame: scores.length >= 2 && scores.every((score) => score === scores[0])};
}

/** 各题等权的均分：每题先对各次取平均，再对题取平均（跑得多的题不多占分量）。 */
export function equalWeightMean(tasks: readonly TaskScores[]): number {
    return mean(tasks.map((task) => mean(task.scores)));
}

/** 重抽用的值：各次相对均值的偏差放大 sqrt(n / (n − 1))（见模块说明）。 */
export function rescaled(scores: readonly number[]): number[] {
    if (scores.length < 2) return [...scores];
    const average = mean(scores);
    const factor = Math.sqrt(scores.length / (scores.length - 1));
    return scores.map((score) => average + (score - average) * factor);
}

function resampledMean(scores: readonly number[], random: () => number): number {
    let sum = 0;
    for (let i = 0; i < scores.length; i++) sum += scores[Math.floor(random() * scores.length)] as number;
    return sum / scores.length;
}

function percentileInterval(statistics: number[]): Interval {
    statistics.sort((a, b) => a - b);
    return {lower: quantile(statistics, 0.025), upper: quantile(statistics, 0.975)};
}

/** 一边的各题等权均分的 95% 区间（题固定，题内重抽样）。 */
export function bootstrapMean(tasks: readonly TaskScores[], options: BootstrapOptions = {}): Interval {
    if (tasks.length === 0) throw new Error("no tasks to resample");
    const random = seededRandom(options.seed ?? DEFAULT_SEED);
    const pools = tasks.map((task) => rescaled(task.scores));
    const statistics: number[] = [];
    for (let b = 0; b < (options.resamples ?? DEFAULT_RESAMPLES); b++) {
        let total = 0;
        for (const pool of pools) total += resampledMean(pool, random);
        statistics.push(total / tasks.length);
    }
    return percentileInterval(statistics);
}

/**
 * 两边逐题配对的差（`ours − baseline`）的各题等权均值与 95% 区间：每题两边各自题内重抽样。
 * 只算两边都有计分的题；只在一边有的题由调用方另列为缺配对。
 */
export function bootstrapPairedDiff(ours: readonly TaskScores[], baseline: readonly TaskScores[], options: BootstrapOptions = {}): {readonly mean: number; readonly interval: Interval; readonly tasks: readonly string[]} {
    const pairs = ours.flatMap((task) => {
        const other = baseline.find((candidate) => candidate.taskId === task.taskId);
        return other === undefined ? [] : [{taskId: task.taskId, ours: task.scores, baseline: other.scores, oursPool: rescaled(task.scores), baselinePool: rescaled(other.scores)}];
    });
    if (pairs.length === 0) throw new Error("no paired tasks");
    const random = seededRandom(options.seed ?? DEFAULT_SEED);
    const statistics: number[] = [];
    for (let b = 0; b < (options.resamples ?? DEFAULT_RESAMPLES); b++) {
        let total = 0;
        for (const pair of pairs) total += resampledMean(pair.oursPool, random) - resampledMean(pair.baselinePool, random);
        statistics.push(total / pairs.length);
    }
    return {mean: mean(pairs.map((pair) => mean(pair.ours) - mean(pair.baseline))), interval: percentileInterval(statistics), tasks: pairs.map((pair) => pair.taskId)};
}

/** 全同分的题的保守方差：把它当成成功率 q = 1/(n+2) 的 0 或 100 分（拉普拉斯平滑）。 */
export function conservativeVariance(n: number): number {
    const q = 1 / (n + 2);
    return 100 ** 2 * q * (1 - q);
}

/**
 * 每题要跑几次，才能在两边水平一样时让配对差的区间下界不低于 −MARGIN：
 * 配对差的方差是 `Σ 2σ²ₜ / r / T²`，要求 `z × 标准差 ≤ MARGIN`，得 `r ≥ 2 × (z / MARGIN)² × Σσ²ₜ / T²`。
 * `Σσ²ₜ` 按每题平均方差外推到 T 题（`T × σ̄²`），所以是 `2 × (z / MARGIN)² × σ̄² / T`。两边方差都用 browser-use 量出来的。
 */
export function repeatsNeeded(meanVariance: number, tasks: number, z: number): number {
    return Math.max(1, Math.ceil(2 * (z / MARGIN) ** 2 * meanVariance / tasks));
}

export interface RepeatEstimate {
    /** 全同分的题的方差怎么记：照实记 0，或按保守算法。 */
    readonly allSameVariance: "zero" | "conservative";
    readonly meanVariance: number;
    /** 半宽法（z = 1.96）：两边水平一样时约一半的机会过判据。键是外推的题数。 */
    readonly halfWidth: Readonly<Record<string, number>>;
    /** 功效法（z = 1.96 + 0.84）：两边水平一样时约 80% 的机会过判据，作推荐。 */
    readonly power: Readonly<Record<string, number>>;
}

export interface RepeatAdvice {
    readonly estimates: readonly RepeatEstimate[];
    /** 推荐采用的：功效法、全同分的题按保守算法。 */
    readonly recommended: {readonly allSameVariance: "conservative"; readonly method: "power"};
    readonly allSameTasks: readonly string[];
    /** 不到 2 次、算不出方差的题，没进估算。 */
    readonly insufficientTasks: readonly string[];
}

export function repeatAdvice(summaries: readonly TaskSummary[]): RepeatAdvice | null {
    const usable = summaries.filter((summary) => summary.variance !== null);
    if (usable.length === 0) return null;
    const estimates = (["zero", "conservative"] as const).map((allSameVariance) => {
        const variances = usable.map((summary) => summary.allSame && allSameVariance === "conservative" ? conservativeVariance(summary.n) : summary.variance as number);
        const meanVariance = mean(variances);
        const per = (z: number) => Object.fromEntries(PROJECTED_TASK_COUNTS.map((count) => [`T${count}`, repeatsNeeded(meanVariance, count, z)]));
        return {allSameVariance, meanVariance, halfWidth: per(Z_95), power: per(Z_95 + Z_POWER_80)};
    });
    return {
        estimates,
        recommended: {allSameVariance: "conservative", method: "power"},
        allSameTasks: usable.filter((summary) => summary.allSame).map((summary) => summary.taskId),
        insufficientTasks: summaries.filter((summary) => summary.variance === null).map((summary) => summary.taskId),
    };
}
