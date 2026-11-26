/**
 * 报表：从运行目录读回各回的运行记录与判分，算统计，写两份产物（设计稿“报表”，实施计划“report/”一节）。
 *
 * - 私有报告 `report.json`、`report.html`：含逐条证据、最终回答、附注，只留在本地运行目录。
 * - 投影 `summary.json`、`summary.html`：从私有报告按白名单逐字段拷出来（题号、模型、数值、结局与条目状态的枚举、版本），
 *   不拷任何文字字段；写完扫一遍，扫出任务原文、最终回答、证据、本机路径或 `sk-` 开头的串就报错，不留下文件。
 *   投影是要入库、经 nbdev 发给开发者的那份；BU 子集的题与细则不能公开，也靠这条。
 */

import {readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {isCounted} from "../record/outcome";
import {ARMS, OUTCOME_KINDS, RunRecordSchema, ScoreSchema} from "../record/schema";
import type {Arm, ItemFindingRecord, OutcomeKind, RunOutcome, RunRecord, ScoreRecord, SiteSafety} from "../record/schema";
import {MAX_TRIES, readJson, tryLayout} from "../record/store";
import {TASKS} from "../tasks/index";
import {renderReportHtml} from "./html";
import {bootstrapMean, bootstrapPairedDiff, equalWeightMean, median, repeatAdvice, summarizeTask} from "./stats";
import type {Interval, RepeatAdvice, TaskScores, TaskSummary} from "./stats";

export const REPORT_FORMAT = "nbook.browser-eval.report/v1";
export const SUMMARY_FORMAT = "nbook.browser-eval.summary/v1";

/** 拿来比的那一边：配对差是 `nbook − browser-use`，每题次数按它的波动算。 */
const BASELINE_ARM: Arm = "browser-use";
/** 投影里留的版本键；值是版本号，没有文字。 */
const PUBLIC_VERSION_KEYS = ["browser-use", "python", "chrome", "bun", "adapter"] as const;

interface TryResult {
    readonly try: number;
    readonly dir: string;
    readonly record: RunRecord | null;
    readonly score: ScoreRecord | null;
}

/** 一格（题 × 模型 × 一边 × 第几次）的各回。最后一回计分了算 settled；跑满还不计分算 exhausted；其余是没跑完（被打断，或续跑还没跑到）。 */
export interface AttemptResult {
    readonly taskId: string;
    readonly model: string;
    readonly arm: Arm;
    readonly attempt: number;
    readonly tries: readonly TryResult[];
    readonly state: "settled" | "exhausted" | "incomplete";
}

async function subdirs(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir, {withFileTypes: true})).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

/** 按 `<题>/<模型>/<一边>/a<第几次>/try-<第几回>/` 走一遍运行目录；不合这个形状的目录跳过。 */
export async function loadAttempts(out: string): Promise<AttemptResult[]> {
    const attempts: AttemptResult[] = [];
    for (const taskId of await subdirs(out)) {
        for (const model of await subdirs(join(out, taskId))) {
            for (const arm of await subdirs(join(out, taskId, model))) {
                if (!(ARMS as readonly string[]).includes(arm)) continue;
                for (const attemptName of await subdirs(join(out, taskId, model, arm))) {
                    const attempt = /^a(\d+)$/u.exec(attemptName)?.[1];
                    if (attempt === undefined) continue;
                    const attemptPath = join(out, taskId, model, arm, attemptName);
                    const tries: TryResult[] = [];
                    for (const tryName of await subdirs(attemptPath)) {
                        const n = /^try-(\d+)$/u.exec(tryName)?.[1];
                        if (n === undefined) continue;
                        const layout = tryLayout(join(attemptPath, tryName));
                        tries.push({try: Number(n), dir: join(taskId, model, arm, attemptName, tryName), record: await readJson(layout.record, RunRecordSchema), score: await readJson(layout.score, ScoreSchema)});
                    }
                    if (tries.length === 0) continue;
                    tries.sort((a, b) => a.try - b.try);
                    const last = tries.at(-1) as TryResult;
                    const state = last.score !== null && isCounted(last.score.outcome) ? "settled" : last.try >= MAX_TRIES ? "exhausted" : "incomplete";
                    attempts.push({taskId, model, arm: arm as Arm, attempt: Number(attempt), tries, state});
                }
            }
        }
    }
    return attempts;
}

/** 一回运行的用量，取自网关：总输入含缓存读。有一次请求上游回了却没给用量，这一回就算缺用量，不进中位数。 */
interface RunUsage {
    readonly input: number;
    /** 上游都没报缓存时为 null；报了的请求里没报的那几次（一般是第一次）按 0 算。 */
    readonly cacheRead: number | null;
    readonly output: number;
    readonly requests: number;
}

function runUsage(record: RunRecord): RunUsage | null {
    const calls = record.usage.gateway;
    if (calls.some((call) => call.usage === null && call.upstream === 200)) return null;
    const known = calls.flatMap((call) => call.usage === null ? [] : [call.usage]);
    const anyCache = known.some((usage) => usage.cacheRead !== null);
    return {
        input: known.reduce((sum, usage) => sum + usage.input, 0),
        cacheRead: anyCache ? known.reduce((sum, usage) => sum + (usage.cacheRead ?? 0), 0) : null,
        output: known.reduce((sum, usage) => sum + usage.output, 0),
        requests: calls.length,
    };
}

/** 一回从执行者发 ready 到运行记录写完的时长（含收尾，收尾每一步有时限）。 */
function wallMs(record: RunRecord): number | null {
    return record.timing.readyAt === null ? null : record.timing.endedAt - record.timing.readyAt;
}

function finalTry(attempt: AttemptResult): TryResult {
    return attempt.tries.at(-1) as TryResult;
}

/** 计分的一回：判分与记录都在。 */
interface CountedRun {
    readonly attempt: AttemptResult;
    readonly record: RunRecord;
    readonly score: ScoreRecord & {readonly score: number};
}

function countedRuns(attempts: readonly AttemptResult[]): CountedRun[] {
    return attempts.flatMap((attempt) => {
        const last = finalTry(attempt);
        if (attempt.state !== "settled" || last.record === null || last.score === null || last.score.score === null) return [];
        return [{attempt, record: last.record, score: last.score as CountedRun["score"]}];
    });
}

function taskScores(runs: readonly CountedRun[]): TaskScores[] {
    const byTask = new Map<string, number[]>();
    for (const run of runs) byTask.set(run.attempt.taskId, [...(byTask.get(run.attempt.taskId) ?? []), run.score.score]);
    return [...byTask].sort(([a], [b]) => a.localeCompare(b)).map(([taskId, scores]) => ({taskId, scores}));
}

function medianOf(values: ReadonlyArray<number | null>): number | null {
    return median(values.filter((value): value is number => value !== null));
}

export interface UsageSummary {
    readonly medianInput: number | null;
    readonly medianCacheRead: number | null;
    readonly medianOutput: number | null;
    readonly medianRequests: number | null;
    /** 缺用量、没进中位数的计分回数。 */
    readonly runsWithoutUsage: number;
    /** 所有回（含重跑与不计分的）经网关的总输入：算费用用。 */
    readonly totalInputAllTries: number;
}

function usageSummary(runs: readonly CountedRun[], attempts: readonly AttemptResult[]): UsageSummary {
    const usages = runs.map((run) => runUsage(run.record));
    const known = usages.filter((usage): usage is RunUsage => usage !== null);
    const allTries = attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => entry.record === null ? [] : [entry.record]));
    return {
        medianInput: medianOf(known.map((usage) => usage.input)),
        medianCacheRead: medianOf(known.map((usage) => usage.cacheRead)),
        medianOutput: medianOf(known.map((usage) => usage.output)),
        medianRequests: medianOf(known.map((usage) => usage.requests)),
        runsWithoutUsage: usages.length - known.length,
        totalInputAllTries: allTries.reduce((sum, record) => sum + record.usage.gateway.reduce((inner, call) => inner + (call.usage?.input ?? 0), 0), 0),
    };
}

export interface GroupReport {
    readonly model: string;
    readonly arm: Arm;
    readonly reasoning: string | null;
    readonly attempts: number;
    readonly counted: number;
    /** 各题等权的均分与题固定的 95% 区间；没有计分的回时为 null。 */
    readonly meanScore: number | null;
    readonly interval: Interval | null;
    /** 计分的回里拿满分的比例。 */
    readonly fullCorrect: number | null;
    readonly tasks: ReadonlyArray<TaskSummary & {readonly scores: readonly number[]}>;
    readonly usage: UsageSummary;
    readonly medianWallMs: number | null;
    readonly medianObserverMs: number | null;
    /** 各格最后一回的结局。 */
    readonly outcomes: Readonly<Record<OutcomeKind, number>>;
    /** 重跑过（不止一回）的格、跑满还不计分的格、没跑完的格。 */
    readonly retriedAttempts: number;
    readonly exhaustedAttempts: number;
    readonly incompleteAttempts: number;
    /** 计分的回里照注入做了、整题清零的回数；对注入接口发过的请求总数。 */
    readonly injectionZeroed: number;
    readonly injectionRequests: number;
}

function groupReport(model: string, arm: Arm, attempts: readonly AttemptResult[]): GroupReport {
    const runs = countedRuns(attempts);
    const scores = taskScores(runs);
    const outcomes = Object.fromEntries(OUTCOME_KINDS.map((kind) => [kind, 0])) as Record<OutcomeKind, number>;
    for (const attempt of attempts) {
        const kind = finalTry(attempt).score?.outcome;
        if (kind !== undefined) outcomes[kind] += 1;
    }
    const safety = runs.flatMap((run) => run.record.site === null ? [] : [run.record.site.safety]);
    return {
        model,
        arm,
        reasoning: runs[0]?.record.identity.reasoning ?? null,
        attempts: attempts.length,
        counted: runs.length,
        meanScore: scores.length === 0 ? null : equalWeightMean(scores),
        interval: scores.length === 0 ? null : bootstrapMean(scores),
        fullCorrect: runs.length === 0 ? null : runs.filter((run) => run.score.score === 100).length / runs.length,
        tasks: scores.map((task) => ({...summarizeTask(task), scores: task.scores})),
        usage: usageSummary(runs, attempts),
        medianWallMs: medianOf(runs.map((run) => wallMs(run.record))),
        medianObserverMs: medianOf(runs.map((run) => run.record.timing.observerMs)),
        outcomes,
        retriedAttempts: attempts.filter((attempt) => attempt.tries.length > 1).length,
        exhaustedAttempts: attempts.filter((attempt) => attempt.state === "exhausted").length,
        incompleteAttempts: attempts.filter((attempt) => attempt.state === "incomplete").length,
        injectionZeroed: runs.filter((run) => run.score.zeroedBy === "injection").length,
        injectionRequests: safety.reduce((sum, entry: SiteSafety) => sum + entry.attempts, 0),
    };
}

export interface PairedReport {
    readonly model: string;
    readonly meanDiff: number;
    readonly interval: Interval;
    readonly pairedTasks: readonly string[];
    /** 只有一边有计分的题。 */
    readonly unpairedTasks: readonly string[];
    /** 两边在配对的题上总输入中位数之比（我们 / browser-use）。 */
    readonly inputMedianRatio: number | null;
}

function pairedReport(model: string, ours: readonly AttemptResult[], baseline: readonly AttemptResult[]): PairedReport | null {
    const oursRuns = countedRuns(ours);
    const baselineRuns = countedRuns(baseline);
    const oursScores = taskScores(oursRuns);
    const baselineScores = taskScores(baselineRuns);
    const shared = new Set(oursScores.map((task) => task.taskId).filter((id) => baselineScores.some((task) => task.taskId === id)));
    if (shared.size === 0) return null;
    const diff = bootstrapPairedDiff(oursScores, baselineScores);
    const medianInput = (runs: readonly CountedRun[]) => medianOf(runs.filter((run) => shared.has(run.attempt.taskId)).map((run) => runUsage(run.record)?.input ?? null));
    const oursInput = medianInput(oursRuns);
    const baselineInput = medianInput(baselineRuns);
    const all = new Set([...oursScores, ...baselineScores].map((task) => task.taskId));
    return {
        model,
        meanDiff: diff.mean,
        interval: diff.interval,
        pairedTasks: diff.tasks,
        unpairedTasks: [...all].filter((id) => !shared.has(id)).sort(),
        inputMedianRatio: oursInput === null || baselineInput === null || baselineInput === 0 ? null : oursInput / baselineInput,
    };
}

/** 私有报告里的逐回明细：含证据与最终回答，只留在本地。 */
export interface TryDetail {
    readonly try: number;
    readonly dir: string;
    readonly outcome: RunOutcome | null;
    readonly score: number | null;
    readonly rawScore: number | null;
    readonly zeroedBy: "injection" | null;
    readonly items: readonly ItemFindingRecord[];
    readonly finalAnswer: string | null;
    readonly notes: readonly string[];
    readonly safety: SiteSafety | null;
    readonly usage: RunUsage | null;
    readonly wallMs: number | null;
}

export interface AttemptDetail {
    readonly taskId: string;
    readonly model: string;
    readonly arm: Arm;
    readonly attempt: number;
    readonly state: AttemptResult["state"];
    readonly tries: readonly TryDetail[];
}

export interface Report {
    readonly format: typeof REPORT_FORMAT;
    readonly generatedAt: string;
    readonly tasks: ReadonlyArray<{readonly taskId: string; readonly versions: readonly string[]}>;
    readonly groups: readonly GroupReport[];
    readonly paired: readonly PairedReport[];
    /** 每个模型按 browser-use 一边量出的波动，估每题要跑几次。 */
    readonly repeats: ReadonlyArray<{readonly model: string; readonly advice: RepeatAdvice | null}>;
    readonly versions: Readonly<Record<string, readonly string[]>>;
    readonly attempts: readonly AttemptDetail[];
}

function groupKey(attempt: {model: string; arm: Arm}): string {
    return `${attempt.model}\u0000${attempt.arm}`;
}

export function buildReport(attempts: readonly AttemptResult[], now: Date = new Date()): Report {
    const groups = new Map<string, AttemptResult[]>();
    for (const attempt of attempts) groups.set(groupKey(attempt), [...(groups.get(groupKey(attempt)) ?? []), attempt]);
    const groupReports = [...groups.values()].map((list) => groupReport((list[0] as AttemptResult).model, (list[0] as AttemptResult).arm, list))
        .sort((a, b) => a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm));
    const models = [...new Set(attempts.map((attempt) => attempt.model))].sort();

    const records = attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => entry.record === null ? [] : [entry.record]));
    const taskVersions = new Map<string, Set<string>>();
    const versions = new Map<string, Set<string>>();
    for (const record of records) {
        taskVersions.set(record.identity.taskId, (taskVersions.get(record.identity.taskId) ?? new Set()).add(record.identity.taskVersion));
        for (const [key, value] of Object.entries(record.versions)) versions.set(key, (versions.get(key) ?? new Set()).add(value));
    }

    return {
        format: REPORT_FORMAT,
        generatedAt: now.toISOString(),
        tasks: [...taskVersions].sort(([a], [b]) => a.localeCompare(b)).map(([taskId, set]) => ({taskId, versions: [...set].sort()})),
        groups: groupReports,
        paired: models.flatMap((model) => {
            const report = pairedReport(model, attempts.filter((a) => a.model === model && a.arm !== BASELINE_ARM), attempts.filter((a) => a.model === model && a.arm === BASELINE_ARM));
            return report === null ? [] : [report];
        }),
        repeats: models.map((model) => ({model, advice: repeatAdvice(groupReports.find((group) => group.model === model && group.arm === BASELINE_ARM)?.tasks ?? [])})),
        versions: Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()])),
        attempts: attempts.map((attempt) => ({
            taskId: attempt.taskId,
            model: attempt.model,
            arm: attempt.arm,
            attempt: attempt.attempt,
            state: attempt.state,
            tries: attempt.tries.map((entry) => ({
                try: entry.try,
                dir: entry.dir,
                outcome: entry.record?.outcome ?? null,
                score: entry.score?.score ?? null,
                rawScore: entry.score?.rawScore ?? null,
                zeroedBy: entry.score?.zeroedBy ?? null,
                items: entry.score?.items ?? [],
                finalAnswer: entry.record?.result.finalAnswer ?? null,
                notes: entry.record?.notes ?? [],
                safety: entry.record?.site?.safety ?? null,
                usage: entry.record === null ? null : runUsage(entry.record),
                wallMs: entry.record === null ? null : wallMs(entry.record),
            })),
        })),
    };
}

/** 投影：只有数值与枚举。逐字段构造，不从私有报告里删字段（私有报告加了文字字段，投影也不会带上）。 */
export interface Summary {
    readonly format: typeof SUMMARY_FORMAT;
    readonly generatedAt: string;
    readonly tasks: Report["tasks"];
    readonly groups: readonly GroupReport[];
    readonly paired: readonly PairedReport[];
    readonly repeats: Report["repeats"];
    readonly versions: Readonly<Record<string, readonly string[]>>;
    readonly attempts: ReadonlyArray<{
        readonly taskId: string;
        readonly model: string;
        readonly arm: Arm;
        readonly attempt: number;
        readonly state: AttemptResult["state"];
        readonly tries: ReadonlyArray<{readonly try: number; readonly outcome: OutcomeKind | null; readonly score: number | null; readonly rawScore: number | null; readonly zeroedBy: "injection" | null; readonly items: ReadonlyArray<{readonly id: string; readonly status: ItemFindingRecord["status"]}>}>;
    }>;
}

export function projectSummary(report: Report): Summary {
    return {
        format: SUMMARY_FORMAT,
        generatedAt: report.generatedAt,
        tasks: report.tasks.map((task) => ({taskId: task.taskId, versions: [...task.versions]})),
        groups: report.groups.map((group) => ({
            model: group.model,
            arm: group.arm,
            reasoning: group.reasoning,
            attempts: group.attempts,
            counted: group.counted,
            meanScore: group.meanScore,
            interval: group.interval === null ? null : {lower: group.interval.lower, upper: group.interval.upper},
            fullCorrect: group.fullCorrect,
            tasks: group.tasks.map((task) => ({taskId: task.taskId, n: task.n, mean: task.mean, variance: task.variance, allSame: task.allSame, scores: [...task.scores]})),
            usage: {...group.usage},
            medianWallMs: group.medianWallMs,
            medianObserverMs: group.medianObserverMs,
            outcomes: {...group.outcomes},
            retriedAttempts: group.retriedAttempts,
            exhaustedAttempts: group.exhaustedAttempts,
            incompleteAttempts: group.incompleteAttempts,
            injectionZeroed: group.injectionZeroed,
            injectionRequests: group.injectionRequests,
        })),
        paired: report.paired.map((entry) => ({model: entry.model, meanDiff: entry.meanDiff, interval: {lower: entry.interval.lower, upper: entry.interval.upper}, pairedTasks: [...entry.pairedTasks], unpairedTasks: [...entry.unpairedTasks], inputMedianRatio: entry.inputMedianRatio})),
        repeats: report.repeats.map((entry) => ({model: entry.model, advice: entry.advice === null ? null : {
            estimates: entry.advice.estimates.map((estimate) => ({allSameVariance: estimate.allSameVariance, meanVariance: estimate.meanVariance, halfWidth: {...estimate.halfWidth}, power: {...estimate.power}})),
            recommended: {...entry.advice.recommended},
            allSameTasks: [...entry.advice.allSameTasks],
            insufficientTasks: [...entry.advice.insufficientTasks],
        }})),
        versions: Object.fromEntries(PUBLIC_VERSION_KEYS.flatMap((key) => report.versions[key] === undefined ? [] : [[key, [...(report.versions[key] as readonly string[])]]])),
        attempts: report.attempts.map((attempt) => ({
            taskId: attempt.taskId,
            model: attempt.model,
            arm: attempt.arm,
            attempt: attempt.attempt,
            state: attempt.state,
            tries: attempt.tries.map((entry) => ({try: entry.try, outcome: entry.outcome?.kind ?? null, score: entry.score, rawScore: entry.rawScore, zeroedBy: entry.zeroedBy, items: entry.items.map((item) => ({id: item.id, status: item.status}))})),
        })),
    };
}

/** 投影里不能出现的串：私有报告里的文字（最终回答、证据、附注、结局说明）、题面里的整段中文、运行目录的路径。 */
export function forbiddenStrings(report: Report, out: string): string[] {
    const texts = report.attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => [
        entry.finalAnswer ?? "",
        entry.outcome?.detail ?? "",
        ...entry.notes,
        ...entry.items.map((item) => item.evidence),
    ]));
    const instructions = TASKS.map((task) => task.instruction({main: "http://main.invalid", editor: "http://editor.invalid"}));
    // 题面里连续 8 个以上的非 ASCII 字符（中文句段）：URL 每回不同，按句段比。
    const passages = instructions.flatMap((text) => text.match(/[^\x00-\x7f]{8,}/gu) ?? []);
    return [...new Set([...texts.map((text) => text.trim()).filter((text) => text.length >= 6), ...passages, out])];
}

export interface ScanHit {
    readonly kind: "secret" | "absolute-path" | "private-text";
    readonly sample: string;
}

/** 扫投影的文本：`sk-` 开头的串、本机绝对路径、私有报告里的文字。命中的样本只截前 24 个字符。 */
export function scanProjection(text: string, forbidden: readonly string[]): ScanHit[] {
    const hits: ScanHit[] = [];
    for (const match of text.matchAll(/\bsk-[A-Za-z0-9_-]{6,}/gu)) hits.push({kind: "secret", sample: match[0].slice(0, 24)});
    for (const match of text.matchAll(/(?<![A-Za-z0-9.])\/(?:home|tmp|root|Users|var|private)\/[^\s"'<]*/gu)) hits.push({kind: "absolute-path", sample: match[0].slice(0, 24)});
    for (const value of forbidden) if (value !== "" && text.includes(value)) hits.push({kind: "private-text", sample: value.slice(0, 24)});
    return hits;
}

export class ProjectionLeakError extends Error {
    constructor(readonly hits: readonly ScanHit[]) {
        super(`summary would leak private content: ${hits.map((hit) => `${hit.kind} ${JSON.stringify(hit.sample)}`).join("; ")}`);
    }
}

export interface WrittenReport {
    readonly report: string;
    readonly reportHtml: string;
    readonly summary: string;
    readonly summaryHtml: string;
}

/** 读运行目录、写四个文件。投影扫出问题时抛 `ProjectionLeakError`，投影的两个文件不留下。 */
export async function writeReport(out: string, now: Date = new Date()): Promise<WrittenReport> {
    const report = buildReport(await loadAttempts(out), now);
    const summary = projectSummary(report);
    const paths: WrittenReport = {report: join(out, "report.json"), reportHtml: join(out, "report.html"), summary: join(out, "summary.json"), summaryHtml: join(out, "summary.html")};
    await writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(paths.reportHtml, renderReportHtml(summary, report));
    const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
    const summaryHtml = renderReportHtml(summary, null);
    const forbidden = forbiddenStrings(report, out);
    const hits = [...scanProjection(summaryJson, forbidden), ...scanProjection(summaryHtml, forbidden)];
    if (hits.length > 0) {
        await Promise.all([rm(paths.summary, {force: true}), rm(paths.summaryHtml, {force: true})]);
        throw new ProjectionLeakError(hits);
    }
    await writeFile(paths.summary, summaryJson);
    await writeFile(paths.summaryHtml, summaryHtml);
    return paths;
}
