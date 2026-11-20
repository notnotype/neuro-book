/**
 * 未读与“看到”（docs/specs/bots/main-conversation.md 的未读）。
 *
 * 只存“看到”的 seq（插件存储的 `bots-seen`，应用级，只进不退）。未读在内存里算：每个 bot 留一张“看到之后的计数消息 seq”的升序表，
 * 未读数就是它的长度。计数消息是一次模型回复的最终那一条（`assistant` 事件里不带工具调用的）；在线计数与补数用同一个判定。
 *
 * 持有主对话之后开始跟：先订阅日志帧、攒着，再从“看到”之后按页读日志补数，两边按 seq 去重。补完之前未读为 null。有归属的会话不改写
 * 历史（agent/sessions.md 输出 26），seq 在当前路径上只增不减，所以按 seq 算是稳的。
 *
 * 最后一句话（bots.md 输出 7 的 `last`）同样只在内存：在线收到计数消息就换；补数时“看到”之后那段有计数消息，取最后一条，那段是空的
 * （都看过了）就从日志尾部往前至多 `TAIL` 条里找，找不到为 null。不存进“看到”的记录：存了要和几个窗口的写入合并，旧记录还没有它。
 */

import {Type} from "typebox";

import type {LogEvent} from "@notnotype/nb-harness/kernel/contracts";

import type {AgentService} from "nbook/plugins/agent/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import type {RecordHandle, StorageService} from "nbook/shared/storage";

import {BOT_ID_PATTERN, mainSessionId} from "../shared/contracts";
import type {BotLast} from "../shared/contracts";
import {messageSummary} from "./summary";

const SEEN_RECORD = defineRecord({key: "bots-seen", scope: "user", locality: "shared", version: 1, schema: Type.Object({seen: Type.Record(Type.String({pattern: BOT_ID_PATTERN}), Type.Integer({minimum: 0}))})});
type Seen = {seen: Record<string, number>};

/** 补数时一页读多少条。 */
const PAGE = 1_000;
/** 找最后一句话时从日志尾部往前至多读多少条：读取有界，再往前的找不到就算没有。 */
const TAIL = 200;

/** 一条计数消息：模型回复的最终那一条（不带工具调用的 `assistant`）。中间调工具的几条在界面上折在这一轮里，不算。 */
export const countsAsMessage = (event: LogEvent): boolean => event.type === "assistant" && ((event.data as {toolCalls?: readonly unknown[]}).toolCalls?.length ?? 0) === 0;

export interface UnreadItem {
    readonly unread: number | null;
    readonly latestSeq: number;
    readonly seenSeq: number;
    readonly last: BotLast | null;
}

/** 一条计数消息的摘要；`seq` 只在内存里比新旧。 */
type LastMessage = BotLast & {readonly seq: number};
const lastOf = (event: LogEvent): LastMessage => ({seq: event.seq, at: event.at, text: messageSummary((event.data as {content?: Parameters<typeof messageSummary>[0]}).content ?? [])});
const newer = (a: LastMessage | null, b: LastMessage | null): LastMessage | null => (a === null ? b : b === null || a.seq >= b.seq ? a : b);

export type SeenResult = {readonly ok: true; readonly seenSeq: number} | {readonly ok: false; readonly code: "storage-failed"; readonly detail: string};

interface Tracked {
    /** “看到”之后的计数消息 seq，升序；补完之前为 null。 */
    seqs: number[] | null;
    /** 补数期间到的帧里的计数消息，补完时并进去。 */
    early: number[];
    /** 最后一条计数消息；补完之前只有补数期间到的。 */
    last: LastMessage | null;
    stop: () => void;
}

export interface UnreadOptions {
    readonly agent: AgentService;
    readonly storage: StorageService;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    /** 某个 bot 的未读或“看到”变了。 */
    readonly changed: () => void;
}

export class UnreadTracker {
    readonly #seen = new Map<string, number>();
    readonly #tracked = new Map<string, Tracked>();
    #handle: RecordHandle<Seen> | null = null;

    constructor(private readonly options: UnreadOptions) {}

    /** 读一次存下的“看到”。读不了或读不懂时当成都没看过，写诊断；读不懂的记录在下一次 `markSeen` 时重写。 */
    async load(): Promise<void> {
        const opened = await this.options.storage.open(SEEN_RECORD);
        if (!opened.ok) {
            this.options.report("seen-failed", `打不开“看到”的记录：${opened.code}`, {detail: opened.detail});
            return;
        }
        this.#handle = opened.handle as RecordHandle<Seen>;
        const read = await this.#handle.read();
        if (read.status === "ok") for (const [bot, seq] of Object.entries(read.value.seen)) this.#seen.set(bot, seq);
        else if (read.status !== "missing") this.options.report("seen-unreadable", `“看到”的记录读不了：${read.status}`, {status: read.status});
    }

    item(botId: string): UnreadItem {
        const seenSeq = this.#seen.get(botId) ?? 0;
        const tracked = this.#tracked.get(botId);
        const seqs = tracked?.seqs ?? null;
        const last = tracked === undefined || tracked.last === null ? null : {text: tracked.last.text, at: tracked.last.at};
        return {unread: seqs?.length ?? null, latestSeq: seqs?.at(-1) ?? seenSeq, seenSeq, last};
    }

    /** 主对话持有了：订阅它的日志帧，再补数。已经在跟的不重来。 */
    track(botId: string): void {
        if (this.#tracked.has(botId)) return;
        const session = this.options.agent.session(mainSessionId(botId));
        const tracked: Tracked = {seqs: null, early: [], last: null, stop: () => undefined};
        this.#tracked.set(botId, tracked);
        tracked.stop = session.subscribe((frame) => {
            if (frame.type !== "log" || !countsAsMessage(frame.event)) return;
            tracked.last = newer(tracked.last, lastOf(frame.event));
            if (tracked.seqs === null) tracked.early.push(frame.event.seq);
            else this.#add(botId, tracked, frame.event.seq);
        });
        void this.#catchUp(botId, tracked).catch((error: unknown) => {
            this.options.report("unread-failed", `数 bot ${botId} 的未读失败：${error instanceof Error ? error.message : String(error)}`, {bot: botId});
        });
    }

    /** 放掉持有时停止跟（未读回到 null）。 */
    untrack(botId: string): void {
        this.#tracked.get(botId)?.stop();
        this.#tracked.delete(botId);
    }

    stop(): void {
        for (const botId of [...this.#tracked.keys()]) this.untrack(botId);
    }

    /**
     * 记“看到”：`through` 截到最新的计数消息（没有未读时什么都不动），小于已存的不动。只进不退的合并用存储的 `update`，几个窗口同时
     * 交也不会退回去。
     */
    async markSeen(botId: string, through: number): Promise<SeenResult> {
        const current = this.#seen.get(botId) ?? 0;
        const latest = this.item(botId).latestSeq;
        const next = Math.max(current, Math.min(through, latest));
        if (next === current) return {ok: true, seenSeq: current};
        const saved = await this.#save(botId, next);
        if (!saved.ok) return saved;
        this.#seen.set(botId, Math.max(this.#seen.get(botId) ?? 0, saved.seenSeq));
        const tracked = this.#tracked.get(botId);
        if (tracked?.seqs) tracked.seqs = tracked.seqs.filter((seq) => seq > saved.seenSeq);
        this.options.changed();
        return {ok: true, seenSeq: saved.seenSeq};
    }

    async #save(botId: string, seq: number): Promise<SeenResult> {
        if (this.#handle === null) return {ok: false, code: "storage-failed", detail: "“看到”的记录打不开"};
        const merge = (value: Seen | null): Seen => ({seen: {...value?.seen, [botId]: Math.max(value?.seen[botId] ?? 0, seq)}});
        const updated = await this.#handle.update(merge);
        if (updated.ok) return {ok: true, seenSeq: updated.value.seen[botId]!};
        if (updated.code === "corrupt" || updated.code === "unsupported-version") {
            // 读不懂的记录不当成要保护的数据：换成只有内存里那份的新值（`reset` 先把原件存进原件区）。
            const fresh = merge({seen: Object.fromEntries(this.#seen)});
            const reset = await this.#handle.reset(fresh, {expect: updated.revision});
            if (reset.ok) return {ok: true, seenSeq: fresh.seen[botId]!};
            return {ok: false, code: "storage-failed", detail: `${reset.code}: ${reset.detail}`};
        }
        return {ok: false, code: "storage-failed", detail: `${updated.code}: ${updated.detail}`};
    }

    async #catchUp(botId: string, tracked: Tracked): Promise<void> {
        const session = this.options.agent.session(mainSessionId(botId));
        const from = this.#seen.get(botId) ?? 0;
        const found: number[] = [];
        // 只给最后留下的那一条生成摘要：补数可能扫过很多条计数消息。
        let lastEvent: LogEvent | null = null;
        let after = from;
        let head = 0;
        for (;;) {
            const page = await session.log({afterSeq: after, limit: PAGE});
            head = page.head;
            for (const event of page.events) {
                if (!countsAsMessage(event)) continue;
                found.push(event.seq);
                if (lastEvent === null || event.seq > lastEvent.seq) lastEvent = event;
            }
            if (!page.more || page.through <= after) break;
            after = page.through;
        }
        // “看到”之后没有计数消息：最后一句话在“看到”之前，从尾部往前有界地找（至多 `TAIL` 条；内核按 seq 定位起点是线性的，已知限制）。
        if (lastEvent === null && head > 0) {
            const tail = await session.log({afterSeq: Math.max(0, head - TAIL), limit: TAIL + 1});
            for (const event of tail.events) if (countsAsMessage(event) && (lastEvent === null || event.seq > lastEvent.seq)) lastEvent = event;
        }
        if (this.#tracked.get(botId) !== tracked) return;
        tracked.last = newer(tracked.last, lastEvent === null ? null : lastOf(lastEvent));
        const seen = this.#seen.get(botId) ?? 0;
        tracked.seqs = [...new Set([...found, ...tracked.early])].filter((seq) => seq > seen).sort((a, b) => a - b);
        tracked.early = [];
        this.options.changed();
    }

    #add(botId: string, tracked: Tracked, seq: number): void {
        if (tracked.seqs === null || seq <= (this.#seen.get(botId) ?? 0) || tracked.seqs.includes(seq)) return;
        tracked.seqs.push(seq);
        this.options.changed();
    }
}
