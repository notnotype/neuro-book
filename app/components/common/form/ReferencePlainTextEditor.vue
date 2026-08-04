<script setup lang="ts">
import {canonicalImageMime} from "nbook/shared/media/raster-image";
import {EditorContent, useEditor} from "@tiptap/vue-3";
import type {Content, Editor} from "@tiptap/core";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {flattenAgentSuggestionItems, type AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {createPlainReferenceTextExtensions} from "nbook/app/components/common/form/tiptap/plain-reference-text-extensions";
import {
    parsePlainReferenceInlineContent,
    parsePlainReferenceText,
    serializePlainReferenceDoc,
    type PlainImageNodeAttrs,
    type PlainPendingImageNodeAttrs,
    type PlainTextProseMirrorNode,
} from "nbook/app/utils/plain-reference-text";
import type {ComposerImageNode} from "nbook/app/components/novel-ide/agent/composer-image-transaction";

const props = withDefaults(defineProps<{
    modelValue: string;
    placeholder?: string;
    ariaLabel?: string;
    minHeight?: number;
    maxHeight?: number;
    expanded?: boolean;
    readonly?: boolean;
    borderless?: boolean;
    submitOnEnter?: boolean;
    /** 为 true 时，Ctrl/Meta+Enter 也提交；普通多行编辑器保持关闭。 */
    submitOnModifierEnter?: boolean;
    enableQuickTriggers?: boolean;
    matchPopoverWidth?: boolean;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    enableImageFiles?: boolean;
}>(), {
    placeholder: "",
    ariaLabel: "",
    minHeight: 36,
    maxHeight: 150,
    expanded: false,
    readonly: false,
    borderless: false,
    submitOnEnter: false,
    submitOnModifierEnter: false,
    enableQuickTriggers: false,
    matchPopoverWidth: false,
    menuRefreshKey: "",
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    onSkillTriggerStart: () => {},
    enableImageFiles: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "image-files", payload: {files: File[]; position?: number}): void;
    (e: "image-files-blocked"): void;
    (e: "pending-image-retry", uploadId: string): void;
    (e: "pending-image-remove", uploadId: string): void;
    (e: "image-document", nodes: ComposerImageNode[]): void;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const bodyRef = ref<HTMLDivElement | null>(null);
const suggestionMenuState = ref<AgentSuggestionMenuState | null>(null);
const activeIndex = ref(0);
const syncingFromOutside = ref(false);
const editorSnapshot = ref(props.modelValue);
const heightPx = ref(props.minHeight);
const overflowing = ref(false);
const shouldStickToBottom = ref(false);
const skillTriggerStarted = ref(false);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | null = null;
// 外部替换内容时从顶部开始；用户在编辑器内继续输入时仍按 sticky-bottom 状态处理。
let scrollToTopOnNextMeasure = Boolean(props.modelValue);
const STICKY_BOTTOM_THRESHOLD_PX = 12;

const menuVisible = computed(() => Boolean(suggestionMenuState.value && suggestionMenuState.value.items.length > 0));
const skillTriggerActive = computed(() => suggestionMenuState.value?.contextKind === "skill");
const popoverTeleportTarget = computed(() => wrapperRef.value?.closest(".novel-ide-theme") as HTMLElement | null);
const rootClass = computed(() => props.borderless ? "reference-plain-text-editor--borderless" : "");
const effectiveMinHeight = computed(() => props.expanded ? Math.max(props.minHeight, 220) : props.minHeight);
const effectiveMaxHeight = computed(() => props.expanded ? Math.max(props.maxHeight, 420) : props.maxHeight);
const bodyStyle = computed(() => ({
    height: `${heightPx.value}px`,
    minHeight: `${effectiveMinHeight.value}px`,
    maxHeight: `${effectiveMaxHeight.value}px`,
    overflowY: overflowing.value ? "auto" as const : "hidden" as const,
}));

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
 * 当前编辑器内容序列化为普通文本。
 */
function readEditorText(currentEditor: Editor | null | undefined): string {
    const json = currentEditor?.state.doc.toJSON() as PlainTextProseMirrorNode | undefined;
    return json ? serializePlainReferenceDoc(json) : editorSnapshot.value;
}

/** 直接投影 TipTap 文档中的图片节点；按键热路径不重新解析 Markdown。 */
function readImageDocument(currentEditor: Editor | null | undefined): ComposerImageNode[] {
    const nodes: ComposerImageNode[] = [];
    currentEditor?.state.doc.descendants((node) => {
        if (node.type.name === "plainImage") {
            const bytes = finiteNumber(node.attrs.bytes);
            const locatorContentIndex = finiteNumber(node.attrs.locatorContentIndex);
            nodes.push({
                kind: "stable",
                index: nodes.length,
                label: String(node.attrs.label ?? ""),
                target: String(node.attrs.target ?? ""),
                ...(typeof node.attrs.attachmentId === "string" ? {attachmentId: node.attrs.attachmentId} : {}),
                ...(typeof node.attrs.mimeType === "string" ? {mimeType: node.attrs.mimeType} : {}),
                ...(bytes === null ? {} : {bytes}),
                ...(typeof node.attrs.name === "string" ? {name: node.attrs.name} : {}),
                ...(typeof node.attrs.locatorEntryId === "string" ? {locatorEntryId: node.attrs.locatorEntryId} : {}),
                ...(locatorContentIndex === null ? {} : {locatorContentIndex}),
            });
            return;
        }
        if (node.type.name === "plainPendingImage") {
            nodes.push({
                kind: "pending",
                index: nodes.length,
                uploadId: String(node.attrs.uploadId ?? ""),
                name: String(node.attrs.name ?? "图片"),
                status: node.attrs.status === "failed" ? "failed" : "uploading",
                ...(typeof node.attrs.error === "string" && node.attrs.error ? {error: node.attrs.error} : {}),
            });
        }
    });
    return nodes;
}

function emitImageDocument(currentEditor: Editor | null | undefined = editor.value): void {
    emit("image-document", readImageDocument(currentEditor));
}

const editor = useEditor({
    content: parsePlainReferenceText(props.modelValue) as Content,
    extensions: createPlainReferenceTextExtensions({
        placeholder: props.placeholder,
        resolveMenu: props.resolveMenu,
        onMenuStateChange: syncMenuState,
        getMenuState: () => suggestionMenuState.value,
        getActiveIndex: () => activeIndex.value,
        setActiveIndex: (index: number) => {
            activeIndex.value = index;
        },
        enableQuickTriggers: props.enableQuickTriggers,
        onPendingImageRetry: (uploadId) => emit("pending-image-retry", uploadId),
        onPendingImageRemove: (uploadId) => emit("pending-image-remove", uploadId),
    }),
    editable: !props.readonly,
    editorProps: {
        attributes: {
            class: `reference-plain-text-editor__prosemirror outline-none${props.readonly ? " reference-plain-text-editor__prosemirror--readonly" : ""}`,
            spellcheck: "false",
            role: "textbox",
            "aria-multiline": "true",
            "aria-readonly": String(props.readonly),
            "aria-label": props.ariaLabel || props.placeholder,
            "data-readonly": String(props.readonly),
        },
        handleDOMEvents: {
            focus: () => {
                emit("focus");
                return false;
            },
            blur: () => {
                emit("blur");
                return false;
            },
            keydown: (_view, event) => {
                if (props.readonly) {
                    return false;
                }
                if (event.key === "Tab" && event.shiftKey) {
                    event.preventDefault();
                    emit("shift-tab");
                    return true;
                }
                if (
                    event.key === "Enter"
                    && !event.shiftKey
                    && !menuVisible.value
                    // 输入法候选确认也会产生 Enter keydown，组合态必须交回编辑器。
                    && !event.isComposing
                    && event.keyCode !== 229
                    && (props.submitOnEnter || (props.submitOnModifierEnter && (event.ctrlKey || event.metaKey)))
                ) {
                    event.preventDefault();
                    emit("submit", {ctrlKey: event.ctrlKey, metaKey: event.metaKey});
                    return true;
                }
                return false;
            },
            paste: (_view, event) => {
                const files = supportedImageFiles(event.clipboardData?.files);
                if (props.readonly) {
                    event.preventDefault();
                    if (files.length > 0) {
                        emit("image-files-blocked");
                    }
                    return true;
                }
                if (!props.enableImageFiles && files.length > 0) {
                    event.preventDefault();
                    emit("image-files-blocked");
                    return true;
                }
                if (props.enableImageFiles && files.length > 0) {
                    event.preventDefault();
                    emit("image-files", {files});
                    return true;
                }
                const text = event.clipboardData?.getData("text/plain") ?? "";
                event.preventDefault();
                if (!text) {
                    return true;
                }
                insertTextIntoEditor(editor.value, text);
                return true;
            },
            dragover: (_view, event) => {
                if (!props.readonly && props.enableImageFiles && supportedImageFiles(event.dataTransfer?.files).length > 0) {
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = "copy";
                    }
                    return true;
                }
                return false;
            },
            drop: (view, event) => {
                const files = supportedImageFiles(event.dataTransfer?.files);
                if (files.length === 0) {
                    return false;
                }
                if (props.readonly || !props.enableImageFiles) {
                    event.preventDefault();
                    emit("image-files-blocked");
                    return true;
                }
                event.preventDefault();
                const position = view.posAtCoords({left: event.clientX, top: event.clientY})?.pos;
                emit("image-files", {
                    files,
                    ...(position === undefined ? {} : {position}),
                });
                return true;
            },
        },
    },
    onCreate: () => {
        scheduleHeightMeasure();
        queueMicrotask(() => emitImageDocument());
    },
    onUpdate: ({editor: currentEditor}) => {
        scheduleHeightMeasure();
        emitImageDocument(currentEditor);
        if (syncingFromOutside.value) {
            return;
        }
        const nextValue = readEditorText(currentEditor);
        if (nextValue === editorSnapshot.value) {
            return;
        }
        editorSnapshot.value = nextValue;
        emit("update:modelValue", nextValue);
    },
});

watch(() => props.modelValue, (nextValue) => {
    if (nextValue === editorSnapshot.value) {
        return;
    }
    editorSnapshot.value = nextValue;
    syncingFromOutside.value = true;
    editor.value?.commands.setContent(parsePlainReferenceText(nextValue) as Content, {
        emitUpdate: false,
    });
    scrollToTopOnNextMeasure = true;
    shouldStickToBottom.value = false;
    scheduleHeightMeasure();
    queueMicrotask(() => {
        syncingFromOutside.value = false;
        emitImageDocument();
    });
});

/** 同步 TipTap 的真实编辑门禁与可访问性只读语义。 */
function syncReadonlyState(readonly: boolean): void {
    const currentEditor = editor.value;
    currentEditor?.setEditable(!readonly);
    const editorRoot = currentEditor?.view.dom;
    if (!editorRoot) {
        return;
    }
    editorRoot.setAttribute("role", "textbox");
    editorRoot.setAttribute("aria-multiline", "true");
    editorRoot.setAttribute("aria-readonly", String(readonly));
    editorRoot.setAttribute("data-readonly", String(readonly));
    editorRoot.classList.toggle("reference-plain-text-editor__prosemirror--readonly", readonly);
}

watch(() => props.readonly, syncReadonlyState, {immediate: true});

/** 同步 contenteditable 根节点的可访问性名称。 */
function syncAccessibleName(): void {
    const editorRoot = editor.value?.view.dom;
    if (!editorRoot) return;
    const label = props.ariaLabel || props.placeholder;
    if (label) {
        editorRoot.setAttribute("aria-label", label);
        return;
    }
    editorRoot.removeAttribute("aria-label");
}

watch(() => [props.ariaLabel, props.placeholder], syncAccessibleName, {immediate: true});

watch(() => [props.minHeight, props.maxHeight, props.expanded], () => {
    scheduleHeightMeasure();
});

watch(() => props.menuRefreshKey, () => {
    refreshActiveMenu();
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

onMounted(() => {
    syncReadonlyState(props.readonly);
    syncAccessibleName();
    if (bodyRef.value) {
        resizeObserver = new ResizeObserver(() => {
            scheduleHeightMeasure();
        });
        resizeObserver.observe(bodyRef.value);
    }
    scheduleHeightMeasure();
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (resizeFrame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = null;
});

/**
 * 聚焦编辑器。
 */
function focus(): void {
    editor.value?.commands.focus();
}

/**
 * 在当前光标插入纯文本，并把系统 token 转成 chip。
 */
function insertText(text: string): void {
    insertTextIntoEditor(editor.value, text);
}

/** 在当前光标或拖拽落点插入稳定图片节点。 */
function insertImage(image: PlainImageNodeAttrs, position?: number): void {
    if (!editor.value || props.readonly) {
        return;
    }
    editor.value.chain().focus().insertContentAt(position ?? editor.value.state.selection.from, {
        type: "plainImage",
        attrs: image,
    }).run();
    scheduleHeightMeasure();
}

/** 按文件原顺序插入唯一 pending 节点，后续响应按 uploadId 原位替换。 */
function insertPendingImages(
    items: Array<{uploadId: string; name: string}>,
    position?: number,
): void {
    if (!editor.value || props.readonly || items.length === 0) {
        return;
    }
    editor.value.chain().focus().insertContentAt(
        position ?? editor.value.state.selection.from,
        items.map((item) => ({
            type: "plainPendingImage",
            attrs: {...item, status: "uploading", error: ""},
        })),
    ).run();
    scheduleHeightMeasure();
}

/** 上传成功后只替换对应 pending 节点，不依赖请求返回顺序。 */
function replacePendingImage(uploadId: string, image: PlainImageNodeAttrs): void {
    const match = findPendingImage(uploadId);
    if (!editor.value || !match) {
        return;
    }
    const imageType = editor.value.state.schema.nodes.plainImage;
    if (!imageType) {
        return;
    }
    editor.value.view.dispatch(editor.value.state.tr
        .replaceWith(match.position, match.position + match.size, imageType.create(image))
        .setMeta("addToHistory", false));
    scheduleHeightMeasure();
}

/** 标记上传失败，保留原位置供重试或移除。 */
function failPendingImage(uploadId: string, error: string): void {
    const match = findPendingImage(uploadId);
    if (!editor.value || !match) {
        return;
    }
    editor.value.view.dispatch(editor.value.state.tr
        .setNodeMarkup(match.position, undefined, {...match.attrs, status: "failed", error})
        .setMeta("addToHistory", false));
    scheduleHeightMeasure();
}

/** 把失败节点恢复为上传中。 */
function startPendingImage(uploadId: string): void {
    const match = findPendingImage(uploadId);
    if (!editor.value || !match) {
        return;
    }
    editor.value.view.dispatch(editor.value.state.tr
        .setNodeMarkup(match.position, undefined, {...match.attrs, status: "uploading", error: ""})
        .setMeta("addToHistory", false));
}

/** 移除指定 pending 节点。 */
function removePendingImage(uploadId: string): void {
    const match = findPendingImage(uploadId);
    if (!editor.value || !match || props.readonly) {
        return;
    }
    editor.value.view.dispatch(editor.value.state.tr.delete(match.position, match.position + match.size));
    scheduleHeightMeasure();
}

/** Session 切换时一次性清除全部临时节点。 */
function clearPendingImages(): void {
    if (!editor.value) {
        return;
    }
    const matches: Array<{position: number; size: number}> = [];
    editor.value.state.doc.descendants((node, position) => {
        if (node.type.name === "plainPendingImage") {
            matches.push({position, size: node.nodeSize});
        }
    });
    if (matches.length === 0) {
        return;
    }
    const transaction = matches
        .sort((left, right) => right.position - left.position)
        .reduce((current, match) => current.delete(match.position, match.position + match.size), editor.value.state.tr)
        .setMeta("addToHistory", false);
    editor.value.view.dispatch(transaction);
    scheduleHeightMeasure();
}

/** 删除正文中的第 N 个稳定图片标记；不会删除 Session Attachment 登记。 */
function removeImageAt(imageIndex: number): void {
    if (!editor.value || props.readonly || imageIndex < 0) {
        return;
    }
    let currentIndex = 0;
    let match: {position: number; size: number} | null = null;
    editor.value.state.doc.descendants((node, position) => {
        if (!match && node.type.name === "plainImage") {
            if (currentIndex === imageIndex) {
                match = {position, size: node.nodeSize};
            }
            currentIndex += 1;
        }
    });
    if (!match) {
        return;
    }
    const resolvedMatch = match as {position: number; size: number};
    editor.value.view.dispatch(editor.value.state.tr.delete(
        resolvedMatch.position,
        resolvedMatch.position + resolvedMatch.size,
    ));
    scheduleHeightMeasure();
}

/** 为草稿/历史恢复出的稳定节点批量补齐 canonical metadata，不进入 Undo 历史。 */
function hydrateImages(items: readonly PlainImageNodeAttrs[]): void {
    if (!editor.value || items.length === 0) {
        return;
    }
    const byTarget = new Map(items.map((item) => [item.target, item]));
    let transaction = editor.value.state.tr;
    editor.value.state.doc.descendants((node, position) => {
        if (node.type.name !== "plainImage") {
            return;
        }
        const item = byTarget.get(String(node.attrs.target ?? ""));
        if (!item) {
            return;
        }
        if (node.attrs.label === item.label
            && node.attrs.target === item.target
            && node.attrs.attachmentId === (item.attachmentId ?? null)
            && node.attrs.mimeType === (item.mimeType ?? null)
            && node.attrs.bytes === (item.bytes ?? null)
            && node.attrs.name === (item.name ?? null)
            && node.attrs.locatorEntryId === (item.locatorEntryId ?? null)
            && node.attrs.locatorContentIndex === (item.locatorContentIndex ?? null)) {
            return;
        }
        transaction = transaction.setNodeMarkup(position, undefined, {...node.attrs, ...item});
    });
    if (transaction.docChanged) {
        editor.value.view.dispatch(transaction.setMeta("addToHistory", false));
    }
}

/**
 * 获取当前纯文本。
 */
function getText(): string {
    return readEditorText(editor.value);
}

/**
 * 使用菜单项 id 选择当前 suggestion item。
 */
function selectMenuItem(itemId: string): void {
    const state = suggestionMenuState.value;
    const item = state?.items.find((current) => current.id === itemId);
    if (!state || !item || item.disabled) {
        return;
    }
    state.command(item);
}

/**
 * 外部数据加载完成后，刷新当前仍打开的 suggestion 菜单。
 */
function refreshActiveMenu(): void {
    const currentState = suggestionMenuState.value;
    if (!currentState) {
        return;
    }

    const menuState = props.resolveMenu({
        kind: currentState.contextKind,
        query: currentState.query,
        hasPlainTextBeforeTrigger: currentState.hasPlainTextBeforeTrigger,
    });
    const items = flattenAgentSuggestionItems(menuState.sections);
    const nextActiveIndex = items.length > 0
        ? Math.min(items.length - 1, Math.max(0, activeIndex.value))
        : 0;

    suggestionMenuState.value = {
        ...currentState,
        title: menuState.title,
        prefix: menuState.prefix,
        sections: menuState.sections,
        items,
    };
    activeIndex.value = nextActiveIndex;
}

/**
 * 测量内容高度，保持输入框随内容增长。
 */
function scheduleHeightMeasure(): void {
    if (resizeFrame !== null) {
        return;
    }
    if (typeof requestAnimationFrame === "function") {
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            measureHeight();
        });
        return;
    }
    nextTick(() => {
        resizeFrame = null;
        measureHeight();
    });
}

function measureHeight(): void {
    const body = bodyRef.value;
    if (!body) {
        heightPx.value = effectiveMinHeight.value;
        overflowing.value = false;
        shouldStickToBottom.value = true;
        return;
    }

    const previousScrollTop = body.scrollTop;
    const shouldResetScrollToTop = scrollToTopOnNextMeasure;
    scrollToTopOnNextMeasure = false;
    // 输入更新后 DOM 可能已经变高，当前 near-bottom 会失真；用滚动事件记录用户变更前是否吸底。
    const wasStickyToBottom = !shouldResetScrollToTop && (shouldStickToBottom.value || isBodyNearBottom(body));
    const previousHeight = body.style.height;
    const previousOverflowY = body.style.overflowY;
    body.style.height = "auto";
    body.style.overflowY = "hidden";
    const wantedHeight = Math.ceil(body.scrollHeight);
    body.style.height = previousHeight;
    body.style.overflowY = previousOverflowY;

    const boundedHeight = Math.min(Math.max(wantedHeight, effectiveMinHeight.value), effectiveMaxHeight.value);
    const nextOverflowing = wantedHeight > effectiveMaxHeight.value;
    heightPx.value = boundedHeight;
    overflowing.value = nextOverflowing;
    if (!nextOverflowing) {
        shouldStickToBottom.value = true;
        nextTick(() => {
            if (bodyRef.value === body) {
                body.scrollTop = 0;
            }
        });
        return;
    }

    nextTick(() => {
        if (bodyRef.value !== body) {
            return;
        }
        if (shouldResetScrollToTop) {
            body.scrollTop = 0;
            shouldStickToBottom.value = isBodyNearBottom(body);
            return;
        }
        // 只有用户原本就在底部时才吸底；在上方编辑长文时要保留当前位置。
        if (wasStickyToBottom) {
            scrollBodyToBottom(body);
            return;
        }
        body.scrollTop = previousScrollTop;
        shouldStickToBottom.value = isBodyNearBottom(body);
    });
}

/**
 * 输入框内部滚动时更新吸底状态。
 */
function handleBodyScroll(): void {
    const body = bodyRef.value;
    if (!body) {
        shouldStickToBottom.value = true;
        return;
    }
    shouldStickToBottom.value = isBodyNearBottom(body);
}

/**
 * 判断当前滚动位置是否接近底部。
 */
function isBodyNearBottom(body: HTMLElement): boolean {
    return body.scrollHeight - (body.scrollTop + body.clientHeight) <= STICKY_BOTTOM_THRESHOLD_PX;
}

/**
 * 滚动到输入框底部，并记录为吸底状态。
 */
function scrollBodyToBottom(body: HTMLElement): void {
    body.scrollTop = body.scrollHeight;
    shouldStickToBottom.value = true;
}

function insertTextIntoEditor(currentEditor: Editor | null | undefined, text: string): void {
    if (!currentEditor || props.readonly) {
        return;
    }
    const content = parsePlainReferenceInlineContent(text) as Content;
    if (Array.isArray(content) && content.length === 0) {
        return;
    }
    currentEditor.chain().focus().insertContent(content).run();
    scheduleHeightMeasure();
}

function supportedImageFiles(list: FileList | null | undefined): File[] {
    return Array.from(list ?? []).filter((file) => canonicalImageMime(file.type) !== null);
}

function findPendingImage(uploadId: string): {
    position: number;
    size: number;
    attrs: PlainPendingImageNodeAttrs;
} | null {
    let result: {position: number; size: number; attrs: PlainPendingImageNodeAttrs} | null = null;
    editor.value?.state.doc.descendants((node, position) => {
        if (!result && node.type.name === "plainPendingImage" && node.attrs.uploadId === uploadId) {
            result = {
                position,
                size: node.nodeSize,
                attrs: {
                    uploadId: String(node.attrs.uploadId ?? ""),
                    name: String(node.attrs.name ?? "图片"),
                    status: node.attrs.status === "failed" ? "failed" : "uploading",
                    ...(typeof node.attrs.error === "string" ? {error: node.attrs.error} : {}),
                },
            };
        }
    });
    return result;
}

function finiteNumber(value: string | number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

defineExpose({
    clearPendingImages,
    failPendingImage,
    focus,
    insertText,
    insertImage,
    insertPendingImages,
    getText,
    hydrateImages,
    removePendingImage,
    removeImageAt,
    replacePendingImage,
    startPendingImage,
});
</script>

<template>
    <!-- 通用纯文本引用编辑器 -->
    <div
        ref="wrapperRef"
        class="reference-plain-text-editor relative overflow-visible"
        :class="[rootClass, {'reference-plain-text-editor--readonly': props.readonly}, props.borderless ? 'border-none bg-[var(--bg-panel)] shadow-none' : 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]']"
        :data-readonly="String(props.readonly)"
    >
        <div ref="bodyRef" class="reference-plain-text-editor__body" :style="bodyStyle" @scroll="handleBodyScroll">
            <EditorContent v-if="editor" :editor="editor" class="reference-plain-text-editor__content" />
        </div>

        <ReferenceSelectorPopover
            v-if="menuVisible && suggestionMenuState"
            :title="suggestionMenuState.title"
            :prefix="suggestionMenuState.prefix"
            :sections="suggestionMenuState.sections"
            :active-index="activeIndex"
            :anchor-element="wrapperRef"
            :anchor-rect="suggestionMenuState.anchorRect"
            :teleport-target="popoverTeleportTarget"
            direction="auto"
            density="compact"
            :match-anchor-width="props.matchPopoverWidth"
            @select="selectMenuItem"
            @hover="activeIndex = $event"
        />
    </div>
</template>

<style scoped>
.reference-plain-text-editor {
    --plain-reference-padding: 6px 9px;
    --plain-reference-font-size: 0.8125rem;
    --plain-reference-line-height: 1.45rem;
    border-radius: 8px;
}

.reference-plain-text-editor--borderless {
    border: none !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
    background: var(--bg-panel) !important;
    box-shadow: none !important;
}

.reference-plain-text-editor__body {
    background: var(--bg-panel);
    border-radius: inherit;
}

.reference-plain-text-editor__content {
    min-height: 100%;
}

:deep(.reference-plain-text-editor__prosemirror) {
    min-height: 100%;
    margin: 0;
    padding: var(--plain-reference-padding);
    color: var(--text-main);
    font-family: inherit;
    font-size: var(--plain-reference-font-size);
    line-height: var(--plain-reference-line-height);
    white-space: pre-wrap;
    word-break: break-word;
}

:deep(.reference-plain-text-editor__prosemirror--readonly) {
    cursor: not-allowed;
}

:deep(.reference-plain-text-editor__prosemirror p) {
    margin: 0 0 0.2rem;
}

:deep(.reference-plain-text-editor__prosemirror p:last-child) {
    margin-bottom: 0;
}

:deep(.reference-plain-text-editor__prosemirror p.is-editor-empty:first-child::before) {
    float: left;
    height: 0;
    color: var(--text-muted);
    content: attr(data-placeholder);
    pointer-events: none;
}

:deep(.nb-plain-reference-node) {
    display: inline-flex;
    margin: 0 0.1rem;
    vertical-align: baseline;
}

:deep(.nb-plain-image-node),
:deep(.nb-plain-pending-image-node) {
    display: inline-flex;
    max-width: 18rem;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0.1rem;
    padding: 0.1rem 0.35rem;
    border: 1px solid var(--status-info-border);
    border-radius: 0.35rem;
    background: var(--status-info-bg);
    color: var(--status-info);
    font-size: 0.72rem;
    line-height: 1.15rem;
    vertical-align: baseline;
}

:deep(.nb-plain-image-node__label),
:deep(.nb-plain-pending-image-node__label) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

:deep(.nb-plain-image-node__badge) {
    color: var(--text-muted);
    font-size: 0.62rem;
}

:deep(.nb-plain-pending-image-node.is-failed) {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger);
}

:deep(.nb-plain-pending-image-node__action),
:deep(.nb-plain-pending-image-node__remove) {
    border: 0;
    background: transparent;
    color: currentColor;
    cursor: pointer;
    font-size: 0.65rem;
}

:deep(.nb-plain-pending-image-node__spin) {
    animation: plain-image-spin 1s linear infinite;
}

@keyframes plain-image-spin {
    to { transform: rotate(360deg); }
}

:deep(.nb-plain-reference-node .nb-reference-chip),
:deep(.nb-agent-skill-node .nb-skill-chip) {
    vertical-align: baseline;
}
</style>
