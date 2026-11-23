/**
 * 后台任务的账本（docs/specs/agent/jobs.md 的回执约定）：任务表只在内存里，服务端停止或重启时还没交出回执的任务会丢掉回执。账本记下这些
 * 任务，下次启动时给它们的启动方补发一条“服务重启时中断”（或“停止前已结束、回执没来得及送出”）的回执，不唤起。
 *
 * 账本跟着任务中心的变化整份重写（临时文件改名，同一时刻只有本进程写）：一项在任务开始时出现，回执进了会话（前台或 `wait` 交回、提醒已
 * 受理）时去掉；只送了“用 wait 取”的短回执的留着，重启之后任务表空了，`wait` 再也取不到它们。只记身份、状态与结果地址，不存结果的正文：
 * 全文在后台命令的输出文件或子会话的日志里。上次留下、这次还没补发出去的项（`#carried`）也写进每一次重写，不被盖掉。
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
    /**
     * 正在送出、或写入结果未知的那条回执提醒的指令 id 与原样的参数：补发时按原样重发，内核对已经受理的只交回原结果、不再写，
     * 不会因为换了指令 id 交两次（审查 omp 第 5 条）。
     */
    readonly notice?: {readonly commandId: string; readonly text: string; readonly key?: string; readonly wake: boolean};
}

/** 这件任务的回执还没进会话：在跑，或结束了还没有出口、只送了短回执、出口是还在送出或结果未知的提醒。 */
const unsettled = (job: Job): boolean => job.state !== "starting" && (isLive(job.state) || job.exit === undefined || job.exit.kind === "announced" || (job.exit.kind === "notice" && job.exit.state !== "pending"));

const entryOf = (job: Job): LedgerEntry => {
    const address = job.driver?.address ?? (job.target === undefined ? undefined : `子会话 ${job.target.sessionId}`);
    const exit = job.exit?.kind === "notice" && job.exit.commandId !== null && job.exit.args !== null ? job.exit : null;
    return {
        id: job.id, owner: job.owner, kind: job.kind, label: job.label, summary: job.summary, startedAt: job.startedAt, state: job.state,
        ...(address === undefined ? {} : {address}),
        ...(exit === null ? {} : {notice: {commandId: exit.commandId!, ...exit.args!}}),
    };
};

export class JobLedger {
    #chain: Promise<void> = Promise.resolve();
    #last = "";
    #stop: (() => void) | null = null;
    /** 上次留下、还没补发出去的项。 */
    readonly #carried = new Map<string, LedgerEntry>();

    constructor(private readonly options: {readonly file: string; readonly jobs: JobCenter; readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void}) {}

    /** 跟着任务中心写账本。 */
    follow(): void {
        this.#stop = this.options.jobs.onChanged(() => this.#write());
    }

    /** 按任务中心此刻的样子写一次并等它落盘：送达在发出一条回执之前调，账本里先有了这次的指令 id。 */
    async flush(): Promise<void> {
        this.#write();
        await this.#chain;
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
     * 启动时补发：每项给它的启动方发一条不带唤起的回执。发完（或会话已不在）就从账本去掉；暂时送不了的留到下次启动。先 `follow` 再补发：
     * 补发期间新起的任务照样进账本（审查第 1 条）。
     */
    async replay(table: SessionTable): Promise<void> {
        const entries = await this.read();
        for (const entry of entries) this.#carried.set(entry.id, entry);
        this.#write();
        for (const entry of entries) {
            const how = isLive(entry.state as Job["state"]) || entry.state === "starting" ? "服务重启时中断，没跑完" : `服务停止前已${STATE_TEXT[entry.state] ?? entry.state}，回执没来得及送出`;
            const text = `以下是你启动的后台任务的回执，不是用户说的话。\n\n【${entry.label} ${entry.id}：${entry.summary}｜${how}】${entry.address === undefined ? "" : `\n结果在：${entry.address}`}`;
            let code: string | null;
            try {
                // 记着在途的那条：按原样重发（已受理的只交回原结果）；否则发一条重启的回执。
                const args = entry.notice ?? {commandId: `ledger-${entry.id}`, text, wake: false};
                const sent = await table.view(entry.owner, RECEIPT_ISSUER).notice({...args, senderOnly: true});
                code = sent.ok ? null : sent.code;
            } catch (error) {
                code = "threw";
                this.options.report("job-ledger-replay-failed", `sending the restart receipt for ${entry.id} threw`, {session: entry.owner, job: entry.id, message: error instanceof Error ? error.message : String(error)});
            }
            if (code === null || code === "session-not-found") this.#carried.delete(entry.id);
            else if (code !== "threw") this.options.report("job-ledger-replay-failed", `the restart receipt for ${entry.id} could not be sent: ${code}`, {session: entry.owner, job: entry.id, code});
        }
        this.#write();
    }

    #write(): void {
        const entries = [...this.#carried.values(), ...this.options.jobs.all().filter(unsettled).map(entryOf)];
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
