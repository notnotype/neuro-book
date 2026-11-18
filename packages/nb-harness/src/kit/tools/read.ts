/**
 * `read`（docs/specs/agent/builtin-tools.md 输出 5–8）：取本机读路径后自己读，分页、大文件与图片字节都不受写入接口的上限约束。
 */

import {createReadStream} from "node:fs";
import {open, stat} from "node:fs/promises";

import {hashlineFormatHeader, hashlineFormatNumberedLines} from "@oh-my-pi/pi-natives";
import type {EditStore} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "../../kernel/contracts.js";
import {decodeText, failed, failure, globalAddress, joinAddress, renderVirtual} from "../files/index.js";
import type {SessionFiles} from "../files/index.js";
import {imageFormat, prepareImage} from "./image.js";
import type {ImageFormat} from "./image.js";
import type {SessionEditStores} from "./snapshot.js";
import type {KitToolDeclaration, KitToolImplementation} from "./types.js";

const MAX_LINES = 2_000;
const MAX_BYTES = 50 * 1024;
const MAX_LINE_CHARS = 2_000;
const MAX_ENTRIES = 500;
/** 比它大的文件不把全文读进内存，也就登记不了行锚快照。 */
const SNAPSHOT_LIMIT = 4 * 1024 * 1024;
const IMAGE_LIMIT = 20 * 1024 * 1024;
const SNIFF_BYTES = 4 * 1024;
const MAX_BUFFERED_LINE = 1024 * 1024;
/** `recordSnapshot` 把空集当作“不限行”，没有完整展示的行时要传这个（引擎的“没看过任何行”）。 */
const NOTHING_SEEN = [0];

export const readDeclaration = (pathParameter: string): KitToolDeclaration => ({
    description: "读取一个资源地址：文本带行号与行锚（一次至多 2000 行、50 KB，用 offset 与 limit 分页），目录与虚拟根列出一层，png、jpeg、gif、webp 图片直接给你看。在 eval 的代码里调时交回对象，文本的原文在 content 里（不带地址头与行号），more 与 next 说明有没有下一页。",
    parameters: {
        type: "object",
        properties: {
            path: {type: "string", description: pathParameter},
            offset: {type: "integer", minimum: 1, description: "从第几行开始，从 1 数起"},
            limit: {type: "integer", minimum: 1, maximum: MAX_LINES, description: "最多读多少行"},
        },
        required: ["path"],
    },
    version: "2",
    concurrency: "shared",
    effect: "read",
});

/**
 * 代码里调 `read` 时交回的值（结果的 `details`，docs/specs/agent/eval.md 输出 7；宿主在工具声明的 `returns` 里写同一个形状，
 * `READ_RETURNS`）。原文与分页信息分开：统计、比对不用去掉地址头与行号。只在嵌套调用里给：顶层调用的 `details` 写进日志，原文不再
 * 存一份；嵌套调用的 `details` 不进日志。
 */
export type ReadValue =
    | {readonly kind: "text"; readonly address: string; readonly content: string; readonly from: number; readonly to: number; readonly total: number | null; readonly more: boolean; readonly next: number | null; readonly clipped: readonly number[]}
    | {readonly kind: "directory"; readonly address: string; readonly entries: readonly string[]; readonly more: boolean}
    | {readonly kind: "image"; readonly address: string; readonly mime: string; readonly width: number; readonly height: number};

/** `ReadValue` 的 JSON Schema，宿主写进 `read` 声明的 `returns`。 */
export const READ_RETURNS = {
    anyOf: [
        {type: "object", properties: {kind: {const: "text"}, address: {type: "string"}, content: {type: "string", description: "这一页的原文，不带地址头与行号；超过 2000 字的行只有前 2000 字"}, from: {type: "integer"}, to: {type: "integer"}, total: {anyOf: [{type: "integer"}, {type: "null"}], description: "全文行数；超过 4 MiB 的文件为 null"}, more: {type: "boolean"}, next: {anyOf: [{type: "integer"}, {type: "null"}], description: "下一页的 offset；没有下一页为 null"}, clipped: {type: "array", items: {type: "integer"}, description: "被截短的行号"}}, required: ["kind", "address", "content", "from", "to", "total", "more", "next", "clipped"]},
        {type: "object", properties: {kind: {const: "directory"}, address: {type: "string"}, entries: {type: "array", items: {type: "string"}, description: "条目的地址，目录以 / 结尾"}, more: {type: "boolean", description: "条目超过 500 个，后面的没有列出"}}, required: ["kind", "address", "entries", "more"]},
        {type: "object", properties: {kind: {const: "image"}, address: {type: "string"}, mime: {type: "string"}, width: {type: "integer"}, height: {type: "integer"}}, required: ["kind", "address", "mime", "width", "height"]},
    ],
} as const;

async function readImage(path: string, address: string, format: ImageFormat, size: number, withValue: boolean): Promise<ToolResult> {
    if (size > IMAGE_LIMIT) return failed("too-large", `too-large: ${address} 有 ${String(size)} 字节，图片至多 ${String(IMAGE_LIMIT)} 字节`);
    try {
        const image = await prepareImage(await Bun.file(path).bytes(), format);
        const changed = image.width !== image.originalWidth || image.height !== image.originalHeight;
        return {
            text: `[${address}] 图片 ${image.mime}，${String(image.originalWidth)}x${String(image.originalHeight)}${changed ? `，调整到 ${String(image.width)}x${String(image.height)}` : ""}`,
            images: [{data: Buffer.from(image.data).toString("base64"), mime: image.mime, width: image.width, height: image.height}],
            ...(withValue ? {details: {kind: "image", address, mime: image.mime, width: image.originalWidth, height: image.originalHeight} satisfies ReadValue} : {}),
        };
    } catch (error) {
        return failed("not-text", `not-text: ${address} 不是能解码的图片（${error instanceof Error ? error.message : String(error)}）`);
    }
}

interface Window {
    readonly rows: readonly string[];
    /** 同 `rows`，但截短的行不带说明（给代码的原文）。 */
    readonly content: readonly string[];
    /** 被截短的行号。 */
    readonly clipped: readonly number[];
    /** 完整展示的行（从 1 数起）：截断了的长行不算，模型没看到全文不能改它。 */
    readonly seen: readonly number[];
    readonly first: number;
    readonly last: number;
    /** 这一页之后还有内容。 */
    readonly more: boolean;
    /** 全文的行数；大文件不读完就不知道。 */
    readonly total: number | null;
}

/** 按预算收集一页；`lines` 是从第 1 行起的迭代器。 */
async function collect(lines: AsyncIterable<string> | Iterable<string>, offset: number, limit: number, total: number | null, maxBytes = MAX_BYTES): Promise<Window> {
    const rows: string[] = [];
    const content: string[] = [];
    const clipped: number[] = [];
    const seen: number[] = [];
    let bytes = 0;
    let number = 0;
    let more = false;
    for await (const line of lines) {
        number += 1;
        if (number < offset) continue;
        if (rows.length >= limit) {
            more = true;
            break;
        }
        const truncated = line.length > MAX_LINE_CHARS;
        const row = truncated ? `${line.slice(0, MAX_LINE_CHARS)} …[本行${line.length >= MAX_BUFFERED_LINE ? "超过" : "共"} ${String(line.length)} 字符，已截断]` : line;
        const size = Buffer.byteLength(row, "utf8") + 1;
        if (rows.length > 0 && bytes + size > maxBytes) {
            more = true;
            break;
        }
        bytes += size;
        rows.push(row);
        content.push(truncated ? line.slice(0, MAX_LINE_CHARS) : line);
        if (truncated) clipped.push(number);
        else seen.push(number);
    }
    return {rows, content, clipped, seen, first: offset, last: offset + rows.length - 1, more, total};
}

function textValue(address: string, window: Window): ReadValue {
    return {kind: "text", address, content: window.content.join("\n"), from: window.first, to: window.last, total: window.total, more: window.more, next: window.more ? window.last + 1 : null, clipped: window.clipped};
}

function render(header: string, window: Window, note: string | null): string {
    const parts = [header];
    if (window.rows.length === 0) parts.push(window.first > 1 ? `（没有第 ${String(window.first)} 行${window.total === null ? "" : `，全文 ${String(window.total)} 行`}）` : "（空文件）");
    else parts.push(hashlineFormatNumberedLines(window.rows.join("\n"), window.first));
    if (window.more) parts.push(`（第 ${String(window.first)} 到 ${String(window.last)} 行${window.total === null ? "" : `，共 ${String(window.total)} 行`}；用 offset=${String(window.last + 1)} 继续）`);
    if (note !== null) parts.push(note);
    return parts.join("\n");
}

const splitLines = (text: string): string[] => {
    const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    if (lines.at(-1) === "") lines.pop();
    return lines;
};

class NotUtf8 extends Error {}

/**
 * 大文件按行流式读。解码是严格的（同 `decodeText`），但只校验读到的部分：翻一页不值得扫完整个文件，后面的非法字节到读到那里时才报。
 * 一行特别长（没有换行的数据文件）时只留开头、丢掉其余，内存有界。
 */
async function* fileLines(path: string, signal: AbortSignal): AsyncGenerator<string> {
    const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    const decode = (chunk?: Uint8Array): string => {
        try {
            return chunk === undefined ? decoder.decode() : decoder.decode(chunk, {stream: true});
        } catch {
            // TextDecoder 只给 TypeError，这里只可能是非法 UTF-8。
            throw new NotUtf8();
        }
    };
    const clean = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);
    let rest = "";
    let skipping = false;
    for await (const chunk of createReadStream(path, {signal})) {
        rest += decode(chunk as Uint8Array);
        const lines = rest.split("\n");
        rest = lines.pop() as string;
        for (const [index, line] of lines.entries()) {
            if (index === 0 && skipping) skipping = false;
            else yield clean(line);
        }
        if (rest.length > MAX_BUFFERED_LINE) {
            if (!skipping) yield rest;
            skipping = true;
            rest = "";
        }
    }
    rest += decode();
    if (rest !== "" && !skipping) yield clean(rest);
}

async function readFile(store: EditStore, path: string, address: string, size: number, offset: number, limit: number, signal: AbortSignal, withValue: boolean): Promise<ToolResult> {
    const handle = await open(path, "r");
    let head: Uint8Array;
    try {
        const buffer = new Uint8Array(SNIFF_BYTES);
        const {bytesRead} = await handle.read(buffer, 0, SNIFF_BYTES, 0);
        head = buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
    const format = imageFormat(head);
    if (format !== null) return readImage(path, address, format, size, withValue);
    if (head.includes(0)) return failed("not-text", `not-text: ${address} 是二进制文件，用 shell 处理`);

    if (size > SNAPSHOT_LIMIT) {
        const window = await collect(fileLines(path, signal), offset, limit, null);
        return {text: render(`[${address}]`, window, `这个文件超过 4 MiB，没有行锚：不能用行锚改，要用 replace、write 或 shell。`), ...(withValue ? {details: textValue(address, window)} : {})};
    }
    const text = decodeText(await Bun.file(path).bytes());
    if (text === null) return failed("not-text", `not-text: ${address} 不是 UTF-8 文本`);
    const shown = await renderSnapshot(store, path, address, text, offset, limit, MAX_BYTES);
    return {text: shown.text, ...(withValue ? {details: textValue(address, shown.window)} : {})};
}

/**
 * 文本读出来之后的公共部分：记行锚快照，按字节预算排版成带行号与行锚的样子。`read` 与压缩后的放回共用，放回的行锚才和
 * `read` 给的一样能被 `edit` 认：只有完整显示的行算看过。
 */
export async function renderSnapshot(store: EditStore, path: string, address: string, text: string, offset: number, limit: number, maxBytes: number): Promise<{readonly text: string; readonly more: boolean; readonly window: Window}> {
    const lines = splitLines(text);
    const window = await collect(lines, offset, limit, lines.length, maxBytes);
    const tag = store.recordSnapshot(path, text, window.seen.length === 0 ? NOTHING_SEEN : [...window.seen]);
    return {text: render(hashlineFormatHeader(address, tag), window, null), more: window.more, window};
}

/** 能把全文读进内存做快照的上限；放回也只放这样的文件。 */
export const SNAPSHOT_MAX_BYTES = SNAPSHOT_LIMIT;
export const MAX_READ_LINES = MAX_LINES;

function readFailure(error: unknown, address: string, signal: AbortSignal): ToolResult {
    if (signal.aborted) return failed("cancelled", `cancelled: 读 ${address} 被中止`);
    if (error instanceof NotUtf8) return failed("not-text", `not-text: ${address} 不是 UTF-8 文本`);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return failed("not-found", `not-found: ${address} 不存在`);
    if (code === "EACCES" || code === "EPERM") return failed("permission-denied", `permission-denied: 没有权限读 ${address}`);
    return failed("io-failed", `io-failed: 读 ${address} 失败（${error instanceof Error ? error.message : String(error)}）`);
}

async function listOne(files: SessionFiles, address: string, signal: AbortSignal, withValue: boolean): Promise<ToolResult> {
    const listed = await files.list(address, {signal});
    if (!listed.ok) return failure(listed);
    const {value} = listed;
    const more = value.entries.length > MAX_ENTRIES;
    const directory = (entries: readonly string[]): {details?: ReadValue} => (withValue ? {details: {kind: "directory", address, entries, more}} : {});
    if (value.kind === "virtual") {
        const shown = {...value, entries: value.entries.slice(0, MAX_ENTRIES)};
        return {text: `${renderVirtual(shown)}${more ? `\n（还有 ${String(value.entries.length - MAX_ENTRIES)} 项没有列出）` : ""}`, ...directory(shown.entries.map((entry) => entry.address))};
    }
    const entries = value.entries.slice(0, MAX_ENTRIES).map((entry) => `${joinAddress(address, entry.name)}${entry.kind === "directory" ? "/" : ""}`);
    const rows = more ? [...entries, `（还有 ${String(value.entries.length - MAX_ENTRIES)} 项没有列出）`] : entries;
    return {text: rows.length === 0 ? `[${address}]（空目录）` : rows.join("\n"), ...directory(entries)};
}

export function readTool(stores: SessionEditStores): KitToolImplementation {
    return {
        subjects: (args) => [{kind: "path", access: "read", address: args.path as string}],
        create: (context, {files}) => {
            const held = stores.acquire(context.sessionId);
            return {
                dispose: () => held.release(),
                execute: async (args, call) => {
                    // 代码里调（嵌套调用）时另交回对象（`ReadValue`）。
                    const withValue = call.within !== undefined;
                    const expanded = globalAddress(files, args.path as string);
                    if (!expanded.ok) return expanded.failure;
                    const {address} = expanded;
                    const located = await files.readPath(address, {signal: call.signal});
                    // 虚拟根没有本机路径，它的内容是列出来的。
                    if (!located.ok) return located.code === "unsupported-capability" ? listOne(files, address, call.signal, withValue) : failure(located);
                    if (located.value.kind === "directory") return listOne(files, address, call.signal, withValue);
                    if (located.value.kind === "other") return failed("not-text", `not-text: ${address} 不是普通文件`);
                    // 定位之后文件可能被 shell 或外部编辑器删掉：这是预料之中的，不能变成工具抛错。
                    try {
                        const {size} = await stat(located.value.path);
                        return await readFile(held.store, located.value.path, address, size, (args.offset as number | undefined) ?? 1, (args.limit as number | undefined) ?? MAX_LINES, call.signal, withValue);
                    } catch (error) {
                        return readFailure(error, address, call.signal);
                    }
                },
            };
        },
    };
}
