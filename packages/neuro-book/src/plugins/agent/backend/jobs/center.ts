/**
 * 任务中心（docs/specs/agent/jobs.md）：Agent 的工具启动的、要跑一阵的事——子代理运行与后台命令——都登记在这张进程内的表里，
 * 不落盘（重启后为空）。一个任务就是一次子代理运行（子会话的一个 `runId`）或一条后台命令。
 *
 * 表只管登记、上限、状态、等待与寿命；怎样停一个任务、结束时交回什么文字由启动它的一方给（`JobDriver`），表不认识子会话与进程。
 *
 * 回执（jobs.md 的回执约定）：每件任务不论怎样结束，启动它的会话恰好收到一次回执，经三个出口之一：前台等着的调用、`wait`、一条提醒
 * （`delivery.ts`）。出口记在 `Job.exit` 上，三方都在同一个同步段里看、写它，所以不会交两次。结果文字在收口时由驱动读一次、存在
 * `final` 里（子代理回退之后接着跑同一个运行，读到的也是收口那一刻的），`wait` 与提醒用同一份。
 */

import type {Clock} from "@notnotype/nb-harness/kernel/contracts";

/** 自己的两种是 `agent`（子代理运行）、`shell`（后台命令）；插件在工具里登记的是 `<插件 id>.<名字>`。 */
export type JobKind = string;
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

/** 任务给模型与界面的终态摘要；全文是 `Job.final`。 */
export interface JobOutcome {
    readonly reason: string;
    readonly line?: string;
    readonly exitCode?: number;
    readonly lines?: number;
    /** 用户停的（远程 `killJob`，或用户在子会话里停的那次运行）：回执不唤起。 */
    readonly byUser?: true;
}

/** 回执经提醒送出（`delivery.ts`）。`commandId` 与 `args` 在组好正文时定下，结果未知时原样重发。 */
export interface NoticeExit {
    readonly kind: "notice";
    commandId: string | null;
    args: {readonly text: string; readonly key?: string; readonly wake: boolean} | null;
    state: "sending" | "pending" | "unconfirmed";
    noticeId?: string;
}

/**
 * 回执的出口：前台或 `wait` 交回过（`taken`）；经提醒送出（`notice`）；全文放不下、只送了一条“用 wait 取”的短回执（`announced`，
 * 之后只由 `wait` 交回）。还没有出口时是 undefined。
 */
export type JobExit = {readonly kind: "taken"} | {readonly kind: "announced"} | NoticeExit;

const TAKEN: JobExit = {kind: "taken"};

export interface JobDriver {
    /**
     * 停掉它；状态由驱动之后照实报回：缺省 `aborted`，插件停止时传 `interrupted`（jobs.md 输出 8）。`byUser`：用户经远程停的
     * （子代理的运行按用户停的记，jobs.md 输出 11），否则是启动它的会话停的。
     */
    kill(reason?: "interrupted", byUser?: boolean): Promise<void | "already-ended">;
    /** 结束后交给模型的结果文字（子代理从日志读、后台命令从文件读）；收口时读一次，存进 `final`。 */
    result(): Promise<string>;
    /** 回执放不下全文时指向全文的地址（后台命令的输出文件）。 */
    readonly address?: string;
    /** 没有现成地址时把全文存一份、交回地址（子代理存进父会话的 `artifacts/`）。 */
    saveFull?(text: string): Promise<{readonly address: string} | {readonly problem: string}>;
}

export interface Job {
    readonly id: string;
    readonly kind: JobKind;
    readonly owner: string;
    /** 启动它的那次工具调用。 */
    readonly invocation: string;
    readonly summary: string;
    /** 给模型与界面的种类名：“子代理”“命令”，插件登记的由它给。 */
    readonly label: string;
    readonly startedAt: number;
    state: JobState;
    endedAt?: number;
    /** 子代理：子会话与这次运行。 */
    target?: {readonly sessionId: string; readonly runId: string};
    /** 正在前台等它的调用数；为 0 就是后台任务。 */
    waiters: number;
    /** 结束结果的出口。 */
    exit?: JobExit;
    question?: JobQuestion;
    /** 提问的出口，按提问 id：同一个提问只交一次。 */
    questionExit?: {readonly id: string; exit: JobExit};
    outcome?: JobOutcome;
    /** 收口时读下的结果文字。 */
    final?: Promise<string>;
    /** 用户经远程停过它：收口为 `aborted` 时记成用户停的。 */
    stopByUser?: true;
    /** 后台命令输出的最后一行。 */
    lastLine?: string;
    driver?: JobDriver;
    /**
     * 子代理：这次运行是不是调用方自己开的（派发，或子会话空闲时的续用）。父会话中止时只连带这些；插话附着到用户在子会话里自己开的
     * 运行时为 false（subagents.md 输出 16）。
     */
    ownRun?: boolean;
}

export type ReserveResult =
    | {readonly ok: true; readonly job: Job}
    | {readonly ok: false; readonly code: "concurrency-limit"; readonly scope: "session" | "global"}
    /** 插件正在停止（`close` 之后）：不再登记新任务，免得停止期间起的后台命令没人收口。 */
    | {readonly ok: false; readonly code: "unavailable"};

export interface JobLimits {
    /** 一个会话同时在跑的子代理运行。 */
    readonly perSession: number;
    /** 所有在跑的任务。 */
    readonly global: number;
}

/** `wait` 交回的这件回执此前在不在对话里：经提醒送过、已被取走（`yes`），写入结果未知（`maybe`），没进过（`no`）。 */
export type InContext = "no" | "yes" | "maybe";

export type WaitOutcome =
    | {readonly kind: "ready"; readonly job: Job; readonly others: readonly Job[]; readonly inContext: InContext}
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
    #closed = false;

    /**
     * `takeover`：`wait` 要交回一件已经经提醒送出的回执时，撤回那条提醒（送达的串行队列里做，等在途的发送结算），交回它此前在不在对话里。
     * `prune`：`wait` 开始前，把回执提醒已被取走的任务移出。两者由送达给；没有送达时不用。
     */
    constructor(private readonly options: {
        readonly clock: Clock;
        readonly limits: () => JobLimits;
        readonly newId: () => string;
        readonly takeover?: (job: Job, exit: NoticeExit) => Promise<InContext>;
        readonly prune?: (owner: string) => Promise<void>;
    }) {}

    onChanged(listener: (owner: string) => void): () => void {
        this.#owners.add(listener);
        return () => this.#owners.delete(listener);
    }

    /** 占名额并登记一个 `starting` 的任务（jobs.md 输出 2）；在工具的同步段里调用，几次并发的启动不会一起越过上限。 */
    reserve(owner: string, kind: JobKind, invocation: string, summary: string, label = kind === "agent" ? "子代理" : kind === "shell" ? "命令" : kind): ReserveResult {
        if (this.#closed) return {ok: false, code: "unavailable"};
        const limits = this.options.limits();
        const live = [...this.#jobs.values()].filter((job) => isLive(job.state));
        if (live.length >= limits.global) return {ok: false, code: "concurrency-limit", scope: "global"};
        if (kind === "agent" && live.filter((job) => job.kind === "agent" && job.owner === owner).length >= limits.perSession) return {ok: false, code: "concurrency-limit", scope: "session"};
        const job: Job = {id: `job-${this.options.newId().slice(0, 12)}`, kind, owner, invocation, summary, label, startedAt: this.options.clock.now(), state: "starting", waiters: 0};
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
        job.outcome = state === "aborted" && job.stopByUser === true ? {...outcome, byUser: true} : outcome;
        job.endedAt = this.options.clock.now();
        delete job.question;
        // 结果在收口这一刻读下（提案第 3 小节第 8 条）；读失败写成一句话，不让 `wait` 与送达失败。
        const driver = job.driver;
        job.final = driver === undefined ? Promise.resolve(`${job.id}：${state}`) : driver.result().catch((error: unknown) => `${job.id} 的结果读不出来（${error instanceof Error ? error.message : String(error)}）`);
        // 前台调用已经以终态交回过（父会话中止时的 `aborted`）：结束即移出，不再当没取过的后台任务交给 `wait`。
        if (job.exit?.kind === "taken" && job.waiters === 0) this.#jobs.delete(job.id);
        this.#changed(job);
        this.#trim(job.owner);
    }

    /**
     * 前台调用不等它收口就以终态交回了（父会话中止，subagents.md 输出 16）：视同取过，结束时直接移出（jobs.md 输出 6）。调用方之后照常
     * `detach`。
     */
    settleEarly(job: Job): void {
        job.exit = TAKEN;
        if (!isLive(job.state) && job.waiters === 0) this.#jobs.delete(job.id);
    }

    /** 停止的第一步：之后 `reserve` 一律得 `unavailable`；在跑的照常由调用方停掉（jobs.md 输出 8）。 */
    close(): void {
        this.#closed = true;
    }

    /** 前台调用开始、结束等它。以终态交回的视同取过，移出。 */
    attach(job: Job): void {
        job.waiters += 1;
    }

    detach(job: Job, delivered: boolean): void {
        job.waiters = Math.max(0, job.waiters - 1);
        if (delivered && !isLive(job.state)) {
            job.exit = TAKEN;
            this.#jobs.delete(job.id);
        } else if (job.exit?.kind === "taken" && !isLive(job.state) && job.waiters === 0) this.#jobs.delete(job.id);
        if (delivered && job.question !== undefined) job.questionExit = {id: job.question.id, exit: TAKEN};
        this.#changed(job);
    }

    /**
     * 送达领取（jobs.md 的送达）：同一个同步段里挑出能经提醒送的，出口标成正在送出。能送的：没有前台在等、已结束、结果还没有出口的；
     * 停在一个提问上、这个提问还没有出口的。
     */
    claim(owner: string): {readonly results: Job[]; readonly questions: Job[]} {
        const results: Job[] = [];
        const questions: Job[] = [];
        for (const job of this.list(owner)) {
            if (job.waiters > 0) continue;
            if (!isLive(job.state) && job.exit === undefined) {
                job.exit = {kind: "notice", commandId: null, args: null, state: "sending"};
                results.push(job);
            } else if (job.state === "question" && job.question !== undefined && job.questionExit?.id !== job.question.id) {
                job.questionExit = {id: job.question.id, exit: {kind: "notice", commandId: null, args: null, state: "sending"}};
                questions.push(job);
            }
        }
        return {results, questions};
    }

    /** 送达放弃了这次领取（暂时送不了）：出口退回，下次再领。 */
    unclaim(job: Job, exit: NoticeExit): void {
        if (job.exit === exit) delete job.exit;
        if (job.questionExit?.exit === exit) delete job.questionExit;
    }

    /** 只送了“用 wait 取”的短回执：之后只由 `wait` 交回。 */
    announce(job: Job, exit: NoticeExit): void {
        if (job.exit === exit) job.exit = {kind: "announced"};
        if (job.questionExit?.exit === exit) job.questionExit = {id: job.questionExit.id, exit: {kind: "announced"}};
    }

    /** 回执提醒已被取走（进了请求）：结果的出口定了，任务移出；提问的记成交过。 */
    receiptTaken(job: Job, exit: NoticeExit): void {
        if (job.exit === exit) {
            job.exit = TAKEN;
            if (job.waiters === 0) this.#jobs.delete(job.id);
        }
        if (job.questionExit?.exit === exit) job.questionExit = {id: job.questionExit.id, exit: TAKEN};
        this.#ownerChanged(job.owner);
    }

    /** 送达结算了一条回执（受理、未确认、退回）：账本与远程跟着更新。 */
    receiptSettled(owner: string): void {
        this.#ownerChanged(owner);
    }

    /** 这个会话里出口是一条还在待发（或未确认）的提醒的任务。 */
    noticeExits(owner: string): {readonly job: Job; readonly exit: NoticeExit}[] {
        const found: {job: Job; exit: NoticeExit}[] = [];
        for (const job of this.#jobs.values()) {
            if (job.owner !== owner) continue;
            if (job.exit?.kind === "notice") found.push({job, exit: job.exit});
            if (job.questionExit?.exit.kind === "notice") found.push({job, exit: job.questionExit.exit});
        }
        return found;
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
        if (owner === null) job.stopByUser = true;
        // 驱动说停的那次已经不在跑（子代理的运行刚收口，runtime.md 输出 120）：不说“已停止”。
        const stopped = await job.driver?.kill(undefined, owner === null);
        return stopped === "already-ended" ? "already-ended" : "killed";
    }

    async wait(owner: string, options: WaitOptions): Promise<WaitOutcome> {
        if (this.options.prune !== undefined) await this.options.prune(owner);
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
            // 取过的（含前台已经以中止交回、还在收口的）不再等。
            candidates = this.list(owner).filter((job) => job.waiters === 0 && job.exit?.kind !== "taken");
        }
        if (candidates.length === 0) return {kind: "failed", code: "no-jobs"};
        const named = options.ids !== undefined;
        const questionOpen = (job: Job): boolean => job.state === "question" && job.question !== undefined && (job.questionExit?.id !== job.question.id || job.questionExit.exit.kind !== "taken");
        // 送出时结果未知的回执悬着、等核对：不点名的 `wait` 不等它，点名的只说“可能已在对话里”（绝不交两次）。
        const resultOpen = (job: Job): boolean => !isLive(job.state) && job.exit?.kind !== "taken" && (named || !(job.exit?.kind === "notice" && job.exit.state === "unconfirmed"));
        // 找到就在同一个同步步骤里写出口（审查第 5 条）：并发的另一个 `wait` 与送达随后看到的已是“交过”。
        const take = (): {readonly job: Job; readonly prior: JobExit | undefined} | undefined => {
            const job = candidates.find(resultOpen) ?? candidates.find(questionOpen);
            if (job === undefined) return undefined;
            if (!isLive(job.state)) {
                const prior = job.exit;
                if (prior?.kind === "notice" && prior.state === "unconfirmed") return {job, prior};
                job.exit = TAKEN;
                this.#jobs.delete(job.id);
                this.#ownerChanged(job.owner);
                return {job, prior};
            }
            const prior = job.questionExit?.id === job.question!.id ? job.questionExit.exit : undefined;
            job.questionExit = {id: job.question!.id, exit: TAKEN};
            this.#ownerChanged(job.owner);
            return {job, prior};
        };
        // 这件回执之前经提醒送出过：撤回那条提醒、问清它在不在对话里。
        const deliver = async ({job, prior}: {readonly job: Job; readonly prior: JobExit | undefined}): Promise<WaitOutcome> => {
            const inContext: InContext = prior?.kind === "notice" && this.options.takeover !== undefined ? await this.options.takeover(job, prior) : "no";
            return {kind: "ready", job, others: candidates.filter((other) => other !== job), inContext};
        };
        const now = take();
        if (now !== undefined) return deliver(now);

        const timer = new AbortController();
        const stop = new AbortController();
        try {
            let done = false;
            const outcome = await new Promise<WaitOutcome | {readonly taken: {readonly job: Job; readonly prior: JobExit | undefined}}>((resolve) => {
                const finish = (value: WaitOutcome | {readonly taken: {readonly job: Job; readonly prior: JobExit | undefined}}) => {
                    if (done) return;
                    done = true;
                    resolve(value);
                };
                const check = () => {
                    // 已经以超时、插话、中止结束的不再领：领了没人交回，回执就丢了。
                    if (done) return;
                    const taken = take();
                    if (taken !== undefined) finish({taken});
                };
                this.#listeners.add(check);
                stop.signal.addEventListener("abort", () => this.#listeners.delete(check), {once: true});
                this.options.clock.wait(options.timeoutMs, timer.signal).then(() => finish({kind: "timeout", jobs: candidates}), () => undefined);
                options.interrupted?.then(() => finish({kind: "interrupted", jobs: candidates}), () => undefined);
                if (options.signal.aborted) finish({kind: "aborted", jobs: candidates});
                else options.signal.addEventListener("abort", () => finish({kind: "aborted", jobs: candidates}), {once: true, signal: stop.signal});
            });
            return "taken" in outcome ? await deliver(outcome.taken) : outcome;
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

    /** 表里的全部任务（账本用）。 */
    all(): readonly Job[] {
        return [...this.#jobs.values()];
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
        const kept = (filter: (job: Job) => boolean) => [...this.#jobs.values()].filter((job) => !isLive(job.state) && job.exit?.kind !== "taken" && job.waiters === 0 && filter(job)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
        const own = kept((job) => job.owner === owner);
        for (const job of own.slice(0, Math.max(0, own.length - KEPT_PER_OWNER))) this.#jobs.delete(job.id);
        const all = kept(() => true);
        for (const job of all.slice(0, Math.max(0, all.length - KEPT_TOTAL))) this.#jobs.delete(job.id);
    }
}
