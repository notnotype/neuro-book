/**
 * 提供方的登记表（docs/specs/workbench/background-tasks.md 输出 18–21、24）：拥有状态的服务端插件交出行，清单只读、汇总与转发停止。
 *
 * 读行的时机：`notify` 只标脏并报一次变化；行在推送合并时经 `snapshot()` 读，所有订阅共用同一份已读快照，一次变化只读一次（输出 20）。
 * 读之前先清脏标记，`rows()` 里同步调来的 `notify` 留到下一轮。
 *
 * 寿命：每次登记是新的一代，行在远程里的键带代次（`p:<插件>:<代次>:<行 id>`），派发时按最新读到的行查，旧一代的键得 `row-gone`。
 * 撤回（插件调撤回函数、门面释放、清单关闭）的先后：先封住派发，在途的 `stop` 以“未知”交给窗口并 abort 它们的信号，再退订、丢行。
 * 交给提供方的 `notify` 闭包认的是登记那一刻的表项，撤回之后调用不起作用。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import type {Text} from "@notnotype/nb-ui/text";
import {Value} from "typebox/value";

import type {ProvidedRow, RowOpen, RowOwner, RowState, StopOutcome, TaskProvider} from "../shared/contracts";
import {RowOpenSchema, RowOwnerSchema} from "../shared/contracts";
import type {Outcome, TasksDiagnostic} from "./core";
import {listedRowOf} from "./groups";
import {normalizeProgress, normalizeText, MESSAGE_MAX, TITLE_MAX} from "./text";

/** 一家至多交几行；一行编码后至多几个字节（输入与前置条件）。 */
export const PROVIDER_ROW_LIMIT = 100;
export const ROW_MAX_BYTES = 2 * 1024;
/** 清单等提供方的 `stop` 至多多久（输出 24）。 */
export const STOP_WAIT_MS = 10_000;
const ROW_ID_MAX = 200;
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u;
const STATES: ReadonlySet<RowState> = new Set(["running", "waiting", "succeeded", "failed", "cancelled", "interrupted"]);
/** `Date` 能表示的毫秒时刻：更大的有限数换成 ISO 字符串时抛 `RangeError`，会让整份推送失败。 */
const MAX_TIME = 8.64e15;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_TIME;

/** 校验过的一行：文字已归一，`kind` 已盖章，带它在远程里的键。 */
export interface AcceptedRow {
    readonly key: string;
    readonly plugin: string;
    /** 登记的代次：越小越早登记；同一个根会话有几家都交了组头时认最早的（输出 26）。 */
    readonly generation: number;
    readonly id: string;
    readonly title: Text;
    readonly message: Text | null;
    readonly progress: number | null;
    readonly state: RowState;
    readonly kind: string;
    readonly kindLabel: Text;
    readonly owner: RowOwner;
    readonly head: boolean;
    readonly foreground: boolean;
    readonly startedAt: number;
    readonly endedAt: number | null;
    readonly stoppable: boolean;
    readonly open: RowOpen | null;
}

export type StopResult = Outcome<{readonly outcome: "accepted" | "rejected" | "unknown"; readonly reason?: Text}, "row-gone" | "not-stoppable">;

interface InFlight {
    readonly controller: AbortController;
    settle(outcome: StopOutcome): void;
}

interface Entry {
    readonly consumer: ConsumerIdentity;
    readonly plugin: string;
    readonly generation: number;
    readonly provider: TaskProvider;
    unsubscribe: (() => void) | null;
    dirty: boolean;
    failed: boolean;
    sealed: boolean;
    rows: readonly AcceptedRow[];
    /** 超过一家上限没列出的行：只计数（`more`、`background`），不进分组。 */
    overflow: readonly AcceptedRow[];
    /** 上一次读到的不合格行（行 id 加原因）：同一行同一原因只记一次诊断。 */
    invalid: ReadonlySet<string>;
    readonly inflight: Set<InFlight>;
}

const isLive = (state: RowState): boolean => state === "running" || state === "waiting";

/** `open` 的命令必须是提供方自己的（命令 id 以 `<插件>.` 开头）。 */
const ownCommand = (plugin: string, open: RowOpen | undefined): boolean => open === undefined || open.command.startsWith(`${plugin}.`);

export class ProviderRegistry {
    /** 按调用方门面的身份（同一个冻结对象，同 core.ts 的发起方）。 */
    readonly #entries = new Map<ConsumerIdentity, Entry>();
    #generation = 0;
    #version = 0;
    /** 撤回过几次：推送发出之前比对，算好之后又有撤回的那一份不发（remote.ts）。 */
    #revocations = 0;
    #closed = false;

    constructor(private readonly options: {readonly clock: RuntimeClock; readonly report: TasksDiagnostic; readonly changed: () => void}) {}

    /** 登记一家（输出 18）：一个调用方同一时刻一个，已有在用的时抛 `TypeError`；只有插件能登记（种类按插件盖章）。 */
    provide(consumer: ConsumerIdentity, provider: TaskProvider): () => void {
        if (this.#closed) throw new TypeError("background tasks are closed");
        const plugin = consumer.plugin;
        if (plugin === null) throw new TypeError("only a plugin can provide task rows");
        if (typeof provider !== "object" || provider === null || typeof provider.rows !== "function" || typeof provider.subscribe !== "function" || typeof provider.stop !== "function") throw new TypeError("invalid task provider");
        if (this.#entries.has(consumer)) throw new TypeError(`${plugin} already provides task rows`);
        this.#generation += 1;
        const entry: Entry = {consumer, plugin, generation: this.#generation, provider, unsubscribe: null, dirty: true, failed: false, sealed: false, rows: [], overflow: [], invalid: new Set(), inflight: new Set()};
        this.#entries.set(consumer, entry);
        try {
            const unsubscribe = provider.subscribe(() => {
                if (entry.sealed) return;
                entry.dirty = true;
                this.options.changed();
            });
            if (typeof unsubscribe !== "function") throw new TypeError("subscribe() did not return a function");
            entry.unsubscribe = unsubscribe;
        } catch (error) {
            // 提供方可能在抛错之前已经把 `notify` 接进了自己的事件源：封住它，之后调用不起作用。提供方自己负责拆掉装上的监听。
            entry.sealed = true;
            this.#entries.delete(consumer);
            throw new TypeError(`subscribing to the task provider of ${plugin} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.options.changed();
        return () => {
            if (!entry.sealed) this.#revoke(entry);
        };
    }

    /** 门面释放（登记方的入口停止）：它的提供方撤回。 */
    release(consumer: ConsumerIdentity): void {
        const entry = this.#entries.get(consumer);
        if (entry !== undefined) this.#revoke(entry);
    }

    /** 当前的行：有脏的家先读（读前清标记），任何一家读过就换一个版本号。`overflow` 是超过一家上限没列出的。 */
    snapshot(): {readonly version: number; readonly rows: readonly AcceptedRow[]; readonly overflow: readonly AcceptedRow[]} {
        let read = false;
        for (const entry of this.#entries.values()) {
            if (!entry.dirty) continue;
            entry.dirty = false;
            read = true;
            this.#read(entry);
        }
        if (read) this.#version += 1;
        const entries = [...this.#entries.values()];
        return {version: this.#version, rows: entries.flatMap((entry) => entry.rows), overflow: entries.flatMap((entry) => entry.overflow)};
    }

    /** 停一行（输出 24）：按最新读到的行查键，转给提供方；提供方 10 秒内没有结果时交回“未知”。 */
    async stop(key: string): Promise<StopResult> {
        const parsed = /^p:([^:]+):(\d+):(.+)$/su.exec(key);
        if (parsed === null) return {ok: false, code: "row-gone", detail: `no row ${key}`};
        this.snapshot();
        const entry = [...this.#entries.values()].find((item) => item.plugin === parsed[1] && item.generation === Number(parsed[2]));
        if (entry === undefined) return {ok: false, code: "row-gone", detail: `the provider of ${key} is gone`};
        const row = entry.rows.find((item) => item.id === parsed[3]);
        if (row === undefined) return {ok: false, code: "row-gone", detail: `no row ${key}`};
        if (!row.stoppable) return {ok: false, code: "not-stoppable", detail: `row ${key} cannot be stopped`};
        const outcome = await new Promise<StopOutcome>((resolve) => {
            const controller = new AbortController();
            let settled = false;
            const failed = (error: unknown): void => {
                if (settled) return;
                this.options.report("provider-stop-failed", `stopping ${row.id} of ${entry.plugin} threw: ${error instanceof Error ? error.message : String(error)}`, {plugin: entry.plugin, row: row.id});
                flight.settle({kind: "unknown"});
            };
            let cancelTimer = (): void => {};
            const flight: InFlight = {
                controller,
                settle: (value) => {
                    if (settled) return;
                    settled = true;
                    cancelTimer();
                    entry.inflight.delete(flight);
                    resolve(value);
                },
            };
            entry.inflight.add(flight);
            cancelTimer = this.options.clock.schedule(() => {
                controller.abort("timeout");
                flight.settle({kind: "unknown"});
            }, STOP_WAIT_MS);
            // 在查过键的同一个同步段里调提供方：撤回只能发生在这之后（撤回时在途的那次以“未知”结算），不会把已撤回的那一家调起来。
            // 结算之后（到点、撤回）才来的结果丢掉，不再校验、不记诊断。
            let pending: Promise<unknown>;
            try {
                pending = Promise.resolve(entry.provider.stop(row.id, controller.signal));
            } catch (error) {
                failed(error);
                return;
            }
            pending.then((value) => {
                if (settled) return;
                try {
                    flight.settle(this.#outcome(entry, row.id, value));
                } catch (error) {
                    failed(error);
                }
            }, failed);
        });
        return {ok: true, value: outcome.kind === "rejected" ? {outcome: "rejected", reason: outcome.reason} : {outcome: outcome.kind}};
    }

    /** 清单关闭（输出 21）：每家照撤回做一遍；之后的撤回函数是空操作。 */
    close(): void {
        this.#closed = true;
        for (const entry of [...this.#entries.values()]) this.#revoke(entry, false);
    }

    /** 撤回过几次（输出 21）：比对前后两次就知道中间有没有撤回。 */
    get revocations(): number {
        return this.#revocations;
    }

    #revoke(entry: Entry, push = true): void {
        entry.sealed = true;
        this.#revocations += 1;
        this.#entries.delete(entry.consumer);
        for (const flight of [...entry.inflight]) {
            flight.controller.abort("revoked");
            flight.settle({kind: "unknown"});
        }
        try {
            entry.unsubscribe?.();
        } catch (error) {
            this.options.report("provider-unsubscribe-failed", `unsubscribing from the task provider of ${entry.plugin} threw: ${error instanceof Error ? error.message : String(error)}`, {plugin: entry.plugin});
        }
        entry.unsubscribe = null;
        entry.rows = [];
        entry.overflow = [];
        if (push) {
            this.#version += 1;
            this.options.changed();
        }
    }

    /**
     * 读一家的行：逐行校验，一家超过上限时先留在跑与等用户的，结束的按结束时刻新到旧补满，其余只计数（输出 19、20）。读行与校验
     * 在同一个 try 里：取某一行的字段时抛错，同样当作这一家出错。
     */
    #read(entry: Entry): void {
        try {
            const raw = entry.provider.rows();
            if (!Array.isArray(raw)) throw new TypeError("rows() did not return an array");
            const seen = new Set<string>();
            const accepted: AcceptedRow[] = [];
            const invalid = new Set<string>();
            for (const row of raw) {
                const checked = this.#accept(entry, row);
                if (typeof checked === "string") {
                    const id = typeof (row as {id?: unknown} | null)?.id === "string" ? (row as {id: string}).id : null;
                    const mark = `${String(id)}\u0000${checked}`;
                    invalid.add(mark);
                    if (!entry.invalid.has(mark)) this.options.report("provider-row-invalid", `a task row of ${entry.plugin} was dropped: ${checked}`, {plugin: entry.plugin, row: id, reason: checked});
                    continue;
                }
                if (seen.has(checked.id)) continue;
                seen.add(checked.id);
                accepted.push(checked);
            }
            entry.invalid = invalid;
            entry.failed = false;
            if (accepted.length <= PROVIDER_ROW_LIMIT) {
                entry.rows = accepted;
                entry.overflow = [];
                return;
            }
            const live = accepted.filter((row) => isLive(row.state));
            const ended = accepted.filter((row) => !isLive(row.state)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
            const ordered = [...live, ...ended];
            if (entry.overflow.length === 0) this.options.report("provider-rows-capped", `${entry.plugin} gave ${String(accepted.length)} task rows, over ${String(PROVIDER_ROW_LIMIT)}; the rest are only counted`, {plugin: entry.plugin, rows: accepted.length});
            entry.rows = ordered.slice(0, PROVIDER_ROW_LIMIT);
            entry.overflow = ordered.slice(PROVIDER_ROW_LIMIT);
        } catch (error) {
            entry.rows = [];
            entry.overflow = [];
            if (!entry.failed) this.options.report("provider-failed", `reading the task rows of ${entry.plugin} threw: ${error instanceof Error ? error.message : String(error)}`, {plugin: entry.plugin});
            entry.failed = true;
        }
    }

    /** 校验并归一一行；不合格时交回原因（不含正文）。 */
    #accept(entry: Entry, row: ProvidedRow): AcceptedRow | string {
        if (typeof row !== "object" || row === null) return "not an object";
        if (typeof row.id !== "string" || row.id === "" || row.id.length > ROW_ID_MAX) return "bad id";
        if (typeof row.kind !== "string" || !KIND_PATTERN.test(row.kind)) return "bad kind";
        if (row.form !== "once") return "bad form";
        if (!STATES.has(row.state)) return "bad state";
        for (const flag of ["head", "foreground", "stoppable"] as const) {
            if (row[flag] !== undefined && typeof row[flag] !== "boolean") return `bad ${flag}`;
        }
        if (!isTime(row.startedAt)) return "bad startedAt";
        if (row.endedAt !== undefined && row.endedAt !== null && !isTime(row.endedAt)) return "bad endedAt";
        const title = normalizeText(row.title, TITLE_MAX);
        if (!title.ok) return `bad title: ${title.reason}`;
        const message = row.message === undefined || row.message === null ? null : normalizeText(row.message, MESSAGE_MAX);
        if (message !== null && !message.ok) return `bad message: ${message.reason}`;
        const kindLabel = normalizeText(row.kindLabel, TITLE_MAX);
        if (!kindLabel.ok) return `bad kindLabel: ${kindLabel.reason}`;
        if (!Value.Check(RowOwnerSchema, row.owner)) return "bad owner";
        const ownerTitle = row.owner.kind === "app" ? null : normalizeText(row.owner.title, TITLE_MAX);
        if (ownerTitle !== null && !ownerTitle.ok) return `bad owner title: ${ownerTitle.reason}`;
        const ownerOpen = row.owner.kind === "session" ? (row.owner as {open?: RowOpen}).open : undefined;
        if (!ownCommand(entry.plugin, ownerOpen)) return "the owner's open command is not the provider's own";
        if (row.open !== undefined && (typeof row.open !== "object" || row.open === null || !Value.Check(RowOpenSchema, row.open))) return "bad open";
        if (!ownCommand(entry.plugin, row.open)) return "the open command is not the provider's own";
        const owner = JSON.parse(JSON.stringify(row.owner)) as RowOwner;
        const accepted: AcceptedRow = {
            key: `p:${entry.plugin}:${String(entry.generation)}:${row.id}`,
            plugin: entry.plugin,
            generation: entry.generation,
            id: row.id,
            title: title.text,
            message: message === null ? null : message.text,
            progress: isLive(row.state) ? normalizeProgress(row.progress) : null,
            state: row.state,
            kind: `${entry.plugin}.${row.kind}`,
            kindLabel: kindLabel.text,
            owner: ownerTitle === null ? owner : {...owner, title: ownerTitle.text} as RowOwner,
            head: row.head === true && row.owner.kind === "session",
            foreground: row.foreground === true,
            startedAt: row.startedAt,
            endedAt: row.endedAt ?? null,
            stoppable: row.stoppable === true && isLive(row.state),
            open: row.open === undefined ? null : JSON.parse(JSON.stringify(row.open)) as RowOpen,
        };
        // 按发给窗口的那一行量（输出 19 的 2 KiB 指的是它）。
        if (Buffer.byteLength(JSON.stringify(listedRowOf(accepted)), "utf8") > ROW_MAX_BYTES) return `over ${String(ROW_MAX_BYTES)} bytes`;
        return accepted;
    }

    /** 提供方交回的结果过一遍形状；不认识的当“未知”。 */
    #outcome(entry: Entry, rowId: string, value: unknown): StopOutcome {
        const outcome = value as StopOutcome | null;
        if (outcome?.kind === "accepted" || outcome?.kind === "unknown") return {kind: outcome.kind};
        if (outcome?.kind === "rejected") {
            const reason = normalizeText(outcome.reason, MESSAGE_MAX);
            if (reason.ok) return {kind: "rejected", reason: reason.text};
        }
        this.options.report("provider-stop-invalid", `the stop outcome for ${rowId} of ${entry.plugin} is not valid`, {plugin: entry.plugin, row: rowId});
        return {kind: "unknown"};
    }
}
