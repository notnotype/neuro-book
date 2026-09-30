/**
 * 把工具调用整理成代码块的行，供工具详情组件使用。纯函数，不依赖 Vue，便于测试。
 */
import type {JsonValue, ToolCallView} from "./agent-view.types";
import {argArray, argNumber, argString, objectString} from "./tool-args";

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
export function fileContentLines(call: ToolCallView): {lines: CodeLine[]; startLine: number} {
    return {lines: textLines(call.result?.text ?? ""), startLine: argNumber(call, "offset") ?? 1};
}

/**
 * 改文件的 diff 行：edit 的每个片段先删后增，片段之间一行淡色省略号；write 全部是新增；
 * apply_patch 按补丁自身的行首符号着色。
 */
export function fileDiffLines(call: ToolCallView): CodeLine[] {
    if (call.name === "write") {
        return splitLines(argString(call, "content")).map((text) => ({text, tone: "added"}));
    }
    if (call.name === "apply_patch") {
        return splitLines(argString(call, "patch")).map(patchLine);
    }
    const lines: CodeLine[] = [];
    argArray(call, "edits").forEach((edit: JsonValue, index) => {
        if (index > 0) {
            lines.push({text: "⋯", tone: "muted"});
        }
        splitLines(objectString(edit, "oldText") ?? "").forEach((text) => lines.push({text, tone: "removed"}));
        splitLines(objectString(edit, "newText") ?? "").forEach((text) => lines.push({text, tone: "added"}));
    });
    return lines;
}

function patchLine(line: string): CodeLine {
    if (line.startsWith("***") || line.startsWith("@@")) {
        return {text: line, tone: "muted"};
    }
    if (line.startsWith("+")) {
        return {text: line.slice(1), tone: "added"};
    }
    if (line.startsWith("-")) {
        return {text: line.slice(1), tone: "removed"};
    }
    return {text: line.startsWith(" ") ? line.slice(1) : line};
}

/** 命令类工具的输入：bash 的 command 或 execute_sql 的 sql。 */
export function commandText(call: ToolCallView): string {
    return argString(call, "command") || argString(call, "sql");
}

/** 原始参数与结构化结果按两空格缩进的 JSON 显示，开发者能据此对照底层调用。 */
export function jsonLines(value: JsonValue | undefined): CodeLine[] {
    return value === undefined ? [] : textLines(JSON.stringify(value, null, 2));
}
