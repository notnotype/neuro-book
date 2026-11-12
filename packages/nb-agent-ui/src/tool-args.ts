/**
 * 读取工具参数的小工具，宿主写领域工具的渲染器时也用（从包入口导出）。参数是工具自己的 JSON，流式生成中可能缺字段、
 * 是半截，所以一律容忍缺失与类型不符，不抛错。
 */
import type {JsonValue, ToolCallView} from "./types";

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

export function argBoolean(call: ToolCallView, key: string): boolean | null {
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return null;
    }
    const value = args[key];
    return typeof value === "boolean" ? value : null;
}
