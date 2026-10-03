import type {Definition, Image, ImageReference, Nodes, Root} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import {toMarkdown} from "mdast-util-to-markdown";
import type {AttachmentId} from "nbook/shared/dto/agent-attachment.dto";

const ATTACHMENT_ID_PATTERN = /^sha256:([0-9a-f]{64})$/u;
const ATTACHMENT_TARGET_PATTERN = /^workspace\/\.nbook\/agent\/attachments\/sha256\/([0-9a-f]{2})\/([0-9a-f]{62})$/u;

/** Agent 正文中保留原始文本或解析后的 Markdown 图片。 */
export type AgentImageMarkdownPart =
    | {
        type: "text";
        text: string;
    }
    | {
        type: "image";
        label: string;
        target: string;
        raw: string;
    };

type ImageOccurrence = {
    start: number;
    end: number;
    label: string;
    target: string;
};

/**
 * 使用 CommonMark mdast 解析图片节点，同时逐字符保留图片之外的原始源码。
 *
 * code、inlineCode 与 HTML block 没有图片子节点，因此不会被误判；引用式图片通过
 * definition 解析目标，但 definition 本身仍作为普通原始文本保留。
 */
export function parseAgentImageMarkdown(value: string): AgentImageMarkdownPart[] {
    if (!value) {
        return [{type: "text", text: value}];
    }
    const tree = fromMarkdown(value);
    const definitions = collectDefinitions(tree);
    const occurrences = collectImages(tree, definitions)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    if (occurrences.length === 0) {
        return [{type: "text", text: value}];
    }

    const parts: AgentImageMarkdownPart[] = [];
    let cursor = 0;
    for (const occurrence of occurrences) {
        if (occurrence.start < cursor) {
            continue;
        }
        if (occurrence.start > cursor) {
            parts.push({type: "text", text: value.slice(cursor, occurrence.start)});
        }
        parts.push({
            type: "image",
            label: occurrence.label,
            target: normalizeMarkdownTarget(occurrence.target),
            raw: value.slice(occurrence.start, occurrence.end),
        });
        cursor = occurrence.end;
    }
    if (cursor < value.length) {
        parts.push({type: "text", text: value.slice(cursor)});
    }
    return parts.length > 0 ? parts : [{type: "text", text: value}];
}

/** 使用 mdast serializer 生成可重新解析的 canonical inline image Markdown。 */
export function serializeAgentImageMarkdown(label: string, target: string): string {
    const image: Image = {
        type: "image",
        alt: label,
        url: normalizeMarkdownTarget(target),
        title: null,
    };
    return toMarkdown(image).replace(/\r?\n$/u, "");
}

/** Attachment ID 对应的唯一 Workspace Root `.nbook` Markdown 目标。 */
export function attachmentMarkdownTarget(id: AttachmentId): string {
    const matched = ATTACHMENT_ID_PATTERN.exec(id);
    if (!matched?.[1]) {
        throw new Error("Attachment ID 非法");
    }
    return `workspace/.nbook/agent/attachments/sha256/${matched[1].slice(0, 2)}/${matched[1].slice(2)}`;
}

/** 从稳定 Markdown 目标解析 Attachment ID；其它 File Address 返回 null。 */
export function attachmentIdFromMarkdownTarget(target: string): AttachmentId | null {
    const matched = ATTACHMENT_TARGET_PATTERN.exec(normalizeMarkdownTarget(target));
    if (!matched?.[1] || !matched[2]) {
        return null;
    }
    return `sha256:${matched[1]}${matched[2]}` as AttachmentId;
}

/** 收集 definition；identifier 已由 micromark 按 CommonMark 规则规范化。 */
function collectDefinitions(tree: Root): Map<string, Definition> {
    const result = new Map<string, Definition>();
    walk(tree, (node) => {
        if (node.type === "definition" && !result.has(node.identifier)) {
            result.set(node.identifier, node);
        }
    });
    return result;
}

/** 收集带精确 source offset 的 inline/reference 图片。 */
function collectImages(tree: Root, definitions: ReadonlyMap<string, Definition>): ImageOccurrence[] {
    const result: ImageOccurrence[] = [];
    walk(tree, (node) => {
        if (node.type !== "image" && node.type !== "imageReference") {
            return;
        }
        const position = node.position;
        const start = position?.start.offset;
        const end = position?.end.offset;
        if (start === undefined || end === undefined || end <= start) {
            return;
        }
        if (node.type === "image") {
            result.push({
                start,
                end,
                label: node.alt ?? "",
                target: node.url,
            });
            return;
        }
        const definition = definitions.get((node as ImageReference).identifier);
        if (!definition) {
            return;
        }
        result.push({
            start,
            end,
            label: node.alt ?? "",
            target: definition.url,
        });
    });
    return result;
}

/** 轻量遍历 mdast；本模块只需要节点与 children，不引入额外 visit 依赖。 */
function walk(node: Nodes, visit: (node: Nodes) => void): void {
    visit(node);
    if (!("children" in node)) {
        return;
    }
    for (const child of node.children) {
        walk(child, visit);
    }
}

/** 将 Markdown destination 规范成跨平台、可持久化的正斜杠路径。 */
function normalizeMarkdownTarget(value: string): string {
    return value.trim().replace(/\\/gu, "/");
}
