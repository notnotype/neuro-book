/**
 * 任务中心（docs/specs/agent/jobs.md）：Agent 的工具启动的、要跑一阵的事——子代理运行与后台命令——都登记在这张进程内的表里，
 * 不落盘（重启后为空）。一个任务就是一次子代理运行（子会话的一个 `runId`）或一条后台命令。
 *
 * 表只管登记、上限、状态、等待与寿命；怎样停一个任务、结束时交回什么文字由启动它的一方给（`JobDriver`），表不认识子会话与进程。
 * 记录只存身份与终态，交回结果时再由驱动去读（子代理从日志、后台命令从文件），免得没取过的任务把全文常驻在内存里。
 */

import type {Clock} from "@notnotype/nb-harness/kernel/contracts";

export type JobKind = "agent" | "shell";
/** `starting`：名额已占、派发的检查还没做完；不出现在 `jobs` 与远程里。 */
export type JobState = "starting" | "running" | "question" | "completed" | "failed" | "aborted" | "interrupted";

const LIVE: ReadonlySet<JobState> = new Set(["starting", "running", "question"]);
export const isLive = (state: JobState): boolean => LIVE.has(state);

/** 结束了、没取过的后台任务每个会话、全部各至多留多少（jobs.md 输出 6）。 */
export const KEPT_PER_OWNER = 32;
export const KEPT_TOTAL = 1_024;

export interface JobQuestion {
    readonly id: string;
    readonly text: string;
}

/** 任务给模型与界面的终态摘要；全文由驱动交回时再读。 */
export interface JobOutcome {
    readonly reason: string;
    readonly line?: string;
    readonly exitCode?: number;
    readonly lines?: number;
}

export interface JobDriver {
    /** 停掉它；状态由驱动之后照实报回：缺省 `aborted`，插件停止时传 `interrupted`（jobs.md 输出 8）。 */
    kill(reason?: "interrupted"): Promise<void>;
    /** 结束后交给模型的结果文字（子代理从日志读、后台命令从文件读）；`wait` 交回它时才读。 */
    result(): Promise<string>;
}

export interface Job {
    readonly id: string;
    readonly kind: JobKind;
    readonly owner: string;
    /** 启动它的那次工具调用。 */
    readonly invocation: string;
    readonly summary: string;
    readonly startedAt: number;
    state: JobState;
    endedAt?: number;
    /** 子代理：子会话与这次运行。 */
    target?: {readonly sessionId: string; readonly runId: string};
    /** 正在前台等它的调用数；为 0 就是后台任务。 */
    waiters: number;
    fetched: boolean;
    question?: JobQuestion;
    /** 已经让 `wait` 立即返回过的提问。 */
    questionDelivered?: string;
    outcome?: JobOutcome;
    /** 后台命令输出的最后一行。 */
    lastLine?: string;
    driver?: JobDriver;
    /**
     * 子代理：这次运行是不是调用方自己开的（派发，或子会话空闲时的续用）。父会话中止时只连带这些；插话附着到用户在子会话里自己开的
     * 运行时为 false（subagents.md 输出 16）。
     */
    ownRun?: boolean;
}

export type ReserveResult = {readonly ok: true; readonly job: Job} | {readonly ok: false; readonly code: "concurrency-limit"; readonly scope: "session" | "global"};

export interface JobLimits {
    /** 一个会话同时在跑的子代理运行。 */
    readonly perSession: number;
    /** 所有在跑的任务。 */
    readonly global: number;
}

export type WaitOutcome =
    | {readonly kind: "ready"; readonly job: Job; readonly others: readonly Job[]}
    | {readonly kind: "timeout" | "interrupted" | "aborted"; readonly jobs: readonly Job[]}
    | {readonly kind: "failed"; readonly code: "job-unknown" | "job-foreground" | "no-jobs"; readonly job?: string};

/** 前台跟一个任务（子代理工具）的结局：结束了、有新的提问、插话、超时、被中止。 */
export type FollowOutcome = "ended" | "question" | "interrupted" | "timeout" | "aborted";

export interface WaitOptions {
    readonly ids?: readonly string[];
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
    /** 本会话来了插话：结束等待（`wait` 交回各任务的现状）。 */
    readonly interrupted?: Promise<void>;
}

export class JobCenter {
    readonly #jobs = new Map<string, Job>();
    /** 等待者（`wait`、`follow`）：任一任务变了就复查。 */
    readonly #listeners = new Set<() => void>();
    /** 远程的 `jobsChanged` 与子代理进度：哪个会话的任务变了。 */
    readonly #owners = new Set<(owner: string) => void>();

    constructor(private readonly options: {readonly clock: Clock; readonly limits: () => JobLimits; readonly newId: () => string}) {}

    onChanged(listener: (owner: string) => void): () => void {
        this.#owners.add(listener);
        return () => this.#owners.delete(listener);
    }

    /** 占名额并登记一个 `starting` 的任务（jobs.md 输出 2）；在工具的同步段里调用，几次并发的启动不会一起越过上限。 */
    reserve(owner: string, kind: JobKind, invocation: string, summary: string): ReserveResult {
        const limits = this.options.limits();
        const live = [...this.#jobs.values()].filter((job) => isLive(job.state));
        if (live.length >= limits.global) return {ok: false, code: "concurrency-limit", scope: "global"};
        if (kind === "agent" && live.filter((job) => job.kind === "agent" && job.owner === owner).length >= limits.perSession) return {ok: false, code: "concurrency-limit", scope: "session"};
        const job: Job = {id: `job-${this.options.newId().slice(0, 12)}`, kind, owner, invocation, summary, startedAt: this.options.clock.now(), state: "starting", waiters: 0, fetched: false};
        this.#jobs.set(job.id, job);
        return {ok: true, job};
    }

    /** 检查过了、真的开始了。 */
    start(job: Job, driver: JobDriver, target?: Job["target"]): void {
        job.driver = driver;
        if (target !== undefined) job.target = target;
        job.state = "running";
        this.#changed(job);
    }

    /** 派发的检查没过：退回名额，任务从未出现过。 */
    release(job: Job): void {
        if (job.state === "starting") this.#jobs.delete(job.id);
    }

    get(id: string): Job | undefined {
        return this.#jobs.get(id);
    }

    /**
     * 按子会话的运行找任务（续用时插话、应答接着跑的是不是原来那次）。暂停的运行接着跑时，同一个 `runId` 可能有一个已结束没取过的旧任务和
     * 一个新任务，先给还没结束的。
     */
    forRun(sessionId: string, runId: string): Job | undefined {
        const matching = [...this.#jobs.values()].filter((job) => job.target?.sessionId === sessionId && job.target.runId === runId);
        return matching.find((job) => isLive(job.state)) ?? matching[0];
    }

    question(job: Job, question: JobQuestion | null): void {
        if (!isLive(job.state)) return;
        if (question === null) {
            delete job.question;
            if (job.state === "question") job.state = "running";
        } else {
            job.question = question;
            job.state = "question";
        }
        this.#changed(job);
    }

    progress(job: Job, lastLine: string): void {
        job.lastLine = lastLine;
        this.#changed(job);
    }

    /** 驱动报回终态。没有前台在等、也没取过的留着（受上限约束）；有前台在等的由它交回时移出。 */
    end(job: Job, state: Exclude<JobState, "starting" | "running" | "question">, outcome: JobOutcome): void {
        if (!isLive(job.state)) return;
        job.state = state;
        job.outcome = outcome;
        job.endedAt = this.options.clock.now();
        delete job.question;
        this.#changed(job);
        this.#trim(job.owner);
    }

    /** 前台调用开始、结束等它。以终态交回的视同取过，移出。 */
    attach(job: Job): void {
        job.waiters += 1;
    }

    detach(job: Job, delivered: boolean): void {
        job.waiters = Math.max(0, job.waiters - 1);
        if (delivered && !isLive(job.state)) {
            job.fetched = true;
            this.#jobs.delete(job.id);
        }
        if (delivered && job.question !== undefined) job.questionDelivered = job.question.id;
        this.#changed(job);
    }

    /** `jobs` 与远程 `jobs` 列的：这个会话启动、还在表里、检查过了的。 */
    list(owner: string): readonly Job[] {
        return [...this.#jobs.values()].filter((job) => job.owner === owner && job.state !== "starting");
    }

    async kill(owner: string | null, id: string): Promise<"killed" | "already-ended" | "job-unknown"> {
        const job = this.#jobs.get(id);
        // `owner` 为 null 是用户经远程停（jobs.md 输出 11）：不受“只管自己启动的”限制，仍只认这个会话的任务由调用方查。
        if (job === undefined || job.state === "starting" || (owner !== null && job.owner !== owner)) return "job-unknown";
        if (!isLive(job.state)) return "already-ended";
        await job.driver?.kill();
        return "killed";
    }

    async wait(owner: string, options: WaitOptions): Promise<WaitOutcome> {
        let candidates: Job[];
        if (options.ids !== undefined) {
            candidates = [];
            for (const id of options.ids) {
                const job = this.#jobs.get(id);
                if (job === undefined || job.owner !== owner || job.state === "starting") return {kind: "failed", code: "job-unknown", job: id};
                if (job.waiters > 0) return {kind: "failed", code: "job-foreground", job: id};
                candidates.push(job);
            }
        } else {
            candidates = this.list(owner).filter((job) => job.waiters === 0 && (isLive(job.state) || !job.fetched));
        }
        if (candidates.length === 0) return {kind: "failed", code: "no-jobs"};
        const ready = (): Job | undefined => candidates.find((job) => !isLive(job.state) && !job.fetched)
            ?? candidates.find((job) => job.state === "question" && job.question !== undefined && job.questionDelivered !== job.question.id);
        const deliver = (job: Job): WaitOutcome => {
            if (!isLive(job.state)) {
                job.fetched = true;
                this.#jobs.delete(job.id);
            } else if (job.question !== undefined) job.questionDelivered = job.question.id;
            this.#ownerChanged(job.owner);
            return {kind: "ready", job, others: candidates.filter((other) => other !== job)};
        };
        const now = ready();
        if (now !== undefined) return deliver(now);

        const timer = new AbortController();
        const stop = new AbortController();
        try {
            const outcome = await new Promise<WaitOutcome | {readonly ready: Job}>((resolve) => {
                const check = () => {
                    const job = ready();
                    if (job !== undefined) resolve({ready: job});
                };
                this.#listeners.add(check);
                stop.signal.addEventListener("abort", () => this.#listeners.delete(check), {once: true});
                this.options.clock.wait(options.timeoutMs, timer.signal).then(() => resolve({kind: "timeout", jobs: candidates}), () => undefined);
                options.interrupted?.then(() => resolve({kind: "interrupted", jobs: candidates}), () => undefined);
                if (options.signal.aborted) resolve({kind: "aborted", jobs: candidates});
                else options.signal.addEventListener("abort", () => resolve({kind: "aborted", jobs: candidates}), {once: true, signal: stop.signal});
            });
            return "ready" in outcome ? deliver(outcome.ready) : outcome;
        } finally {
            timer.abort();
            stop.abort();
        }
    }

    /**
     * 前台跟着一个任务（subagents.md 输出 6），直到它结束、停在一个新的提问上、本会话来了插话、超时或被中止。`answered` 是调用方刚答过的
     * 提问：应答写下之后，子会话那边的结算要过一会儿才清掉任务上的提问，这期间不能把它当新提问立即返回。调用方先 `attach`，按结局 `detach`。
     */
    async follow(job: Job, options: {readonly timeoutMs: number; readonly signal: AbortSignal; readonly interrupted?: Promise<void>; readonly answered?: string}): Promise<FollowOutcome> {
        const ready = (): FollowOutcome | undefined => {
            if (!isLive(job.state)) return "ended";
            return job.state === "question" && job.question !== undefined && job.question.id !== options.answered ? "question" : undefined;
        };
        const now = ready();
        if (now !== undefined) return now;
        const timer = new AbortController();
        const stop = new AbortController();
        try {
            return await new Promise<FollowOutcome>((resolve) => {
                const check = () => {
                    const outcome = ready();
                    if (outcome !== undefined) resolve(outcome);
                };
                this.#listeners.add(check);
                stop.signal.addEventListener("abort", () => this.#listeners.delete(check), {once: true});
                this.options.clock.wait(options.timeoutMs, timer.signal).then(() => resolve("timeout"), () => undefined);
                options.interrupted?.then(() => resolve("interrupted"), () => undefined);
                if (options.signal.aborted) resolve("aborted");
                else options.signal.addEventListener("abort", () => resolve("aborted"), {once: true, signal: stop.signal});
            });
        } finally {
            timer.abort();
            stop.abort();
        }
    }

    /** 插件停止：表里的都不再有人取。 */
    clear(): void {
        const owners = new Set([...this.#jobs.values()].map((job) => job.owner));
        this.#jobs.clear();
        this.#notify();
        for (const owner of owners) this.#ownerChanged(owner);
    }

    live(): readonly Job[] {
        return [...this.#jobs.values()].filter((job) => isLive(job.state));
    }

    #changed(job: Job): void {
        this.#ownerChanged(job.owner);
        this.#notify();
    }

    #ownerChanged(owner: string): void {
        for (const listener of [...this.#owners]) listener(owner);
    }

    #notify(): void {
        for (const listener of [...this.#listeners]) listener();
    }

    /** 结束了、没取过的后台任务按会话与全部各留上限个，先丢最早结束的（jobs.md 输出 6）。 */
    #trim(owner: string): void {
        const kept = (filter: (job: Job) => boolean) => [...this.#jobs.values()].filter((job) => !isLive(job.state) && !job.fetched && job.waiters === 0 && filter(job)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
        const own = kept((job) => job.owner === owner);
        for (const job of own.slice(0, Math.max(0, own.length - KEPT_PER_OWNER))) this.#jobs.delete(job.id);
        const all = kept(() => true);
        for (const job of all.slice(0, Math.max(0, all.length - KEPT_TOTAL))) this.#jobs.delete(job.id);
    }
}
