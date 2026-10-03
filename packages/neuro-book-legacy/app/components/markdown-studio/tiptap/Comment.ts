import {Mark, mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import type {Mark as ProseMirrorMark, Node as ProseMirrorNode} from "@tiptap/pm/model";
import {Plugin, PluginKey, type EditorState} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import {
    findMarkdownBlockTagStart,
    parseMarkdownCommentBlock,
    parseMarkdownCommentInline,
    renderMarkdownCommentBlock,
    renderMarkdownCommentInline,
} from "nbook/shared/markdown-workbench";

interface CommentInlineToken extends MarkdownToken {
    id?: string | null;
    body?: string;
    text?: string;
    tokens?: MarkdownToken[];
}

interface CommentBlockToken extends MarkdownToken {
    id?: string | null;
    body?: string;
    text?: string;
    tokens?: MarkdownToken[];
}

export interface CommentRange {
    from: number;
    to: number;
    body: string;
    text: string;
}

/**
 * 文档中一条评论的统一视图。
 * kind=inline 来自行内 comment mark（可能由多个相邻/同 id 的 range 聚合）；
 * kind=block 来自跨段落的 commentBlock 节点，ranges 恒为整个节点范围。
 */
export interface CommentItem {
    index: number;
    kind: "inline" | "block";
    id: string | null;
    from: number;
    to: number;
    body: string;
    text: string;
    active: boolean;
    ranges: CommentRange[];
}

interface CommentOptions {
    onSelect: (index: number) => void;
    /** 评论列表实质变化（含 active 变化）时回调；identity 不变则不会触发 */
    onCommentsChange: (comments: CommentItem[]) => void;
}

interface CommentPluginState {
    activeIndex: number | null;
    comments: CommentItem[];
    decorations: DecorationSet;
}

export const COMMENT_PLUGIN_KEY = new PluginKey<CommentPluginState>("nb-comment");

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        comment: {
            setComment: (body: string, id?: string | null) => ReturnType;
            unsetComment: () => ReturnType;
        };
        commentBlock: {
            setCommentBlock: (body: string, id?: string | null) => ReturnType;
            unsetCommentBlock: () => ReturnType;
        };
    }
}

/**
 * 行内评论 mark，Markdown 序列化为 <comment body="...">正文</comment>。
 * 解析时兼容旧 <inline-comment> 标签，保存统一输出 <comment>。
 * 评论列表与高亮 decoration 缓存在 ProseMirror 插件状态中：
 * 文档变化才全量重扫，光标移动只重算 active 标志，避免每次按键多遍全文遍历。
 */
export const Comment = Mark.create<CommentOptions>({
    name: "comment",
    priority: 780,
    inclusive: false,

    addOptions() {
        return {
            onSelect: () => {},
            onCommentsChange: () => {},
        };
    },

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute("id"),
                renderHTML: (attributes) => attributes.id ? {id: attributes.id} : {},
            },
            body: {
                default: "",
                parseHTML: (element: HTMLElement) => element.getAttribute("body") ?? "",
                renderHTML: (attributes) => ({body: attributes.body ?? ""}),
            },
        };
    },

    parseHTML() {
        return [
            {tag: "comment", getAttrs: readCommentDomAttrs},
            {tag: "inline-comment", getAttrs: readCommentDomAttrs},
        ];
    },

    renderHTML({HTMLAttributes}) {
        return ["comment", mergeAttributes(HTMLAttributes), 0];
    },

    markdownTokenizer: {
        name: "comment",
        level: "inline",
        start(src: string) {
            return earliestIndex(src.indexOf("<comment"), src.indexOf("<inline-comment"));
        },
        tokenize(src: string, _tokens: unknown, lexer: {inlineTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownCommentInline(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "comment",
                raw: parsed.raw,
                id: parsed.id,
                body: parsed.body,
                text: parsed.text,
                tokens: lexer.inlineTokens(parsed.text),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const commentToken = token as CommentInlineToken;
        return helpers.applyMark("comment", helpers.parseInline(commentToken.tokens ?? []), {
            id: commentToken.id ?? null,
            body: commentToken.body ?? "",
        });
    },

    renderMarkdown: (node, helpers) => {
        return renderMarkdownCommentInline(
            {
                id: normalizeCommentId(node.attrs?.id),
                body: String(node.attrs?.body ?? ""),
            },
            helpers.renderChildren(node),
        );
    },

    addCommands() {
        return {
            setComment: (body: string, id: string | null = null) => ({commands}) => commands.setMark(this.name, {id, body}),
            unsetComment: () => ({commands}) => commands.unsetMark(this.name),
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;
        return [new Plugin<CommentPluginState>({
            key: COMMENT_PLUGIN_KEY,
            state: {
                init: (_config, state): CommentPluginState => {
                    const comments = collectComments(state.doc, state.selection.from, state.selection.to);
                    return {
                        activeIndex: null,
                        comments,
                        decorations: buildCommentDecorations(state.doc, comments, null),
                    };
                },
                apply: (transaction, previous, oldState, newState) => {
                    const meta = transaction.getMeta(COMMENT_PLUGIN_KEY) as Partial<CommentPluginState> | undefined;
                    const activeIndex = meta && Object.hasOwn(meta, "activeIndex")
                        ? (meta.activeIndex ?? null)
                        : previous.activeIndex;
                    const selectionChanged = !newState.selection.eq(oldState.selection);
                    if (!transaction.docChanged && !selectionChanged && activeIndex === previous.activeIndex) {
                        return previous;
                    }

                    const nextComments = resolveNextComments(previous.comments, newState, transaction.docChanged);
                    if (nextComments === previous.comments && activeIndex === previous.activeIndex && !transaction.docChanged) {
                        return previous;
                    }
                    return {
                        activeIndex,
                        comments: nextComments,
                        decorations: buildCommentDecorations(newState.doc, nextComments, activeIndex),
                    };
                },
            },
            view: () => ({
                update: (view, prevState) => {
                    const previous = COMMENT_PLUGIN_KEY.getState(prevState);
                    const next = COMMENT_PLUGIN_KEY.getState(view.state);
                    if (!next || previous?.comments === next.comments) {
                        return;
                    }
                    options.onCommentsChange(next.comments);
                },
            }),
            props: {
                decorations: (state) => COMMENT_PLUGIN_KEY.getState(state)?.decorations ?? DecorationSet.empty,
                handleClick: (view, position, event) => {
                    if (!event.ctrlKey) {
                        return false;
                    }
                    const comments = COMMENT_PLUGIN_KEY.getState(view.state)?.comments ?? [];
                    const target = event.target as HTMLElement | null;
                    const targetIndex = Number(target?.closest("[data-inline-comment-index]")?.getAttribute("data-inline-comment-index") ?? 0);
                    const matched = comments.find((comment) => comment.index === targetIndex)
                        ?? comments.find((comment) => position >= comment.from && position <= comment.to);
                    if (!matched) {
                        return false;
                    }
                    event.preventDefault();
                    view.dispatch(view.state.tr.setMeta(COMMENT_PLUGIN_KEY, {activeIndex: matched.index}));
                    options.onSelect(matched.index);
                    return true;
                },
            },
        })];
    },
});

/**
 * 跨段落评论块，Markdown 序列化为开闭标签独立成行的 <comment>：
 *
 * <comment body="...">
 * 多个段落
 * </comment>
 */
export const CommentBlock = Node.create<{}, {}>({
    name: "commentBlock",
    group: "block",
    content: "block+",
    defining: true,
    priority: 890,

    addAttributes() {
        return {
            id: {
                default: null,
            },
            body: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "div[data-comment-body]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    id: element.getAttribute("data-comment-id"),
                    body: element.getAttribute("data-comment-body") ?? "",
                };
            },
        }];
    },

    renderHTML({node, HTMLAttributes}) {
        return ["div", mergeAttributes(HTMLAttributes, {
            class: "nb-comment-block",
            "data-comment-body": String(node.attrs.body ?? ""),
            ...(node.attrs.id ? {"data-comment-id": String(node.attrs.id)} : {}),
        }), 0];
    },

    markdownTokenizer: {
        name: "commentBlock",
        level: "block",
        start(src: string) {
            // 只在「行首开标签 + 开标签后换行」的块级形态处中断段落，
            // 行内 <comment>x</comment> 用法交给 inline tokenizer，避免拆散句子。
            return findMarkdownBlockTagStart(src, "comment");
        },
        tokenize(src: string, _tokens: unknown, lexer: {blockTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownCommentBlock(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "commentBlock",
                raw: parsed.raw,
                id: parsed.id,
                body: parsed.body,
                text: parsed.text,
                tokens: lexer.blockTokens(parsed.text),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const blockToken = token as CommentBlockToken;
        return helpers.createNode("commentBlock", {
            id: blockToken.id ?? null,
            body: blockToken.body ?? "",
        }, helpers.parseChildren(blockToken.tokens ?? []));
    },

    renderMarkdown: (node, helpers) => {
        return renderMarkdownCommentBlock({
            id: normalizeCommentId(node.attrs?.id),
            body: String(node.attrs?.body ?? ""),
        }, helpers.renderChildren(node, "\n\n"));
    },

    addCommands() {
        return {
            setCommentBlock: (body: string, id: string | null = null) => ({commands}) => commands.wrapIn(this.name, {id, body}),
            unsetCommentBlock: () => ({commands}) => commands.lift(this.name),
        };
    },
});

/**
 * 按文档顺序收集全部评论：行内 mark（含旧数据同 id 多段聚合）与块级 commentBlock 节点。
 */
export function collectComments(doc: ProseMirrorNode, selectionFrom: number, selectionTo: number): CommentItem[] {
    const comments: CommentItem[] = [];
    const commentsById = new Map<string, CommentItem>();
    doc.descendants((node, position) => {
        if (node.type.name === "commentBlock") {
            const from = position;
            const to = position + node.nodeSize;
            const body = String(node.attrs?.body ?? "");
            comments.push({
                index: comments.length + 1,
                kind: "block",
                id: normalizeCommentId(node.attrs?.id),
                from,
                to,
                body,
                text: node.textContent,
                active: isCommentActive(from, to, selectionFrom, selectionTo),
                ranges: [{from, to, body, text: node.textContent}],
            });
            return true;
        }
        if (!node.isInline) {
            return;
        }
        const mark = findCommentMark(node.marks);
        if (!mark) {
            return;
        }
        const from = position;
        const to = position + node.nodeSize;
        const id = normalizeCommentId(mark.attrs?.id);
        const body = String(mark.attrs?.body ?? "");
        const text = node.isText ? (node.text ?? "") : node.type.name === "hardBreak" ? "\n" : node.textContent;
        const active = isCommentActive(from, to, selectionFrom, selectionTo);
        if (id) {
            const existing = commentsById.get(id);
            if (existing) {
                const previousTo = existing.to;
                appendCommentRange(existing, {from, to, body, text});
                existing.to = Math.max(previousTo, to);
                existing.text += text;
                existing.active = existing.active || active;
                if (!existing.body && body) {
                    existing.body = body;
                }
                return;
            }
            const comment = createCommentItem(comments.length + 1, id, {from, to, body, text}, active);
            comments.push(comment);
            commentsById.set(id, comment);
            return;
        }

        const previous = comments[comments.length - 1];
        if (previous && previous.kind === "inline" && previous.id === null && previous.body === body && previous.to === from) {
            appendCommentRange(previous, {from, to, body, text});
            previous.to = to;
            previous.text += text;
            previous.active = previous.active || active;
            return;
        }

        comments.push(createCommentItem(comments.length + 1, null, {from, to, body, text}, active));
    });
    return comments;
}

/**
 * 文档未变时只基于缓存 ranges 重算 active，避免全文遍历；
 * 文档变化时全量重扫，但列表实质未变则保留旧数组 identity（供变更通知去重）。
 */
function resolveNextComments(previous: CommentItem[], state: EditorState, docChanged: boolean): CommentItem[] {
    const {from, to} = state.selection;
    if (!docChanged) {
        let changed = false;
        const next = previous.map((comment) => {
            const active = comment.ranges.some((range) => isCommentActive(range.from, range.to, from, to));
            if (active === comment.active) {
                return comment;
            }
            changed = true;
            return {...comment, active};
        });
        return changed ? next : previous;
    }
    const rebuilt = collectComments(state.doc, from, to);
    return commentListEquals(previous, rebuilt) ? previous : rebuilt;
}

/**
 * 根据评论列表构建高亮 decoration：行内逐 range 标注，块级整节点标注。
 */
function buildCommentDecorations(doc: ProseMirrorNode, comments: CommentItem[], activeIndex: number | null): DecorationSet {
    const decorations: Decoration[] = [];
    for (const comment of comments) {
        const active = comment.active || comment.index === activeIndex;
        if (comment.kind === "block") {
            decorations.push(Decoration.node(comment.from, comment.to, {
                class: active ? "is-active" : "",
                "data-inline-comment-index": String(comment.index),
            }));
            continue;
        }
        for (const range of comment.ranges) {
            decorations.push(Decoration.inline(range.from, range.to, {
                class: active ? "nb-inline-comment-mark is-active" : "nb-inline-comment-mark",
                "data-inline-comment-index": String(comment.index),
            }));
        }
    }
    return DecorationSet.create(doc, decorations);
}

function commentListEquals(a: CommentItem[], b: CommentItem[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        const x = a[index]!;
        const y = b[index]!;
        if (x.kind !== y.kind || x.id !== y.id || x.from !== y.from || x.to !== y.to
            || x.body !== y.body || x.text !== y.text || x.active !== y.active
            || x.ranges.length !== y.ranges.length) {
            return false;
        }
        for (let rangeIndex = 0; rangeIndex < x.ranges.length; rangeIndex += 1) {
            const rx = x.ranges[rangeIndex]!;
            const ry = y.ranges[rangeIndex]!;
            if (rx.from !== ry.from || rx.to !== ry.to || rx.body !== ry.body || rx.text !== ry.text) {
                return false;
            }
        }
    }
    return true;
}

function readCommentDomAttrs(dom: HTMLElement | string): {id: string | null; body: string} {
    const element = dom as HTMLElement;
    return {
        id: element.getAttribute("id"),
        body: element.getAttribute("body") ?? "",
    };
}

function earliestIndex(a: number, b: number): number {
    if (a < 0) {
        return b;
    }
    if (b < 0) {
        return a;
    }
    return Math.min(a, b);
}

function findCommentMark(marks: readonly ProseMirrorMark[]): ProseMirrorMark | null {
    return marks.find((mark) => mark.type.name === "comment") ?? null;
}

function isCommentActive(from: number, to: number, selectionFrom: number, selectionTo: number): boolean {
    if (selectionFrom === selectionTo) {
        return selectionFrom >= from && selectionFrom <= to;
    }
    return selectionFrom < to && selectionTo > from;
}

function normalizeCommentId(value: unknown): string | null {
    const id = String(value ?? "").trim();
    return id ? id : null;
}

function createCommentItem(index: number, id: string | null, range: CommentRange, active: boolean): CommentItem {
    return {
        index,
        kind: "inline",
        id,
        from: range.from,
        to: range.to,
        body: range.body,
        text: range.text,
        active,
        ranges: [{...range}],
    };
}

function appendCommentRange(comment: CommentItem, range: CommentRange): void {
    const previous = comment.ranges[comment.ranges.length - 1];
    if (previous && previous.to === range.from && previous.body === range.body) {
        previous.to = range.to;
        previous.text += range.text;
        return;
    }
    comment.ranges.push({...range});
}
