/**
 * 调度：按“题 × 模型 × 第几次”排出运行，并发跑，按阶段落盘，可续跑（实施计划“schedule.ts”一节）。
 *
 * 一回运行的先后：起假站、起 Chrome、登记网关的假密钥（这一段出错是评测部件出错）→ 在沙箱里起执行者，
 * 它连上浏览器后发 ready，题的时限从这里算；执行者自己到点收尾（browser-use 的 `run(timeout=...)`），
 * 调度器在“时限 + 宽限”才兜底结束它 → 收尾，每一步有自己的时限 → 拼运行记录、定结局、判分。
 * 不计分的结局（上游或评测部件出错）在同一次重复里再跑一回，最多 `MAX_TRIES` 回。
 */

import {createWriteStream} from "node:fs";
import {appendFile, mkdir, mkdtemp, realpath, rm} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createInterface} from "node:readline";

import {spawnOwnedProcess} from "@notnotype/owned-process";

import {ExecutorOutputSchema, buildSteps, parseEventLine} from "../arms/browser-use/adapter";
import type {ExecutorOutput, ObservedStep} from "../arms/browser-use/adapter";
import {scoreRun} from "../judge/rules";
import {classifyOutcome, isCounted} from "../record/outcome";
import {RUN_FORMAT} from "../record/schema";
import type {Arm, RunOutcome, RunRecord, ScoreRecord, SiteEvidenceRecord} from "../record/schema";
import {MAX_TRIES, attemptDir, attemptState, readJson, tryDir, tryLayout, writeJsonAtomic} from "../record/store";
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
    readonly cells: readonly Cell[];
    readonly gateway: Gateway;
    /** browser-use 环境里的 python。 */
    readonly buPython: string;
    readonly chromePath?: string;
    /** Chrome 临时目录的父目录（系统 Temp 下，跑完删掉）。 */
    readonly tempRoot: string;
    /** 执行者最多几次模型请求（browser-use 的 max_steps）。 */
    readonly maxSteps: number;
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
    /** 止损后没派出去的格。 */
    readonly notStarted: number;
    readonly stoppedByBudget: boolean;
    readonly totalInputTokens: number;
}

const READY_TIMEOUT_MS = 180_000;
const BACKSTOP_GRACE_MS = 90_000;
const ARM_DIR = join(import.meta.dir, "../arms/browser-use");

/** 给一个 Promise 加时限；超时或失败时记一条附注、交回 undefined（收尾的每一步都这样，免得一步卡住整个运行）。 */
async function bounded<T>(name: string, ms: number, notes: string[], work: () => Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
        })]);
    } catch (error) {
        notes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
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

interface Started {
    site: RunningSite<unknown> | null;
    chrome: ChromeHandle | null;
    registration: GatewayRegistration | null;
    cdp: CdpClient | null;
}

async function runTry(options: ScheduleOptions, cell: Cell, layout: TryLayout, n: number): Promise<{score: ScoreRecord; inputTokens: number}> {
    const {task, model} = cell;
    const notes: string[] = [];
    const started: Started = {site: null, chrome: null, registration: null, cdp: null};
    let startupError: string | null = null;
    for (const dir of [layout.job, layout.workspace, layout.executor, layout.shots]) await mkdir(dir, {recursive: true});
    const chromeDir = await mkdtemp(join(options.tempRoot, "chrome-"));
    let observer: Observer | null = null;
    try {
        started.site = await startSite(task.site as TaskDefinition["site"], task.seed);
        started.chrome = await launchChrome({runDir: chromeDir, chromePath: options.chromePath});
        started.registration = options.gateway.register();
        started.cdp = await CdpClient.connect(started.chrome.cdpUrl);
        observer = new Observer(started.cdp, layout.shots);
        await writeJsonAtomic(join(layout.job, "job.json"), {
            task: task.instruction(started.site.urls),
            cdpUrl: started.chrome.cdpUrl,
            gatewayUrl: options.gateway.url,
            gatewayKey: started.registration.key,
            model: model.model,
            reasoning: model.reasoning,
            timeLimitSec: task.timeLimitSec,
            maxSteps: options.maxSteps,
        });
        await writeJsonAtomic(layout.ready, {urls: started.site.urls, chrome: started.chrome.version, at: performance.now()});
    } catch (error) {
        startupError = error instanceof Error ? error.message : String(error);
    }

    let readyAt: number | null = null;
    let killedAtBackstop = false;
    let output: ExecutorOutput | null = null;
    const observed: ObservedStep[] = [];
    if (startupError === null && observer !== null && started.chrome !== null) {
        const capturing: Array<Promise<unknown>> = [];
        await bounded("observer start", 20_000, notes, () => (observer as Observer).capture("start"));
        const argv = sandboxArgv({
            command: [options.buPython, "-I", join(ARM_DIR, "run.py"), "/tmp/job/job.json"],
            readonly: await executorReadonly(options.buPython),
            binds: [{host: layout.workspace, sandbox: "/tmp/work", writable: true}, {host: layout.job, sandbox: "/tmp/job", writable: false}, {host: layout.executor, sandbox: "/tmp/out", writable: true}],
            dirs: ["/tmp/home"],
            env: {PATH: `${dirname(options.buPython)}:/usr/bin:/bin`, HOME: "/tmp/home", LANG: "C.UTF-8", TZ: "Asia/Shanghai", PYTHONUNBUFFERED: "1", ANONYMIZED_TELEMETRY: "false", BROWSER_USE_NO_UPDATE_CHECK: "1", BROWSER_USE_AUTO_LOGIN: "false", BROWSER_USE_SETUP_LOGGING: "false"},
            cwd: "/tmp/work",
        });
        const lease = spawnOwnedProcess({command: argv[0] as string, args: argv.slice(1), env: {PATH: process.env.PATH ?? "/usr/bin:/bin"}, stdin: "ignore", stdout: "pipe", stderr: "pipe", graceMs: 5_000});
        const stderr = createWriteStream(layout.stderr);
        lease.stderr?.pipe(stderr);
        const stdout = createWriteStream(layout.stdout);
        let readyTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
            notes.push(`executor sent no ready event within ${READY_TIMEOUT_MS} ms`);
            void lease.terminate("timeout");
        }, READY_TIMEOUT_MS);
        let backstop: ReturnType<typeof setTimeout> | undefined;
        const lines = createInterface({input: lease.stdout as NodeJS.ReadableStream});
        lines.on("line", (line) => {
            stdout.write(`${line}\n`);
            const event = parseEventLine(line);
            if (event === null) return;
            if (event.event === "ready" && readyAt === null) {
                readyAt = performance.now();
                clearTimeout(readyTimer);
                readyTimer = undefined;
                backstop = setTimeout(() => {
                    killedAtBackstop = true;
                    void lease.terminate("timeout");
                }, task.timeLimitSec * 1_000 + BACKSTOP_GRACE_MS);
            } else if (event.event === "step") {
                const at = performance.now();
                const ordinal = observed.length + 1;
                const entry: {line: string; at: number; targets: PageTarget[]} = {line: event.line ?? "", at, targets: []};
                observed.push(entry);
                capturing.push(appendFile(layout.progress, `${JSON.stringify({ordinal, at, line: entry.line})}\n`));
                capturing.push((observer as Observer).capture(ordinal).then((targets) => {
                    entry.targets = targets;
                }, (error: unknown) => notes.push(`observer step ${ordinal}: ${error instanceof Error ? error.message : String(error)}`)));
            }
        });
        const completion = await lease.completion.catch((error: unknown) => {
            notes.push(`executor completion failed: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        });
        clearTimeout(readyTimer);
        clearTimeout(backstop);
        await Promise.allSettled(capturing);
        stdout.end();
        if (readyAt === null) startupError = `executor exited before ready (${JSON.stringify(completion)})`;
        try {
            output = await readJson(join(layout.executor, "executor.json"), ExecutorOutputSchema);
        } catch (error) {
            notes.push(`executor.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 收尾：截终态、收假站证据、断开、关 Chrome、停假站、注销假密钥；每一步各自限时。
    if (observer !== null) await bounded("observer end", 20_000, notes, () => (observer as Observer).capture("end"));
    const evidence: SiteEvidenceRecord | null = started.site?.evidence(task.allowedWrites) ?? null;
    const siteErrors = started.site?.errors() ?? [];
    started.cdp?.close();
    const chromeExit = started.chrome?.selfExit() ?? null;
    if (started.chrome !== null) await bounded("chrome close", 20_000, notes, () => (started.chrome as ChromeHandle).close());
    if (started.site !== null) await bounded("site stop", 10_000, notes, () => (started.site as RunningSite<unknown>).stop());
    await rm(chromeDir, {recursive: true, force: true});
    const calls = started.registration?.calls() ?? [];
    const budgetExceeded = started.registration?.budgetExceeded() ?? false;
    started.registration?.release();

    const outcome: RunOutcome = classifyOutcome({
        startupError,
        siteError: siteErrors[0] ?? null,
        executor: output === null ? null : {status: output.status, error: output.error},
        executorKilledAtBackstop: killedAtBackstop,
        chromeExit,
        gatewayCalls: calls,
        budgetExceeded,
    });
    const record: RunRecord = {
        format: RUN_FORMAT,
        identity: {taskId: task.id, taskVersion: taskVersion(task), arm: cell.arm, model: model.id, reasoning: model.reasoning, attempt: cell.attempt, try: n},
        steps: buildSteps(output, observed),
        thinking: output?.thinking ?? [],
        result: {finalAnswer: output?.finalAnswer ?? null, deliverables: output?.deliverables ?? [], downloads: []},
        screenshots: observer?.screenshots() ?? [],
        usage: {gateway: calls, executor: output?.usage ?? null},
        site: evidence,
        outcome,
        timing: {readyAt, deadlineAt: readyAt === null ? null : readyAt + task.timeLimitSec * 1_000, endedAt: performance.now(), observerMs: observer?.observerMs() ?? 0},
        versions: {...(output?.versions ?? {}), chrome: started.chrome?.version ?? "unknown", bun: Bun.version, taskVersion: taskVersion(task), adapter: "browser-use/1"},
        notes,
    };
    await writeJsonAtomic(layout.record, record);
    const score = scoreRun(task, record);
    await writeJsonAtomic(layout.score, score);
    return {score, inputTokens: calls.reduce((sum, call) => sum + (call.usage?.input ?? 0), 0)};
}

/** 跑一格（一个 attempt）：从续跑的位置开始，不计分的结局再跑一回，直到计分或跑满。交回这一格各回用掉的总输入 token。 */
async function runCell(options: ScheduleOptions, cell: Cell): Promise<CellResult> {
    const dir = attemptDir(options.out, {taskId: cell.task.id, model: cell.model.id, arm: cell.arm, attempt: cell.attempt});
    const state = await attemptState(dir);
    if (state.kind !== "run") return {state: "skipped", inputTokens: 0};
    let inputTokens = 0;
    for (let n = state.nextTry; ; n++) {
        const label = `${cell.task.id} ${cell.model.id} a${cell.attempt} try-${n}`;
        options.log(`start ${label}`);
        const layout = tryLayout(tryDir(dir, n));
        const {score, inputTokens: used} = await runTry(options, cell, layout, n);
        inputTokens += used;
        options.log(`done  ${label}: ${score.outcome} score=${score.score ?? "-"}`);
        if (isCounted(score.outcome)) return {state: "settled", inputTokens};
        if (n >= MAX_TRIES) return {state: "exhausted", inputTokens};
    }
}

/**
 * 按给的先后派格：总并发与每个上游的并发都有上限，挑队列里第一个现在能跑的格（Gemini 满了时后面的 luna 先走）。
 * 整批的总输入超过止损线后不再派新的，已在跑的收完。`run` 不该失败；失败了记一条日志、算作 failed，不影响别的格。
 */
export async function runPool(cells: readonly Cell[], limits: PoolLimits, run: (cell: Cell) => Promise<CellResult>): Promise<ScheduleSummary> {
    const queue = [...cells];
    const running = new Set<Promise<void>>();
    const perProvider = new Map<ModelChoice["provider"], number>();
    const counts = {settled: 0, exhausted: 0, skipped: 0, failed: 0};
    let totalInputTokens = 0;
    let stoppedByBudget = false;
    const capacity = (cell: Cell) => (perProvider.get(cell.model.provider) ?? 0) < (limits.providerLimits[cell.model.provider] ?? Number.POSITIVE_INFINITY);
    while (queue.length > 0 || running.size > 0) {
        const index = stoppedByBudget || running.size >= limits.concurrency ? -1 : queue.findIndex(capacity);
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
            if (limits.maxTotalInputTokens !== null && totalInputTokens > limits.maxTotalInputTokens && !stoppedByBudget) {
                stoppedByBudget = true;
                limits.log(`stop-loss: ${totalInputTokens} input tokens > ${limits.maxTotalInputTokens}; no new runs`);
            }
        }, (error: unknown) => {
            counts.failed += 1;
            limits.log(`cell ${cell.task.id} ${cell.model.id} a${cell.attempt} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }).finally(() => {
            perProvider.set(cell.model.provider, (perProvider.get(cell.model.provider) ?? 1) - 1);
            running.delete(job);
        });
        running.add(job);
    }
    return {...counts, notStarted: queue.length, stoppedByBudget, totalInputTokens};
}

/** 起真的假站、Chrome 与执行者跑这一批格；运行目录里已经跑完的格跳过（续跑）。 */
export async function runSchedule(options: ScheduleOptions): Promise<ScheduleSummary> {
    await mkdir(options.tempRoot, {recursive: true});
    return runPool(options.cells, options, (cell) => runCell(options, cell));
}
