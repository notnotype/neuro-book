import {readdir, readFile, stat} from "node:fs/promises";
import {extname, isAbsolute, resolve} from "node:path";
import type {AgentTool, AgentToolResult} from "@oh-my-pi/pi-agent-core";
import {formatBytes} from "@oh-my-pi/pi-utils";
import type {EditStore} from "@oh-my-pi/pi-natives";
import type {PluginReadFormat} from "../plugins.js";
import {truncateText} from "../text-budget.js";

export interface ReadToolOptions {
    readonly cwd: string;
    readonly formats?: readonly PluginReadFormat[];
    readonly maxLines?: number;
    readonly maxBytes?: number;
    /** 与 edit 工具共享的快照存储：登记本次展示的内容与行，并输出 `[path#tag]` 头。 */
    readonly store?: EditStore;
}

interface ReadArguments {
    readonly path: string;
    readonly offset?: number;
    readonly limit?: number;
}

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;

const IMAGE_MIME_TYPES = new Map<string, string>([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
]);

function textResult(text: string, details: Record<string, unknown> = {}): AgentToolResult {
    return {content: [{type: "text", text}], details};
}

function errorResult(text: string): AgentToolResult {
    return {content: [{type: "text", text}], isError: true};
}

/** 读取文件或目录：文本带 `N: ` 行号前缀，目录列一层，图片返回 image content。 */
export function createReadTool(options: ReadToolOptions): AgentTool {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const formats = options.formats ?? [];

    return {
        name: "read",
        label: "Read",
        description:
            "读取文件或目录。文本按 `N: 内容` 输出行号（可直接用于 hashline 的 PUT N.=M 锚点）；目录列出一层条目；图片以 image content 返回。",
        loadMode: "essential",
        concurrency: "shared",
        strict: false,
        parameters: {
            type: "object",
            properties: {
                path: {type: "string", description: "文件或目录路径（相对 cwd 或绝对路径）"},
                offset: {type: "number", description: "起始行（1-based，默认 1）"},
                limit: {type: "number", description: "最多读取多少行"},
            },
            required: ["path"],
            additionalProperties: false,
        },
        async execute(_toolCallId, params): Promise<AgentToolResult> {
            const args = params as ReadArguments;
            if (typeof args.path !== "string" || args.path.trim() === "") {
                return errorResult("read 需要非空 path");
            }
            const target = isAbsolute(args.path) ? args.path : resolve(options.cwd, args.path);

            const info = await stat(target).catch(() => null);
            if (info === null) {
                return errorResult(`文件不存在：${args.path}`);
            }

            if (info.isDirectory()) {
                return readDirectory(target, args.path);
            }

            for (const format of formats) {
                if (!format.canRead(target)) continue;
                const read = await format.read(target, {offset: args.offset, limit: args.limit});
                if (read === null) continue;
                return textResult(read.text, {path: args.path, format: format.id});
            }

            const mimeType = IMAGE_MIME_TYPES.get(extname(target).toLowerCase());
            if (mimeType !== undefined) {
                const data = await readFile(target);
                return {
                    content: [{type: "image", data: data.toString("base64"), mimeType}],
                    details: {path: args.path, bytes: data.byteLength},
                };
            }

            const raw = await readFile(target);
            if (raw.includes(0)) {
                return errorResult(`二进制文件不受支持：${args.path}`);
            }
            return readText(raw.toString("utf-8"), args, maxLines, maxBytes, target, options.store);
        },
    } as AgentTool;
}

async function readDirectory(target: string, displayPath: string): Promise<AgentToolResult> {
    const entries = await readdir(target, {withFileTypes: true});
    const names = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort((left, right) => left.localeCompare(right));
    const shown = names.slice(0, MAX_DIRECTORY_ENTRIES);
    const lines = shown.map((name) => `- ${name}`);
    if (names.length > shown.length) {
        lines.push(`…（已截断，共 ${names.length} 项）`);
    }
    return textResult(lines.join("\n"), {path: displayPath, kind: "directory", entries: names.length});
}

function readText(
    content: string,
    args: ReadArguments,
    maxLines: number,
    maxBytes: number,
    absolutePath: string,
    store: EditStore | undefined,
): AgentToolResult {
    const lines = content.split("\n");
    const offset = args.offset ?? 1;
    if (!Number.isSafeInteger(offset) || offset < 1) {
        return errorResult(`offset 必须是 >= 1 的整数：${String(args.offset)}`);
    }
    if (offset > lines.length) {
        return errorResult(`offset 越界：文件只有 ${lines.length} 行，offset=${offset}`);
    }
    const window = typeof args.limit === "number" && Number.isSafeInteger(args.limit) && args.limit >= 0
        ? lines.slice(offset - 1, offset - 1 + args.limit).join("\n")
        : lines.slice(offset - 1).join("\n");

    const budget = truncateText(window, {maxLines, maxBytes});
    const numbered = budget.text
        .split("\n")
        .map((line, index) => `${offset + index}: ${line}`)
        .join("\n");
    const shownLines = budget.text === "" ? 0 : budget.text.split("\n").length;
    const seenLines = Array.from({length: shownLines}, (_value, index) => offset + index);
    const tag = store?.recordSnapshot(absolutePath, content, seenLines);
    const header = tag === undefined ? "" : `[${args.path}#${tag}]\n`;
    const text = budget.truncated
        ? `${header}${numbered}\n…（输出已截断：${budget.reason}；本文件共 ${lines.length} 行、${formatBytes(Buffer.byteLength(content, "utf-8"))}）`
        : `${header}${numbered}`;

    return textResult(text, {path: args.path, tag, truncated: budget.truncated, reason: budget.reason, lines: lines.length});
}
