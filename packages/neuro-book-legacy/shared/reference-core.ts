import {z} from "zod";

export const MAX_REFERENCE_RELATION_LENGTH = 120;
export const MAX_REFERENCE_TARGET_LENGTH = 500;
export const MAX_REFERENCE_NOTE_LENGTH = 5_000;
export const MAX_REFERENCE_COUNT = 100;

export const INLINE_REFERENCE_KINDS = [
    "chapter",
    "volume",
    "lorebook",
    "thread",
    "scene",
] as const;

export const STRUCTURED_REFERENCE_KINDS = [
    "content",
    "thread",
    "scene",
] as const;

export const LOREBOOK_STRUCTURED_REFERENCE_KINDS = [
    "content",
] as const;

export const STORY_STRUCTURED_REFERENCE_KINDS = [
    "content",
    "thread",
    "scene",
] as const;

export type ReferenceKind = typeof INLINE_REFERENCE_KINDS[number];
export type StructuredReferenceKind = typeof STRUCTURED_REFERENCE_KINDS[number];
export type LorebookStructuredReferenceKind = typeof LOREBOOK_STRUCTURED_REFERENCE_KINDS[number];
export type StoryStructuredReferenceKind = typeof STORY_STRUCTURED_REFERENCE_KINDS[number];

export const ReferenceKindSchema = z.enum(INLINE_REFERENCE_KINDS);
export const StructuredReferenceKindSchema = z.enum(STRUCTURED_REFERENCE_KINDS);
export const LorebookStructuredReferenceKindSchema = z.enum(LOREBOOK_STRUCTURED_REFERENCE_KINDS);
export const StoryStructuredReferenceKindSchema = z.enum(STORY_STRUCTURED_REFERENCE_KINDS);
export const ReferenceVisibilitySchema = z.enum(["author", "reader"]);

const ReferenceRelationSchema = z.string()
    .trim()
    .min(1, "relation 不能为空")
    .max(MAX_REFERENCE_RELATION_LENGTH, "relation 过长");
const ReferenceTargetSchema = z.string()
    .trim()
    .min(1, "target 不能为空")
    .max(MAX_REFERENCE_TARGET_LENGTH, "target 过长");
const ReferenceNoteSchema = z.string().max(MAX_REFERENCE_NOTE_LENGTH, "note 过长");

export const StructuredReferenceDtoSchema = z.object({
    relation: ReferenceRelationSchema,
    target: ReferenceTargetSchema,
    visibility: ReferenceVisibilitySchema.default("author"),
    // `note` 为空表示该引用没有额外备注。
    note: ReferenceNoteSchema.nullable().optional().default(null),
});

export type StructuredReferenceDto = z.infer<typeof StructuredReferenceDtoSchema>;
export type ReferenceVisibility = z.infer<typeof ReferenceVisibilitySchema>;

export type ParsedReferenceUri = {
    kind: ReferenceKind;
    targetId: string;
};

export type ParsedStructuredReferenceTarget = {
    kind: StructuredReferenceKind;
    targetId: string;
    canonicalTarget: string;
    legacy: boolean;
};

const URI_REFERENCE_PATTERN = /^([a-z]+):\/\/(.+)$/i;
const LEGACY_LOREBOOK_TARGET_PATTERN = /^lorebook:(.+)$/i;
const LEGACY_THREAD_TARGET_PATTERN = /^thread:(.+)$/i;
const LEGACY_PENDING_TARGET_PATTERN = /^pending\./i;
const WORKSPACE_REFERENCE_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 构造 canonical URI。
 */
export function buildReferenceUri(kind: ReferenceKind, targetId: string): string {
    return `${kind}://${targetId}`;
}

/**
 * 解析 canonical URI。
 */
export function parseReferenceUri(raw: string): ParsedReferenceUri | null {
    const normalizedRaw = raw.trim();
    const matched = normalizedRaw.match(URI_REFERENCE_PATTERN);
    if (!matched) {
        return null;
    }

    const kind = matched[1]?.trim().toLowerCase() as ReferenceKind | undefined;
    const targetId = matched[2]?.trim() ?? "";
    if (!kind || !INLINE_REFERENCE_KINDS.includes(kind) || !targetId) {
        return null;
    }

    return {
        kind,
        targetId,
    };
}

/**
 * 解析 structured ref target，同时兼容 legacy 写法。
 */
export function parseStructuredReferenceTarget(raw: string): ParsedStructuredReferenceTarget | null {
    const normalizedRaw = raw.trim();
    const uri = parseReferenceUri(normalizedRaw);
    if (uri && isStructuredUriKind(uri.kind)) {
        const matchedKind = uri.kind;
        return {
            kind: matchedKind,
            targetId: uri.targetId,
            canonicalTarget: buildReferenceUri(matchedKind, uri.targetId),
            legacy: false,
        };
    }

    const lorebookMatch = normalizedRaw.match(LEGACY_LOREBOOK_TARGET_PATTERN);
    if (lorebookMatch?.[1]?.trim()) {
        const targetId = lorebookMatch[1].trim();
        return {
            kind: "content",
            targetId,
            canonicalTarget: normalizeWorkspaceReferenceTarget(targetId),
            legacy: true,
        };
    }

    const threadMatch = normalizedRaw.match(LEGACY_THREAD_TARGET_PATTERN);
    if (threadMatch?.[1]?.trim()) {
        const targetId = threadMatch[1].trim();
        return {
            kind: "thread",
            targetId,
            canonicalTarget: buildReferenceUri("thread", targetId),
            legacy: true,
        };
    }

    if (LEGACY_PENDING_TARGET_PATTERN.test(normalizedRaw)) {
        return null;
    }

    if (isStructuredWorkspaceReferenceTarget(normalizedRaw)) {
        const targetId = normalizeWorkspaceReferenceTarget(normalizedRaw);
        return {
            kind: "content",
            targetId,
            canonicalTarget: targetId,
            legacy: false,
        };
    }

    return null;
}

/**
 * 判断 URI kind 是否是 structured refs 允许的协议型目标。
 */
function isStructuredUriKind(kind: ReferenceKind): kind is Extract<StructuredReferenceKind, ReferenceKind> {
    return kind === "thread" || kind === "scene";
}

/**
 * 判断 structured ref target 是否是 workspace 相对路径。
 */
function isStructuredWorkspaceReferenceTarget(raw: string): boolean {
    if (!raw || raw.startsWith("/") || raw.startsWith("#")) {
        return false;
    }
    if (WORKSPACE_REFERENCE_SCHEME_PATTERN.test(raw)) {
        return false;
    }
    return true;
}

/**
 * 规范化 workspace 相对路径 target。
 */
function normalizeWorkspaceReferenceTarget(raw: string): string {
    return raw.trim().replace(/\\/g, "/");
}
