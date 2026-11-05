/**
 * `read`（docs/specs/agent/builtin-tools.md 输出 5–8）：取本机读路径后自己读，分页、大文件与图片字节都不受写入接口的上限约束。
 */

import {createReadStream} from "node:fs";
import {open, stat} from "node:fs/promises";

import {hashlineFormatHeader, hashlineFormatNumberedLines} from "@oh-my-pi/pi-natives";
import type {EditStore} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import {decodeText, renderVirtual} from "nbook/plugins/files/shared/contracts";

import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";
import type {SessionResources} from "../../shared/resources";

import {failed, failure, globalAddress, joinAddress} from "./common";
import type {SessionEditStores} from "./common";
import {prepareImage} from "./image";

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

export const readDeclaration: AgentToolDeclaration = {
    description: "读取一个资源地址：文本带行号与行锚（一次至多 2000 行、50 KB，用 offset 与 limit 分页），目录与虚拟根列出一层，png、jpeg、gif、webp 图片直接给你看。",
    parameters: {
        type: "object",
        properties: {
            path: {type: "string", description: "资源地址，例如 project://正文/第一章.md、session://plan.md"},
            offset: {type: "integer", minimum: 1, description: "从第几行开始，从 1 数起"},
            limit: {type: "integer", minimum: 1, maximum: MAX_LINES, description: "最多读多少行"},
        },
        required: ["path"],
    },
    version: "1",
    concurrency: "shared",
    effect: "read",
};

type ImageFormat = "png" | "jpeg" | "gif" | "webp";

function imageFormat(head: Uint8Array): ImageFormat | null {
    const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
    if (starts(0xff, 0xd8, 0xff)) return "jpeg";
    if (starts(0x47, 0x49, 0x46, 0x38)) return "gif";
    if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "webp";
    return null;
}

async function readImage(path: string, address: string, format: ImageFormat, size: number): Promise<ToolResult> {
    if (size > IMAGE_LIMIT) return failed("too-large", `too-large: ${address} 有 ${String(size)} 字节，图片至多 ${String(IMAGE_LIMIT)} 字节`);
    try {
        const image = await prepareImage(await Bun.file(path).bytes(), format);
        const changed = image.width !== image.originalWidth || image.height !== image.originalHeight;
        return {
            text: `[${address}] 图片 ${image.mime}，${String(image.originalWidth)}x${String(image.originalHeight)}${changed ? `，调整到 ${String(image.width)}x${String(image.height)}` : ""}`,
            images: [{data: Buffer.from(image.data).toString("base64"), mime: image.mime, width: image.width, height: image.height}],
        };
    } catch (error) {
        return failed("not-text", `not-text: ${address} 不是能解码的图片（${error instanceof Error ? error.message : String(error)}）`);
    }
}

interface Window {
    readonly rows: readonly string[];
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
        if (!truncated) seen.push(number);
    }
    return {rows, seen, first: offset, last: offset + rows.length - 1, more, total};
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

async function readFile(store: EditStore, path: string, address: string, size: number, offset: number, limit: number, signal: AbortSignal): Promise<ToolResult> {
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
    if (format !== null) return readImage(path, address, format, size);
    if (head.includes(0)) return failed("not-text", `not-text: ${address} 是二进制文件，用 shell 处理`);

    if (size > SNAPSHOT_LIMIT) {
        const window = await collect(fileLines(path, signal), offset, limit, null);
        return {text: render(`[${address}]`, window, `这个文件超过 4 MiB，没有行锚：不能用行锚改，要用 replace、write 或 shell。`)};
    }
    const text = decodeText(await Bun.file(path).bytes());
    if (text === null) return failed("not-text", `not-text: ${address} 不是 UTF-8 文本`);
    return {text: (await renderSnapshot(store, path, address, text, offset, limit, MAX_BYTES)).text};
}

/**
 * 文本读出来之后的公共部分：记行锚快照，按字节预算排版成带行号与行锚的样子。`read` 与压缩后的放回共用，放回的行锚才和
 * `read` 给的一样能被 `edit` 认：只有完整显示的行算看过。
 */
export async function renderSnapshot(store: EditStore, path: string, address: string, text: string, offset: number, limit: number, maxBytes: number): Promise<{readonly text: string; readonly more: boolean}> {
    const lines = splitLines(text);
    const window = await collect(lines, offset, limit, lines.length, maxBytes);
    const tag = store.recordSnapshot(path, text, window.seen.length === 0 ? NOTHING_SEEN : [...window.seen]);
    return {text: render(hashlineFormatHeader(address, tag), window, null), more: window.more};
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

async function listOne(resources: SessionResources, address: string, signal: AbortSignal): Promise<ToolResult> {
    const listed = await resources.list(address, {signal});
    if (!listed.ok) return failure(listed);
    const {value} = listed;
    if ("kind" in value) {
        const shown = {...value, entries: value.entries.slice(0, MAX_ENTRIES)};
        return {text: `${renderVirtual(shown)}${value.entries.length > MAX_ENTRIES ? `\n（还有 ${String(value.entries.length - MAX_ENTRIES)} 项没有列出）` : ""}`};
    }
    const rows = value.entries.slice(0, MAX_ENTRIES).map((entry) => `${joinAddress(address, entry.name)}${entry.kind === "directory" ? "/" : ""}`);
    if (value.entries.length > MAX_ENTRIES) rows.push(`（还有 ${String(value.entries.length - MAX_ENTRIES)} 项没有列出）`);
    return {text: rows.length === 0 ? `[${address}]（空目录）` : rows.join("\n")};
}

export function readTool(stores: SessionEditStores): AgentToolImplementation {
    return {
        create: (context, {resources}) => {
            const held = stores.acquire(context.sessionId);
            return {
                dispose: () => held.release(),
                execute: async (args, call) => {
                    const expanded = globalAddress(resources, args.path as string);
                    if (!expanded.ok) return expanded.failure;
                    const {address} = expanded;
                    const located = await resources.readPath(address, {signal: call.signal});
                    // 虚拟根没有本机路径，它的内容是列出来的。
                    if (!located.ok) return located.code === "unsupported-capability" ? listOne(resources, address, call.signal) : failure(located);
                    if (located.value.kind === "directory") return listOne(resources, address, call.signal);
                    if (located.value.kind === "other") return failed("not-text", `not-text: ${address} 不是普通文件`);
                    // 定位之后文件可能被 shell 或外部编辑器删掉：这是预料之中的，不能变成工具抛错。
                    try {
                        const {size} = await stat(located.value.path);
                        return await readFile(held.store, located.value.path, address, size, (args.offset as number | undefined) ?? 1, (args.limit as number | undefined) ?? MAX_LINES, call.signal);
                    } catch (error) {
                        return readFailure(error, address, call.signal);
                    }
                },
            };
        },
    };
}
