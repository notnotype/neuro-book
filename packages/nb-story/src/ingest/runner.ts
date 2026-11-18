/**
 * 在主线程里管一次抽取任务（docs/specs/story/ingest.md 输出 1、3、11 与“状态与转换”）：拿锁、判定、起抽取线程、
 * 转发事件、写瞬时状态、停止、收口。
 *
 * 锁由主线程持有，直到抽取线程确认结束（或被结束）才放：锁在线程里打开的话，线程被结束时文件不会关、锁不会放，
 * 同一进程以后会一直以为它还在运行（计划审查第 2 条）。抽取线程的正常结束、报错、意外退出都走同一个收口
 * `finish`，它只执行一次。
 *
 * 停止：置共享标志、发消息中止在途请求，等线程自己结束；宽限期过了还没结束（例如卡在一次很长的编译里）就结束
 * 线程。没提交的那一章作废，书的数据不受影响（提交是一次改名）。
 */

import {randomUUID} from "node:crypto";

import type {FileLock} from "@notnotype/nb-flock";

import type {BookFeatures} from "../core/dataset";
import {StoryError} from "../core/errors";
import {bookIdFromTitle, isValidBookId, type Library} from "../core/library";
import type {IngestEvent, JobOutcome} from "./job";
import {chapterWaits} from "./retry-policy";
import {applyPlan, planFromSaved, planFromText, type IngestPlan} from "./start";
import {IngestStore, type IngestState, type Price, type RunnerKind} from "./store";
import type {WorkerOutbound, WorkerStart} from "./worker";

/** 停止后等抽取线程自己结束的时间；过了就结束它。 */
const STOP_GRACE_MS = 15_000;

export interface EndpointConfig {
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
    maxTokens: number;
}

/** 配置里的一个抽取模型 → 发给抽取线程的端点与单价（密钥只带环境变量名）。 */
export function modelChoice(model: {baseUrl: string; id: string; apiKeyEnv: string; maxTokens: number; price: Price | null}): {endpoint: EndpointConfig; price: Price | null} {
    return {endpoint: {baseUrl: model.baseUrl, model: model.id, apiKeyEnv: model.apiKeyEnv, maxTokens: model.maxTokens}, price: model.price};
}

export interface Runner {
    readonly id: string;
    readonly plan: IngestPlan;
    /** 任务结束（抽完、停下、失败）时 resolve；锁已经放掉、状态已经写下。 */
    readonly done: Promise<JobOutcome>;
    /** 停止；可以多次调用。 */
    stop(): void;
}

export interface StartInput {
    library: Library;
    /** 给原文时按它判定（新建、接着抽、追加）；不给时用保存的原文接着抽。 */
    text?: string;
    title?: string;
    id?: string;
    /** 请求的开关：新建时生效；已有抽取记录时只核对（与保存值不同报 invalid_params）。 */
    features?: Partial<BookFeatures>;
    endpoint: EndpointConfig;
    price: Price | null;
    /** 挑相关说法用的模型；null 时不挑（默认）。 */
    recall: {endpoint: EndpointConfig; price: Price | null} | null;
    /** 马甲核对开不开（输出 20）；由入口从配置解析（`personaCheckEnabled`），这里不给默认值。 */
    personaCheck: boolean;
    runner: RunnerKind;
    /** 同一章失败（回复不成形、渠道失败重试用完）后最多重做几次，缺省 3；0 不重做。 */
    autoResume?: number;
    /** 替换等待时间（测试把分钟缩成毫秒；产品里不传）：章级重做的等待，以及渠道失败与限流的延迟表。 */
    timing?: {chapterWaitsMs?: number[]; delaysMs?: {network?: number[]; rateLimit?: number[]}};
    onEvent?: (event: IngestEvent) => void;
}

/**
 * 发起：拿锁，在锁里重新判定，占用或追加，起抽取线程。已经全部抽完（`done`）时不起线程，返回 runner 为 null。
 * 这个 id 已有任务在运行时报 `ingest_running`。
 */
export async function startIngest(input: StartInput): Promise<{plan: IngestPlan; runner: Runner | null}> {
    const id = input.id ?? (input.text !== undefined ? bookIdFromTitle(input.title ?? "") : undefined);
    if (!id) throw new StoryError("invalid_params", "没有给原文，也没有给书 id");
    // 书 id 拼进锁与记录的路径：在碰任何文件之前校验（实现审查第 15 条）；书库格式不认识时什么都不写、不发请求（第 3 条）。
    if (!isValidBookId(id)) throw new StoryError("invalid_params", `书 id 只能用小写字母、数字与短横线：${id}`);
    await input.library.ensureWritable();
    const store = new IngestStore(input.library, id);
    const lock = await store.tryLock();
    if (!lock) throw new StoryError("ingest_running", `书 ${id} 已有抽取任务在运行`);
    try {
        // 判定在锁里做：两个发起者不会都以为是新建。
        const plan = input.text !== undefined ? await planFromText(input.library, {text: input.text, title: input.title ?? "", id, ...(input.features ? {features: input.features} : {})}) : await planFromSaved(input.library, id, input.features);
        if (plan.action === "done") {
            lock.release();
            return {plan, runner: null};
        }
        await applyPlan(input.library, plan);
        return {plan, runner: launch(input, plan, store, lock)};
    } catch (error) {
        lock.release();
        throw error;
    }
}

function launch(input: StartInput, plan: IngestPlan, store: IngestStore, lock: FileLock): Runner {
    const run = randomUUID();
    const stopBuffer = new SharedArrayBuffer(4);
    const stopFlag = new Int32Array(stopBuffer);
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {type: "module"});
    let state: IngestState = {
        run, runner: input.runner, pid: process.pid, startedAt: new Date().toISOString(), state: "running",
        chapter: null, step: null, retry: null, stopReason: null, updatedAt: new Date().toISOString(),
    };
    // 状态文件按事件顺序写；写失败不影响抽取（进度以书为准），但要留下诊断。
    let writing = Promise.resolve();
    const writeState = (patch: Partial<IngestState>) => {
        state = {...state, ...patch, updatedAt: new Date().toISOString()};
        const snapshot = state;
        writing = writing.then(() => store.writeState(snapshot)).catch((error: unknown) => {
            console.error(`写抽取状态失败：${error instanceof Error ? error.message : String(error)}`);
        });
        return writing;
    };
    void writeState({});
    const runStart = store.appendActivity({kind: "run-start", run, at: new Date().toISOString()});

    let stopRequested = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let settle!: (outcome: JobOutcome) => void;
    const done = new Promise<JobOutcome>(resolve => (settle = resolve));
    let finished = false;
    const finish = (outcome: JobOutcome) => {
        if (finished) return;
        finished = true;
        if (graceTimer) clearTimeout(graceTimer);
        worker.terminate();
        const stopReason = outcome.kind === "failed" ? {kind: "failed" as const, code: outcome.code, ...(outcome.errorKind ? {errorKind: outcome.errorKind} : {}), message: outcome.message} : outcome.kind === "stopped" ? {kind: "user" as const} : null;
        // 先记下任务结束（用时按它算），再放锁：放锁之后别人看到的进度要是完整的。
        void Promise.allSettled([runStart, store.appendActivity({kind: "run-end", run, at: new Date().toISOString()}), writeState({state: "stopped", retry: null, stopReason})]).then(results => {
            for (const result of results) if (result.status === "rejected") console.error(`写抽取记录失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
            lock.release();
            settle(outcome);
        });
    };

    worker.onmessage = (message: MessageEvent<WorkerOutbound>) => {
        const data = message.data;
        if (data.type === "outcome") {
            finish(stopRequested && data.outcome.kind === "failed" ? {kind: "stopped"} : data.outcome);
            return;
        }
        const event = data.event;
        if (event.type === "chapter") void writeState({chapter: event.chapter, step: null, retry: null});
        else if (event.type === "step") void writeState({chapter: event.chapter, step: event.step, retry: null});
        else if (event.type === "retry") void writeState({retry: {attempt: event.attempt, waitMs: event.waitMs, until: new Date(Date.now() + event.waitMs).toISOString()}});
        input.onEvent?.(event);
    };
    worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish({kind: "failed", code: "model_failed", errorKind: "local", message: `抽取线程出错：${event.message}`});
    };
    worker.addEventListener("close", () => finish(stopRequested ? {kind: "stopped"} : {kind: "failed", code: "model_failed", errorKind: "local", message: "抽取线程意外退出"}));

    const start: WorkerStart = {type: "start", libraryRoot: input.library.root, id: plan.id, endpoint: input.endpoint, price: input.price, recall: input.recall, personaCheck: input.personaCheck, run, stop: stopBuffer,
        chapterWaitsMs: input.timing?.chapterWaitsMs ?? chapterWaits(input.autoResume ?? 3),
        ...(input.timing?.delaysMs ? {delaysMs: input.timing.delaysMs} : {}),
    };
    worker.postMessage(start);

    return {
        id: plan.id,
        plan,
        done,
        stop() {
            if (stopRequested || finished) return;
            stopRequested = true;
            Atomics.store(stopFlag, 0, 1);
            worker.postMessage({type: "stop"});
            graceTimer = setTimeout(() => finish({kind: "stopped"}), STOP_GRACE_MS);
        },
    };
}
