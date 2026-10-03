import {createError} from "h3";

import {
    buildReferenceUri,
    parseStructuredReferenceTarget,
    parseReferenceUri,
    type ParsedReferenceUri,
    type StructuredReferenceDto,
    type StructuredReferenceKind,
} from "nbook/shared/reference-core";
import {parseReferenceLink} from "nbook/shared/reference-link";
import {
    parseAiAnnotationBlocks,
    type AiAnnotationBlock,
} from "nbook/server/content/ai-annotation";

export type InlineReferenceToken = ParsedReferenceUri & {
    raw: string;
    target: string;
    // `title` 为空表示当前 inline ref 使用的是裸写 `@uri`。
    title: string | null;
    start: number;
    end: number;
    syntax: "markdown" | "bare";
};

export type ContentDiagnostics = {
    errors: string[];
    warnings: string[];
    notes: string[];
};

export type ProcessedContentText = {
    raw: string;
    normalized: string;
    resolved: string;
    text: string;
    inlineRefs: InlineReferenceToken[];
    annotations: AiAnnotationBlock[];
    diagnostics: ContentDiagnostics;
};

export type ProcessedTextFields<T extends object, K extends keyof T> = {
    values: T;
    results: Partial<Record<K, ProcessedContentText>>;
    diagnostics: ContentDiagnostics;
};

export type ProcessedStructuredReferences<TRef extends StructuredReferenceDto, TResolved> = {
    raw: TRef[];
    normalized: TRef[];
    resolved: TResolved[];
    diagnostics: ContentDiagnostics;
};

export type ResponseContentDiagnostics = {
    warnings: string[];
    notes: string[];
};

const LEGACY_MARKDOWN_REFERENCE_PATTERN = /\[([^\]]+)\]\(@([a-z]+:\/\/[^)]+)\)/g;
const STANDARD_MARKDOWN_REFERENCE_PATTERN = /\[([^\]]+)\]\((?:@)?([a-z]+:\/\/[^)]+)\)/g;
const BARE_INLINE_REFERENCE_PATTERN = /(^|[\s(])@([a-z]+:\/\/[^\s)]+)/g;

/**
 * 运行文本内容校验与规范化。
 * 当前只做 inline ref 规范化/提取，以及 AI 批注语法校验。
 */
export function processContentText(text: string): ProcessedContentText {
    const normalizedText = normalizeInlineReferenceMarkdown(text);
    const annotations = parseAiAnnotationBlocks(normalizedText);
    const inlineRefs = extractInlineReferences(normalizedText);
    const diagnostics = createContentDiagnostics();
    const legacyInlineCount = countLegacyInlineReferences(text);

    if (legacyInlineCount > 0) {
        diagnostics.warnings.push(`legacy inline 引用已自动规范化 ${String(legacyInlineCount)} 处`);
    }
    if (inlineRefs.length > 0) {
        diagnostics.notes.push(`识别到 ${String(inlineRefs.length)} 个 inline 引用`);
    }
    if (annotations.length > 0) {
        diagnostics.notes.push(`识别到 ${String(annotations.length)} 个 AI 批注块`);
    }

    return {
        raw: text,
        normalized: normalizedText,
        resolved: normalizedText,
        text: normalizedText,
        inlineRefs,
        annotations,
        diagnostics,
    };
}

/**
 * 批量处理对象中的文本字段。
 */
export function processTextFields<T extends object, K extends keyof T>(
    input: T,
    fields: K[],
): T {
    return processTextFieldsWithResults(input, fields).values;
}

/**
 * 批量处理对象中的文本字段，并返回运行时结果。
 */
export function processTextFieldsWithResults<T extends object, K extends keyof T>(
    input: T,
    fields: K[],
): ProcessedTextFields<T, K> {
    const nextInput = {...input};
    const results: Partial<Record<K, ProcessedContentText>> = {};
    const diagnostics = createContentDiagnostics();

    for (const field of fields) {
        const currentValue = input[field];
        if (typeof currentValue !== "string") {
            continue;
        }

        const result = processContentText(currentValue);
        nextInput[field] = result.text as T[K];
        results[field] = result;
        const mergedDiagnostics = mergeContentDiagnostics(diagnostics, result.diagnostics);
        diagnostics.errors = mergedDiagnostics.errors;
        diagnostics.warnings = mergedDiagnostics.warnings;
        diagnostics.notes = mergedDiagnostics.notes;
    }

    return {
        values: nextInput,
        results,
        diagnostics,
    };
}

/**

/**
 * 统一处理 structured refs：
 * 先做 canonical 规范化与 allowed kinds 校验，再交给领域 resolver。
 */
export async function processStructuredReferences<
    TRef extends StructuredReferenceDto,
    TResolved,
>(input: {
    refs: TRef[];
    allowedKinds: readonly StructuredReferenceKind[];
    label: string;
    resolve: (refs: TRef[]) => Promise<TResolved[]>;
}): Promise<ProcessedStructuredReferences<TRef, TResolved>> {
    const normalized = normalizeStructuredReferences({
        refs: input.refs,
        allowedKinds: input.allowedKinds,
        label: input.label,
    });
    const resolved = await input.resolve(normalized.normalized);

    return {
        raw: input.refs,
        normalized: normalized.normalized,
        resolved,
        diagnostics: normalized.diagnostics,
    };
}

/**
 * 统一规范化 structured refs。
 */
export function normalizeStructuredReferences<TRef extends StructuredReferenceDto>(input: {
    refs: TRef[];
    allowedKinds: readonly StructuredReferenceKind[];
    label: string;
}): {
    raw: TRef[];
    normalized: TRef[];
    diagnostics: ContentDiagnostics;
} {
    const diagnostics = createContentDiagnostics();
    let legacyTargetCount = 0;
    const normalized = input.refs.map((ref) => {
        const parsedTarget = parseStructuredReferenceTarget(ref.target);
        if (!parsedTarget) {
            throwContentBadRequest(`不支持的引用目标：${ref.target}`);
        }

        if (!input.allowedKinds.includes(parsedTarget.kind)) {
            throwContentBadRequest(`${input.label} refs 仅支持 ${input.allowedKinds.join(" / ")}：${ref.target}`);
        }

        if (parsedTarget.legacy) {
            legacyTargetCount += 1;
        }

        return {
            ...ref,
            relation: ref.relation.trim(),
            target: parsedTarget.canonicalTarget,
            note: ref.note === undefined ? null : ref.note,
        };
    });

    if (legacyTargetCount > 0) {
        diagnostics.warnings.push(`legacy structured 引用已自动规范化 ${String(legacyTargetCount)} 处`);
    }
    if (normalized.length > 0) {
        diagnostics.notes.push(`识别到 ${String(normalized.length)} 个 structured ref`);
    }

    return {
        raw: input.refs,
        normalized,
        diagnostics,
    };
}

/**
 * 将 legacy markdown 引用统一成标准写法。
 */
export function normalizeInlineReferenceMarkdown(text: string): string {
    return text.replaceAll(LEGACY_MARKDOWN_REFERENCE_PATTERN, (_matched, title: string, uri: string) => {
        const parsedUri = parseReferenceUri(uri);
        if (!parsedUri) {
            throwContentBadRequest(`非法 inline 引用：@${uri}`);
        }

        return `[${title}](${parsedUri.kind}://${parsedUri.targetId})`;
    });
}

/**
 * 统计 legacy markdown inline 引用数量。
 */
export function countLegacyInlineReferences(text: string): number {
    return [...text.matchAll(LEGACY_MARKDOWN_REFERENCE_PATTERN)].length;
}

/**
 * 从文本中提取 inline refs。
 */
export function extractInlineReferences(text: string): InlineReferenceToken[] {
    const tokens: InlineReferenceToken[] = [];

    for (const matched of text.matchAll(STANDARD_MARKDOWN_REFERENCE_PATTERN)) {
        const matchedIndex = matched.index ?? -1;
        const raw = matched[0] ?? "";
        if (matchedIndex < 0 || !raw) {
            continue;
        }

        const parsedReference = parseReferenceLink(raw);
        if (!parsedReference) {
            throwContentBadRequest(`非法 inline 引用：${raw}`);
        }

        tokens.push({
            kind: parsedReference.kind,
            targetId: parsedReference.targetId,
            raw,
            target: buildReferenceUri(parsedReference.kind, parsedReference.targetId),
            title: parsedReference.title,
            start: matchedIndex,
            end: matchedIndex + raw.length,
            syntax: "markdown",
        });
    }

    for (const matched of text.matchAll(BARE_INLINE_REFERENCE_PATTERN)) {
        const matchedIndex = matched.index ?? -1;
        const leadingText = matched[1] ?? "";
        const rawUri = matched[2]?.trim() ?? "";
        if (matchedIndex < 0 || !rawUri) {
            continue;
        }

        const parsedUri = parseReferenceUri(rawUri);
        if (!parsedUri) {
            throwContentBadRequest(`非法 inline 引用：@${rawUri}`);
        }

        const raw = `@${rawUri}`;
        const start = matchedIndex + leadingText.length;
        tokens.push({
            ...parsedUri,
            raw,
            target: buildReferenceUri(parsedUri.kind, parsedUri.targetId),
            title: null,
            start,
            end: start + raw.length,
            syntax: "bare",
        });
    }

    return tokens;
}

/**
 * 合并多份 diagnostics。
 */
export function mergeContentDiagnostics(...diagnosticsList: ContentDiagnostics[]): ContentDiagnostics {
    const merged = createContentDiagnostics();

    for (const diagnostics of diagnosticsList) {
        merged.errors.push(...diagnostics.errors);
        merged.warnings.push(...diagnostics.warnings);
        merged.notes.push(...diagnostics.notes);
    }

    merged.errors = [...new Set(merged.errors)];
    merged.warnings = [...new Set(merged.warnings)];
    merged.notes = [...new Set(merged.notes)];
    return merged;
}

/**
 * 转成写接口可返回的 diagnostics。
 */
export function toResponseContentDiagnostics(diagnostics: ContentDiagnostics): ResponseContentDiagnostics | undefined {
    if (diagnostics.warnings.length === 0 && diagnostics.notes.length === 0) {
        return undefined;
    }

    return {
        warnings: diagnostics.warnings,
        notes: diagnostics.notes,
    };
}

/**
 * 构造空 diagnostics。
 */
function createContentDiagnostics(): ContentDiagnostics {
    return {
        errors: [],
        warnings: [],
        notes: [],
    };
}

/**
 * 抛出内容校验错误。
 */
function throwContentBadRequest(message: string): never {
    throw createError({
        statusCode: 400,
        message,
    });
}
