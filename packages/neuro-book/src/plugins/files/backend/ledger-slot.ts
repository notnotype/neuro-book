/**
 * 记账槽的接收者与调用（docs/specs/workspace/resources.md 的“记账槽”）：一个根一份序号，至多一个贡献者。
 *
 * 调用发生在提交的锁里：Files 至多等 `LEDGER_TIMEOUT_MS`，超时、抛错、贡献撤回都只写诊断，写入照常完成；超时后触发交给
 * 记账者的 `signal`，迟到的完成被忽略。所以记账者不能指望“我记下了”与“写入成功”同时成立，按序号与对账补齐。
 */

import {randomUUID} from "node:crypto";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {Ledger, LedgerEntry} from "../shared/ledger";

export const LEDGER_TIMEOUT_MS = 2000;

type Handle = ContributionHandle<Record<string, never>, Ledger>;
type Prepared = {readonly accepted: boolean};

export interface LedgerSlotOptions {
    readonly root: LedgerEntry["root"];
    readonly clock: RuntimeClock;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown) => void;
}

export class LedgerSlot {
    readonly #options: LedgerSlotOptions;
    #holder: Handle | null = null;
    #published = false;
    #seq = 0;

    constructor(options: LedgerSlotOptions) {
        this.#options = options;
    }

    readonly receiver: ContributionReceiver<Record<string, never>, Ledger, Prepared> = {
        prepare: (handle) => {
            if (this.#holder !== null) {
                this.#options.record("warn", "files.ledger.rejected", "记账槽已有贡献者，这一条被拒", {plugin: handle.plugin, holder: this.#holder.plugin});
                return {accepted: false};
            }
            this.#holder = handle;
            return {accepted: true};
        },
        published: (handle, prepared) => {
            if (prepared.accepted && this.#holder === handle) this.#published = true;
        },
        revoke: (handle, prepared) => {
            if (!prepared.accepted || this.#holder !== handle) return;
            this.#holder = null;
            this.#published = false;
        },
    };

    /** 有已发布的贡献者时才需要准备改后的字节：没有记账者就不为它多读一遍。 */
    get active(): boolean {
        return this.#published;
    }

    /** 交一条记录；没有贡献者时只占一个序号。从不抛错、从不让调用方等超过 `LEDGER_TIMEOUT_MS`。 */
    async record(entry: Omit<LedgerEntry, "id" | "seq" | "root">): Promise<void> {
        this.#seq += 1;
        const holder = this.#holder;
        if (holder === null || !this.#published) return;
        let ledger: Ledger;
        try {
            ledger = holder.implementation();
        } catch (error) {
            // 贡献正在撤回：取不到实现，这一条不记。
            this.#options.record("warn", "files.ledger.unavailable", "记账者不可用，这次写入没有记账", {path: entry.path}, error);
            return;
        }
        const full: LedgerEntry = {...entry, id: randomUUID(), seq: this.#seq, root: this.#options.root};
        const controller = new AbortController();
        let expire: (value: "timeout") => void = () => undefined;
        const timeout = new Promise<"timeout">((resolve) => {
            expire = resolve;
        });
        const cancel = this.#options.clock.schedule(() => expire("timeout"), LEDGER_TIMEOUT_MS);
        // 失败也收成值：超时之后才失败的那一次不能变成没人处理的 rejection。
        const recorded = Promise.resolve().then(() => ledger.record(full, controller.signal)).then(() => ({ok: true as const}), (error: unknown) => ({ok: false as const, error}));
        const settled = await Promise.race([recorded, timeout]);
        cancel();
        if (settled === "timeout") {
            controller.abort(new Error("记账超时"));
            this.#options.record("warn", "files.ledger.timeout", "记账超过 2 秒，写入不再等它", {path: entry.path, seq: full.seq, plugin: holder.plugin});
            void recorded.then((late) => {
                if (!late.ok) this.#options.record("warn", "files.ledger.failed", "超时之后记账失败", {path: entry.path, seq: full.seq, plugin: holder.plugin}, late.error);
            });
        } else if (!settled.ok) {
            this.#options.record("warn", "files.ledger.failed", "记账失败，写入照常完成", {path: entry.path, seq: full.seq, plugin: holder.plugin}, settled.error);
        }
    }
}
