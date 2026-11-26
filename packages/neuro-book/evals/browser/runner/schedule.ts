/**
 * 调度：按“题 × 模型 × 第几次”排出运行，并发跑，按阶段落盘，可续跑（实施计划“schedule.ts”一节）。
 *
 * 一回运行的先后：起假站、起 Chrome、登记网关的假密钥（这一段出错是评测部件出错）→ 在沙箱里起执行者，
 * 它连上浏览器后发 ready，题的时限从这里算；执行者自己到点收尾（browser-use 的 `run(timeout=...)`），
 * 调度器在“时限 + 宽限”才兜底结束它 → 收尾，每一步有自己的时限 → 拼运行记录、定结局、判分。
 * 起来之后任何一步抛错，也照样收尾，并写一份 harness-error 的记录。
 * 不计分的结局（上游或评测部件出错）在同一次重复里再跑一回，最多 `MAX_TRIES` 回。
 *
 * 一个运行目录同时只能有一个调度器（目录上的排他锁），计划写在 `plan.json`，续跑必须同一份计划。
 */

import {createWriteStream} from "node:fs";
import {appendFile, mkdir, mkdtemp, realpath, rm} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createInterface} from "node:readline";

import {tryLock} from "@notnotype/nb-flock";
import {spawnOwnedProcess} from "@notnotype/owned-process";
import type {OwnedProcessLease} from "@notnotype/owned-process";

import {ExecutorOutputSchema, buildSteps, parseEventLine} from "../arms/browser-use/adapter";
import type {ExecutorOutput, ObservedStep} from "../arms/browser-use/adapter";
import {scoreRun} from "../judge/rules";
import {classifyOutcome, isCounted} from "../record/outcome";
import {claimPlan} from "../record/plan";
import type {RunPlan} from "../record/plan";
import {RUN_FORMAT, RunRecordSchema} from "../record/schema";
import type {Arm, RunRecord, ScoreRecord, SiteEvidenceRecord} from "../record/schema";
import {MAX_TRIES, attemptDir, attemptState, readJson, readUntrustedJson, tryDir, tryLayout, writeJsonAtomic} from "../record/store";
import type {TryLayout} from "../record/store";
import {startSite} from "../sites/server";
import type {RunningSite} from "../sites/server";
import type {TaskDefinition} from "../tasks/types";
import {taskVersion} from "../tasks/types";
import {CdpClient} from "./cdp";
import {launchChrome} from "./chrome";
import type {ChromeHandle} from "./chrome";
import type {Gateway, GatewayRegistration} from "./gateway";
import type {ModelChoice} from "./models";
import {Observer} from "./observer";
import type {PageTarget} from "./observer";
import {sandboxArgv} from "./sandbox";

export interface Cell {
    readonly task: TaskDefinition;
    readonly model: ModelChoice;
    readonly arm: Arm;
    readonly attempt: number;
}

/** 派运行的上限：总并发、每个上游的并发、整批的总输入止损线。 */
export interface PoolLimits {
    readonly concurrency: number;
    /** 每个上游同时最多几个运行（extremelycat 限并发）。 */
    readonly providerLimits: Readonly<Partial<Record<ModelChoice["provider"], number>>>;
    /** 整批的总输入 token 超过它就不再派新的运行，已在跑的收完。 */
    readonly maxTotalInputTokens: number | null;
    log(message: string): void;
}

export interface ScheduleOptions extends PoolLimits {
    readonly out: string;
    readonly plan: RunPlan;
    readonly cells: readonly Cell[];
    readonly gateway: Gateway;
    /** browser-use 环境里的 python。 */
    readonly buPython: string;
    readonly chromePath?: string;
    /** Chrome 临时目录的父目录（系统 Temp 下，跑完删掉）。 */
    readonly tempRoot: string;
    /** 沙箱里另外要藏起来的宿主目录：运行目录、Chrome 的临时根、密钥文件所在的目录（真实路径）。 */
    readonly hide: readonly string[];
    /** 等执行者发 ready 的时限；缺省 `READY_TIMEOUT_MS`。测试用短的。 */
    readonly readyTimeoutMs?: number;
    /** 题的时限之外再等多久才兜底结束执行者；缺省 `BACKSTOP_GRACE_MS`。 */
    readonly backstopGraceMs?: number;
}

/** 一格跑完的结果：计分了、跑满了还不计分，或者早先已经跑完（续跑时跳过）。 */
export interface CellResult {
    readonly state: "settled" | "exhausted" | "skipped";
    readonly inputTokens: number;
}

export interface ScheduleSummary {
    readonly settled: number;
    readonly exhausted: number;
    /** 早先的调用里已经跑完的格。 */
    readonly skipped: number;
    /** 跑一格时评测自己抛了错（写盘失败之类），这一格没有结论。 */
    readonly failed: number;
    /** 停派之后没派出去的格。 */
    readonly notStarted: number;
    /** 为什么停派：总输入超过止损线，或连着几格都跑满了还不计分（上游多半整体出了问题，例如额度用完）。 */
    readonly stoppedBy: "budget" | "infra-errors" | null;
    readonly totalInputTokens: number;
}

/** 这个运行目录正被另一个调度器用着。 */
export class OutDirBusyError extends Error {}

const READY_TIMEOUT_MS = 180_000;
const BACKSTOP_GRACE_MS = 90_000;
/** 连着这么多格跑满还不计分就停派。 */
const CONSECUTIVE_EXHAUSTED_STOP = 3;
/** 执行者交回的 executor.json 的上限。 */
const EXECUTOR_OUTPUT_MAX_BYTES = 20 * 1024 * 1024;
const ARM_DIR = join(import.meta.dir, "../arms/browser-use");

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 给一个 Promise 加时限；超时或失败时记一条附注、交回 undefined（收尾的每一步都这样，免得一步卡住整个运行）。 */
async function bounded<T>(name: string, ms: number, notes: string[], work: () => Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
        })]);
    } catch (error) {
        notes.push(`${name}: ${message(error)}`);
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

/** 执行者沙箱里要只读绑回来的路径：venv 与它的基础解释器所在的整个目录、适配脚本的目录。 */
async function executorReadonly(buPython: string): Promise<string[]> {
    const venv = dirname(dirname(buPython));
    const base = dirname(dirname(await realpath(buPython)));
    return [...new Set([venv, base, ARM_DIR])];
}

/** 不算“出了任务范围”的网址：空白页、Chrome 自己的错误页与内部页。 */
const NOT_A_SITE = /^(?:about:|chrome-error:|chrome:|devtools:|data:)/u;
const OFFSITE_LIMIT = 50;

/** 页面目标到过的、任务给的两个源之外的网址（去重，最多 `OFFSITE_LIMIT` 个）。 */
export function offsiteUrls(targets: readonly PageTarget[], urls: {readonly main: string; readonly editor: string}): string[] {
    const origins = new Set([new URL(urls.main).origin, new URL(urls.editor).origin]);
    const origin = (url: string) => {
        try {
            return new URL(url).origin;
        } catch {
            return url;
        }
    };
    return [...new Set(targets.map((target) => target.url).filter((url) => !NOT_A_SITE.test(url) && !origins.has(origin(url))))].slice(0, OFFSITE_LIMIT);
}

/** 一回运行里已经拿到的资源：收尾只依赖这里有的。 */
interface Started {
    site: RunningSite<unknown> | null;
    chrome: ChromeHandle | null;
    registration: GatewayRegistration | null;
    cdp: CdpClient | null;
    observer: Observer | null;
    lease: OwnedProcessLease | null;
}

/** 执行这一段交回的事实。 */
interface Execution {
    readyAt: number | null;
    executorEndedAt: number | null;
    killedAtBackstop: boolean;
    output: ExecutorOutput | null;
    /** 执行者没发 ready 就退出了。 */
    neverReady: string | null;
}

/** 在沙箱里起执行者，转发它的事件，等它退出，读它的结果。 */
async function execute(options: ScheduleOptions, cell: Cell, layout: TryLayout, started: Started & {observer: Observer}, notes: string[], observed: ObservedStep[]): Promise<Execution> {
    const {observer} = started;
    const facts: Execution = {readyAt: null, executorEndedAt: null, killedAtBackstop: false, output: null, neverReady: null};
    const argv = sandboxArgv({
        command: [options.buPython, "-I", join(ARM_DIR, "run.py"), "/tmp/job/job.json"],
        readonly: await executorReadonly(options.buPython),
        binds: [{host: layout.workspace, sandbox: "/tmp/work", writable: true}, {host: layout.job, sandbox: "/tmp/job", writable: false}, {host: layout.executor, sandbox: "/tmp/out", writable: true}],
        dirs: ["/tmp/home"],
        hide: options.hide,
        env: {PATH: `${dirname(options.buPython)}:/usr/bin:/bin`, HOME: "/tmp/home", LANG: "C.UTF-8", TZ: "Asia/Shanghai", PYTHONUNBUFFERED: "1", ANONYMIZED_TELEMETRY: "false", BROWSER_USE_NO_UPDATE_CHECK: "1", BROWSER_USE_AUTO_LOGIN: "false", BROWSER_USE_SETUP_LOGGING: "false"},
        cwd: "/tmp/work",
    });
    const lease = spawnOwnedProcess({command: argv[0] as string, args: argv.slice(1), env: {PATH: process.env.PATH ?? "/usr/bin:/bin"}, stdin: "ignore", stdout: "pipe", stderr: "pipe", graceMs: 5_000});
    started.lease = lease;
    const stderr = createWriteStream(layout.stderr);
    lease.stderr?.pipe(stderr);
    const stdout = createWriteStream(layout.stdout);
    const capturing: Array<Promise<unknown>> = [];
    const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    let readyTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        notes.push(`executor sent no ready event within ${readyTimeoutMs} ms`);
        void lease.terminate("timeout");
    }, readyTimeoutMs);
    let backstop: ReturnType<typeof setTimeout> | undefined;
    const lines = createInterface({input: lease.stdout as NodeJS.ReadableStream});
    lines.on("line", (line) => {
        stdout.write(`${line}\n`);
        const event = parseEventLine(line);
        if (event === null) return;
        if (event.event === "ready" && facts.readyAt === null) {
            facts.readyAt = performance.now();
            clearTimeout(readyTimer);
            readyTimer = undefined;
            backstop = setTimeout(() => {
                facts.killedAtBackstop = true;
                void lease.terminate("timeout");
            }, cell.task.timeLimitSec * 1_000 + (options.backstopGraceMs ?? BACKSTOP_GRACE_MS));
        } else if (event.event === "step") {
            const at = performance.now();
            const ordinal = observed.length + 1;
            const entry: {line: string; at: number; targets: PageTarget[]} = {line: event.line ?? "", at, targets: []};
            observed.push(entry);
            capturing.push(appendFile(layout.progress, `${JSON.stringify({ordinal, at, line: entry.line})}\n`));
            capturing.push(observer.capture(ordinal).then((targets) => {
                entry.targets = targets;
            }, (error: unknown) => notes.push(`observer step ${ordinal}: ${message(error)}`)));
        }
    });
    const completion = await lease.completion.catch((error: unknown) => {
        notes.push(`executor completion failed: ${message(error)}`);
        return null;
    });
    facts.executorEndedAt = performance.now();
    clearTimeout(readyTimer);
    clearTimeout(backstop);
    await Promise.allSettled(capturing);
    await new Promise<void>((resolve) => stdout.end(resolve));
    if (facts.readyAt === null) facts.neverReady = `executor exited before ready (${JSON.stringify(completion)})`;
    try {
        facts.output = await readUntrustedJson(join(layout.executor, "executor.json"), ExecutorOutputSchema, EXECUTOR_OUTPUT_MAX_BYTES);
    } catch (error) {
        notes.push(`executor.json ${message(error)}`);
    }
    return facts;
}

async function runTry(options: ScheduleOptions, cell: Cell, layout: TryLayout, n: number): Promise<{score: ScoreRecord; inputTokens: number}> {
    const {task, model} = cell;
    const notes: string[] = [];
    const started: Started = {site: null, chrome: null, registration: null, cdp: null, observer: null, lease: null};
    const observed: ObservedStep[] = [];
    const seen: PageTarget[] = [];
    let chromeDir: string | null = null;
    let startupError: string | null = null;
    let harnessError: string | null = null;
    let execution: Execution | null = null;

    // 这一回的目录不带 recursive 建：已经在了说明有别的调度器在写它（锁之外再挡一道），直接抛出，不往里写。
    await mkdir(layout.dir);
    try {
        for (const dir of [layout.job, layout.workspace, layout.executor, layout.shots]) await mkdir(dir);
        try {
            chromeDir = await mkdtemp(join(options.tempRoot, "chrome-"));
            started.site = await startSite(task.site as TaskDefinition["site"], task.seed);
            started.chrome = await launchChrome({runDir: chromeDir, chromePath: options.chromePath, hide: options.hide});
            started.registration = options.gateway.register(model.model);
            started.cdp = await CdpClient.connect(started.chrome.cdpUrl);
            started.observer = new Observer(started.cdp, layout.shots);
            await writeJsonAtomic(join(layout.job, "job.json"), {
                task: task.instruction(started.site.urls),
                cdpUrl: started.chrome.cdpUrl,
                gatewayUrl: options.gateway.url,
                gatewayKey: started.registration.key,
                model: model.model,
                reasoning: model.reasoning,
                timeLimitSec: task.timeLimitSec,
                maxSteps: options.plan.maxSteps,
            });
            await writeJsonAtomic(layout.ready, {urls: started.site.urls, chrome: started.chrome.version, at: performance.now()});
        } catch (error) {
            startupError = message(error);
        }
        const observer = started.observer;
        if (startupError === null && observer !== null) {
            seen.push(...(await bounded("observer start", 20_000, notes, () => observer.capture("start")) ?? []));
            execution = await execute(options, cell, layout, {...started, observer}, notes, observed);
            startupError = execution.neverReady;
        }
    } catch (error) {
        harnessError = message(error);
    }

    // 收尾：执行者还在就结束它、截终态、收假站证据、断开、关 Chrome、停假站、注销假密钥（取消在途请求）；每一步各自限时。
    const lease = started.lease;
    if (lease !== null && execution === null) await bounded("executor stop", 15_000, notes, () => lease.terminate("cancel"));
    const observer = started.observer;
    if (observer !== null) seen.push(...(await bounded("observer end", 20_000, notes, () => observer.capture("end")) ?? []));
    const evidence: SiteEvidenceRecord | null = started.site?.evidence(task.allowedWrites) ?? null;
    const siteErrors = started.site?.errors() ?? [];
    started.cdp?.close();
    const chromeExit = started.chrome?.selfExit() ?? null;
    if (started.chrome !== null) await bounded("chrome close", 20_000, notes, () => (started.chrome as ChromeHandle).close());
    if (started.site !== null) await bounded("site stop", 10_000, notes, () => (started.site as RunningSite<unknown>).stop());
    if (chromeDir !== null) await rm(chromeDir, {recursive: true, force: true});
    await started.registration?.release();
    const calls = started.registration?.calls() ?? [];
    const refused = started.registration?.refused() ?? 0;
    if (refused > 0) notes.push(`gateway refused ${refused} request(s) for another model`);

    const output = execution?.output ?? null;
    const readyAt = execution?.readyAt ?? null;
    const record: RunRecord = {
        format: RUN_FORMAT,
        identity: {taskId: task.id, taskVersion: taskVersion(task), arm: cell.arm, model: model.id, reasoning: model.reasoning, attempt: cell.attempt, try: n},
        steps: buildSteps(output, observed),
        thinking: output?.thinking ?? [],
        result: {finalAnswer: output?.finalAnswer ?? null, success: output?.success ?? null, partial: output?.partial ?? null, deliverables: output?.deliverables ?? [], downloads: []},
        screenshots: observer?.screenshots() ?? [],
        usage: {gateway: calls, executor: output?.usage ?? null},
        site: evidence,
        navigation: {offsite: started.site === null ? [] : offsiteUrls([...seen, ...observed.flatMap((step) => step.targets)], started.site.urls)},
        outcome: classifyOutcome({
            startupError,
            siteError: siteErrors[0] ?? null,
            harnessError,
            executor: output === null ? null : {status: output.status, error: output.error},
            executorKilledAtBackstop: execution?.killedAtBackstop ?? false,
            chromeExit,
            gatewayCalls: calls,
            budgetExceeded: started.registration?.budgetExceeded() ?? false,
        }),
        timing: {readyAt, deadlineAt: readyAt === null ? null : readyAt + task.timeLimitSec * 1_000, executorEndedAt: execution?.executorEndedAt ?? null, endedAt: performance.now(), observerMs: observer?.observerMs() ?? 0},
        versions: {...(output?.versions ?? {}), chrome: started.chrome?.version ?? "unknown", bun: Bun.version, taskVersion: taskVersion(task), adapter: "browser-use/1"},
        notes,
    };
    await writeJsonAtomic(layout.record, record);
    const score = scoreRun(task, record);
    await writeJsonAtomic(layout.score, score);
    return {score, inputTokens: calls.reduce((sum, call) => sum + (call.usage?.input ?? 0), 0)};
}

/**
 * 跑一格（一个 attempt）：从续跑的位置开始，不计分的结局再跑一回，直到计分或跑满。交回这一格各回用掉的总输入 token。
 * 上一回记录写好了、判分还没写就被打断的，按记录补判，不重跑（重跑会换掉样本、再花一次钱）。
 */
export async function runCell(options: ScheduleOptions, cell: Cell): Promise<CellResult> {
    const dir = attemptDir(options.out, {taskId: cell.task.id, model: cell.model.id, arm: cell.arm, attempt: cell.attempt});
    let state = await attemptState(dir);
    if (state.kind === "run" && state.nextTry > 1) {
        const previous = tryLayout(tryDir(dir, state.nextTry - 1));
        const record = await readJson(previous.record, RunRecordSchema);
        if (record !== null && !(await Bun.file(previous.score).exists())) {
            await writeJsonAtomic(previous.score, scoreRun(cell.task, record));
            options.log(`rescored ${cell.task.id} ${cell.model.id} a${cell.attempt} try-${state.nextTry - 1} from its record`);
            state = await attemptState(dir);
        }
    }
    if (state.kind !== "run") return {state: "skipped", inputTokens: 0};
    await mkdir(dir, {recursive: true});
    let inputTokens = 0;
    for (let n = state.nextTry; ; n++) {
        const label = `${cell.task.id} ${cell.model.id} a${cell.attempt} try-${n}`;
        options.log(`start ${label}`);
        const {score, inputTokens: used} = await runTry(options, cell, tryLayout(tryDir(dir, n)), n);
        inputTokens += used;
        options.log(`done  ${label}: ${score.outcome} score=${score.score ?? "-"}`);
        if (isCounted(score.outcome)) return {state: "settled", inputTokens};
        if (n >= MAX_TRIES) return {state: "exhausted", inputTokens};
    }
}

/**
 * 按给的先后派格：总并发与每个上游的并发都有上限，挑队列里第一个现在能跑的格（Gemini 满了时后面的 luna 先走）。
 * 整批的总输入超过止损线、或连着几格跑满还不计分时不再派新的，已在跑的收完。
 * `run` 不该失败；失败了记一条日志、算作 failed，不影响别的格。
 */
export async function runPool(cells: readonly Cell[], limits: PoolLimits, run: (cell: Cell) => Promise<CellResult>): Promise<ScheduleSummary> {
    const queue = [...cells];
    const running = new Set<Promise<void>>();
    const perProvider = new Map<ModelChoice["provider"], number>();
    const counts = {settled: 0, exhausted: 0, skipped: 0, failed: 0};
    let totalInputTokens = 0;
    let consecutiveExhausted = 0;
    let stoppedBy: ScheduleSummary["stoppedBy"] = null;
    const stop = (reason: NonNullable<ScheduleSummary["stoppedBy"]>, detail: string) => {
        if (stoppedBy !== null) return;
        stoppedBy = reason;
        limits.log(`stop: ${detail}; no new runs`);
    };
    const capacity = (cell: Cell) => (perProvider.get(cell.model.provider) ?? 0) < (limits.providerLimits[cell.model.provider] ?? Number.POSITIVE_INFINITY);
    while (queue.length > 0 || running.size > 0) {
        const index = stoppedBy !== null || running.size >= limits.concurrency ? -1 : queue.findIndex(capacity);
        if (index === -1) {
            if (running.size === 0) break;
            await Promise.race(running);
            continue;
        }
        const [cell] = queue.splice(index, 1) as [Cell];
        perProvider.set(cell.model.provider, (perProvider.get(cell.model.provider) ?? 0) + 1);
        const job: Promise<void> = run(cell).then((result) => {
            counts[result.state] += 1;
            totalInputTokens += result.inputTokens;
            if (result.state === "exhausted") consecutiveExhausted += 1;
            else if (result.state === "settled") consecutiveExhausted = 0;
            if (limits.maxTotalInputTokens !== null && totalInputTokens > limits.maxTotalInputTokens) stop("budget", `${totalInputTokens} input tokens > ${limits.maxTotalInputTokens}`);
            if (consecutiveExhausted >= CONSECUTIVE_EXHAUSTED_STOP) stop("infra-errors", `${consecutiveExhausted} cells in a row ended without a counted outcome`);
        }, (error: unknown) => {
            counts.failed += 1;
            limits.log(`cell ${cell.task.id} ${cell.model.id} a${cell.attempt} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }).finally(() => {
            perProvider.set(cell.model.provider, (perProvider.get(cell.model.provider) ?? 1) - 1);
            running.delete(job);
        });
        running.add(job);
    }
    return {...counts, notStarted: queue.length, stoppedBy, totalInputTokens};
}

/**
 * 起真的假站、Chrome 与执行者跑这一批格；运行目录里已经跑完的格跳过（续跑）。
 * 先拿运行目录的排他锁（进程退出即放），再核对或写下计划；拿不到锁抛 `OutDirBusyError`，计划不同抛 `PlanMismatchError`。
 */
export async function runSchedule(options: ScheduleOptions): Promise<ScheduleSummary> {
    await mkdir(options.out, {recursive: true});
    const lock = tryLock(join(options.out, ".lock"));
    if (lock === null) throw new OutDirBusyError(`${options.out} is being used by another evaluation run`);
    try {
        await claimPlan(options.out, options.plan);
        await mkdir(options.tempRoot, {recursive: true});
        return await runPool(options.cells, options, (cell) => runCell(options, cell));
    } finally {
        lock.release();
    }
}
