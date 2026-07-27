<script setup lang="ts">
import {EditorContent, useEditor} from "@tiptap/vue-3";
import {getTextBetween, getTextSerializersFromSchema, type Editor} from "@tiptap/core";
import {flattenAgentSuggestionItems, type AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import MarkdownSelectionMenu from "nbook/app/components/markdown-studio/MarkdownSelectionMenu.vue";
import TipTapFrontmatterPanel from "nbook/app/components/markdown-studio/TipTapFrontmatterPanel.vue";
import type {MarkdownFormatCommand, MarkdownInlineCommentItem, MarkdownStudioEditorHandle} from "nbook/app/composables/useMarkdownStudioController";
import {createMarkdownEditorExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-editor-extensions";
import {COMMENT_PLUGIN_KEY, type CommentItem} from "nbook/app/components/markdown-studio/tiptap/Comment";
import {useDialog} from "nbook/app/composables/useDialog";
import {useEditorChangeDebounce} from "nbook/app/composables/useEditorChangeDebounce";
import {useNotification} from "nbook/app/composables/useNotification";
import {refreshWorkspaceReferenceNodes, type WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {applyInlineAiReferenceHighlight, countMarkdownLines, InlineAiReferenceHighlight, locateInlineAiSelectionTextRange, serializeEditorPrefix} from "nbook/app/components/markdown-studio/tiptap/InlineAiReferenceHighlight";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, type FrontmatterProfileKind, type MarkdownEditorPreferences} from "nbook/shared/editor-workbench";
import {splitMarkdownFrontmatter} from "nbook/shared/editor-workbench";
import {normalizeMarkdownDialectBlocks} from "nbook/shared/markdown-workbench";
import {buildSelectionRefChip, locateSelectionRange, type InlineEditReference, type SelectionRangeLocation} from "nbook/app/utils/inline-editor-selection";
import {isRelativeWorkspaceImageSrc, workspaceImageUrl} from "nbook/app/utils/workspace-image-url";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import YAML from "yaml";

type PopoverDirection = "auto" | "up" | "down";

const props = withDefaults(defineProps<{
    initialValue?: string;
    visible?: boolean;
    readonly?: boolean;
    editorPreferences?: MarkdownEditorPreferences;
    placeholder?: string;
    autofocus?: boolean;
    activePath?: string;
    inlineAiReferences?: InlineEditReference[];
    inlineAiHighlightReference?: InlineEditReference | null;
    referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    showFrontmatterPanel?: boolean;
    submitOnEnter?: boolean;
    enableQuickTriggers?: boolean;
    onSkillTriggerStart?: () => void;
    popoverDirection?: PopoverDirection;
    matchPopoverWidth?: boolean;
}>(), {
    initialValue: "",
    visible: true,
    readonly: false,
    editorPreferences: () => ({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
    placeholder: "",
    autofocus: false,
    activePath: "",
    inlineAiReferences: () => [],
    inlineAiHighlightReference: null,
    referenceRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    openReference: () => {},
    showFrontmatterPanel: true,
    submitOnEnter: false,
    enableQuickTriggers: false,
    onSkillTriggerStart: () => {},
    popoverDirection: "auto",
    matchPopoverWidth: false,
});

const emit = defineEmits<{
    (e: "change", value: string): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "open-frontmatter-profile", kind: FrontmatterProfileKind): void;
    (e: "inline-comments-change", comments: MarkdownInlineCommentItem[]): void;
    (e: "inline-comment-select", index: number): void;
    (e: "inline-ai-reference", reference: InlineEditReference): void;
    (e: "generate-illustration", payload: {text: string; insertPos: number}): void;
}>();

const {prompt} = useDialog();
const notification = useNotification();
const novelIdeStore = useNovelIdeStore();
const {t} = useI18n();

/**
 * 工作区插图相对路径 → raw serve URL；调用时实时读取当前项目上下文，
 * 只影响编辑器 DOM 展示，Markdown 序列化仍保留原相对路径。
 */
function resolveWorkspaceImage(src: string): string {
    if (!isRelativeWorkspaceImageSrc(src)) {
        return src;
    }
    const projectPath = novelIdeStore.workspaceKind === "user-assets" ? null : novelIdeStore.currentNovelId || null;
    return workspaceImageUrl(src, projectPath);
}
const wrapperRef = ref<HTMLDivElement | null>(null);
const focused = ref(false);
const syncingFromOutside = ref(false);
const suggestionMenuState = ref<AgentSuggestionMenuState | null>(null);
const activeIndex = ref(0);
const initialSplit = splitMarkdownFrontmatter(props.initialValue);
const frontmatterText = ref(initialSplit.frontmatterText);
const hasFrontmatter = ref(initialSplit.hasFrontmatter);
const frontmatterOpen = ref(false);
const editorSnapshot = ref(props.initialValue);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const skillTriggerStarted = ref(false);
const popoverTeleportTarget = computed(() => wrapperRef.value?.closest(".novel-ide-theme") as HTMLElement | null);
const editorPlaceholder = computed(() => props.placeholder || t("markdownStudio.editor.placeholder"));
const menuVisible = computed(() => Boolean(suggestionMenuState.value && suggestionMenuState.value.items.length > 0));
const skillTriggerActive = computed(() => suggestionMenuState.value?.contextKind === "skill");
const editorPreferenceStyle = computed(() => {
    const preferences = props.editorPreferences;
    const fontSize = clampNumber(preferences.fontSize, 12, 28, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontSize);
    const lineHeight = clampNumber(preferences.lineHeight, 1.2, 2.6, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.lineHeight);
    const contentWidth = clampNumber(preferences.contentWidth, 520, 1280, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.contentWidth);
    const paragraphIndent = preferences.paragraphIndentEnabled
        ? `${clampNumber(preferences.paragraphIndentEm, 0, 4, DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEm)}em`
        : "0em";

    return {
        "--nb-markdown-editor-font-family": preferences.fontFamily || DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontFamily,
        "--nb-markdown-editor-font-size": `${fontSize}px`,
        "--nb-markdown-editor-line-height": `${lineHeight}`,
        "--nb-markdown-editor-content-width": `${contentWidth}px`,
        "--nb-markdown-editor-paragraph-indent": paragraphIndent,
    };
});

/**
 * TipTap Markdown 编辑器。
 * 输入输出始终是完整 Markdown；frontmatter 在顶部 YAML 区编辑，正文交给 TipTap。
 */
function composeMarkdown(body: string): string {
    if (!hasFrontmatter.value) {
        return body;
    }
    return `---\n${frontmatterText.value.trimEnd()}\n---\n\n${body}`;
}

/**
 * 校验 YAML 结构；错误只提示，不阻止用户继续修复。
 */
const frontmatterError = computed(() => {
    if (!hasFrontmatter.value || !frontmatterText.value.trim()) {
        return "";
    }
    try {
        const parsed = YAML.parse(frontmatterText.value) as unknown;
        if (parsed === null || (typeof parsed === "object" && !Array.isArray(parsed))) {
            return "";
        }
        return t("markdownStudio.editor.frontmatterObjectError");
    } catch (error) {
        return error instanceof Error ? error.message : t("markdownStudio.editor.frontmatterParseFailed");
    }
});

/**
 * 同步引用选择菜单状态。
 */
function syncMenuState(state: AgentSuggestionMenuState | null): void {
    suggestionMenuState.value = state;
    if (!state || activeIndex.value >= state.items.length) {
        activeIndex.value = 0;
    }
}

/**
 * 获取当前 TipTap Markdown。
 */
function readEditorMarkdown(currentEditor: Editor | null | undefined): string {
    return currentEditor?.getMarkdown() ?? splitMarkdownFrontmatter(editorSnapshot.value).body;
}

/**
 * 计算正文第一行在完整 Markdown 里的行号偏移，保证 selection chip 指向真实文件行号。
 */
function frontmatterLineOffset(): number {
    if (!hasFrontmatter.value) {
        return 0;
    }
    return `---\n${frontmatterText.value.trimEnd()}\n---\n\n`.split("\n").length - 1;
}

/**
 * 变更上报防抖：打字期间不做全文 Markdown 序列化（大文档下每键序列化是 CPU 跑满的元凶），
 * 停顿后才序列化并 emit change；失焦、保存快捷键、store flush 钩子强制结算。
 * 切换文件等会消费 store 内容的路径由 novel-ide store 的 activeEditorFlush 钩子先行 flush，
 * 组件卸载时只丢弃 pending（此时 store 活动文件可能已切换，emit 会把内容写进别的文件）。
 */
const changeDebounce = useEditorChangeDebounce({
    readValue: () => {
        const currentEditor = editor.value;
        if (!currentEditor) {
            return null;
        }
        return composeMarkdown(currentEditor.getMarkdown());
    },
    onEmit: (nextMarkdown) => {
        editorSnapshot.value = nextMarkdown;
        if (props.readonly || !props.visible) {
            return;
        }
        emit("change", nextMarkdown);
    },
});

/**
 * 立即序列化当前文档并向外 emit change；评论增删改等低频操作也直接走这里。
 */
function emitChangeNow(): void {
    changeDebounce.emitNow();
}

/**
 * 有未结算的输入时立即结算；没有则不动。
 */
function flushPendingChange(): void {
    changeDebounce.flush();
}

const editor = useEditor({
    content: normalizeMarkdownDialectBlocks(splitMarkdownFrontmatter(props.initialValue).body),
    contentType: "markdown",
    extensions: [
        ...createMarkdownEditorExtensions({
            placeholder: editorPlaceholder.value,
            resolveMenu: props.resolveMenu,
            onMenuStateChange: syncMenuState,
            getMenuState: () => suggestionMenuState.value,
            getActiveIndex: () => activeIndex.value,
            setActiveIndex: (index: number) => {
                activeIndex.value = index;
            },
            openReference: props.openReference,
            onInlineCommentSelect: handleInlineCommentSelect,
            onCommentsChange: (comments) => {
                emit("inline-comments-change", comments);
            },
            resolveHtmlEmbedLabels: () => ({
                render: t("markdownStudio.editor.htmlBlockRender"),
                viewSource: t("markdownStudio.editor.htmlBlockViewSource"),
                caption: t("markdownStudio.editor.htmlBlockCaption"),
            }),
            sourcePath: props.activePath,
            resolveReference: props.resolveReference,
            enableQuickTriggers: props.enableQuickTriggers,
            resolveImageUrl: resolveWorkspaceImage,
        }),
        InlineAiReferenceHighlight,
    ],
    editable: !props.readonly,
    editorProps: {
        attributes: {
            class: "nb-markdown-editor prose-mirror-markdown h-full min-h-full outline-none",
            spellcheck: "false",
        },
        handleDOMEvents: {
            focus: () => {
                focused.value = true;
                emit("focus");
                return false;
            },
            blur: () => {
                focused.value = false;
                flushPendingChange();
                emit("blur");
                return false;
            },
            keydown: (_view, event) => {
                if (event.key === "Tab" && event.shiftKey) {
                    event.preventDefault();
                    emit("shift-tab");
                    return true;
                }
                if (props.submitOnEnter && event.key === "Enter" && !event.shiftKey && !menuVisible.value) {
                    event.preventDefault();
                    flushPendingChange();
                    emit("submit", {ctrlKey: event.ctrlKey, metaKey: event.metaKey});
                    return true;
                }
                if (!isSaveShortcut(event)) {
                    return false;
                }
                event.preventDefault();
                flushPendingChange();
                emit("save-request");
                return true;
            },
            paste: (_view, event) => {
                event.preventDefault();
                if (props.readonly) {
                    return true;
                }
                const text = event.clipboardData?.getData("text/plain") ?? "";
                if (!text) {
                    return true;
                }
                insertMarkdown(text);
                return true;
            },
        },
    },
    onCreate: ({editor: currentEditor}) => {
        emit("inline-comments-change", COMMENT_PLUGIN_KEY.getState(currentEditor.state)?.comments ?? []);
        refreshInlineAiReferenceHighlight(currentEditor);
    },
    onUpdate: () => {
        if (syncingFromOutside.value || props.readonly || !props.visible || !focused.value) {
            return;
        }
        changeDebounce.schedule();
    },
});

watch(() => props.readonly, (readonly) => {
    editor.value?.setEditable(!readonly);
});

watch(() => [props.inlineAiReferences, props.inlineAiHighlightReference, props.activePath] as const, () => {
    refreshInlineAiReferenceHighlight();
});

const frontmatterProfileKind = computed<FrontmatterProfileKind | null>(() => {
    if (!hasFrontmatter.value || frontmatterError.value) {
        return null;
    }
    try {
        const parsed = YAML.parse(frontmatterText.value) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const type = (parsed as Record<string, unknown>).type;
        if (type === "character" || type === "location" || type === "rule") {
            return type;
        }
        return null;
    } catch {
        return null;
    }
});

watch(() => props.referenceRefreshKey, () => {
    refreshWorkspaceReferenceNodes();

    if (suggestionMenuState.value) {
        const menuState = props.resolveMenu({
            kind: suggestionMenuState.value.contextKind,
            query: suggestionMenuState.value.query,
            hasPlainTextBeforeTrigger: suggestionMenuState.value.hasPlainTextBeforeTrigger,
        });
        const items = flattenAgentSuggestionItems(menuState.sections);
        const nextActiveIndex = items.length > 0
            ? Math.min(items.length - 1, Math.max(0, activeIndex.value))
            : 0;
        
        suggestionMenuState.value = {
            ...suggestionMenuState.value,
            title: menuState.title,
            prefix: menuState.prefix,
            sections: menuState.sections,
            items,
        };
        activeIndex.value = nextActiveIndex;
    }
});

watch(skillTriggerActive, (active) => {
    if (active && !skillTriggerStarted.value) {
        skillTriggerStarted.value = true;
        props.onSkillTriggerStart();
        return;
    }

    if (!active) {
        skillTriggerStarted.value = false;
    }
});

/**
 * 显式更新编辑器内容。
 */
function update(markdown: string): void {
    if (markdown === editorSnapshot.value) {
        return;
    }

    // 外部权威内容覆盖本地状态，未结算的防抖输入作废
    changeDebounce.cancel();
    const split = splitMarkdownFrontmatter(markdown);
    frontmatterText.value = split.frontmatterText;
    hasFrontmatter.value = split.hasFrontmatter;
    editorSnapshot.value = markdown;
    syncingFromOutside.value = true;
    // 读时规范化宽容形态（快照仍存原始串：改写在用户下次编辑时才随防抖上报实化为 dirty）
    editor.value?.commands.setContent(normalizeMarkdownDialectBlocks(split.body), {
        contentType: "markdown",
        emitUpdate: false,
    });
    nextTick(() => {
        refreshInlineAiReferenceHighlight();
    });
    queueMicrotask(() => {
        syncingFromOutside.value = false;
    });
}

/**
 * 开始在当前 Markdown 中维护 frontmatter。
 */
function addFrontmatter(): void {
    if (props.readonly) {
        return;
    }
    hasFrontmatter.value = true;
    frontmatterText.value = frontmatterText.value.trim() || "title: \"\"";
    frontmatterOpen.value = true;
    emitFrontmatterChange();
}

/**
 * 删除 frontmatter 区块，正文保持不变。
 */
function removeFrontmatter(): void {
    if (props.readonly) {
        return;
    }
    hasFrontmatter.value = false;
    frontmatterText.value = "";
    frontmatterOpen.value = false;
    emitFrontmatterChange();
}

/**
 * 更新 YAML 文本并写回完整 Markdown。
 */
function updateFrontmatterText(value: string): void {
    frontmatterText.value = value;
    emitFrontmatterChange();
}

/**
 * frontmatter 变化时向父层提交完整 Markdown。
 */
function emitFrontmatterChange(): void {
    const nextMarkdown = composeMarkdown(readEditorMarkdown(editor.value));
    editorSnapshot.value = nextMarkdown;
    if (props.readonly || !props.visible) {
        return;
    }
    emit("change", nextMarkdown);
}

/**
 * frontmatter 编辑区获得焦点时标记为富文本侧输入源。
 */
function handleFrontmatterFocus(): void {
    focused.value = true;
    emit("focus");
}

/**
 * frontmatter 编辑区失焦时向外触发保存请求。
 */
function handleFrontmatterBlur(): void {
    focused.value = false;
    emit("blur");
}

/**
 * 聚焦富文本编辑器。
 */
function focus(): void {
    editor.value?.commands.focus();
}

/**
 * 滚动到顶部。
 */
function scrollToTop(): void {
    wrapperRef.value?.scrollTo({top: 0, behavior: "auto"});
}

/**
 * 获取合并 frontmatter 后的 Markdown。
 */
function getMarkdown(): string {
    return composeMarkdown(readEditorMarkdown(editor.value));
}

/**
 * 撤销编辑。
 */
function undo(): void {
    editor.value?.chain().focus().undo().run();
}

/**
 * 重做编辑。
 */
function redo(): void {
    editor.value?.chain().focus().redo().run();
}

/**
 * 选择当前 suggestion 菜单项。
 */
function selectMenuItem(itemId: string): void {
    const state = suggestionMenuState.value;
    const item = state?.items.find((entry) => entry.id === itemId);
    if (!state || !item) {
        return;
    }
    state.command(item);
}

/**
 * 在当前光标插入 Markdown（粘贴与外部插入共用）。
 * 纯空白内容不能走 markdown parse（会产生空 doc 导致 insertContent 抛 RangeError），
 * 退化为原样插入文本。插入前做方言块规范化（判据自带无闭合守卫，句子片段安全）。
 */
function insertMarkdown(markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    if (!markdown.trim()) {
        if (markdown) {
            currentEditor.chain().focus().command(({tr}) => {
                tr.insertText(markdown);
                return true;
            }).run();
        }
        return;
    }
    currentEditor.chain().focus().insertContent(normalizeMarkdownDialectBlocks(markdown), {contentType: "markdown"}).run();
}

/**
 * 用 Markdown 替换当前选区。
 * ⚠️ 故意不做方言块规范化：本函数是 AI 流式写入的逐 chunk 路径（openStream），
 * chunk 边界任意，规范化悬尾标签会抢拆；残片数据安全由行内兜底 chip 保证。
 */
function replaceSelection(markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    currentEditor.chain().focus().insertContentAt({
        from: currentEditor.state.selection.from,
        to: currentEditor.state.selection.to,
    }, markdown, {contentType: "markdown"}).run();
}

/**
 * 在指定文档位置插入 Markdown（生图插画"插在选区之后"的落点）。
 * pos 超界时夹到文档末尾；插入块级内容（如图片行）时 TipTap 会自动拆分所在段落。
 */
function insertMarkdownAt(pos: number, markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor || !markdown.trim()) {
        return;
    }
    const clamped = Math.max(0, Math.min(pos, currentEditor.state.doc.content.size));
    currentEditor.chain().focus().insertContentAt(clamped, markdown, {contentType: "markdown"}).run();
    emitChangeNow();
}

/**
 * 将 Markdown 追加到正文末尾。
 * ⚠️ 故意不做方言块规范化：与 replaceSelection 同为流式 chunk 语义路径。
 */
function appendMarkdown(markdown: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    currentEditor.chain().focus().insertContentAt(currentEditor.state.doc.content.size, markdown, {contentType: "markdown"}).run();
}

/**
 * 给选区添加评论：选区落在单个段落内用行内 comment mark，
 * 跨多个段落时包成 commentBlock 块级评论（Markdown 里开闭标签独立成行）。
 */
function addComment(body: string): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    const {from, to} = currentEditor.state.selection;
    if (from === to) {
        return;
    }
    if (countSelectionTextblocks(currentEditor.state.doc, from, to) > 1) {
        currentEditor.chain().focus().setCommentBlock(body).run();
    } else {
        currentEditor.chain().focus().setComment(body).run();
    }
    emitChangeNow();
}

/**
 * 统计选区实际覆盖的文本块数量，用于决定行内/块级评论形态。
 */
function countSelectionTextblocks(doc: Editor["state"]["doc"], from: number, to: number): number {
    let count = 0;
    doc.nodesBetween(from, to, (node, position) => {
        if (!node.isTextblock) {
            return;
        }
        const blockFrom = position + 1;
        const blockTo = position + node.nodeSize - 1;
        if (Math.max(blockFrom, from) < Math.min(blockTo, to)) {
            count += 1;
        }
    });
    return count;
}

/**
 * 编辑当前光标所在的 inline-comment。
 */
async function editActiveComment(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const activeComment = findActiveInlineComment(editor.value);
    if (!activeComment) {
        return;
    }
    const body = await prompt(t("markdownStudio.editor.commentBody"), activeComment.body, t("markdownStudio.editor.editComment"));
    if (body === null) {
        return;
    }
    updateInlineComment(activeComment.index, body.trim());
}

/**
 * 删除当前 inline-comment 标签，保留其内部正文。
 */
function deleteActiveComment(): void {
    if (props.readonly) {
        return;
    }
    const activeComment = findActiveInlineComment(editor.value);
    if (!activeComment) {
        return;
    }
    deleteInlineComment(activeComment.index);
}

/**
 * 将当前块包裹成对齐块。
 */
function setAlign(align: "left" | "center" | "right" | "justify"): void {
    editor.value?.chain().focus().setMarkdownAlign(align).run();
}

/**
 * 执行表单工具条暴露的常用 Markdown 格式命令。
 */
function applyMarkdownFormat(command: MarkdownFormatCommand): void {
    const currentEditor = editor.value;
    if (!currentEditor || props.readonly) {
        return;
    }
    const chain = currentEditor.chain().focus();
    if (command === "paragraph") {
        chain.setParagraph().run();
        return;
    }
    if (command === "heading-2") {
        chain.toggleHeading({level: 2}).run();
        return;
    }
    if (command === "heading-3") {
        chain.toggleHeading({level: 3}).run();
        return;
    }
    if (command === "bold") {
        chain.toggleBold().run();
        return;
    }
    if (command === "italic") {
        chain.toggleItalic().run();
        return;
    }
    if (command === "underline") {
        chain.toggleUnderline().run();
        return;
    }
    if (command === "strike") {
        chain.toggleStrike().run();
        return;
    }
    if (command === "code") {
        chain.toggleCode().run();
        return;
    }
    if (command === "bullet-list") {
        chain.toggleBulletList().run();
        return;
    }
    if (command === "ordered-list") {
        chain.toggleOrderedList().run();
        return;
    }
    if (command === "blockquote") {
        chain.toggleBlockquote().run();
        return;
    }
    chain.unsetAllMarks().clearNodes().run();
}

/**
 * 读取当前选区纯文本。
 */
function selectedText(): string {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return "";
    }
    return currentEditor.state.doc.textBetween(
        currentEditor.state.selection.from,
        currentEditor.state.selection.to,
        "\n",
    );
}

/**
 * 当前选区的剪贴板文本；引用节点输出 Markdown，避免 chip 复制为空。
 */
function selectedClipboardText(): string {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return "";
    }
    return getTextBetween(
        currentEditor.state.doc,
        {
            from: currentEditor.state.selection.from,
            to: currentEditor.state.selection.to,
        },
        {
            blockSeparator: "\n",
            textSerializers: getTextSerializersFromSchema(currentEditor.state.schema),
        },
    );
}

/**
 * 用 TipTap 选区位置推导 Markdown 行号；失败时由调用方回退到文本匹配。
 */
function locateSelectionRangeFromEditor(currentEditor: Editor): SelectionRangeLocation {
    const {from, to} = currentEditor.state.selection;
    if (from === to) {
        return {match: "unknown"};
    }
    try {
        const offset = frontmatterLineOffset();
        const startLine = offset + countMarkdownLines(serializeEditorPrefix(currentEditor, from));
        const endLine = offset + countMarkdownLines(serializeEditorPrefix(currentEditor, to));
        return {
            match: "unique",
            range: {
                startLine,
                endLine: Math.max(startLine, endLine),
            },
        };
    } catch {
        return {match: "unknown"};
    }
}

/**
 * 根据 PromptBar 当前 hover 的 Inline AI 引用刷新编辑器里的临时高亮。
 */
function refreshInlineAiReferenceHighlight(targetEditor?: Editor): void {
    const currentEditor = targetEditor ?? editor.value;
    if (!currentEditor) {
        return;
    }
    applyInlineAiReferenceHighlight(currentEditor, {
        references: props.inlineAiReferences,
        highlightedReference: props.inlineAiHighlightReference,
        activePath: props.activePath,
        frontmatterLineOffset: frontmatterLineOffset(),
    });
}

/**
 * 把当前选区加入 Inline AI 引用。
 */
function addAiReferenceFromSelection(): void {
    const currentEditor = editor.value;
    const path = props.activePath.trim();
    if (!path) {
        notification.warning(t("markdownStudio.editor.currentPathMissing"));
        return;
    }

    const text = selectedClipboardText().trim();
    if (!text) {
        notification.warning(t("markdownStudio.editor.selectBodyFirst"));
        return;
    }

    const locatedFromEditor: SelectionRangeLocation = currentEditor ? locateSelectionRangeFromEditor(currentEditor) : {match: "unknown"};
    const located = locatedFromEditor.match === "unique"
        ? locatedFromEditor
        : locateSelectionRange(getMarkdown(), text);
    const textRange = currentEditor ? locateInlineAiSelectionTextRange(currentEditor) : undefined;
    emit("inline-ai-reference", {
        ref: buildSelectionRefChip({
            path,
            range: located.range,
        }),
        path,
        range: located.range,
        textRange,
        match: located.match,
        text,
    });
}

/**
 * 用当前选区发起生图：把选中文字与"选区末尾位置"上抛，由宿主打开生图面板；
 * 生成完成后宿主调 insertMarkdownAt(insertPos, "![](...)") 把插图放在选区之后。
 */
function generateIllustrationFromSelection(): void {
    const currentEditor = editor.value;
    const text = selectedClipboardText().trim();
    if (!currentEditor || !text) {
        notification.warning(t("markdownStudio.editor.selectBodyFirst"));
        return;
    }
    emit("generate-illustration", {text, insertPos: currentEditor.state.selection.to});
}

/**
 * 当前选区是否包含内容。
 */
function hasSelection(): boolean {
    const currentEditor = editor.value;
    return Boolean(currentEditor && currentEditor.state.selection.from !== currentEditor.state.selection.to);
}

/**
 * 使用剪贴板 API 复制当前选区。
 */
async function copySelection(): Promise<void> {
    const text = selectedClipboardText();
    if (!text) {
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        notification.warning(t("markdownStudio.editor.copyFailed"), {title: t("markdownStudio.editor.copyFailedTitle")});
    }
}

/**
 * 剪切当前选区。
 */
async function cutSelection(): Promise<void> {
    if (props.readonly || !hasSelection()) {
        return;
    }
    try {
        await navigator.clipboard.writeText(selectedClipboardText());
        editor.value?.chain().focus().deleteSelection().run();
    } catch {
        notification.warning(t("markdownStudio.editor.cutFailed"), {title: t("markdownStudio.editor.cutFailedTitle")});
    }
}

/**
 * 从剪贴板读取纯文本并插入当前光标。
 */
async function pasteText(): Promise<void> {
    if (props.readonly) {
        return;
    }
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            insertMarkdown(text);
        }
    } catch {
        notification.warning(t("markdownStudio.editor.pasteFailed"), {title: t("markdownStudio.editor.pasteFailedTitle")});
    }
}

/**
 * 插入 Markdown 链接。
 */
async function insertLinkFromMenu(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const label = await prompt(t("markdownStudio.editor.linkText"), selectedText() || "title", t("markdownStudio.editor.insertLink"));
    if (label === null) {
        return;
    }
    const url = await prompt(t("markdownStudio.editor.linkUrl"), "https://", t("markdownStudio.editor.insertLink"));
    if (url === null || !url.trim()) {
        return;
    }
    replaceSelection(`[${label || "title"}](${url.trim()})`);
}

/**
 * 插入 Markdown 图片。
 */
async function insertImageFromMenu(): Promise<void> {
    if (props.readonly) {
        return;
    }
    const url = await prompt(t("markdownStudio.editor.imageUrl"), "", t("markdownStudio.editor.insertImage"));
    if (url === null || !url.trim()) {
        return;
    }
    replaceSelection(`![](${url.trim()})`);
}

/**
 * 给当前选区添加评论。
 */
async function addCommentFromMenu(): Promise<void> {
    if (props.readonly || !hasSelection()) {
        return;
    }
    const body = await prompt(t("markdownStudio.editor.commentBody"), "", t("markdownStudio.editor.addComment"));
    if (body === null || !body.trim()) {
        return;
    }
    addComment(body.trim());
}

/**
 * 给选区添加/编辑注音（ruby）；输入留空则移除注音。
 */
async function addRubyFromMenu(): Promise<void> {
    const currentEditor = editor.value;
    if (props.readonly || !currentEditor || !hasSelection()) {
        return;
    }
    const previous = String(currentEditor.getAttributes("markdownRuby").text ?? "");
    const text = await prompt(t("markdownStudio.editor.rubyText"), previous, t("markdownStudio.editor.addRuby"));
    if (text === null) {
        return;
    }
    const trimmed = text.trim();
    if (trimmed) {
        currentEditor.chain().focus().setMarkdownRuby(trimmed).run();
    } else {
        currentEditor.chain().focus().unsetMarkdownRuby().run();
    }
    emitChangeNow();
}

/**
 * 给当前段落添加/编辑双语对照译文；已在对照块内时输入留空则解除对照。
 */
async function addBilingualFromMenu(): Promise<void> {
    const currentEditor = editor.value;
    if (props.readonly || !currentEditor) {
        return;
    }
    const active = currentEditor.isActive("markdownBilingual");
    const previous = active ? String(currentEditor.getAttributes("markdownBilingual").text ?? "") : "";
    const text = await prompt(t("markdownStudio.editor.bilingualText"), previous, t("markdownStudio.editor.addBilingual"));
    if (text === null) {
        return;
    }
    const trimmed = text.trim();
    if (active) {
        if (trimmed) {
            currentEditor.chain().focus().updateMarkdownBilingual(trimmed).run();
        } else {
            currentEditor.chain().focus().unsetMarkdownBilingual().run();
        }
    } else if (trimmed) {
        currentEditor.chain().focus().setMarkdownBilingual(trimmed).run();
    }
    emitChangeNow();
}

/**
 * 插入 @ 触发引用菜单。
 */
function openReferenceMenuFromContext(): void {
    if (props.readonly) {
        return;
    }
    insertMarkdown("@");
}

/**
 * 构造富文本编辑器右键菜单。
 */
function buildContextMenuItems(): ContextMenuItem[] {
    const writeDisabled = props.readonly;
    const selectionDisabled = !hasSelection();
    const activeComment = findActiveInlineComment(editor.value);
    return [
        {label: t("markdownStudio.editor.menuSave"), iconClass: "i-lucide-save", shortcut: "Ctrl+S", action: () => emit("save-request")},
        {separator: true},
        {label: t("markdownStudio.editor.menuUndo"), iconClass: "i-lucide-undo-2", shortcut: "Ctrl+Z", disabled: writeDisabled, action: undo},
        {label: t("markdownStudio.editor.menuRedo"), iconClass: "i-lucide-redo-2", shortcut: "Ctrl+Y", disabled: writeDisabled, action: redo},
        {separator: true},
        {label: t("markdownStudio.editor.menuCut"), iconClass: "i-lucide-scissors", shortcut: "Ctrl+X", disabled: writeDisabled || selectionDisabled, action: () => void cutSelection()},
        {label: t("markdownStudio.editor.menuCopy"), iconClass: "i-lucide-copy", shortcut: "Ctrl+C", disabled: selectionDisabled, action: () => void copySelection()},
        {label: t("markdownStudio.editor.menuPaste"), iconClass: "i-lucide-clipboard-paste", shortcut: "Ctrl+V", disabled: writeDisabled, action: () => void pasteText()},
        {separator: true},
        {label: t("markdownStudio.editor.menuInsertReference"), iconClass: "i-lucide-at-sign", disabled: writeDisabled, action: openReferenceMenuFromContext},
        {label: t("markdownStudio.editor.menuInsertLink"), iconClass: "i-lucide-link", disabled: writeDisabled, action: () => void insertLinkFromMenu()},
        {label: t("markdownStudio.editor.menuInsertImage"), iconClass: "i-lucide-image", disabled: writeDisabled, action: () => void insertImageFromMenu()},
        {label: t("markdownStudio.editor.menuAddComment"), iconClass: "i-lucide-message-square-plus", disabled: writeDisabled || selectionDisabled, action: () => void addCommentFromMenu()},
        {label: t("markdownStudio.editor.menuAddRuby"), iconClass: "i-lucide-languages", disabled: writeDisabled || selectionDisabled, action: () => void addRubyFromMenu()},
        {label: t("markdownStudio.editor.menuAddBilingual"), iconClass: "i-lucide-letter-text", disabled: writeDisabled, action: () => void addBilingualFromMenu()},
        ...(activeComment ? [
            {label: t("markdownStudio.editor.menuEditComment"), iconClass: "i-lucide-message-square-text", disabled: writeDisabled, action: () => void editActiveComment()},
            {label: t("markdownStudio.editor.menuDeleteComment"), iconClass: "i-lucide-message-square-x", disabled: writeDisabled, action: deleteActiveComment},
        ] : []),
    ];
}

/**
 * 打开富文本右键菜单。
 */
function openEditorContextMenu(event: MouseEvent): void {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return;
    }
    const position = currentEditor.view.posAtCoords({left: event.clientX, top: event.clientY});
    if (position) {
        const selection = currentEditor.state.selection;
        const insideSelection = selection.from <= position.pos && position.pos <= selection.to && selection.from !== selection.to;
        if (!insideSelection) {
            currentEditor.chain().focus().setTextSelection(position.pos).run();
        } else {
            currentEditor.commands.focus();
        }
    } else {
        currentEditor.commands.focus();
    }

    syncMenuState(null);
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = buildContextMenuItems();
    contextMenuVisible.value = true;
}

onMounted(() => {
    if (props.autofocus) {
        focus();
    }
});

onBeforeUnmount(() => {
    // 卸载时 store 的活动文件可能已切换，emit change 会把内容写进别的文件（串位）。
    // 切换文件的入口统一由 store 的 activeEditorFlush 钩子在切换前 flush，这里只丢弃残余。
    changeDebounce.cancel();
});

defineExpose<MarkdownStudioEditorHandle>({
    update,
    focus,
    scrollToTop,
    undo,
    redo,
    insertMarkdown,
    replaceSelection,
    appendMarkdown,
    insertMarkdownAt,
    addComment,
    getInlineComments,
    selectInlineComment,
    activateInlineComment,
    updateInlineComment,
    deleteInlineComment,
    setAlign,
    applyMarkdownFormat,
    flushPendingChange,
    getValue: getMarkdown,
});

/**
 * 查找当前激活（选区所在）的评论；行内与块级评论统一返回。
 */
function findActiveInlineComment(currentEditor: Editor | null | undefined): CommentItem | null {
    if (!currentEditor) {
        return null;
    }

    const {selection} = currentEditor.state;
    const comments = getInlineComments();
    return comments.find((comment) => comment.active)
        ?? comments.find((comment) => selection.from >= comment.from && selection.from <= comment.to)
        ?? null;
}

/**
 * 读取评论列表；直接消费 Comment 插件的缓存状态，不做全文遍历。
 */
function getInlineComments(): MarkdownInlineCommentItem[] {
    const currentEditor = editor.value;
    if (!currentEditor) {
        return [];
    }
    return COMMENT_PLUGIN_KEY.getState(currentEditor.state)?.comments ?? [];
}

function findInlineCommentByIndex(index: number): MarkdownInlineCommentItem | null {
    return getInlineComments().find((comment) => comment.index === index) ?? null;
}

/**
 * 块级评论滚动定位到节点内部第一个子块，行内评论定位到首个 range。
 */
function commentScrollPosition(comment: MarkdownInlineCommentItem): number {
    if (comment.kind === "block") {
        return comment.from + 1;
    }
    return comment.ranges[0]?.from ?? comment.from;
}

function selectInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment) {
        return;
    }
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(COMMENT_PLUGIN_KEY, {activeIndex: index})
        .setMeta("addToHistory", false));
    currentEditor.view.focus();
    requestAnimationFrame(() => {
        scrollInlineCommentIntoView(currentEditor, commentScrollPosition(comment));
    });
}

function activateInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment) {
        return;
    }
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(COMMENT_PLUGIN_KEY, {activeIndex: index})
        .setMeta("addToHistory", false));
    scrollInlineCommentIntoView(currentEditor, commentScrollPosition(comment));
}

function updateInlineComment(index: number, body: string): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment || props.readonly) {
        return;
    }
    if (comment.kind === "block") {
        currentEditor.chain().focus().command(({state, tr}) => {
            const node = state.doc.nodeAt(comment.from);
            if (!node || node.type.name !== "commentBlock") {
                return false;
            }
            tr.setNodeMarkup(comment.from, undefined, {...node.attrs, body});
            return true;
        }).run();
        emitChangeNow();
        return;
    }
    currentEditor.chain().focus().command(({state, tr}) => {
        const commentMark = state.schema.marks.comment;
        if (!commentMark) {
            return false;
        }
        for (const range of comment.ranges) {
            tr.removeMark(range.from, range.to, commentMark);
        }
        comment.ranges.forEach((range, rangeIndex) => {
            tr.addMark(range.from, range.to, commentMark.create({
                id: comment.id,
                body: rangeIndex === 0 ? body : "",
            }));
        });
        return true;
    }).run();
    emitChangeNow();
}

function deleteInlineComment(index: number): void {
    const currentEditor = editor.value;
    const comment = findInlineCommentByIndex(index);
    if (!currentEditor || !comment || props.readonly) {
        return;
    }
    if (comment.kind === "block") {
        // 删除块级评论标签，内部段落原样保留
        currentEditor.chain().focus().command(({state, tr}) => {
            const node = state.doc.nodeAt(comment.from);
            if (!node || node.type.name !== "commentBlock") {
                return false;
            }
            tr.replaceWith(comment.from, comment.from + node.nodeSize, node.content);
            return true;
        }).run();
        emitChangeNow();
        return;
    }
    currentEditor.chain().focus().command(({state, tr}) => {
        const commentMark = state.schema.marks.comment;
        if (!commentMark) {
            return false;
        }
        for (const range of comment.ranges) {
            tr.removeMark(range.from, range.to, commentMark);
        }
        return true;
    }).run();
    emitChangeNow();
}

function handleInlineCommentSelect(index: number): void {
    emit("inline-comment-select", index);
}

function scrollInlineCommentIntoView(currentEditor: Editor, position: number): void {
    const domAtPos = currentEditor.view.domAtPos(position);
    const element = domAtPos.node instanceof HTMLElement
        ? domAtPos.node
        : domAtPos.node.parentElement;
    element?.scrollIntoView({block: "center", inline: "nearest", behavior: "smooth"});
}

/**
 * 把用户输入的显示配置限制在合理区间，避免布局被异常值撑坏。
 */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(value, min), max);
}

/**
 * 判断是否是跨平台保存快捷键。
 */
function isSaveShortcut(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
}
</script>

<template>
    <div ref="wrapperRef" class="tiptap-markdown-wrapper" :style="editorPreferenceStyle">
        <!-- Markdown frontmatter 编辑区 -->
        <TipTapFrontmatterPanel
            v-if="props.showFrontmatterPanel"
            :model-value="frontmatterText"
            :has-frontmatter="hasFrontmatter"
            :open="frontmatterOpen"
            :readonly="props.readonly"
            :error="frontmatterError"
            :profile-kind="frontmatterProfileKind"
            @update:model-value="updateFrontmatterText"
            @update:open="frontmatterOpen = $event"
            @add="addFrontmatter"
            @remove="removeFrontmatter"
            @focus="handleFrontmatterFocus"
            @blur="handleFrontmatterBlur"
            @save-request="emit('save-request')"
            @open-profile="emit('open-frontmatter-profile', $event)"
        />

        <!-- Markdown 富文本正文区 -->
        <EditorContent v-if="editor" :editor="editor" class="tiptap-markdown-content" @contextmenu.prevent="openEditorContextMenu" />
        <MarkdownSelectionMenu
            v-if="editor"
            :editor="editor"
            :readonly="props.readonly"
            @insert-reference="openReferenceMenuFromContext"
            @insert-image="void insertImageFromMenu()"
            @add-comment="void addCommentFromMenu()"
            @add-ruby="void addRubyFromMenu()"
            @add-bilingual="void addBilingualFromMenu()"
            @add-ai-reference="addAiReferenceFromSelection"
            @generate-illustration="generateIllustrationFromSelection"
        />

        <ReferenceSelectorPopover
            v-if="menuVisible && suggestionMenuState"
            :title="suggestionMenuState.title"
            :prefix="suggestionMenuState.prefix"
            :sections="suggestionMenuState.sections"
            :active-index="activeIndex"
            :anchor-element="wrapperRef"
            :anchor-rect="suggestionMenuState.anchorRect"
            :teleport-target="popoverTeleportTarget"
            density="compact"
            :direction="props.popoverDirection"
            :match-anchor-width="props.matchPopoverWidth"
            @hover="activeIndex = $event"
            @select="selectMenuItem"
        />

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="contextMenuVisible = false"
        />
    </div>
</template>

<style scoped>
.tiptap-markdown-wrapper {
    position: relative;
    height: 100%;
    min-height: 100%;
    overflow-y: auto;
    background: var(--editor-bg);
}

.tiptap-markdown-content {
    min-height: 100%;
}

:deep(.nb-markdown-editor) {
    counter-reset: nb-inline-comment;
    max-width: calc(var(--nb-markdown-editor-content-width) + 48px);
    min-height: 100%;
    margin: 0 auto;
    padding: 20px 24px 32px;
    color: var(--text-main);
    font-family: var(--nb-markdown-editor-font-family);
    font-size: var(--nb-markdown-editor-font-size);
    line-height: var(--nb-markdown-editor-line-height);
    white-space: pre-wrap;
    word-break: break-word;
}

:deep(.nb-markdown-editor p) {
    margin: 0 0 0.75rem;
}

:deep(.nb-markdown-editor > p) {
    text-indent: var(--nb-markdown-editor-paragraph-indent);
}

:deep(.nb-markdown-editor h1),
:deep(.nb-markdown-editor h2),
:deep(.nb-markdown-editor h3) {
    margin: 1.2em 0 0.6em;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    font-weight: 700;
    line-height: 1.22;
}

:deep(.nb-markdown-editor h1) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.72);
}

:deep(.nb-markdown-editor h2) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.42);
}

:deep(.nb-markdown-editor h3) {
    font-size: calc(var(--nb-markdown-editor-font-size) * 1.18);
}

:deep(.nb-markdown-editor strong) {
    font-weight: 700;
}

:deep(.nb-markdown-editor em) {
    font-style: italic;
}

:deep(.nb-markdown-editor u) {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
}

:deep(.nb-markdown-editor s),
:deep(.nb-markdown-editor del),
:deep(.nb-markdown-editor strike) {
    text-decoration: line-through;
}

:deep(.nb-markdown-editor sup) {
    vertical-align: super;
    font-size: 0.72em;
    line-height: 0;
}

:deep(.nb-markdown-editor sub) {
    vertical-align: sub;
    font-size: 0.72em;
    line-height: 0;
}

:deep(.nb-markdown-editor mark) {
    border-radius: 0.2em;
    padding: 0.02em 0.12em;
}

:deep(.nb-markdown-editor ul),
:deep(.nb-markdown-editor ol) {
    margin: 0 0 0.9rem;
    padding-left: 1.7em;
    white-space: normal;
}

:deep(.nb-markdown-editor ul) {
    list-style: disc;
}

:deep(.nb-markdown-editor ol) {
    list-style: decimal;
}

:deep(.nb-markdown-editor li) {
    margin: 0.25rem 0;
    padding-left: 0.15em;
}

:deep(.nb-markdown-editor li > p) {
    margin: 0.2rem 0;
    text-indent: 0;
}

:deep(.nb-markdown-editor .tableWrapper) {
    margin: 0 0 1rem;
    overflow-x: auto;
}

:deep(.nb-markdown-editor table) {
    width: 100%;
    min-width: 24rem;
    border-collapse: collapse;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--editor-bg);
    table-layout: fixed;
    white-space: normal;
}

:deep(.nb-markdown-editor th),
:deep(.nb-markdown-editor td) {
    min-width: 6rem;
    border: 1px solid var(--border-color);
    padding: 0.45rem 0.6rem;
    color: var(--text-main);
    text-align: left;
    vertical-align: top;
}

:deep(.nb-markdown-editor th) {
    background: var(--source-bg);
    color: var(--text-secondary);
    font-weight: 700;
}

:deep(.nb-markdown-editor td p),
:deep(.nb-markdown-editor th p) {
    margin: 0;
    text-indent: 0;
}

:deep(.nb-markdown-editor blockquote) {
    margin: 0 0 1rem;
    border-left: 3px solid color-mix(in srgb, var(--accent-main) 56%, var(--border-color));
    padding-left: 1rem;
    color: var(--text-secondary);
    font-style: italic;
}

:deep(.nb-markdown-editor pre) {
    margin: 0 0 1rem;
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--source-bg);
    padding: 0.9rem 1rem;
    white-space: pre;
}

:deep(.nb-markdown-editor pre code) {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--source-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9em;
}

:deep(.nb-markdown-editor :not(pre) > code) {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--source-bg);
    padding: 0.04rem 0.34rem;
    color: var(--source-text);
    font-family: inherit;
    font-size: 0.95em;
    line-height: 1.25;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
}

:deep(.nb-markdown-editor img.nb-markdown-image-node) {
    display: block;
    max-width: min(100%, 560px);
    max-height: 360px;
    margin: 0.25rem 0 1rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: color-mix(in srgb, var(--source-bg) 88%, var(--shadow-color) 12%);
    object-fit: contain;
}

:deep(.nb-markdown-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
    color: var(--text-muted);
}

:deep(.nb-markdown-editor a) {
    color: var(--accent-text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    cursor: pointer;
}

:deep(.nb-markdown-editor a:hover) {
    color: color-mix(in srgb, var(--accent-text) 82%, var(--text-main));
}

:deep(.nb-inline-comment-mark) {
    position: relative;
    border-radius: 0.18em;
    background: transparent;
    padding: 0;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    cursor: text;
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: var(--status-warning);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
}

:deep(.nb-inline-comment-mark.is-active) {
    background: var(--status-warning-bg);
    box-shadow: inset 0 0 0 1px var(--status-warning-border);
}

:deep(.nb-inline-comment-mark[data-inline-comment-index])::after {
    content: attr(data-inline-comment-index);
    position: absolute;
    right: -0.52em;
    top: -0.64em;
    z-index: 1;
    display: inline-flex;
    min-width: 0.82rem;
    height: 0.82rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--status-warning);
    border-radius: 999px;
    background: var(--editor-bg);
    color: var(--status-warning);
    font-size: 0.52em;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
}

:deep(.nb-inline-comment-mark.is-active[data-inline-comment-index])::after {
    background: var(--status-warning);
    color: var(--text-inverse);
}

/* 跨段落评论块：左侧批注色竖线 + 顶部批注正文行 */
:deep(.nb-comment-block) {
    position: relative;
    margin: 0 0 1rem;
    border-left: 3px solid var(--status-warning);
    border-radius: 0 8px 8px 0;
    background: color-mix(in srgb, var(--status-warning-bg) 46%, transparent);
    padding: 0.55rem 0.8rem 0.35rem;
}

:deep(.nb-comment-block)::before {
    content: attr(data-comment-body);
    display: block;
    margin-bottom: 0.4rem;
    color: var(--status-warning);
    font-size: 0.78em;
    font-weight: 600;
    line-height: 1.4;
}

:deep(.nb-comment-block[data-comment-body=""])::before {
    display: none;
}

:deep(.nb-comment-block.is-active) {
    background: var(--status-warning-bg);
    box-shadow: inset 0 0 0 1px var(--status-warning-border);
}

/* 段落级双语对照块：原文上方的弱色对照译文行 */
:deep(.nb-bilingual-block) {
    margin: 0 0 1rem;
    border-left: 2px solid color-mix(in srgb, var(--status-info) 55%, transparent);
    padding: 0.2rem 0 0.1rem 0.8rem;
}

:deep(.nb-bilingual-block)::before {
    content: attr(data-bilingual-text);
    display: block;
    margin-bottom: 0.35rem;
    color: var(--status-info);
    font-size: 0.82em;
    line-height: 1.5;
    opacity: 0.88;
}

:deep(.nb-bilingual-block[data-bilingual-text=""])::before {
    display: none;
}

/* 注音（ruby）：正文上方小字标注 */
:deep(ruby.nb-ruby) {
    ruby-position: over;
    ruby-align: center;
}

:deep(ruby.nb-ruby rt.nb-ruby-text) {
    color: var(--text-secondary);
    font-size: 0.56em;
    line-height: 1.1;
    letter-spacing: 0.02em;
    user-select: none;
}

/* 显式 <html> 嵌入卡片：默认源码态，点击后 sandbox iframe 渲染 */
:deep(.nb-html-embed) {
    margin: 0 0 1rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--source-bg);
}

:deep(.nb-html-embed__header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    background: color-mix(in srgb, var(--bg-panel) 60%, transparent);
    padding: 0.3rem 0.4rem 0.3rem 0.65rem;
}

:deep(.nb-html-embed__caption) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.74em;
    font-weight: 600;
    letter-spacing: 0.04em;
    user-select: none;
}

:deep(.nb-html-embed__icon) {
    width: 0.9em;
    height: 0.9em;
}

:deep(.nb-html-embed__toggle) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-panel);
    padding: 0.14rem 0.6rem;
    color: var(--text-secondary);
    font-size: 0.72em;
    line-height: 1.4;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

:deep(.nb-html-embed__toggle-icon) {
    width: 0.95em;
    height: 0.95em;
    flex: none;
}

/* 源码态的「渲染」是主操作，accent 提高可供性 */
:deep(.nb-html-embed__toggle.is-idle) {
    border-color: color-mix(in srgb, var(--accent-main) 45%, var(--border-color));
    color: var(--accent-main);
}

:deep(.nb-html-embed__toggle.is-idle:hover) {
    border-color: var(--accent-main);
    background: var(--accent-bg);
}

:deep(.nb-html-embed__toggle.is-rendered:hover) {
    background: var(--bg-hover);
    color: var(--text-main);
}

:deep(.nb-html-embed__source) {
    margin: 0;
    overflow: auto;
    /* 超长 HTML 源码限高滚动，避免源码态卡片占满整屏 */
    max-height: 280px;
    min-height: 1.6em;
    padding: 0.6rem 0.75rem;
    color: var(--source-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.82em;
    line-height: 1.5;
    white-space: pre;
}

:deep(.nb-html-embed__frame) {
    display: block;
    width: 100%;
    min-height: 40px;
    border: 0;
    background: var(--editor-bg);
    opacity: 0;
    transition: opacity 0.16s ease;
}

:deep(.nb-html-embed__frame.is-loaded) {
    opacity: 1;
}

:deep(.nb-html-embed.ProseMirror-selectednode) {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 45%, transparent);
}

/* 块级未知 HTML 兜底：低调源码块，只保数据不渲染 */
:deep(pre.nb-html-block) {
    margin: 0 0 1rem;
    overflow-x: auto;
    border: 1px dashed color-mix(in srgb, var(--border-color) 85%, transparent);
    border-radius: 8px;
    background: var(--source-bg);
    padding: 0.55rem 0.75rem;
    color: var(--source-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.82em;
    line-height: 1.5;
    white-space: pre;
}

:deep(pre.nb-html-block.ProseMirror-selectednode) {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 45%, transparent);
}

/* 行内未知标签兜底 chip：code 风格原样保留 */
:deep(.nb-raw-inline-html) {
    border: 1px dashed color-mix(in srgb, var(--border-color) 85%, transparent);
    border-radius: 6px;
    background: var(--source-bg);
    padding: 0.02rem 0.3rem;
    color: var(--source-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.82em;
    line-height: 1.3;
}

:deep(.nb-workspace-reference-node) {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin: 0 0.1rem;
    vertical-align: baseline;
}

:deep(align[value="center"]) {
    display: block;
    text-align: center;
}

:deep(align[value="right"]) {
    display: block;
    text-align: right;
}

:deep(align[value="justify"]) {
    display: block;
    text-align: justify;
}

:deep(.nb-inline-ai-reference-mark) {
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-color: color-mix(in srgb, var(--accent-main) 78%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    border-radius: 3px;
}

:deep(.nb-inline-ai-reference-highlight) {
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent-main) 18%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 20%, transparent);
    transition: background 120ms ease, box-shadow 120ms ease;
}
</style>
