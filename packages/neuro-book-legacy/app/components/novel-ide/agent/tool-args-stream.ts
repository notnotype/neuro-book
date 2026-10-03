import { parse } from "partial-json";

/**
 * 仅在参数文本是完整 JSON 时返回原文，避免流式阶段把半截 JSON 误标成稳定结果。
 */
export const toStableArgsJson = (rawArgsText?: string): string | undefined => {
    if (!rawArgsText) {
        return undefined;
    }
    try {
        JSON.parse(rawArgsText);
        return rawArgsText;
    } catch {
        return undefined;
    }
};

/**
 * 尝试将参数文本解析为对象。
 * 优先使用完整 JSON；流式阶段退回 partial-json。
 */
export const parseToolArgsObject = <T extends object>(rawArgsText?: string): T | null => {
    if (!rawArgsText) {
        return null;
    }
    try {
        return JSON.parse(rawArgsText) as T;
    } catch {
        try {
            return parse(rawArgsText) as T;
        } catch {
            return null;
        }
    }
};

/**
 * 从原始 JSON 文本中提取字符串字段，供流式组件尽早展示。
 */
export const extractStreamingStringField = (rawArgsText: string | undefined, fieldName: string): string => {
    if (!rawArgsText) {
        return "";
    }
    const valueStartIndex = findJsonStringValueStart(rawArgsText, fieldName);
    if (valueStartIndex < 0) {
        return "";
    }
    const tail = rawArgsText.slice(valueStartIndex);
    const closingQuoteIndex = findClosingQuoteIndex(tail);
    const rawValue = closingQuoteIndex >= 0 ? tail.slice(0, closingQuoteIndex) : tail;
    return decodeJsonStringPrefix(rawValue);
};

/**
 * 从原始 JSON 文本中提取布尔字段。
 */
export const extractStreamingBooleanField = (rawArgsText: string | undefined, fieldName: string): boolean | null => {
    if (!rawArgsText) {
        return null;
    }
    const fieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*(true|false)`);
    const fieldMatch = rawArgsText.match(fieldPattern);
    if (!fieldMatch) {
        return null;
    }
    return fieldMatch[1] === "true";
};

/**
 * 从原始 JSON 文本中提取数字字段。
 */
export const extractStreamingNumberField = (rawArgsText: string | undefined, fieldName: string): number | null => {
    if (!rawArgsText) {
        return null;
    }
    const fieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
    const fieldMatch = rawArgsText.match(fieldPattern);
    if (!fieldMatch) {
        return null;
    }
    const nextValue = Number(fieldMatch[1]);
    return Number.isFinite(nextValue) ? nextValue : null;
};

/**
 * 对 patch 这类长文本字段做优先提取。
 */
export const extractStreamingTextField = (rawArgsText: string | undefined, fieldName: string): string => {
    return extractStreamingStringField(rawArgsText, fieldName);
};

const escapeRegExp = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * 定位 JSON 对象中某个字符串字段值的起始位置。
 */
const findJsonStringValueStart = (rawArgsText: string, fieldName: string): number => {
    const fieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`, "g");
    const fieldMatch = fieldPattern.exec(rawArgsText);
    if (!fieldMatch) {
        return -1;
    }
    return fieldMatch.index + fieldMatch[0].length;
};

/**
 * 查找 JSON 字符串中真正的结束引号，忽略转义引号。
 */
const findClosingQuoteIndex = (value: string): number => {
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            return index;
        }
    }
    return -1;
};

/**
 * 把可能不完整的 JSON 字符串前缀解码成人类可读文本。
 */
const decodeJsonStringPrefix = (value: string): string => {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char !== "\\") {
            result += char;
            continue;
        }
        const nextChar = value[index + 1];
        if (!nextChar) {
            break;
        }
        if (nextChar === "n") {
            result += "\n";
            index += 1;
            continue;
        }
        if (nextChar === "r") {
            result += "\r";
            index += 1;
            continue;
        }
        if (nextChar === "t") {
            result += "\t";
            index += 1;
            continue;
        }
        if (nextChar === "\"" || nextChar === "\\" || nextChar === "/") {
            result += nextChar;
            index += 1;
            continue;
        }
        if (nextChar === "b") {
            result += "\b";
            index += 1;
            continue;
        }
        if (nextChar === "f") {
            result += "\f";
            index += 1;
            continue;
        }
        if (nextChar === "u") {
            const unicodeHex = value.slice(index + 2, index + 6);
            if (/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
                result += String.fromCharCode(Number.parseInt(unicodeHex, 16));
                index += 5;
                continue;
            }
            break;
        }
        result += nextChar;
        index += 1;
    }
    return result;
};
