/**
 * 把工具调用整理成代码块的行，供工具详情组件使用。纯函数，不依赖 Vue，便于测试。
 */
import type {JsonValue, ToolCallView} from "./types";
import {argNumber, argString} from "./tool-args";

export type CodeLine = {text: string; tone?: "added" | "removed" | "muted"};

/** 文本按行拆开；末尾换行不产生多余的空行。 */
export function splitLines(text: string): string[] {
    if (text === "") {
        return [];
    }
    const lines = text.split("\n");
    return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

export function textLines(text: string): CodeLine[] {
    return splitLines(text).map((line) => ({text: line}));
}

/** 读取结果按文件行号显示；带 offset 参数时从该行开始编号。 */
/**
 * `read` 的结果：NeuroBook 的格式是头一行 `[地址#标记]`、每行 `行号:正文`，后面可能有说明（还有多少行怎么翻页）。
 * 去掉这些给模型看的写法：行号由代码块画，说明单独一行淡色。目录与图片的结果没有带行号的行，原样显示。
 */
const READ_HEADER = /^\[[^\]\n]+#[^\]\n]*\]/u;
const NUMBERED_LINE = /^(\d+):(.*)$/u;

function hashlineContent(text: string): {lines: CodeLine[]; startLine: number} | null {
    const rows = splitLines(text);
    if (rows.length < 2 || !READ_HEADER.test(rows[0]!)) return null;
    const first = NUMBERED_LINE.exec(rows[1]!);
    if (first === null) return null;
    const lines: CodeLine[] = [];
    let index = 1;
    for (; index < rows.length; index += 1) {
        const match = NUMBERED_LINE.exec(rows[index]!);
        if (match === null) break;
        lines.push({text: match[2]!});
    }
    for (; index < rows.length; index += 1) lines.push({text: rows[index]!, tone: "muted"});
    return {lines, startLine: Number(first[1])};
}

export function fileContentLines(call: ToolCallView): {lines: CodeLine[]; startLine: number} {
    const hashline = hashlineContent(call.result?.text ?? "");
    if (hashline !== null) return hashline;
    return {lines: textLines(call.result?.text ?? ""), startLine: argNumber(call, "offset") ?? 1};
}

/** 命令类工具的输入：bash 的 command 或 execute_sql 的 sql。 */
export function commandText(call: ToolCallView): string {
    return argString(call, "command") || argString(call, "sql");
}

/** 原始参数与结构化结果按两空格缩进的 JSON 显示，开发者能据此对照底层调用。 */
export function jsonLines(value: JsonValue | undefined): CodeLine[] {
    return value === undefined ? [] : textLines(JSON.stringify(value, null, 2));
}
