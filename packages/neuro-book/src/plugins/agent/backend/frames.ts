/**
 * 远程层的帧与大小（docs/specs/agent/sessions.md 输出 7、9）：日志事件按大小投影成事件或占位，流式增量在一个订阅里合并。
 *
 * 通道一条消息上限 1 MiB、没有发送背压：大事件换成占位、内容另分段读；增量 100 毫秒最多推一次，合并后超过 64 KiB 就切开。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {DeltaFrame, Frame, LogEvent} from "@notnotype/nb-harness/kernel/contracts";

import type {LogItem, RemoteFrame} from "../shared/remote";

/** 一条事件编码后超过它就换成占位。 */
export const EVENT_INLINE_BYTES = 256 * 1024;
/** 一页日志、一页诊断、一份预览编码后的上限。 */
export const PAGE_BYTES = 512 * 1024;
/** 分段读回时一段的上限。 */
export const CHUNK_BYTES = 256 * 1024;
/** 合并后的一帧增量的上限。 */
export const DELTA_BYTES = 64 * 1024;
/** 增量的合并窗口。 */
export const DELTA_WINDOW_MS = 100;

export const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export function logItem(event: LogEvent): LogItem {
    const bytes = byteLength(event);
    return bytes <= EVENT_INLINE_BYTES ? {kind: "event", event} : {kind: "oversized", seq: event.seq, type: event.type, bytes};
}

/** 一页里条目数组之外的开销（页对象的其余字段、远程调用的外壳）留的余量。 */
const PAGE_OVERHEAD = 4 * 1024;

/** 按编码后的字节数取一页：数组加分隔符不超过 `PAGE_BYTES` 减去余量；至少留一条（调用方保证单条放得下）。 */
export function pageOf<T>(values: readonly T[]): {readonly items: T[]; readonly cut: boolean} {
    const items: T[] = [];
    let total = 2;
    for (const value of values) {
        const size = byteLength(value) + 1;
        if (items.length > 0 && total + size > PAGE_BYTES - PAGE_OVERHEAD) return {items, cut: true};
        items.push(value);
        total += size;
    }
    return {items, cut: false};
}

/** 一页日志条目：大事件先换成占位（一条最大也只有占位那么大）。 */
export function pageOfItems(events: readonly LogEvent[]): {readonly items: LogItem[]; readonly cut: boolean} {
    return pageOf(events.map(logItem));
}

/** 诊断里的长文字（消息、提示、原因与栈）截到这么长，一条诊断总放得进一页。 */
export const DIAGNOSTIC_TEXT_BYTES = 4 * 1024;

export function trimText(text: string, bytes = DIAGNOSTIC_TEXT_BYTES): string {
    if (Buffer.byteLength(text) <= bytes) return text;
    return `${chunkOf(text, 0, bytes)!.text}…`;
}

/** 按 UTF-8 字节切出第 `index` 段，不切断多字节字符。 */
export function chunkOf(text: string, index: number, size = CHUNK_BYTES): {readonly text: string; readonly last: boolean} | null {
    const bytes = Buffer.from(text);
    let start = 0;
    for (let at = 0; ; at += 1) {
        if (start >= bytes.length && !(at === 0 && bytes.length === 0)) return null;
        let end = Math.min(start + size, bytes.length);
        // 0b10xxxxxx 是多字节字符的后续字节：退到字符的开头再切。
        while (end < bytes.length && end > start && (bytes[end]! & 0xc0) === 0x80) end -= 1;
        if (at === index) return {text: bytes.subarray(start, end).toString("utf8"), last: end >= bytes.length};
        start = end;
    }
}

/** 按 UTF-8 字节把一段文字切成不超过 `size` 的几段。 */
function splitText(text: string, size: number): string[] {
    const parts: string[] = [];
    for (let index = 0; ; index += 1) {
        const chunk = chunkOf(text, index, size);
        if (chunk === null) return parts;
        parts.push(chunk.text);
        if (chunk.last) return parts;
    }
}

const sameStream = (a: DeltaFrame, b: DeltaFrame): boolean => a.request === b.request && a.part === b.part && a.callId === b.callId && a.purpose === b.purpose;

/**
 * 一个远程订阅的帧合并：同一请求、同一部分、同一工具调用的连续增量拼成一帧，窗口内最多推一次；任何别的帧先把攒着的推出去，
 * 先后不变；推出的增量按本订阅从 1 重新编号（内核的 `n` 是内核订阅者局部的，合并后不连续）。
 */
export class FrameMerger {
    #pending: DeltaFrame | null = null;
    #cancel: (() => void) | null = null;
    readonly #numbers = new Map<number, number>();
    #closed = false;

    constructor(private readonly clock: RuntimeClock, private readonly emit: (frame: RemoteFrame) => void) {}

    push(frame: Frame): void {
        if (this.#closed) return;
        if (frame.type === "delta") {
            if (this.#pending !== null && sameStream(this.#pending, frame)) this.#pending = {...this.#pending, text: this.#pending.text + frame.text};
            else {
                this.flush();
                this.#pending = {...frame};
            }
            if (Buffer.byteLength(this.#pending.text) >= DELTA_BYTES) this.flush();
            else this.#cancel ??= this.clock.schedule(() => {
                this.#cancel = null;
                this.flush();
            }, DELTA_WINDOW_MS);
            return;
        }
        this.flush();
        this.emit(frame.type === "log" ? {type: "log", item: logItem(frame.event)} : frame);
    }

    flush(): void {
        this.#cancel?.();
        this.#cancel = null;
        const pending = this.#pending;
        this.#pending = null;
        if (pending === null) return;
        for (const text of splitText(pending.text, DELTA_BYTES)) {
            const n = (this.#numbers.get(pending.request) ?? 0) + 1;
            this.#numbers.set(pending.request, n);
            this.emit({...pending, text, n});
        }
    }

    close(): void {
        this.#closed = true;
        this.#cancel?.();
        this.#cancel = null;
        this.#pending = null;
    }
}
