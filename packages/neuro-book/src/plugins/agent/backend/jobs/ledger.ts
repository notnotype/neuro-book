/**
 * 后台任务的账本（docs/specs/agent/jobs.md 的回执约定）：任务表只在内存里，服务端停止或重启时还没交出回执的任务会丢掉回执。账本记下这些
 * 任务，下次启动时给它们的启动方补发一条“服务重启时中断”（或“停止前已结束、回执没来得及送出”）的回执，不唤起。
 *
 * 账本跟着任务中心的变化整份重写（临时文件改名，同一时刻只有本进程写）：一项在任务开始时出现，回执有了出口（前台或 `wait` 交回、提醒已
 * 受理、只送了短回执）时去掉。只记身份、状态与结果地址，不存结果的正文：全文在后台命令的输出文件或子会话的日志里。
 */

import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

import {isLive, type Job, type JobCenter} from "./center";
import {RECEIPT_ISSUER} from "./delivery";

export interface LedgerEntry {
    readonly id: string;
    readonly owner: string;
    readonly kind: string;
    readonly label: string;
    readonly summary: string;
    readonly startedAt: number;
    readonly state: string;
    /** 结果在哪：后台命令的输出文件，子代理的子会话。 */
    readonly address?: string;
}

/** 这件任务的回执还没有着落：在跑，或结束了还没有出口、出口是还在送出或结果未知的提醒。 */
const unsettled = (job: Job): boolean => job.state !== "starting" && (isLive(job.state) || job.exit === undefined || (job.exit.kind === "notice" && job.exit.state !== "pending"));

const entryOf = (job: Job): LedgerEntry => {
    const address = job.driver?.address ?? (job.target === undefined ? undefined : `子会话 ${job.target.sessionId}`);
    return {id: job.id, owner: job.owner, kind: job.kind, label: job.label, summary: job.summary, startedAt: job.startedAt, state: job.state, ...(address === undefined ? {} : {address})};
};

export class JobLedger {
    #chain: Promise<void> = Promise.resolve();
    #last = "";
    #stop: (() => void) | null = null;

    constructor(private readonly options: {readonly file: string; readonly jobs: JobCenter; readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void}) {}

    /** 跟着任务中心写账本。 */
    follow(): void {
        this.#stop = this.options.jobs.onChanged(() => this.#write());
    }

    /** 停止时：不再跟（停止过程中任务按中断收口，账本里留着它们，下次启动补发）；等在途的写完。 */
    async stop(): Promise<void> {
        this.#stop?.();
        this.#stop = null;
        await this.#chain;
    }

    /** 读上次留下的账本；读不到或读不懂当作空的（记诊断）。 */
    async read(): Promise<LedgerEntry[]> {
        try {
            const parsed = JSON.parse(await readFile(this.options.file, "utf8")) as unknown;
            return Array.isArray(parsed) ? (parsed as LedgerEntry[]) : [];
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.options.report("job-ledger-unreadable", `the job ledger could not be read`, {message: error instanceof Error ? error.message : String(error)});
            return [];
        }
    }

    /**
     * 启动时补发：每项给它的启动方发一条不带唤起的回执。发完（或会话已不在）就从账本去掉；暂时送不了的留到下次启动。
     */
    async replay(table: SessionTable, newId: () => string): Promise<void> {
        const left: LedgerEntry[] = [];
        for (const entry of await this.read()) {
            const how = isLive(entry.state as Job["state"]) || entry.state === "starting" ? "服务重启时中断，没跑完" : `服务停止前已${STATE_TEXT[entry.state] ?? entry.state}，回执没来得及送出`;
            const text = `以下是你启动的后台任务的回执，不是用户说的话。\n\n【${entry.label} ${entry.id}：${entry.summary}｜${how}】${entry.address === undefined ? "" : `\n结果在：${entry.address}`}`;
            const sent = await table.view(entry.owner, RECEIPT_ISSUER).notice({commandId: `ledger-${entry.id}`, text, wake: false, senderOnly: true}).catch((error: unknown) => ({ok: false as const, code: error instanceof Error ? error.message : String(error)}));
            if (sent.ok || sent.code === "session-not-found") continue;
            this.options.report("job-ledger-replay-failed", `the restart receipt for ${entry.id} could not be sent: ${sent.code}`, {session: entry.owner, job: entry.id, code: sent.code});
            left.push(entry);
        }
        await this.#save(JSON.stringify(left));
    }

    #write(): void {
        const entries = this.options.jobs.all().filter(unsettled).map(entryOf);
        const text = JSON.stringify(entries);
        if (text === this.#last) return;
        this.#last = text;
        this.#chain = this.#chain.then(() => this.#save(text));
    }

    async #save(text: string): Promise<void> {
        try {
            await mkdir(dirname(this.options.file), {recursive: true});
            if (text === "[]") {
                await rm(this.options.file, {force: true});
                return;
            }
            const temp = `${this.options.file}.${String(process.pid)}.tmp`;
            await writeFile(temp, text, "utf8");
            await rename(temp, this.options.file);
        } catch (error) {
            this.options.report("job-ledger-write-failed", `the job ledger could not be written`, {message: error instanceof Error ? error.message : String(error)});
        }
    }
}

const STATE_TEXT: Readonly<Record<string, string>> = {completed: "完成", failed: "失败", aborted: "停止", interrupted: "中断"};
