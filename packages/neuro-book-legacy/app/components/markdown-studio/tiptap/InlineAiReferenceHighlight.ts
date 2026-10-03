import {Extension, type Editor, type JSONContent} from "@tiptap/core";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {InlineEditReference, InlineEditReferenceTextRange} from "nbook/app/utils/inline-editor-selection";

/**
 * Inline AI 引用高亮模块。
 *
 * PromptBar 的引用 chip（用户框选正文加入 Inline AI 的引用）需要在编辑器里
 * 反向标记出对应文本：全部引用画基础标记，hover 中的引用叠加背景强调。
 * 定位策略三级回退：
 * 1. reference.text 精确文本匹配（chip 行号只用来缩小搜索范围）；
 * 2. 同一文档重复文本用记录的选区纯文本 offset 消歧（reference.textRange）；
 * 3. 文本匹配失败退回行号整块标记，避免引用提示完全消失。
 *
 * 装饰通过 plugin meta 全量替换；文档编辑时旧装饰随 mapping 平移，
 * 宿主在引用列表 / hover 目标 / 文件路径变化时调用 applyInlineAiReferenceHighlight。
 */

const PLUGIN_KEY = new PluginKey<DecorationSet>("inlineAiReferenceHighlight");

/** 装饰承载扩展：只存放/映射 DecorationSet，内容由 applyInlineAiReferenceHighlight 注入 */
export const InlineAiReferenceHighlight = Extension.create({
    name: "inlineAiReferenceHighlight",
    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: PLUGIN_KEY,
                state: {
                    init: () => DecorationSet.empty,
                    apply(transaction, decorationSet) {
                        const nextDecorationSet = transaction.getMeta(PLUGIN_KEY) as DecorationSet | undefined;
                        if (nextDecorationSet) {
                            return nextDecorationSet;
                        }
                        return transaction.docChanged
                            ? decorationSet.map(transaction.mapping, transaction.doc)
                            : decorationSet;
                    },
                },
                props: {
                    decorations(state) {
                        return PLUGIN_KEY.getState(state) ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});

export interface InlineAiReferenceHighlightInput {
    /** PromptBar 当前全部引用 */
    references: InlineEditReference[];
    /** hover 中的引用；null 时全部引用只画基础标记 */
    highlightedReference: InlineEditReference | null | undefined;
    /** 当前打开文件路径，属于其他文件的引用不画 */
    activePath: string;
    /** frontmatter 占据的源码行数（正文行号 = chip 行号 - 该值） */
    frontmatterLineOffset: number;
}

/**
 * 重算并全量替换编辑器里的引用装饰。
 */
export function applyInlineAiReferenceHighlight(editor: Editor, input: InlineAiReferenceHighlightInput): void {
    const decorations = buildReferenceDecorations(editor, input);
    editor.view.dispatch(editor.state.tr
        .setMeta(PLUGIN_KEY, decorations)
        .setMeta("addToHistory", false));
}

/**
 * 记录选区在正文纯文本中的 offset，解决同一文档重复文本的高亮歧义。
 * 宿主在把选区加入引用时调用，结果存进 reference.textRange。
 */
export function locateInlineAiSelectionTextRange(editor: Editor): InlineEditReferenceTextRange | undefined {
    const {from, to} = editor.state.selection;
    if (from === to) {
        return undefined;
    }
    const mappedText = buildTextMap(editor);
    const startOffset = firstTextOffsetAtOrAfter(mappedText.positions, from, to);
    const endOffset = lastTextOffsetBefore(mappedText.positions, from, to);
    if (startOffset === null || endOffset === null || startOffset >= endOffset) {
        return undefined;
    }
    return {startOffset, endOffset};
}

/**
 * 序列化从文档开头到指定 ProseMirror 位置的 Markdown 前缀（行号推导用）。
 */
export function serializeEditorPrefix(editor: Editor, position: number): string {
    const manager = editor.markdown;
    if (!manager) {
        return "";
    }
    const docSize = editor.state.doc.content.size;
    const safePosition = Number.isFinite(position) ? Math.floor(Math.min(Math.max(position, 0), docSize)) : 0;
    const prefixDoc = editor.state.doc.cut(0, safePosition);
    return manager.serialize(prefixDoc.toJSON() as JSONContent);
}

/**
 * 统计 Markdown 片段占用的行数；空前缀仍位于第 1 行。
 */
export function countMarkdownLines(markdown: string): number {
    if (!markdown) {
        return 1;
    }
    return markdown.replace(/\r\n/g, "\n").split("\n").length;
}

/**
 * 将所有引用映射成正文装饰；hover 中的引用额外叠加背景高亮。
 */
function buildReferenceDecorations(editor: Editor, input: InlineAiReferenceHighlightInput): DecorationSet {
    const decorations: Decoration[] = [];
    // 文本位置映射对整个文档只需构建一次，供全部引用的精确定位共用（O(全文)）
    const mappedText = buildTextMap(editor);

    for (const reference of input.references) {
        if (!referencePathMatches(reference.path, input.activePath)) {
            continue;
        }
        const highlighted = referenceEquals(reference, input.highlightedReference);
        const textRange = locateReferenceText(mappedText, reference, input.frontmatterLineOffset);
        if (textRange) {
            decorations.push(Decoration.inline(textRange.from, textRange.to, {
                class: highlighted
                    ? "nb-inline-ai-reference-mark nb-inline-ai-reference-highlight"
                    : "nb-inline-ai-reference-mark",
            }));
            continue;
        }
        decorations.push(...buildLineDecorations(editor, reference, highlighted, input.frontmatterLineOffset));
    }

    return DecorationSet.create(editor.state.doc, decorations);
}

/**
 * 优先用 reference.text 定位具体字符范围；chip 行号只用于缩小搜索范围。
 */
function locateReferenceText(mappedText: {text: string; positions: Array<number | null>}, reference: InlineEditReference, frontmatterLineOffset: number): {from: number; to: number} | null {
    const needle = normalizeReferenceText(reference.text);
    if (!needle) {
        return null;
    }

    const searchBounds = referenceSearchBounds(mappedText.text, reference, frontmatterLineOffset);
    const globalIndex = bestTextIndex(mappedText.text, needle, searchBounds, reference.textRange);
    if (globalIndex < 0) {
        return null;
    }

    const from = firstMappedPosition(mappedText.positions, globalIndex, globalIndex + needle.length);
    const to = lastMappedPosition(mappedText.positions, globalIndex, globalIndex + needle.length);
    if (from === null || to === null || from >= to) {
        return null;
    }
    return {from, to};
}

/**
 * 在重复文本中优先选择离原始选区 offset 最近的候选。
 */
function bestTextIndex(text: string, needle: string, bounds: {from: number; to: number}, preferredRange?: InlineEditReferenceTextRange): number {
    const boundedCandidates = collectTextIndexes(text, needle, bounds.from, bounds.to);
    if (boundedCandidates.length > 0) {
        return nearestTextIndex(boundedCandidates, preferredRange);
    }
    const globalCandidates = collectTextIndexes(text, needle, 0, text.length);
    if (globalCandidates.length === 0) {
        return -1;
    }
    return nearestTextIndex(globalCandidates, preferredRange);
}

/**
 * 收集 needle 在 [from, to) 内的全部出现位置。
 */
function collectTextIndexes(text: string, needle: string, from: number, to: number): number[] {
    const indexes: number[] = [];
    const safeFrom = Math.max(0, Math.min(from, text.length));
    const safeTo = Math.max(safeFrom, Math.min(to, text.length));
    let index = text.indexOf(needle, safeFrom);
    while (index >= 0 && index + needle.length <= safeTo) {
        indexes.push(index);
        index = text.indexOf(needle, index + Math.max(1, needle.length));
    }
    return indexes;
}

/**
 * 多个候选中取离原始选区 startOffset 最近的一个。
 */
function nearestTextIndex(indexes: number[], preferredRange?: InlineEditReferenceTextRange): number {
    if (!preferredRange) {
        return indexes[0] ?? -1;
    }
    const targetOffset = Math.max(0, Math.floor(preferredRange.startOffset));
    return indexes.reduce((nearest, candidate) => {
        return Math.abs(candidate - targetOffset) < Math.abs(nearest - targetOffset)
            ? candidate
            : nearest;
    }, indexes[0] ?? -1);
}

/**
 * 生成「正文纯文本 offset -> ProseMirror position」的映射，供精确 inline decoration 使用。
 * positions[i] 为 null 表示该字符（块间换行）没有对应的文档位置。
 */
function buildTextMap(editor: Editor): {text: string; positions: Array<number | null>} {
    const textParts: string[] = [];
    const positions: Array<number | null> = [];
    let firstBlock = true;

    editor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) {
            return;
        }
        if (!firstBlock) {
            textParts.push("\n");
            positions.push(null);
        }
        firstBlock = false;
        node.descendants((child, childPosition) => {
            if (!child.isText) {
                return;
            }
            const text = child.text ?? "";
            const absoluteStart = position + 1 + childPosition;
            for (let index = 0; index < text.length; index += 1) {
                textParts.push(text[index] ?? "");
                positions.push(absoluteStart + index);
            }
        });
    });

    return {text: textParts.join(""), positions};
}

/**
 * chip 行号换算成正文纯文本的搜索窗口；无行号时搜索全文。
 */
function referenceSearchBounds(text: string, reference: InlineEditReference, frontmatterLineOffset: number): {from: number; to: number} {
    if (!reference.range) {
        return {from: 0, to: text.length};
    }
    const bodyStartLine = Math.max(1, Math.floor(reference.range.startLine) - frontmatterLineOffset);
    const bodyEndLine = Math.max(bodyStartLine, Math.floor(reference.range.endLine) - frontmatterLineOffset);
    return {
        from: textOffsetAtLine(text, bodyStartLine),
        to: textOffsetAtLine(text, bodyEndLine + 1),
    };
}

/**
 * 求纯文本中指定行（1 起）的起始 offset。
 */
function textOffsetAtLine(text: string, line: number): number {
    if (line <= 1) {
        return 0;
    }
    let currentLine = 1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== "\n") {
            continue;
        }
        currentLine += 1;
        if (currentLine === line) {
            return index + 1;
        }
    }
    return text.length;
}

/**
 * [from, to) 文本区间内第一个有文档位置的字符的 position。
 */
function firstMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = from; index < to; index += 1) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position;
        }
    }
    return null;
}

/**
 * [from, to) 文本区间内最后一个有文档位置的字符的结束 position。
 */
function lastMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = to - 1; index >= from; index -= 1) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position + 1;
        }
    }
    return null;
}

/**
 * 文档位置区间 [fromPosition, toPosition) 内第一个字符的纯文本 offset。
 */
function firstTextOffsetAtOrAfter(positions: Array<number | null>, fromPosition: number, toPosition: number): number | null {
    for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index] ?? null;
        if (position !== null && position >= fromPosition && position < toPosition) {
            return index;
        }
    }
    return null;
}

/**
 * 文档位置区间 [fromPosition, toPosition) 内最后一个字符的纯文本结束 offset。
 */
function lastTextOffsetBefore(positions: Array<number | null>, fromPosition: number, toPosition: number): number | null {
    for (let index = positions.length - 1; index >= 0; index -= 1) {
        const position = positions[index] ?? null;
        if (position !== null && position >= fromPosition && position < toPosition) {
            return index + 1;
        }
    }
    return null;
}

/**
 * 精确文本无法匹配时，退回到行号文本块标记，避免引用提示完全消失。
 */
function buildLineDecorations(editor: Editor, reference: InlineEditReference, highlighted: boolean, frontmatterLineOffset: number): Decoration[] {
    if (!reference.range) {
        return [];
    }
    const targetStartLine = Math.max(1, Math.floor(reference.range.startLine));
    const targetEndLine = Math.max(targetStartLine, Math.floor(reference.range.endLine));
    const decorations: Decoration[] = [];

    editor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) {
            return;
        }
        const blockFrom = position + 1;
        const blockTo = position + node.nodeSize - 1;
        const blockStartLine = frontmatterLineOffset + countMarkdownLines(serializeEditorPrefix(editor, blockFrom));
        const blockEndLine = frontmatterLineOffset + countMarkdownLines(serializeEditorPrefix(editor, blockTo));
        if (blockEndLine < targetStartLine || blockStartLine > targetEndLine) {
            return;
        }
        decorations.push(Decoration.node(position, position + node.nodeSize, {
            class: highlighted
                ? "nb-inline-ai-reference-mark nb-inline-ai-reference-highlight"
                : "nb-inline-ai-reference-mark",
        }));
    });

    return decorations;
}

/**
 * 比较 PromptBar 引用路径和当前打开路径，兼容 Project Workspace 前缀差异。
 */
function referencePathMatches(referencePath: string, currentPath: string): boolean {
    const normalizedReferencePath = normalizeReferencePath(referencePath);
    const normalizedCurrentPath = normalizeReferencePath(currentPath);
    if (!normalizedReferencePath || !normalizedCurrentPath) {
        return false;
    }
    return normalizedReferencePath === normalizedCurrentPath
        || normalizedReferencePath.endsWith(`/${normalizedCurrentPath}`)
        || normalizedCurrentPath.endsWith(`/${normalizedReferencePath}`);
}

/**
 * 归一路径分隔符并去掉 ./ 与前导 / 前缀。
 */
function normalizeReferencePath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

/**
 * 归一引用文本换行并去除首尾空白。
 */
function normalizeReferenceText(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

/**
 * 引用相等判定：ref 标识 + 路径 + 文本三者一致。
 */
function referenceEquals(reference: InlineEditReference, other: InlineEditReference | null | undefined): boolean {
    if (!other) {
        return false;
    }
    return reference.ref === other.ref
        && reference.path === other.path
        && reference.text === other.text;
}
