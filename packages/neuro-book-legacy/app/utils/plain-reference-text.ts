import {parseReferenceUri} from "nbook/shared/reference-core";
import {buildSelectionRefChip, readSelectionRefChipAt, type InlineEditReferenceRange} from "nbook/app/utils/inline-editor-selection";
import {parseAgentImageMarkdown, serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";

export interface PlainReferenceNodeAttrs {
    label: string;
    target: string;
}

export interface PlainSkillNodeAttrs {
    name: string;
}

export interface PlainImageNodeAttrs {
    label: string;
    target: string;
    attachmentId?: string;
    mimeType?: string;
    bytes?: number;
    name?: string;
    locatorEntryId?: string;
    locatorContentIndex?: number;
}

export interface PlainPendingImageNodeAttrs {
    uploadId: string;
    name: string;
    status: "uploading" | "failed";
    error?: string;
}

export interface PlainSelectionReferenceNodeAttrs {
    label: string;
    target: string;
    ref: string;
    startLine?: string;
    endLine?: string;
}

export interface PlainTextProseMirrorNode {
    type: string;
    text?: string;
    attrs?: Record<string, string | number | null>;
    content?: PlainTextProseMirrorNode[];
}

export interface PlainTextToken {
    kind: "text" | "reference" | "skill" | "selection" | "image";
    raw: string;
    reference?: PlainReferenceNodeAttrs;
    skill?: PlainSkillNodeAttrs;
    selection?: PlainSelectionReferenceNodeAttrs;
    image?: PlainImageNodeAttrs;
}

const SKILL_PATTERN = /(^|[\s(])(\$(?:([\p{L}_-][\p{L}\p{N}_-]*)|\{([\p{L}_-][\p{L}\p{N}_-]*)\}))/gu;
const WORKSPACE_REFERENCE_PREFIXES = [
    "agents/",
    "assets/",
    "docs/",
    "lorebook/",
    "manuscript/",
    "reference/",
    "simulation/",
    "workspace/",
    ".agent/",
    ".nbook/agent/",
];

/**
 * 将普通文本解析成 plain reference editor 使用的 ProseMirror doc。
 */
export function parsePlainReferenceText(value: string): PlainTextProseMirrorNode {
    return {
        type: "doc",
        content: tokensToParagraphs(tokenizePlainReferenceText(value)).map((content) => ({
            type: "paragraph",
            content,
        })),
    };
}

/**
 * 将普通文本解析成可直接插入当前光标的 inline content。
 */
export function parsePlainReferenceInlineContent(value: string): PlainTextProseMirrorNode[] {
    return tokensToInlineNodes(tokenizePlainReferenceText(value));
}

/**
 * 将 plain reference editor 的 ProseMirror doc 序列化回普通文本。
 */
export function serializePlainReferenceDoc(doc: PlainTextProseMirrorNode): string {
    if (doc.type === "doc") {
        return (doc.content ?? []).map(serializePlainReferenceDoc).join("\n");
    }
    if (doc.type === "paragraph") {
        return (doc.content ?? []).map(serializePlainReferenceDoc).join("");
    }
    if (doc.type === "text") {
        return doc.text ?? "";
    }
    if (doc.type === "hardBreak") {
        return "\n";
    }
    if (doc.type === "plainReference") {
        const label = String(doc.attrs?.label ?? "");
        const target = String(doc.attrs?.target ?? "");
        return label && target ? `[${label}](${serializeReferenceTarget(target)})` : "";
    }
    if (doc.type === "plainSelectionReference") {
        const target = String(doc.attrs?.target ?? "");
        const startLine = Number(doc.attrs?.startLine ?? "");
        const endLine = Number(doc.attrs?.endLine ?? "");
        const range = Number.isInteger(startLine) && startLine > 0 && Number.isInteger(endLine) && endLine >= startLine
            ? {startLine, endLine}
            : undefined;
        return target ? buildSelectionRefChip({path: target, range}) : "";
    }
    if (doc.type === "agentSkill") {
        const name = String(doc.attrs?.name ?? "");
        return name ? `$${name}` : "";
    }
    if (doc.type === "plainImage") {
        const label = String(doc.attrs?.label ?? "");
        const target = String(doc.attrs?.target ?? "");
        return target ? serializeAgentImageMarkdown(label, target) : "";
    }
    if (doc.type === "plainPendingImage") {
        // pending File 不属于草稿或正文真相；上传完成后才替换为稳定 Markdown。
        return "";
    }
    return (doc.content ?? []).map(serializePlainReferenceDoc).join("");
}

/**
 * 把普通文本切分成文本、系统引用和 skill token。
 */
export function tokenizePlainReferenceText(value: string): PlainTextToken[] {
    const imageMatches = collectImageMatches(value);
    const selectionMatches = collectSelectionMatches(value);
    const referenceMatches = collectReferenceMatches(value, [...imageMatches, ...selectionMatches]);
    const occupiedMatches = [...imageMatches, ...selectionMatches, ...referenceMatches];
    const skillMatches = collectSkillMatches(value, occupiedMatches);
    const matches = [...occupiedMatches, ...skillMatches].sort((left, right) => left.start - right.start);
    const tokens: PlainTextToken[] = [];
    let cursor = 0;

    for (const match of matches) {
        if (match.start < cursor) {
            continue;
        }
        if (match.start > cursor) {
            const raw = value.slice(cursor, match.start);
            tokens.push({kind: "text", raw});
        }
        tokens.push(match.token);
        cursor = match.end;
    }

    if (cursor < value.length) {
        tokens.push({kind: "text", raw: value.slice(cursor)});
    }
    return tokens;
}

function tokenToNode(token: PlainTextToken): PlainTextProseMirrorNode | null {
            if (token.kind === "text") {
                return token.raw ? {type: "text", text: token.raw} : null;
            }
            if (token.kind === "reference" && token.reference) {
                return {
                    type: "plainReference",
                    attrs: {
                        label: token.reference.label,
                        target: token.reference.target,
                    },
                };
            }
            if (token.kind === "selection" && token.selection) {
                return {
                    type: "plainSelectionReference",
                    attrs: {
                        label: token.selection.label,
                        target: token.selection.target,
                        ref: token.selection.ref,
                        ...(token.selection.startLine ? {startLine: token.selection.startLine} : {}),
                        ...(token.selection.endLine ? {endLine: token.selection.endLine} : {}),
                    },
                };
            }
            if (token.kind === "skill" && token.skill) {
                return {
                    type: "agentSkill",
                    attrs: {
                        name: token.skill.name,
                    },
                };
            }
            if (token.kind === "image" && token.image) {
                return {
                    type: "plainImage",
                    attrs: {
                        label: token.image.label,
                        target: token.image.target,
                    },
                };
            }
            return null;
}

function tokensToParagraphs(tokens: PlainTextToken[]): PlainTextProseMirrorNode[][] {
    const paragraphs: PlainTextProseMirrorNode[][] = [[]];
    for (const token of tokens) {
        if (token.kind !== "text" || !token.raw.includes("\n")) {
            const node = tokenToNode(token);
            if (node) {
                paragraphs.at(-1)?.push(node);
            }
            continue;
        }
        const lines = token.raw.split("\n");
        lines.forEach((line, index) => {
            if (line) {
                paragraphs.at(-1)?.push({type: "text", text: line});
            }
            if (index < lines.length - 1) {
                paragraphs.push([]);
            }
        });
    }
    return paragraphs;
}

function tokensToInlineNodes(tokens: PlainTextToken[]): PlainTextProseMirrorNode[] {
    const nodes: PlainTextProseMirrorNode[] = [];
    for (const token of tokens) {
        if (token.kind !== "text" || !token.raw.includes("\n")) {
            const node = tokenToNode(token);
            if (node) {
                nodes.push(node);
            }
            continue;
        }
        const lines = token.raw.split("\n");
        lines.forEach((line, index) => {
            if (line) {
                nodes.push({type: "text", text: line});
            }
            if (index < lines.length - 1) {
                nodes.push({type: "hardBreak"});
            }
        });
    }
    return nodes;
}

interface TokenMatch {
    start: number;
    end: number;
    token: PlainTextToken;
}

function collectImageMatches(value: string): TokenMatch[] {
    const matches: TokenMatch[] = [];
    let cursor = 0;
    for (const part of parseAgentImageMarkdown(value)) {
        if (part.type === "text") {
            cursor += part.text.length;
            continue;
        }
        matches.push({
            start: cursor,
            end: cursor + part.raw.length,
            token: {
                kind: "image",
                raw: part.raw,
                image: {
                    label: part.label,
                    target: part.target,
                },
            },
        });
        cursor += part.raw.length;
    }
    return matches;
}

function collectSelectionMatches(value: string): TokenMatch[] {
    const matches: TokenMatch[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        const chip = readSelectionRefChipAt(value, cursor);
        if (!chip) {
            cursor += 1;
            continue;
        }
        const range = chip.range;
        matches.push({
            start: cursor,
            end: cursor + chip.raw.length,
            token: {
                kind: "selection",
                raw: chip.raw,
                selection: {
                    label: chip.label,
                    target: chip.path,
                    ref: chip.ref,
                    ...rangeToAttrs(range),
                },
            },
        });
        cursor += chip.raw.length;
    }
    return matches;
}

function collectReferenceMatches(value: string, occupiedMatches: TokenMatch[]): TokenMatch[] {
    const matches: TokenMatch[] = [];
    for (const matched of collectMarkdownLinkMatches(value)) {
        if (isInsideToken(matched.start, occupiedMatches)) {
            continue;
        }
        const reference = resolveReferenceToken(matched);
        if (!reference) {
            continue;
        }
        matches.push({
            start: matched.start,
            end: matched.end,
            token: {
                kind: "reference",
                raw: matched.raw,
                reference,
            },
        });
    }
    return matches;
}

function rangeToAttrs(range: InlineEditReferenceRange | undefined): Pick<PlainSelectionReferenceNodeAttrs, "startLine" | "endLine"> {
    if (!range) {
        return {};
    }
    return {
        startLine: String(range.startLine),
        endLine: String(range.endLine),
    };
}

function collectSkillMatches(value: string, referenceMatches: TokenMatch[]): TokenMatch[] {
    const matches: TokenMatch[] = [];
    for (const matched of value.matchAll(SKILL_PATTERN)) {
        const prefix = matched[1] ?? "";
        const raw = matched[2] ?? "";
        const start = (matched.index ?? -1) + prefix.length;
        const name = matched[3] ?? matched[4] ?? "";
        if (start < 0 || !raw || !name || isInsideToken(start, referenceMatches)) {
            continue;
        }
        matches.push({
            start,
            end: start + raw.length,
            token: {
                kind: "skill",
                raw,
                skill: {name},
            },
        });
    }
    return matches;
}

interface MarkdownLinkMatch {
    start: number;
    end: number;
    raw: string;
    label: string;
    target: string;
}

function collectMarkdownLinkMatches(value: string): MarkdownLinkMatch[] {
    const matches: MarkdownLinkMatch[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        const start = value.indexOf("[", cursor);
        if (start < 0) {
            break;
        }
        const delimiter = value.indexOf("](", start + 1);
        if (delimiter < 0) {
            break;
        }
        const close = value.indexOf(")", delimiter + 2);
        if (close < 0) {
            break;
        }

        const label = value.slice(start + 1, delimiter).trim();
        const target = value.slice(delimiter + 2, close).trim();
        if (label && target && !/\s/.test(target)) {
            matches.push({
                start,
                end: close + 1,
                raw: value.slice(start, close + 1),
                label,
                target,
            });
            cursor = close + 1;
            continue;
        }
        cursor = start + 1;
    }
    return matches;
}

function resolveReferenceToken(link: MarkdownLinkMatch): PlainReferenceNodeAttrs | null {
    const domainReference = parseReferenceUri(link.target);
    if (domainReference) {
        return {
            label: link.label,
            target: `${domainReference.kind}://${domainReference.targetId}`,
        };
    }

    if (!isSystemWorkspaceReferenceTarget(link.target)) {
        return null;
    }
    return {
        label: link.label,
        target: link.target,
    };
}

function isSystemWorkspaceReferenceTarget(target: string): boolean {
    const normalized = normalizeWorkspaceTarget(target);
    if (!isSafeRelativeWorkspaceTarget(normalized)) {
        return false;
    }
    if (parseReferenceUri(normalized)) {
        return true;
    }
    return WORKSPACE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function serializeReferenceTarget(target: string): string {
    const normalized = normalizeWorkspaceTarget(target);
    if (!isSafeRelativeWorkspaceTarget(normalized)) {
        return target;
    }
    if (parseReferenceUri(normalized) || WORKSPACE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
        return normalized;
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(normalized)) {
        return normalized;
    }
    return `workspace/${normalized}`;
}

function normalizeWorkspaceTarget(target: string): string {
    return target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeRelativeWorkspaceTarget(target: string): boolean {
    return Boolean(target) && !target.startsWith("/") && !target.includes("..") && !/\s/u.test(target);
}

function isInsideToken(position: number, matches: TokenMatch[]): boolean {
    return matches.some((match) => position >= match.start && position < match.end);
}
