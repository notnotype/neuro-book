/**
 * 读取工具参数的小工具。参数是工具自己的 JSON，流式生成中可能缺字段，所以一律容忍缺失与类型不符。
 */
import type {JsonValue, ToolCallView} from "./agent-view.types";
import type {FileChangeView} from "./agent-view-registry";

export function argString(call: ToolCallView, key: string): string {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return "";
    }
    const value = args[key];
    return typeof value === "string" ? value : "";
}

export function argArray(call: ToolCallView, key: string): JsonValue[] {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return [];
    }
    const value = args[key];
    return Array.isArray(value) ? value : [];
}

export function countLines(text: string): number {
    if (text === "") {
        return 0;
    }
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

export function objectString(value: JsonValue, key: string): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const field = value[key];
    return typeof field === "string" ? field : null;
}

export function argNumber(call: ToolCallView, key: string): number | null {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return null;
    }
    const value = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const PATCH_FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/u;

/** 解析 Codex apply_patch 文本，按文件统计 `+`/`-` 行。 */
export function parsePatchChanges(patch: string): FileChangeView[] {
    const changes: FileChangeView[] = [];
    let current: {path: string; added: number; removed: number} | null = null;
    for (const line of patch.split("\n")) {
        const header = PATCH_FILE_HEADER.exec(line);
        if (header !== null) {
            current = {path: header[2]!.trim(), added: 0, removed: 0};
            changes.push(current);
            continue;
        }
        if (current === null || line.startsWith("***")) {
            continue;
        }
        if (line.startsWith("+")) {
            current.added += 1;
        } else if (line.startsWith("-")) {
            current.removed += 1;
        }
    }
    return changes;
}
