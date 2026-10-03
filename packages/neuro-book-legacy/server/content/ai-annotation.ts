import {createError} from "h3";

export type AiAnnotationKind = "replace" | "command";

export type AiAnnotationBlock = {
    kind: AiAnnotationKind;
    raw: string;
    prompt: string;
    rangeStart: number;
    rangeEnd: number;
};

/**
 * 解析文本中的 AI 批注块。
 * v1 只做语法识别与校验，不执行替换。
 */
export function parseAiAnnotationBlocks(text: string): AiAnnotationBlock[] {
    const blocks: AiAnnotationBlock[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const nextMarkerIndex = text.indexOf("%", cursor);
        if (nextMarkerIndex < 0) {
            break;
        }

        const marker = resolveMarker(text, nextMarkerIndex);
        if (!marker) {
            cursor = nextMarkerIndex + 1;
            continue;
        }

        const closeIndex = text.indexOf("}%", marker.contentStart);
        if (closeIndex < 0) {
            throwAnnotationBadRequest("AI 批注缺少结束标记 }%");
        }

        const nestedIndex = findNestedMarker(text, marker.contentStart, closeIndex);
        if (nestedIndex >= 0) {
            throwAnnotationBadRequest("AI 批注暂不支持嵌套");
        }

        const content = text.slice(marker.contentStart, closeIndex).trim();
        if (!content) {
            throwAnnotationBadRequest("AI 批注内容不能为空");
        }

        blocks.push({
            kind: marker.kind,
            raw: text.slice(nextMarkerIndex, closeIndex + 2),
            prompt: content,
            rangeStart: nextMarkerIndex,
            rangeEnd: closeIndex + 2,
        });
        cursor = closeIndex + 2;
    }

    return blocks;
}

/**
 * 返回当前下标处是否为合法批注起始标记。
 */
function resolveMarker(text: string, index: number): {kind: AiAnnotationKind; contentStart: number} | null {
    if (text.startsWith("%!{", index)) {
        return {
            kind: "command",
            contentStart: index + 3,
        };
    }

    if (text.startsWith("%{", index)) {
        return {
            kind: "replace",
            contentStart: index + 2,
        };
    }

    return null;
}

/**
 * 查找未闭合块内部是否又出现新的起始标记。
 */
function findNestedMarker(text: string, start: number, end: number): number {
    const replaceIndex = text.indexOf("%{", start);
    const commandIndex = text.indexOf("%!{", start);

    const candidates = [replaceIndex, commandIndex]
        .filter((index) => index >= 0 && index < end)
        .sort((left, right) => left - right);

    return candidates[0] ?? -1;
}

/**
 * 抛出内容校验错误。
 */
function throwAnnotationBadRequest(message: string): never {
    throw createError({
        statusCode: 400,
        message,
    });
}
