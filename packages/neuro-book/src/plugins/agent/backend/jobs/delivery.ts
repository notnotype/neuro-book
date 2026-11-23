/**
 * 回执的送达（docs/specs/agent/jobs.md 的回执与送达）：后台任务结束、或子代理停在一个交给调用方的提问上时，以宿主身份给启动它的会话发一条
 * 提醒（`notice`，只有发送方能撤回）。发送方不管会话开没开：会话表的视图按需打开，空闲后自己关。
 *
 * 每个会话一条串行队列：领取、发送、撤回、重发都排在里面，所以同一条回执的发送与撤回不会颠倒。领取与 `wait` 都在任务中心的同步段里写
 * 任务的出口（`center.ts`），回执只交一次：`wait` 要交回一件已经经提醒送出的，经 `takeover` 在这条队列里撤回那条提醒。
 *
 * 一条提醒可以装几件任务的回执；`wait` 撤回其中一件时整条撤回，其余几件退回、下一轮重送。提问一件一条（`key` 按任务），答了就单独撤回。
 */

import type {Issuer} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

import {isLive, type InContext, type Job, type JobCenter, type NoticeExit} from "./center";
import {pack, receiptTitle, segment, shortReceipt} from "./receipt";

/** 回执提醒的发出者：排队区写“提醒 · 后台任务”。 */
export const RECEIPT_ISSUER: Issuer = {kind: "host", source: {plugin: "nbook.agent", label: "后台任务"}};

/** 暂时送不了（稍后重送）的码：预算满了、会话这会儿打不开。 */
const TRANSIENT = new Set(["notice-budget", "session-busy", "storage-failed", "open-failed", "session-closed", "unavailable"]);
/** 写入结果未知：同一个指令 id 与参数重发才能定。 */
const UNKNOWN = new Set(["log-broken", "unknown-outcome"]);

export interface JobDeliveryOptions {
    readonly jobs: JobCenter;
    readonly table: SessionTable;
    /** 根会话（没有调用方）的回执带唤起；子会话的不带。 */
    readonly isRoot: (sessionId: string) => boolean;
    readonly newId: () => string;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class JobDelivery {
    readonly #queues = new Map<string, Promise<void>>();
    /** 一条提醒装了哪几件：撤回整条时其余几件要退回重送。 */
    readonly #members = new WeakMap<NoticeExit, Job[]>();
    #closed = false;
    #stop: (() => void) | null = null;

    constructor(private readonly options: JobDeliveryOptions) {}

    start(): void {
        this.#stop = this.options.jobs.onChanged((owner) => this.schedule(owner));
    }

    /** 插件停止的第一步：之后不再领取、不再发送。还没送出的回执留在账本里，下次启动补发（`ledger.ts`）。 */
    close(): void {
        this.#closed = true;
        this.#stop?.();
        this.#stop = null;
    }

    /** 会话的句柄关了（损坏或空闲）：结果未知的回执按原样重发、暂时没送出的再领（审查第 16 条）。 */
    sessionClosed(sessionId: string): void {
        if (this.options.jobs.noticeExits(sessionId).length > 0 || this.options.jobs.list(sessionId).length > 0) this.schedule(sessionId);
    }

    schedule(owner: string): void {
        void this.#enqueue(owner, () => this.#pass(owner));
    }

    /**
     * `wait` 接过一件已经经提醒送出的回执（审查第 1 条）：排在这个会话的队列里，等在途的发送结算，再撤回那条提醒。撤回成功，回执没进过请求，
     * 由 `wait` 交回；已被取走就在对话里；结果未知、撤回出错时说“可能在”，`wait` 不再给一次（绝不交两次）。
     */
    takeover(job: Job, exit: NoticeExit): Promise<InContext> {
        return this.#enqueue(job.owner, async (): Promise<InContext> => {
            if (exit.state === "unconfirmed") return "maybe";
            if (exit.state !== "pending" || exit.noticeId === undefined) return "no";
            const removed = await this.#view(job.owner).removeNotice({commandId: this.options.newId(), noticeId: exit.noticeId}).catch((error: unknown) => ({ok: false as const, code: error instanceof Error ? error.message : String(error)}));
            if (removed.ok) {
                this.#returnOthers(exit, job);
                return "no";
            }
            if (removed.code === "notice-taken") return "yes";
            this.options.report("job-receipt-takeover-failed", `could not withdraw the receipt notice ${exit.noticeId} in session ${job.owner}: ${removed.code}`, {session: job.owner, code: removed.code});
            return "maybe";
        });
    }

    /** `wait` 开始前：回执提醒已被取走的（不在这个会话的待发里了）记成交过、移出（会话这时一定开着：`wait` 在它里面跑）。 */
    async prune(owner: string): Promise<void> {
        const pending = this.options.jobs.noticeExits(owner).filter(({exit}) => exit.state === "pending");
        if (pending.length === 0) return;
        const snapshot = await this.#view(owner).snapshot();
        const waiting = new Set(snapshot.notices.map((item) => item.id));
        for (const {job, exit} of pending) if (exit.noticeId !== undefined && !waiting.has(exit.noticeId)) this.options.jobs.receiptTaken(job, exit);
    }

    #enqueue<T>(owner: string, step: () => Promise<T>): Promise<T> {
        const previous = this.#queues.get(owner) ?? Promise.resolve();
        const next = previous.then(step);
        const settled = next.then(() => undefined, () => undefined);
        this.#queues.set(owner, settled);
        void settled.then(() => {
            if (this.#queues.get(owner) === settled) this.#queues.delete(owner);
        });
        return next;
    }

    #view(owner: string) {
        return this.options.table.view(owner, RECEIPT_ISSUER);
    }

    /** 一轮：撤回过时的提问、重发结果未知的、领取并送出新的。出错只记诊断，不让队列断掉。 */
    async #pass(owner: string): Promise<void> {
        if (this.#closed) return;
        try {
            await this.#withdrawStaleQuestions(owner);
            await this.#resendUnconfirmed(owner);
            const {results, questions} = this.options.jobs.claim(owner);
            if (results.length > 0) await this.#sendResults(owner, results);
            for (const job of questions) await this.#sendQuestion(owner, job);
        } catch (error) {
            this.options.report("job-receipt-failed", `delivering receipts to session ${owner} threw`, {session: owner, message: error instanceof Error ? error.message : String(error)});
        }
    }

    /** 提问在提醒取走之前被答了、停了或换了：撤回它（输出见 subagents.md）。 */
    async #withdrawStaleQuestions(owner: string): Promise<void> {
        for (const {job, exit} of this.options.jobs.noticeExits(owner)) {
            const question = job.questionExit;
            if (question === undefined || question.exit !== exit || exit.state !== "pending" || exit.noticeId === undefined) continue;
            if (job.question?.id === question.id && isLive(job.state)) continue;
            const removed = await this.#view(owner).removeNotice({commandId: this.options.newId(), noticeId: exit.noticeId}).catch(() => ({ok: false as const, code: "threw"}));
            if (!removed.ok && removed.code !== "notice-taken" && removed.code !== "notice-not-found") continue;
            if (job.questionExit === question) delete job.questionExit;
        }
    }

    async #resendUnconfirmed(owner: string): Promise<void> {
        for (const {exit} of this.options.jobs.noticeExits(owner)) {
            if (exit.state !== "unconfirmed" || exit.commandId === null || exit.args === null) continue;
            await this.#send(owner, exit);
        }
    }

    async #sendResults(owner: string, claimed: readonly Job[]): Promise<void> {
        // 正文在领取之后组：收口时读下的结果（`final`），长的留头留尾、写全文地址。
        const parts = await Promise.all(claimed.map(async (job) => {
            const body = await (job.final ?? Promise.resolve(`${job.id}：${job.state}`));
            let address = job.driver?.address ?? null;
            if (address === null && job.driver?.saveFull !== undefined && Buffer.byteLength(body, "utf8") > 12 * 1024) {
                const saved = await job.driver.saveFull(body);
                if ("address" in saved) address = saved.address;
            }
            return `${receiptTitle(job)}\n${segment(body, address)}`;
        }));
        // 组正文期间被 `wait` 拿走的不再送：只装出口仍是这次领取的。
        const mine = claimed.map((job, index) => ({job, part: parts[index]!, exit: job.exit})).filter((item) => item.exit?.kind === "notice" && item.exit.state === "sending" && item.exit.commandId === null);
        for (const notice of pack(mine.map((item) => item.part))) {
            const members = notice.indexes.map((index) => mine[index]!);
            const live = members.filter(({job, exit}) => job.exit === exit);
            if (live.length === 0) continue;
            const exit: NoticeExit = {kind: "notice", commandId: this.options.newId(), args: {text: live.length === members.length ? notice.text : pack(live.map((item) => item.part))[0]!.text, wake: this.#wakes(owner, live.map((item) => item.job))}, state: "sending"};
            for (const {job} of live) job.exit = exit;
            this.#members.set(exit, live.map((item) => item.job));
            await this.#send(owner, exit);
        }
    }

    async #sendQuestion(owner: string, job: Job): Promise<void> {
        const claimed = job.questionExit;
        if (claimed === undefined || claimed.exit.kind !== "notice") return;
        const text = await (job.driver?.result() ?? Promise.resolve(""));
        if (job.questionExit !== claimed) return;
        const exit: NoticeExit = {kind: "notice", commandId: this.options.newId(), args: {text: `${receiptTitle(job)}\n${segment(text, null)}`, key: `question:${job.id}`, wake: this.options.isRoot(owner)}, state: "sending"};
        job.questionExit = {id: claimed.id, exit};
        this.#members.set(exit, [job]);
        await this.#send(owner, exit);
    }

    /** 根会话带唤起；子会话不带；只有被用户停掉的几件时不带（回执进了缓冲区，下一次请求必定带上）。 */
    #wakes(owner: string, jobs: readonly Job[]): boolean {
        return this.options.isRoot(owner) && jobs.some((job) => job.outcome?.byUser !== true);
    }

    /** 发一条（或按原样重发一条）回执提醒，按结果结算出口。 */
    async #send(owner: string, exit: NoticeExit): Promise<void> {
        const args = exit.args!;
        let outcome: {ok: true; noticeId: string} | {ok: false; code: string};
        try {
            const sent = await this.#view(owner).notice({commandId: exit.commandId!, text: args.text, ...(args.key === undefined ? {} : {key: args.key}), wake: args.wake, senderOnly: true});
            outcome = sent.ok ? {ok: true, noticeId: sent.value.noticeId} : {ok: false, code: sent.code};
        } catch (error) {
            outcome = {ok: false, code: "unknown-outcome"};
            this.options.report("job-receipt-unknown", `sending a receipt to session ${owner} threw`, {session: owner, message: error instanceof Error ? error.message : String(error)});
        }
        const members = this.#members.get(exit) ?? [];
        if (outcome.ok) {
            exit.state = "pending";
            exit.noticeId = outcome.noticeId;
            this.options.jobs.receiptSettled(owner);
            return;
        }
        if (UNKNOWN.has(outcome.code)) {
            exit.state = "unconfirmed";
            this.options.jobs.receiptSettled(owner);
            return;
        }
        // 预算满了：改发一条很短的“用 wait 取”，它几乎总能放下（审查第 6 条）；连它都放不下就稍后重送。
        if (outcome.code === "notice-budget" && args.key === undefined) {
            const short = await this.#view(owner).notice({commandId: this.options.newId(), text: shortReceipt(members), wake: false, senderOnly: true}).catch(() => null);
            if (short?.ok === true) {
                for (const job of members) this.options.jobs.announce(job, exit);
                return;
            }
        }
        if (!TRANSIENT.has(outcome.code)) {
            // 会话不在了、读不懂这类永久送不了的：只留给 `wait`，记诊断。
            this.options.report("job-receipt-undeliverable", `a receipt cannot be delivered to session ${owner}: ${outcome.code}`, {session: owner, code: outcome.code});
            for (const job of members) this.options.jobs.announce(job, exit);
            return;
        }
        this.options.report("job-receipt-deferred", `a receipt to session ${owner} is deferred: ${outcome.code}`, {session: owner, code: outcome.code});
        for (const job of members) this.options.jobs.unclaim(job, exit);
    }

    /** 整条撤回之后，除了被 `wait` 接走的那件，其余几件的出口退回，下一轮重送。 */
    #returnOthers(exit: NoticeExit, taken: Job): void {
        const others = (this.#members.get(exit) ?? []).filter((job) => job !== taken);
        for (const job of others) this.options.jobs.unclaim(job, exit);
        if (others.length > 0) this.schedule(taken.owner);
    }
}
