/**
 * read 工具（docs/specs/harness/builtin-tools.md 输出 2–5）：文本带 `[path#tag]` 头与行号、目录列一层、图片以图片块返回。
 * 展示过的行登记到本会话的快照存储，edit 靠这个标签核对“先读后改”。
 */

import type {ImageContent} from "@oh-my-pi/pi-ai";
import Type from "typebox";
import {defineTool} from "../tools/tools";
import type {ToolDefinition, ToolOutcome} from "../tools/tools";
import type {FileAccess, FilesResult, ReadBudget, SnapshotStores} from "./types";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;
const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
    [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"],
]);
const encoder = new TextEncoder();

const ReadParameters = Type.Object({
    path: Type.String({minLength: 1, description: "根内相对路径：文件或目录"}),
    offset: Type.Optional(Type.Integer({minimum: 1, description: "起始行（从 1 起）"})),
    limit: Type.Optional(Type.Integer({minimum: 0, description: "最多读多少行"})),
});

const failed = (result: Extract<FilesResult<unknown>, {ok: false}>): ToolOutcome => ({ok: false, code: result.code, message: result.detail});

function imageMime(path: string): string | undefined {
    const dot = path.lastIndexOf(".");
    return dot === -1 ? undefined : IMAGE_MIME_TYPES.get(path.slice(dot).toLowerCase());
}

/** 按行累加、先到先停地截断：超过行数或字节预算就停下并报告原因。 */
function budgeted(lines: readonly string[], maxLines: number, maxBytes: number): {lines: string[]; reason: "lines" | "bytes" | null} {
    const out: string[] = [];
    let bytes = 0;
    for (const line of lines) {
        if (out.length >= maxLines) return {lines: out, reason: "lines"};
        const size = encoder.encode(line).length + (out.length > 0 ? 1 : 0);
        if (bytes + size > maxBytes) return {lines: out, reason: "bytes"};
        out.push(line);
        bytes += size;
    }
    return {lines: out, reason: null};
}

export function readTool(input: {access: FileAccess; stores: SnapshotStores} & ReadBudget): ToolDefinition {
    const maxLines = input.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    return defineTool({
        id: "read",
        description: "读取文件或目录。文本按 `[path#tag]` 头加 `N: 内容` 输出行号（edit 要用这个头）；目录列出一层；图片以图片块返回。",
        parameters: ReadParameters,
        risk: "read",
        async execute(args, context): Promise<ToolOutcome> {
            const {path, offset, limit} = args as {path: string; offset?: number; limit?: number};
            const info = await input.access.stat(path);
            if (!info.ok) return failed(info);
            if (info.value.kind === "directory") {
                const listed = await input.access.list(path);
                if (!listed.ok) return failed(listed);
                const shown = listed.value.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => `- ${entry.name}${entry.kind === "directory" ? "/" : ""}`);
                if (listed.value.length > MAX_DIRECTORY_ENTRIES) shown.push(`…（已截断，共 ${listed.value.length} 项）`);
                return {ok: true, content: shown.join("\n"), details: {path, kind: "directory", entries: listed.value.length}};
            }
            const bytes = await input.access.readBytes(path);
            if (!bytes.ok) return failed(bytes);
            const mimeType = imageMime(path);
            if (mimeType !== undefined) {
                const image: ImageContent = {type: "image", mimeType, data: Buffer.from(bytes.value).toString("base64")};
                return {ok: true, content: [image], details: {path, bytes: bytes.value.byteLength}};
            }
            if (bytes.value.includes(0)) return {ok: false, code: "binary", message: `二进制文件不受支持：${path}`};
            const text = new TextDecoder("utf-8").decode(bytes.value);
            const lines = text.split("\n");
            const start = offset ?? 1;
            if (start > lines.length) return {ok: false, code: "invalid-arguments", message: `offset 越界：文件只有 ${lines.length} 行，offset=${start}`};
            const window = limit === undefined ? lines.slice(start - 1) : lines.slice(start - 1, start - 1 + limit);
            const {lines: shown, reason} = budgeted(window, maxLines, maxBytes);
            const seen = shown.map((_line, index) => start + index);
            const absolute = input.access.resolve(path);
            if (!absolute.ok) return failed(absolute);
            const tag = input.stores.forSession(context.session.id).recordSnapshot(absolute.value, text, seen);
            const body = shown.map((line, index) => `${start + index}: ${line}`);
            if (reason !== null) body.push(`输出已截断：${reason}`);
            return {ok: true, content: [`[${path}#${tag}]`, ...body].join("\n"), details: {path, lines: shown.length, truncated: reason !== null, ...(reason === null ? {} : {reason})}};
        },
    });
}
