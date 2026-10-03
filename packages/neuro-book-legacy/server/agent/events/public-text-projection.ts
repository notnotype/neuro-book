import {textPreview} from "nbook/server/agent/events/public-tool-projection";
import type {PublicTextPreviewDto} from "nbook/shared/dto/agent-public-event.dto";

/** 多个公开文本字段共享的原文与 JSON 转义后字节预算。 */
export type PublicTextBudget = {
    remainingRawBytes: number;
    remainingSerializedBytes: number;
};

/** 创建一次公开投影使用的共享文本预算。 */
export function createPublicTextBudget(rawBytes: number, serializedBytes: number): PublicTextBudget {
    return {
        remainingRawBytes: rawBytes,
        remainingSerializedBytes: serializedBytes,
    };
}

/**
 * 同时约束正文 UTF-8 大小与 JSON string 转义后的大小。
 * 控制字符会在 stringify 时扩张，不能只按原始 UTF-8 预算判断公开 payload 大小。
 */
export function projectPublicText(value: string, budget: PublicTextBudget, maxRawBytes = budget.remainingRawBytes): PublicTextPreviewDto {
    const raw = textPreview(value, Math.min(maxRawBytes, budget.remainingRawBytes));
    let preview = raw.preview;
    if (jsonStringBytes(preview) > budget.remainingSerializedBytes) {
        preview = fitSerializedPrefix(preview, budget.remainingSerializedBytes);
    }
    const rawPreviewBytes = Buffer.byteLength(preview, "utf8");
    budget.remainingRawBytes = Math.max(0, budget.remainingRawBytes - rawPreviewBytes);
    budget.remainingSerializedBytes = Math.max(0, budget.remainingSerializedBytes - jsonStringBytes(preview));
    return {
        preview,
        bytes: raw.bytes,
        omitted: raw.omitted || preview.length < raw.preview.length,
    };
}

function fitSerializedPrefix(value: string, maxBytes: number): string {
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (jsonStringBytes(value.slice(0, middle)) <= maxBytes) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    let length = low;
    while (length > 0 && jsonStringBytes(value.slice(0, length)) > maxBytes) {
        length -= 1;
    }
    const lastCodeUnit = value.charCodeAt(length - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
        length -= 1;
    }
    return value.slice(0, Math.max(0, length));
}

function jsonStringBytes(value: string): number {
    return Math.max(0, Buffer.byteLength(JSON.stringify(value), "utf8") - 2);
}
