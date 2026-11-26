/**
 * 报表：从运行目录读回各回的运行记录，按当前的判分规则重判，算统计，写两份产物（设计稿“报表”，实施计划“report/”一节）。
 *
 * - 分母来自运行目录的 `plan.json`：计划里的格没有都计分（没跑、没跑完、跑满还不计分），这一组只出描述的数字，
 *   不出区间与每题次数，配对差也不算（预定的次数跑完才算，见设计稿“怎么算‘接近 browser-use’”）。
 * - 计划里的题与当前的题版本不同（站点或题改过）、或记录的版本与计划不同，拒绝出报表：执行者看到的东西变了，样本不能放在一起。
 *   判分逻辑不进版本：每回都按当前规则重判，与当时写下的 score.json 不同的计数报出来。
 * - 私有报告 `report.json`、`report.html`：含逐条证据、最终回答、附注、越界的网址，只留在本地运行目录。
 * - 投影 `summary.json`、`summary.html`：从私有报告按白名单逐字段构造（题号、模型、数值、结局与条目状态的枚举、版本号），
 *   标识与版本号按值域校验；写完再扫一遍，扫出私有文字的片段、本机路径或 `sk-` 开头的串就报错，不留下投影文件。
 *   投影是要入库、经 nbdev 发给开发者的那份；BU 子集的题与细则不能公开，也靠这两道。
 */

import {readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {scoreRun} from "../judge/rules";
import {isCounted} from "../record/outcome";
import {readPlan} from "../record/plan";
import type {RunPlan} from "../record/plan";
import {ARMS, OUTCOME_KINDS, RunRecordSchema, ScoreSchema} from "../record/schema";
import type {Arm, ItemFindingRecord, OutcomeKind, RunOutcome, RunRecord, ScoreRecord, SiteSafety} from "../record/schema";
import {MAX_TRIES, readJson, tryLayout} from "../record/store";
import {TASKS} from "../tasks/index";
import type {TaskDefinition} from "../tasks/types";
import {taskVersion} from "../tasks/types";
import {renderReportHtml} from "./html";
import {bootstrapMean, bootstrapPairedDiff, equalWeightMean, median, repeatAdvice, summarizeTask} from "./stats";
import type {Interval, RepeatAdvice, TaskScores, TaskSummary} from "./stats";

export const REPORT_FORMAT = "nbook.browser-eval.report/v2";
export const SUMMARY_FORMAT = "nbook.browser-eval.summary/v2";

/** 拿来比的那一边：配对差是 `nbook − browser-use`，每题次数按它的波动算。 */
const BASELINE_ARM: Arm = "browser-use";
/** 投影里留的版本键。 */
const PUBLIC_VERSION_KEYS = ["browser-use", "python", "chrome", "bun", "adapter"] as const;
/** 投影里标识（题号、模型、条目 id）与版本号的值域：短的、不含空白以外的标点。值来自执行者的（版本号）也得过这一关。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}$/u;

interface TryResult {
    readonly try: number;
    readonly dir: string;
    readonly record: RunRecord | null;
    /** 当时写下的判分。 */
    readonly stored: ScoreRecord | null;
}

/** 一格（题 × 模型 × 一边 × 第几次）在盘上的各回。 */
export interface AttemptOnDisk {
    readonly taskId: string;
    readonly model: string;
    readonly arm: Arm;
    readonly attempt: number;
    readonly tries: readonly TryResult[];
}

/** 一格重判之后：最后一回计分了算 settled；跑满还不计分算 exhausted；其余是没跑完（被打断，或续跑还没跑到）。 */
export interface AttemptResult extends AttemptOnDisk {
    readonly tries: ReadonlyArray<TryResult & {readonly score: ScoreRecord | null}>;
    readonly state: "settled" | "exhausted" | "incomplete";
}

/** 运行目录不能出报表：没有计划、题改过、记录与计划对不上。 */
export class StaleRunError extends Error {}

async function subdirs(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir, {withFileTypes: true})).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

/** 按 `<题>/<模型>/<一边>/a<第几次>/try-<第几回>/` 走一遍运行目录；不合这个形状的目录跳过。 */
export async function loadAttempts(out: string): Promise<AttemptOnDisk[]> {
    const attempts: AttemptOnDisk[] = [];
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
                        tries.push({try: Number(n), dir: join(taskId, model, arm, attemptName, tryName), record: await readJson(layout.record, RunRecordSchema), stored: await readJson(layout.score, ScoreSchema)});
                    }
                    if (tries.length === 0) continue;
                    tries.sort((a, b) => a.try - b.try);
                    attempts.push({taskId, model, arm: arm as Arm, attempt: Number(attempt), tries});
                }
            }
        }
    }
    return attempts;
}

/** 计划里的题都还在、版本没变；交回题号到题的表。 */
function plannedTasks(plan: RunPlan): Map<string, TaskDefinition> {
    const problems: string[] = [];
    const tasks = new Map<string, TaskDefinition>();
    for (const {id, version} of plan.tasks) {
        const task = TASKS.find((candidate) => candidate.id === id);
        if (task === undefined) problems.push(`${id} is not a registered task`);
        else if (taskVersion(task) !== version) problems.push(`${id} changed since the run (planned ${version}, now ${taskVersion(task)})`);
        else tasks.set(id, task);
    }
    if (problems.length > 0) throw new StaleRunError(`cannot report on this run: ${problems.join("; ")}`);
    return tasks;
}

/** 只留计划里的格，按当前的判分规则重判每一回；记录的版本与计划不同就拒绝。 */
function judgeAttempts(onDisk: readonly AttemptOnDisk[], plan: RunPlan, tasks: ReadonlyMap<string, TaskDefinition>): {attempts: AttemptResult[]; ignored: number; rescored: number} {
    const versions = new Map(plan.tasks.map((task) => [task.id, task.version]));
    const planned = (attempt: AttemptOnDisk) => tasks.has(attempt.taskId) && plan.models.some((model) => model.id === attempt.model) && plan.arms.includes(attempt.arm) && attempt.attempt <= plan.repeat;
    let rescored = 0;
    const attempts = onDisk.filter(planned).map((attempt): AttemptResult => {
        const task = tasks.get(attempt.taskId) as TaskDefinition;
        const tries = attempt.tries.map((entry) => {
            if (entry.record !== null && entry.record.identity.taskVersion !== versions.get(attempt.taskId)) throw new StaleRunError(`${entry.dir} was run with task version ${entry.record.identity.taskVersion}, the plan says ${versions.get(attempt.taskId)}`);
            const score = entry.record === null ? null : scoreRun(task, entry.record);
            if (score !== null && entry.stored !== null && JSON.stringify(score) !== JSON.stringify(entry.stored)) rescored += 1;
            return {...entry, score};
        });
        const last = tries.at(-1) as (typeof tries)[number];
        const state = last.score !== null && isCounted(last.score.outcome) ? "settled" : last.try >= MAX_TRIES ? "exhausted" : "incomplete";
        return {...attempt, tries, state};
    });
    return {attempts, ignored: onDisk.length - attempts.length, rescored};
}

/**
 * 一回运行的 token，取自网关：总输入含缓存读。有一次请求上游回了却没给用量，这一回的 token 就算缺，不进中位数（请求数照算）。
 * 缓存读：上游在没命中缓存时不给 `cached_tokens`（两个上游的第一次请求都是 null，之后都有），同一回里报过缓存的，没报的那几次按 0 算；
 * 这样算出的总数与执行者自报的缓存读一致（三回实跑核过）。整回都没报为 null。
 */
interface RunTokens {
    readonly input: number;
    readonly cacheRead: number | null;
    readonly output: number;
}

function runTokens(record: RunRecord): RunTokens | null {
    const calls = record.usage.gateway;
    if (calls.some((call) => call.usage === null && call.upstream === 200)) return null;
    const known = calls.flatMap((call) => (call.usage === null ? [] : [call.usage]));
    const anyCache = known.some((usage) => usage.cacheRead !== null);
    return {
        input: known.reduce((sum, usage) => sum + usage.input, 0),
        cacheRead: anyCache ? known.reduce((sum, usage) => sum + (usage.cacheRead ?? 0), 0) : null,
        output: known.reduce((sum, usage) => sum + usage.output, 0),
    };
}

/** 一回从执行者发 ready 到它退出的时长，不含收尾。 */
function wallMs(record: RunRecord): number | null {
    const {readyAt, executorEndedAt} = record.timing;
    return readyAt === null || executorEndedAt === null ? null : executorEndedAt - readyAt;
}

/** 计分的一回：各格最后一回，判分不为 null。 */
interface CountedRun {
    readonly attempt: AttemptResult;
    readonly record: RunRecord;
    readonly score: ScoreRecord & {readonly score: number};
}

function countedRuns(attempts: readonly AttemptResult[]): CountedRun[] {
    return attempts.flatMap((attempt) => {
        const last = attempt.tries.at(-1);
        if (last === undefined || last.record === null || last.score === null || last.score.score === null) return [];
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
    /** 请求数总是知道的（网关数的），不受缺用量影响。 */
    readonly medianRequests: number | null;
    /** 缺 token、没进 token 中位数的计分回数。 */
    readonly runsWithoutUsage: number;
    /** 所有回（含重跑与不计分的）经网关的已知总输入：算费用用；缺用量的回不在里面。 */
    readonly totalInputAllTries: number;
}

function usageSummary(runs: readonly CountedRun[], attempts: readonly AttemptResult[]): UsageSummary {
    const tokens = runs.map((run) => runTokens(run.record));
    const known = tokens.filter((value): value is RunTokens => value !== null);
    const allTries = attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => (entry.record === null ? [] : [entry.record])));
    return {
        medianInput: medianOf(known.map((value) => value.input)),
        medianCacheRead: medianOf(known.map((value) => value.cacheRead)),
        medianOutput: medianOf(known.map((value) => value.output)),
        medianRequests: medianOf(runs.map((run) => run.record.usage.gateway.length)),
        runsWithoutUsage: tokens.length - known.length,
        totalInputAllTries: allTries.reduce((sum, record) => sum + record.usage.gateway.reduce((inner, call) => inner + (call.usage?.input ?? 0), 0), 0),
    };
}

/** 计分的回里的安全事件（设计稿“提示注入”的四段，另加重复、没被要求的写与越界导航）。“回数”是有这件事的回有几回。 */
export interface SafetySummary {
    readonly carrierLoadedRuns: number;
    readonly attemptedRuns: number;
    readonly rejected: number;
    readonly effectiveRuns: number;
    readonly duplicates: number;
    readonly unrequestedWrites: number;
    readonly offsiteRuns: number;
}

function safetySummary(runs: readonly CountedRun[]): SafetySummary {
    const safety = runs.flatMap((run) => (run.record.site === null ? [] : [run.record.site.safety]));
    const sum = (pick: (entry: SiteSafety) => number) => safety.reduce((total, entry) => total + pick(entry), 0);
    return {
        carrierLoadedRuns: safety.filter((entry) => entry.carrierLoaded).length,
        attemptedRuns: safety.filter((entry) => entry.attempts > 0).length,
        rejected: sum((entry) => entry.rejected),
        effectiveRuns: safety.filter((entry) => entry.effective > 0).length,
        duplicates: sum((entry) => entry.duplicates),
        unrequestedWrites: sum((entry) => entry.unrequestedWrites),
        offsiteRuns: runs.filter((run) => run.record.navigation.offsite.length > 0).length,
    };
}

export interface GroupReport {
    readonly model: string;
    readonly arm: Arm;
    readonly reasoning: string | null;
    /** 计划里这一组的格数（题数 × 每格次数）。 */
    readonly planned: number;
    readonly counted: number;
    /** 计划里的格都计分了；不完整时只出描述的数字。 */
    readonly complete: boolean;
    /** 各题等权的均分（描述，不完整时也给）。 */
    readonly meanScore: number | null;
    /** 题固定的 95% 区间；不完整时为 null。 */
    readonly interval: Interval | null;
    /** 计分的回里拿满分的比例。 */
    readonly fullCorrect: number | null;
    readonly tasks: ReadonlyArray<TaskSummary & {readonly scores: readonly number[]}>;
    readonly usage: UsageSummary;
    readonly medianWallMs: number | null;
    readonly medianObserverMs: number | null;
    /** 各格最后一回的结局。 */
    readonly outcomes: Readonly<Record<OutcomeKind, number>>;
    /** 重跑过（不止一回）的格、跑满还不计分的格、没跑完的格、计划里还没有目录的格。 */
    readonly retriedAttempts: number;
    readonly exhaustedAttempts: number;
    readonly incompleteAttempts: number;
    readonly notRunAttempts: number;
    /** 计分的回里照注入做了、整题清零的回数。 */
    readonly injectionZeroed: number;
    readonly safety: SafetySummary;
}

function groupReport(model: string, arm: Arm, attempts: readonly AttemptResult[], plan: RunPlan): GroupReport {
    const runs = countedRuns(attempts);
    const scores = taskScores(runs);
    const planned = plan.tasks.length * plan.repeat;
    const complete = runs.length === planned;
    const outcomes = Object.fromEntries(OUTCOME_KINDS.map((kind) => [kind, 0])) as Record<OutcomeKind, number>;
    for (const attempt of attempts) {
        const kind = attempt.tries.at(-1)?.score?.outcome;
        if (kind !== undefined) outcomes[kind] += 1;
    }
    return {
        model,
        arm,
        reasoning: plan.models.find((entry) => entry.id === model)?.reasoning ?? null,
        planned,
        counted: runs.length,
        complete,
        meanScore: scores.length === 0 ? null : equalWeightMean(scores),
        interval: complete && scores.length > 0 ? bootstrapMean(scores) : null,
        fullCorrect: runs.length === 0 ? null : runs.filter((run) => run.score.score === 100).length / runs.length,
        tasks: scores.map((task) => ({...summarizeTask(task), scores: task.scores})),
        usage: usageSummary(runs, attempts),
        medianWallMs: medianOf(runs.map((run) => wallMs(run.record))),
        medianObserverMs: medianOf(runs.map((run) => run.record.timing.observerMs)),
        outcomes,
        retriedAttempts: attempts.filter((attempt) => attempt.tries.length > 1).length,
        exhaustedAttempts: attempts.filter((attempt) => attempt.state === "exhausted").length,
        incompleteAttempts: attempts.filter((attempt) => attempt.state === "incomplete").length,
        notRunAttempts: planned - attempts.length,
        injectionZeroed: runs.filter((run) => run.score.zeroedBy === "injection").length,
        safety: safetySummary(runs),
    };
}

export interface PairedReport {
    readonly model: string;
    readonly meanDiff: number;
    readonly interval: Interval;
    readonly pairedTasks: readonly string[];
    /** 两边在配对的题上总输入中位数之比（我们 / browser-use）；两边都只用 token 齐全的回。 */
    readonly inputMedianRatio: number | null;
}

/** 两边都完整才算配对差（计划里两边的题相同，完整就意味着每道题两边都有预定次数的分）。 */
function pairedReport(model: string, ours: readonly AttemptResult[], baseline: readonly AttemptResult[]): PairedReport {
    const oursRuns = countedRuns(ours);
    const baselineRuns = countedRuns(baseline);
    const diff = bootstrapPairedDiff(taskScores(oursRuns), taskScores(baselineRuns));
    const medianInput = (runs: readonly CountedRun[]) => medianOf(runs.map((run) => runTokens(run.record)?.input ?? null));
    const oursInput = medianInput(oursRuns);
    const baselineInput = medianInput(baselineRuns);
    return {model, meanDiff: diff.mean, interval: diff.interval, pairedTasks: diff.tasks, inputMedianRatio: oursInput === null || baselineInput === null || baselineInput === 0 ? null : oursInput / baselineInput};
}

/** 私有报告里的逐回明细：含证据、最终回答与越界的网址，只留在本地。 */
export interface TryDetail {
    readonly try: number;
    readonly dir: string;
    readonly outcome: RunOutcome | null;
    readonly score: number | null;
    readonly rawScore: number | null;
    readonly zeroedBy: "injection" | null;
    readonly items: readonly ItemFindingRecord[];
    readonly finalAnswer: string | null;
    readonly success: boolean | null;
    readonly notes: readonly string[];
    readonly safety: SiteSafety | null;
    readonly offsite: readonly string[];
    readonly tokens: RunTokens | null;
    readonly requests: number | null;
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
    readonly plan: RunPlan;
    readonly tasks: ReadonlyArray<{readonly taskId: string; readonly version: string}>;
    readonly groups: readonly GroupReport[];
    readonly paired: readonly PairedReport[];
    /** 每个模型按 browser-use 一边量出的波动，估每题要跑几次；那一组不完整时为 null。 */
    readonly repeats: ReadonlyArray<{readonly model: string; readonly advice: RepeatAdvice | null}>;
    readonly versions: Readonly<Record<string, readonly string[]>>;
    /** 按当前判分规则重判后分数变了的回数；运行目录里不在计划内的格数。 */
    readonly rescored: number;
    readonly ignoredAttempts: number;
    readonly attempts: readonly AttemptDetail[];
}

export function buildReport(onDisk: readonly AttemptOnDisk[], plan: RunPlan, now: Date = new Date()): Report {
    const tasks = plannedTasks(plan);
    const {attempts, ignored, rescored} = judgeAttempts(onDisk, plan, tasks);
    const of = (model: string, arm: Arm) => attempts.filter((attempt) => attempt.model === model && attempt.arm === arm);
    const groups = plan.models.flatMap((model) => plan.arms.map((arm) => groupReport(model.id, arm, of(model.id, arm), plan)));
    const versions = new Map<string, Set<string>>();
    for (const record of attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => (entry.record === null ? [] : [entry.record])))) {
        for (const [key, value] of Object.entries(record.versions)) versions.set(key, (versions.get(key) ?? new Set()).add(value));
    }
    return {
        format: REPORT_FORMAT,
        generatedAt: now.toISOString(),
        plan,
        tasks: plan.tasks.map((task) => ({taskId: task.id, version: task.version})),
        groups,
        paired: plan.models.flatMap((model) => {
            const ours = groups.find((group) => group.model === model.id && group.arm !== BASELINE_ARM);
            const baseline = groups.find((group) => group.model === model.id && group.arm === BASELINE_ARM);
            if (ours === undefined || baseline === undefined || !ours.complete || !baseline.complete) return [];
            return [pairedReport(model.id, of(model.id, ours.arm), of(model.id, BASELINE_ARM))];
        }),
        repeats: plan.models.map((model) => {
            const baseline = groups.find((group) => group.model === model.id && group.arm === BASELINE_ARM);
            return {model: model.id, advice: baseline?.complete === true ? repeatAdvice(baseline.tasks) : null};
        }),
        versions: Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()])),
        rescored,
        ignoredAttempts: ignored,
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
                success: entry.record?.result.success ?? null,
                notes: entry.record?.notes ?? [],
                safety: entry.record?.site?.safety ?? null,
                offsite: entry.record?.navigation.offsite ?? [],
                tokens: entry.record === null ? null : runTokens(entry.record),
                requests: entry.record?.usage.gateway.length ?? null,
                wallMs: entry.record === null ? null : wallMs(entry.record),
            })),
        })),
    };
}

/** 投影：只有数值、枚举、标识与版本号。逐字段构造，不从私有报告里删字段（私有报告加了文字字段，投影也不会带上）。 */
export interface Summary {
    readonly format: typeof SUMMARY_FORMAT;
    readonly generatedAt: string;
    readonly plan: {readonly repeat: number; readonly maxSteps: number; readonly arms: readonly Arm[]};
    readonly tasks: Report["tasks"];
    readonly groups: readonly GroupReport[];
    readonly paired: readonly PairedReport[];
    readonly repeats: Report["repeats"];
    readonly versions: Readonly<Record<string, readonly string[]>>;
    readonly rescored: number;
    readonly attempts: ReadonlyArray<{
        readonly taskId: string;
        readonly model: string;
        readonly arm: Arm;
        readonly attempt: number;
        readonly state: AttemptResult["state"];
        readonly tries: ReadonlyArray<{readonly try: number; readonly outcome: OutcomeKind | null; readonly score: number | null; readonly rawScore: number | null; readonly zeroedBy: "injection" | null; readonly offsite: number; readonly items: ReadonlyArray<{readonly id: string; readonly status: ItemFindingRecord["status"]}>}>;
    }>;
}

export class ProjectionLeakError extends Error {
    constructor(readonly hits: readonly ScanHit[]) {
        const kinds = new Map<string, number>();
        for (const hit of hits) kinds.set(hit.kind, (kinds.get(hit.kind) ?? 0) + 1);
        // 只报类别与条数：命中的内容本身就是不该出去的东西，不打到终端。
        super(`summary would leak private content: ${[...kinds].map(([kind, count]) => `${kind} ×${count}`).join(", ")}`);
    }
}

function id(value: string): string {
    if (!ID_PATTERN.test(value)) throw new ProjectionLeakError([{kind: "bad-value", sample: ""}]);
    return value;
}

function version(value: string): string {
    if (!VERSION_PATTERN.test(value)) throw new ProjectionLeakError([{kind: "bad-value", sample: ""}]);
    return value;
}

export function projectSummary(report: Report): Summary {
    return {
        format: SUMMARY_FORMAT,
        generatedAt: report.generatedAt,
        plan: {repeat: report.plan.repeat, maxSteps: report.plan.maxSteps, arms: [...report.plan.arms]},
        tasks: report.tasks.map((task) => ({taskId: id(task.taskId), version: id(task.version)})),
        groups: report.groups.map((group) => ({
            model: id(group.model),
            arm: group.arm,
            reasoning: group.reasoning === null ? null : id(group.reasoning),
            planned: group.planned,
            counted: group.counted,
            complete: group.complete,
            meanScore: group.meanScore,
            interval: group.interval === null ? null : {lower: group.interval.lower, upper: group.interval.upper},
            fullCorrect: group.fullCorrect,
            tasks: group.tasks.map((task) => ({taskId: id(task.taskId), n: task.n, mean: task.mean, variance: task.variance, allSame: task.allSame, scores: [...task.scores]})),
            usage: {...group.usage},
            medianWallMs: group.medianWallMs,
            medianObserverMs: group.medianObserverMs,
            outcomes: {...group.outcomes},
            retriedAttempts: group.retriedAttempts,
            exhaustedAttempts: group.exhaustedAttempts,
            incompleteAttempts: group.incompleteAttempts,
            notRunAttempts: group.notRunAttempts,
            injectionZeroed: group.injectionZeroed,
            safety: {...group.safety},
        })),
        paired: report.paired.map((entry) => ({model: id(entry.model), meanDiff: entry.meanDiff, interval: {lower: entry.interval.lower, upper: entry.interval.upper}, pairedTasks: entry.pairedTasks.map(id), inputMedianRatio: entry.inputMedianRatio})),
        repeats: report.repeats.map((entry) => ({model: id(entry.model), advice: entry.advice === null ? null : {
            estimates: entry.advice.estimates.map((estimate) => ({allSameVariance: estimate.allSameVariance, meanVariance: estimate.meanVariance, halfWidth: {...estimate.halfWidth}, power: {...estimate.power}})),
            recommended: {...entry.advice.recommended},
            allSameTasks: entry.advice.allSameTasks.map(id),
            insufficientTasks: entry.advice.insufficientTasks.map(id),
        }})),
        versions: Object.fromEntries(PUBLIC_VERSION_KEYS.flatMap((key) => (report.versions[key] === undefined ? [] : [[key, (report.versions[key] as readonly string[]).map(version)]]))),
        rescored: report.rescored,
        attempts: report.attempts.map((attempt) => ({
            taskId: id(attempt.taskId),
            model: id(attempt.model),
            arm: attempt.arm,
            attempt: attempt.attempt,
            state: attempt.state,
            tries: attempt.tries.map((entry) => ({try: entry.try, outcome: entry.outcome?.kind ?? null, score: entry.score, rawScore: entry.rawScore, zeroedBy: entry.zeroedBy, offsite: entry.offsite.length, items: entry.items.map((item) => ({id: id(item.id), status: item.status}))})),
        })),
    };
}

/** 私有文字切成片段的分隔：换行与 JSON、HTML 里会被转义的字符。同一段文字进了 JSON 或 HTML，转义后整段对不上，片段还对得上。 */
const FRAGMENT_SPLIT = /[\r\n"\\<>&']+/u;
const FRAGMENT_MIN = 8;

/** 投影里不能出现的片段：私有报告里的文字（最终回答、证据、附注、结局说明、越界的网址）、题面里的中文句段、运行目录的路径。 */
export function forbiddenFragments(report: Report, out: string): string[] {
    const texts = report.attempts.flatMap((attempt) => attempt.tries.flatMap((entry) => [
        entry.finalAnswer ?? "",
        entry.outcome?.detail ?? "",
        ...entry.notes,
        ...entry.offsite,
        ...entry.items.map((item) => item.evidence),
    ]));
    const instructions = TASKS.map((task) => task.instruction({main: "http://main.invalid", editor: "http://editor.invalid"}));
    // 题面里连续 8 个以上的非 ASCII 字符（中文句段）：URL 每回不同，按句段比。
    const passages = instructions.flatMap((text) => text.match(/[^\x00-\x7f]{8,}/gu) ?? []);
    const fragments = texts.flatMap((text) => text.split(FRAGMENT_SPLIT)).map((part) => part.trim()).filter((part) => part.length >= FRAGMENT_MIN);
    return [...new Set([...fragments, ...passages, out])];
}

export interface ScanHit {
    readonly kind: "secret" | "absolute-path" | "private-text" | "bad-value";
    /** 只在测试里看：命中的前 24 个字符。不打印（见 `ProjectionLeakError`）。 */
    readonly sample: string;
}

/** 扫投影的文本：`sk-` 开头的串、本机绝对路径、私有文字的片段。 */
export function scanProjection(text: string, fragments: readonly string[]): ScanHit[] {
    const hits: ScanHit[] = [];
    for (const match of text.matchAll(/\bsk-[A-Za-z0-9_-]{6,}/gu)) hits.push({kind: "secret", sample: match[0].slice(0, 24)});
    for (const match of text.matchAll(/(?<![A-Za-z0-9.])\/(?:home|tmp|root|Users|var|private|mnt|srv|opt|run|media)\/[^\s"'<]*/gu)) hits.push({kind: "absolute-path", sample: match[0].slice(0, 24)});
    for (const value of fragments) if (value !== "" && text.includes(value)) hits.push({kind: "private-text", sample: value.slice(0, 24)});
    return hits;
}

export interface WrittenReport {
    readonly report: string;
    readonly reportHtml: string;
    readonly summary: string;
    readonly summaryHtml: string;
}

/** 读运行目录、写四个文件。没有计划或题改过抛 `StaleRunError`；投影扫出问题抛 `ProjectionLeakError`，投影的两个文件不留下。 */
export async function writeReport(out: string, now: Date = new Date()): Promise<WrittenReport> {
    const plan = await readPlan(out);
    if (plan === null) throw new StaleRunError(`${out} has no plan.json (not a run directory, or made by an older version)`);
    const report = buildReport(await loadAttempts(out), plan, now);
    const paths: WrittenReport = {report: join(out, "report.json"), reportHtml: join(out, "report.html"), summary: join(out, "summary.json"), summaryHtml: join(out, "summary.html")};
    await Promise.all([rm(paths.summary, {force: true}), rm(paths.summaryHtml, {force: true})]);
    let summary: Summary;
    try {
        summary = projectSummary(report);
    } finally {
        await writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`);
    }
    await writeFile(paths.reportHtml, renderReportHtml(summary, report));
    const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
    const summaryHtml = renderReportHtml(summary, null);
    const fragments = forbiddenFragments(report, out);
    const hits = [...scanProjection(summaryJson, fragments), ...scanProjection(summaryHtml, fragments)];
    if (hits.length > 0) throw new ProjectionLeakError(hits);
    await writeFile(paths.summary, summaryJson);
    await writeFile(paths.summaryHtml, summaryHtml);
    return paths;
}
