import type { Ref } from "vue";
import type { CommentItem } from "nbook/app/components/markdown-studio/tiptap/Comment";
import { useTypewriterStream } from "nbook/app/composables/useTypewriterStream";

export type ActiveEditor = "source" | "preview" | null;
export type MarkdownStudioViewMode = "rich" | "source";
export type MarkdownStreamTarget = "append-document" | "insert-cursor" | "replace-selection";
export type MarkdownFormatCommand =
    | "paragraph"
    | "heading-2"
    | "heading-3"
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "code"
    | "bullet-list"
    | "ordered-list"
    | "blockquote"
    | "clear-format";

/**
 * 评论列表项：行内 mark 评论与块级 commentBlock 评论的统一视图，复用编辑器层定义（kind 区分形态）。
 */
export type MarkdownInlineCommentItem = CommentItem;

export interface MarkdownStreamChannel {
    append: (chunk: string) => void;
    finish: () => void;
    abort: () => void;
}

export interface MarkdownStreamOptions {
    target: MarkdownStreamTarget;
    prependParagraphBreak?: boolean;
}

/**
 * 编辑器句柄接口。
 */
export type MarkdownStudioEditorHandle = {
    update: (markdown: string) => void;
    focus: () => void;
    scrollToTop?: () => void;
    undo?: () => void;
    redo?: () => void;
    getValue?: () => string;
    /** 有未结算的防抖输入时立即上报（无 pending 则 no-op）；切文件 / 磁盘同步前由 store 钩子触发 */
    flushPendingChange?: () => void;
    insertMarkdown?: (markdown: string) => void;
    replaceSelection?: (markdown: string) => void;
    appendMarkdown?: (markdown: string) => void;
    /** 在指定文档位置插入 Markdown（生图插画"插在选区之后"用）。 */
    insertMarkdownAt?: (pos: number, markdown: string) => void;
    addComment?: (body: string) => void;
    getInlineComments?: () => MarkdownInlineCommentItem[];
    selectInlineComment?: (index: number) => void;
    activateInlineComment?: (index: number) => void;
    updateInlineComment?: (index: number, body: string) => void;
    deleteInlineComment?: (index: number) => void;
    setAlign?: (align: "left" | "center" | "right" | "justify") => void;
    applyMarkdownFormat?: (command: MarkdownFormatCommand) => void;
};

type UseMarkdownStudioControllerOptions = {
    markdown: Ref<string>;
    viewMode: Ref<MarkdownStudioViewMode>;
    typewriterIntervalMs?: number;
    typewriterChunkSize?: number;
    initialStatusText?: string;
};

/**
 * Markdown Studio 控制器接口。
 */
export type MarkdownStudioController = ReturnType<typeof useMarkdownStudioController>;

/**
 * 负责协调源码区、预览区和流式打字机。
 * 这套实现只维护一份 Markdown 真状态，父层显式调用两个编辑器的 update() 完成同步。
 */
export const useMarkdownStudioController = (options: UseMarkdownStudioControllerOptions) => {
    const {t} = useI18n();
    const loading = ref(false);
    const statusText = ref(options.initialStatusText ?? t("markdownStudio.workbench.waitingStatus"));
    const viewMode = options.viewMode;
    const activeEditor = ref<ActiveEditor>(null);
    const sourceHandle = shallowRef<MarkdownStudioEditorHandle | null>(null);
    const previewHandle = shallowRef<MarkdownStudioEditorHandle | null>(null);
    const streamWriting = ref(false);
    const commentViewOpen = ref(false);
    const inlineComments = ref<MarkdownInlineCommentItem[]>([]);
    const activeInlineCommentIndex = ref<number | null>(null);
    let lastKnownMarkdown = options.markdown.value;
    const typewriter = useTypewriterStream({
        intervalMs: options.typewriterIntervalMs,
        chunkSize: options.typewriterChunkSize,
        onChunk: (chunk) => {
            commitChange(`${options.markdown.value}${chunk}`);
        },
    });
    const typing = typewriter.typing;
    const typewriterBuffer = typewriter.buffer;
    const editorsLocked = computed(() => loading.value || typing.value || streamWriting.value);
    const isPreviewVisible = computed(() => viewMode.value === "rich");
    const isSourceVisible = computed(() => viewMode.value === "source");

    /**
     * 提交一份新的 Markdown。
     */
    const commitChange = (markdown: string): void => {
        if (markdown === lastKnownMarkdown) {
            return;
        }

        lastKnownMarkdown = markdown;
        options.markdown.value = markdown;
    };

    /**
     * 处理用户从编辑器发起的正文修改。
     */
    const commitEditorChange = (markdown: string): void => {
        if (loading.value || typing.value) {
            return;
        }

        commitChange(markdown);
    };

    /**
     * 处理预览区用户输入。
     */
    const commitPreviewChange = (markdown: string): void => {
        commitEditorChange(markdown);
    };

    /**
     * 处理源码区用户输入。
     */
    const commitSourceChange = (markdown: string): void => {
        commitEditorChange(markdown);
    };

    /**
     * 流式写入开始。默认会在已有正文末尾补两个换行。
     */
    const startStream = (prependParagraphBreak = true): void => {
        loading.value = true;
        typewriter.reset();

        if (prependParagraphBreak && options.markdown.value.trim()) {
            commitChange(`${options.markdown.value}\n\n`);
        }

        typewriter.start();
    };

    /**
     * 追加一段流式文本。
     */
    const appendStreamText = (text: string): void => {
        if (!text) {
            return;
        }

        typewriter.append(text);
    };

    /**
     * 流式写入结束。
     */
    const finishStream = (): void => {
        loading.value = false;
        typewriter.finish();
    };

    /**
     * 强制中断流式写入，并清空尚未落字的缓冲区。
     */
    const abortStream = (): void => {
        loading.value = false;
        typewriter.abort();
    };

    /**
     * 设置状态文本。
     */
    const setStatusText = (text: string): void => {
        statusText.value = text;
    };

    /**
     * 注册源码区句柄。
     */
    const registerSourceHandle = (handle: MarkdownStudioEditorHandle | null): void => {
        sourceHandle.value = handle;
    };

    /**
     * 注册预览区句柄。
     */
    const registerPreviewHandle = (handle: MarkdownStudioEditorHandle | null): void => {
        previewHandle.value = handle;
    };

    /**
     * 同步当前 Markdown 文档里的 inline-comment 列表。
     */
    const setInlineComments = (comments: MarkdownInlineCommentItem[]): void => {
        inlineComments.value = comments;
        const active = comments.find((comment) => comment.active) ?? null;
        activeInlineCommentIndex.value = active?.index ?? activeInlineCommentIndex.value;
        if (activeInlineCommentIndex.value !== null && comments.every((comment) => comment.index !== activeInlineCommentIndex.value)) {
            activeInlineCommentIndex.value = null;
        }
    };

    /**
     * 打开评论视图并激活指定评论。
     */
    const openCommentView = (index?: number): void => {
        commentViewOpen.value = true;
        if (typeof index === "number") {
            activeInlineCommentIndex.value = index;
        }
    };

    /**
     * 关闭评论视图。
     */
    const closeCommentView = (): void => {
        commentViewOpen.value = false;
    };

    /**
     * 源码区获得焦点。
     */
    const onSourceFocus = (): void => {
        activeEditor.value = "source";
    };

    /**
     * 源码区失去焦点。
     */
    const onSourceBlur = (): void => {
        if (activeEditor.value === "source") {
            activeEditor.value = null;
        }
    };

    /**
     * 预览区获得焦点。
     */
    const onPreviewFocus = (): void => {
        activeEditor.value = "preview";
    };

    /**
     * 预览区失去焦点。
     */
    const onPreviewBlur = (): void => {
        if (activeEditor.value === "preview") {
            activeEditor.value = null;
        }
    };

    /**
     * 聚焦源码区。
     */
    const focusSource = (): void => {
        sourceHandle.value?.focus();
    };

    /**
     * 聚焦预览区。
     */
    const focusPreview = (): void => {
        previewHandle.value?.focus();
    };

    /**
     * 返回当前用于写入的编辑器句柄。
     */
    const activeWriteHandle = (): MarkdownStudioEditorHandle | null => {
        if (activeEditor.value === "source") {
            return sourceHandle.value ?? previewHandle.value;
        }
        return previewHandle.value ?? sourceHandle.value;
    };

    /**
     * 在当前光标插入 Markdown。
     */
    const insertMarkdown = (markdown: string): void => {
        const handle = activeWriteHandle();
        if (handle?.insertMarkdown) {
            handle.insertMarkdown(markdown);
            return;
        }
        commitChange(`${options.markdown.value}${markdown}`);
    };

    /**
     * 用 Markdown 替换当前选区。
     */
    const replaceSelection = (markdown: string): void => {
        const handle = activeWriteHandle();
        if (handle?.replaceSelection) {
            handle.replaceSelection(markdown);
            return;
        }
        insertMarkdown(markdown);
    };

    /**
     * 在指定文档位置插入 Markdown。仅富文本句柄支持精确位置，
     * 其余情况退化为追加到正文末尾（保证插图不丢）。
     */
    const insertMarkdownAt = (pos: number, markdown: string): void => {
        const handle = activeWriteHandle();
        if (handle?.insertMarkdownAt) {
            handle.insertMarkdownAt(pos, markdown);
            return;
        }
        appendMarkdown(markdown);
    };

    /**
     * 将 Markdown 追加到正文末尾。
     */
    const appendMarkdown = (markdown: string): void => {
        const handle = activeWriteHandle();
        if (handle?.appendMarkdown) {
            handle.appendMarkdown(markdown);
            return;
        }
        commitChange(`${options.markdown.value}${markdown}`);
    };

    /**
     * 打开一个流式写入通道。
     */
    const openStream = (streamOptions: MarkdownStreamOptions): MarkdownStreamChannel => {
        const snapshot = options.markdown.value;
        let buffer = "";
        let firstChunk = true;
        let closed = false;
        streamWriting.value = true;

        const append = (chunk: string): void => {
            if (closed || !chunk) {
                return;
            }
            buffer += chunk;
            if (streamOptions.target === "append-document") {
                const separator = streamOptions.prependParagraphBreak !== false && snapshot.trim() ? "\n\n" : "";
                commitChange(`${snapshot}${separator}${buffer}`);
                return;
            }
            if (streamOptions.target === "replace-selection" && firstChunk) {
                replaceSelection(chunk);
            } else {
                insertMarkdown(chunk);
            }
            firstChunk = false;
        };

        return {
            append,
            finish: () => {
                closed = true;
                streamWriting.value = false;
            },
            abort: () => {
                closed = true;
                streamWriting.value = false;
                commitChange(snapshot);
            },
        };
    };

    /**
     * 结算所有编辑器的防抖输入，把最新内容立即回传给 markdown ref。
     * store 在切换文件 / 磁盘同步 / 保存前通过 activeEditorFlush 钩子调用，
     * 保证 dirty 判定和 buffer 持久化建立在编辑器最新内容之上。
     * flush 对无 pending 的编辑器是 no-op，两个句柄都调是安全的。
     */
    const flushActiveEditor = (): void => {
        previewHandle.value?.flushPendingChange?.();
        sourceHandle.value?.flushPendingChange?.();
    };

    /**
     * 将两个编辑器的滚动位置都重置到顶部。
     */
    const scrollToTop = (): void => {
        previewHandle.value?.scrollToTop?.();
        sourceHandle.value?.scrollToTop?.();
    };

    /**
     * 设置工作区显示模式，并在必要时修正焦点。
     */
    const setViewMode = (mode: MarkdownStudioViewMode): void => {
        if (viewMode.value === mode) {
            return;
        }

        if (mode === "rich" && activeEditor.value === "source") {
            activeEditor.value = null;
        }
        if (mode === "source" && activeEditor.value === "preview") {
            activeEditor.value = null;
        }

        viewMode.value = mode;
        nextTick(() => {
            if (mode === "rich") {
                focusPreview();
                return;
            }

            focusSource();
        });
    };

    /**
     * 切换到仅预览模式。
     */
    const showPreviewOnly = (): void => {
        setViewMode("rich");
    };

    /**
     * 切换到仅源码模式。
     */
    const showSourceOnly = (): void => {
        setViewMode("source");
    };

    /**
     * 定位并选中指定评论。
     */
    const selectInlineComment = (index: number): void => {
        activeInlineCommentIndex.value = index;
        commentViewOpen.value = true;
        if (viewMode.value === "source") {
            setViewMode("rich");
        }
        nextTick(() => {
            previewHandle.value?.selectInlineComment?.(index);
        });
    };

    /**
     * 激活评论视图但不改动编辑器文本选区。
     */
    const activateInlineComment = (index: number): void => {
        activeInlineCommentIndex.value = index;
        commentViewOpen.value = true;
        if (viewMode.value === "source") {
            setViewMode("rich");
        }
        nextTick(() => {
            previewHandle.value?.activateInlineComment?.(index);
        });
    };

    /**
     * 更新指定评论正文。
     */
    const updateInlineComment = (index: number, body: string): void => {
        previewHandle.value?.updateInlineComment?.(index, body);
    };

    /**
     * 删除指定评论标签并保留原文。
     */
    const deleteInlineComment = (index: number): void => {
        previewHandle.value?.deleteInlineComment?.(index);
    };

    /**
     * 撤销当前激活编辑器的操作。
     */
    const undo = (): void => {
        if (activeEditor.value === "source") {
            sourceHandle.value?.undo?.();
            return;
        }

        previewHandle.value?.undo?.();
    };

    /**
     * 重做当前激活编辑器的操作。
     */
    const redo = (): void => {
        if (activeEditor.value === "source") {
            sourceHandle.value?.redo?.();
            return;
        }

        previewHandle.value?.redo?.();
    };

    /**
     * 给当前选区添加评论标记。
     */
    const addComment = (body: string): void => {
        previewHandle.value?.addComment?.(body);
    };

    /**
     * 设置当前块对齐方式。
     */
    const setAlign = (align: "left" | "center" | "right" | "justify"): void => {
        previewHandle.value?.setAlign?.(align);
    };

    watch(options.markdown, (newMarkdown) => {
        lastKnownMarkdown = newMarkdown;
    });

    return {
        markdown: options.markdown,
        loading,
        typing,
        statusText,
        typewriterBuffer,
        viewMode,
        activeEditor,
        commentViewOpen,
        inlineComments,
        activeInlineCommentIndex,
        editorsLocked,
        isPreviewVisible,
        isSourceVisible,
        commitSourceChange,
        commitPreviewChange,
        insertMarkdown,
        replaceSelection,
        appendMarkdown,
        insertMarkdownAt,
        openStream,
        startStream,
        appendStreamText,
        finishStream,
        abortStream,
        setStatusText,
        registerSourceHandle,
        registerPreviewHandle,
        setInlineComments,
        openCommentView,
        closeCommentView,
        onSourceFocus,
        onSourceBlur,
        onPreviewFocus,
        onPreviewBlur,
        focusSource,
        focusPreview,
        flushActiveEditor,
        scrollToTop,
        setViewMode,
        showPreviewOnly,
        showSourceOnly,
        selectInlineComment,
        activateInlineComment,
        updateInlineComment,
        deleteInlineComment,
        undo,
        redo,
        addComment,
        setAlign,
    };
};
