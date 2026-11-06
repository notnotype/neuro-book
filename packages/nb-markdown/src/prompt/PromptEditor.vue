<script lang="ts">
import {Editor as VueEditor} from "@tiptap/vue-3";
import type {EditorState} from "@tiptap/pm/state";

/**
 * 状态直接取视图上的那份。@tiptap/vue-3 的 Editor 读的是一份随事务更新的响应式副本，
 * 换草稿版本时用 view.updateState 整份换掉状态（顺带清空撤销历史），那份副本不会跟着变。
 */
class PromptTiptapEditor extends VueEditor {
    override get state(): EditorState {
        return this.view.state;
    }
}

/** 页面内唯一的附件 localId。 */
let attachmentSequence = 0;

function nextAttachmentId(): string {
    attachmentSequence += 1;
    return `prompt-attachment-${attachmentSequence}`;
}
</script>

<script setup lang="ts">
/** 写给 Agent 的编辑组件（同名 .md；docs/specs/ui/prompt-editor.md）：文字是唯一真相，特殊内容按文字写法显示为小块与粘贴块。 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch, watchEffect} from "vue";
import type {Editor} from "@tiptap/core";
import {EditorContent} from "@tiptap/vue-3";
import {SuggestionMenu, suggestionMenuOptions, suggestionOptionId, type SuggestionMenuGroup, type SuggestionMenuItem} from "@notnotype/nb-ui/components";
import type {Node as PMNode} from "@tiptap/pm/model";
import {EditorState as PMEditorState, TextSelection} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";
import {provideMarkdownText} from "../host/text";
import type {MarkdownLocale} from "../locale";

import PromptAttachmentStrip from "./PromptAttachmentStrip.vue";
import PromptPasteBlockView from "./PromptPasteBlockView.vue";
import PromptTokenView from "./PromptTokenView.vue";
import {PromptAttachmentTracker, type PromptAttachmentExcerpt} from "./prompt-attachments";
import {
    DISMISS_TRIGGER,
    atomLeafText,
    createPromptExtensions,
    deleteAdjacentAtom,
    edgeSelection,
    insertParagraphAtGap,
    isEmptyPrompt,
    lineEdge,
    pendingLocalIds,
    promptTriggerKey,
    readyTokenNode,
    replaceWithBlocks,
    startBlockPosition,
    type PromptNodeContext,
    type PromptTriggerActive,
} from "./prompt-editor-extensions";
import type {
    PromptAttachmentCard,
    PromptEditorAttachment,
    PromptEditorAttachmentKind,
    PromptEditorDraft,
    PromptEditorMenu,
    PromptEditorMenuContext,
    PromptEditorMenuItem,
    PromptEditorPastePolicy,
    PromptEditorToken,
} from "./prompt-editor.types";
import {
    PROMPT_PENDING_NODE,
    classifyPaste,
    countPromptLines,
    maxPromptNumbers,
    normalizePastedText,
    parsePromptInsertion,
    parsePromptText,
    pasteBlockNode,
    pasteContent,
    pasteMarkerAttrs,
    renumberInsertion,
    resolvePastePolicy,
    PROMPT_ATOM_CHAR,
    tokenNode,
    triggerNeedsSpace,
    usedPromptNumbers,
    type PromptNodeJSON,
    type PromptNumberSet,
    type PromptNumbers,
    type PromptPendingAttrs,
} from "./prompt-text";

const props = withDefaults(defineProps<{
    draft: PromptEditorDraft;
    /** 只在上面没有注入翻译端口时起作用（`../host/text.ts`）。 */
    locale?: MarkdownLocale;
    placeholder?: string;
    ariaLabel?: string;
    readonly?: boolean;
    enterSubmits?: boolean;
    triggers?: readonly string[];
    resolveMenu?: (context: PromptEditorMenuContext) => PromptEditorMenu;
    menuPlacement?: "above" | "below";
    commands?: readonly string[];
    acceptImages?: boolean;
    acceptFiles?: boolean;
    attachments?: readonly PromptEditorAttachment[];
    resolveThumbnail?: (target: string) => string | null;
    pastePolicy?: Partial<PromptEditorPastePolicy>;
    recall?: readonly string[];
    minHeight?: number;
    maxHeight?: number;
    fill?: boolean;
    bare?: boolean;
}>(), {
    locale: undefined,
    placeholder: "",
    ariaLabel: "",
    readonly: false,
    enterSubmits: true,
    triggers: () => [],
    resolveMenu: () => ({items: []}),
    menuPlacement: "above",
    commands: () => [],
    acceptImages: false,
    acceptFiles: false,
    attachments: () => [],
    resolveThumbnail: () => null,
    pastePolicy: () => ({}),
    recall: () => [],
    minHeight: 36,
    maxHeight: 200,
    fill: false,
    bare: false,
});

const emit = defineEmits<{
    (e: "change", text: string): void;
    (e: "submit", payload: {mod: boolean}): void;
    (e: "escape"): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "menu-open", payload: {trigger: string}): void;
    (e: "token-activate", token: PromptEditorToken): void;
    (e: "attachment-add", payload: {localId: string; kind: PromptEditorAttachmentKind; file: File}): void;
    (e: "attachment-retry", payload: {localId: string}): void;
    (e: "attachment-remove", payload: {localId: string}): void;
    (e: "attachment-reject", payload: {kind: PromptEditorAttachmentKind; count: number}): void;
}>();

// 节点视图（粘贴块、小块）与附件条经 inject 拿到同一个端口。
const {t} = provideMarkdownText(() => props.locale);

const menuId = `prompt-menu-${useId()}`;

const editor = shallowRef<PromptTiptapEditor | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const historyMenuRef = ref<InstanceType<typeof SuggestionMenu> | null>(null);
const historySearchRef = ref<HTMLInputElement | null>(null);
const focused = ref(false);
const trigger = shallowRef<PromptTriggerActive | null>(null);
const activeItemId = ref<string | null>(null);
const highlighted = ref<string | null>(null);
/** 文档每变一次加一，附件条据此重新收集卡片。 */
const docRevision = ref(0);
/** Ctrl+R 搜索框里的文字；null 表示没打开。 */
const historyQuery = ref<string | null>(null);
const historyActiveId = ref<string | null>(null);

/** 最近一次读入或上报的文字，用来判断 change 是否真有变化。 */
let lastText = props.draft.text;
let loadedVersion = props.draft.version;
let deferredDraft = false;
/** 每套编号在这次编辑里用过的最大号：删掉的号不再使用。 */
let highWater: PromptNumbers = {image: 0, file: 0};
/** Ctrl/⌘+Shift+V 按下后到粘贴事件之间为真。 */
let rawPasteArmed = false;
/** 正在翻看的输入历史下标；正文改动后失效。 */
let recallIndex: number | null = null;

const tracker = new PromptAttachmentTracker({
    add: (localId, kind, file) => emit("attachment-add", {localId, kind, file}),
    remove: (localId) => emit("attachment-remove", {localId}),
}, nextAttachmentId);

const attachmentStates = computed(() => new Map(props.attachments.map((item) => [item.localId, item])));
const pastePolicy = computed(() => resolvePastePolicy(props.pastePolicy));

const nodeContext: PromptNodeContext = {
    get readonly() {
        return props.readonly;
    },
    get highlighted() {
        return highlighted.value;
    },
    attachmentState: (nodeId) => attachmentStates.value.get(tracker.hostId(nodeId)) ?? null,
    activate: (token) => emit("token-activate", token),
    hover: (key) => {
        highlighted.value = key;
    },
    submit: () => emit("submit", {mod: true}),
};

onMounted(() => {
    const instance = new PromptTiptapEditor({
        content: parsePromptText(props.draft.text, {commands: props.commands}),
        editable: !props.readonly,
        extensions: createPromptExtensions({
            context: nodeContext,
            placeholder: () => props.placeholder,
            triggers: () => props.triggers,
            commands: () => props.commands,
            readonly: () => props.readonly,
            resolvedTarget: (nodeId) => tracker.resolvedTarget(nodeId),
            nodeViews: {token: PromptTokenView, pasteBlock: PromptPasteBlockView},
        }),
        coreExtensionOptions: {clipboardTextSerializer: {blockSeparator: "\n"}},
        editorProps: {
            attributes: {
                class: "prompt-editor__prosemirror",
                spellcheck: "false",
                role: "textbox",
                "aria-multiline": "true",
            },
            handleKeyDown,
            handlePaste,
            handleDrop,
            handleDOMEvents: {
                // 聚焦与失焦由正文区的 focusin、focusout 判断，这里只关菜单。
                blur: (view) => {
                    dismissTrigger(view);
                    return false;
                },
                keyup: () => {
                    rawPasteArmed = false;
                    return false;
                },
            },
        },
        onUpdate: ({editor: current}) => handleDocChange(current),
        onTransaction: ({editor: current}) => syncTrigger(current),
    });
    // 初始光标放在末尾；默认的开头位置在正文只有粘贴块时会退成全选。
    instance.view.dispatch(instance.state.tr.setSelection(edgeSelection(instance.state.doc, "end")));
    editor.value = instance;
    loadedVersion = props.draft.version;
    lastText = props.draft.text;
    highWater = maxPromptNumbers(docNodes(instance.state.doc));
    docRevision.value += 1;
});

onBeforeUnmount(() => {
    editor.value?.destroy();
    editor.value = null;
    tracker.dispose();
});

watch(() => props.draft.version, () => applyDraft());

watch(() => props.readonly, (readonly) => {
    editor.value?.setEditable(!readonly, false);
    if (readonly) {
        historyQuery.value = null;
    }
});

/** 宿主准备好的附件：节点换成写进文字的图片或文件标签，不进撤销历史。 */
watch(attachmentStates, (states) => {
    const current = editor.value;
    if (!current) {
        return;
    }
    const tr = current.state.tr;
    current.state.doc.descendants((node, pos) => {
        if (node.type.name !== PROMPT_PENDING_NODE) {
            return;
        }
        const nodeId = String(node.attrs.localId);
        const state = states.get(tracker.hostId(nodeId));
        if (state?.state !== "ready") {
            return;
        }
        tracker.resolve(nodeId, state.target);
        const from = tr.mapping.map(pos);
        tr.replaceWith(from, from + node.nodeSize, readyTokenNode(current.schema, node.attrs as PromptPendingAttrs, state.target));
    });
    if (tr.docChanged) {
        current.view.dispatch(tr.setMeta("addToHistory", false));
    }
});

function docNodes(doc: PMNode): PromptNodeJSON[] {
    return (doc.toJSON() as PromptNodeJSON).content ?? [];
}

function applyDraft(): void {
    const current = editor.value;
    if (!current || current.isDestroyed || loadedVersion === props.draft.version) {
        return;
    }
    if (current.view.composing) {
        deferredDraft = true;
        return;
    }
    tracker.reset(current.state.doc);
    const doc = current.schema.nodeFromJSON(parsePromptText(props.draft.text, {commands: props.commands}));
    // 新建状态而不是发事务：撤销历史随之清空，也不触发 update，因此不发 change。
    current.view.updateState(PMEditorState.create({doc, plugins: current.state.plugins, selection: edgeSelection(doc, "end")}));
    loadedVersion = props.draft.version;
    lastText = props.draft.text;
    recallIndex = null;
    highWater = maxPromptNumbers(docNodes(doc));
    trigger.value = null;
    docRevision.value += 1;
}

function handleDocChange(current: Editor): void {
    tracker.sync(current.state.doc);
    docRevision.value += 1;
    const text = current.getText({blockSeparator: "\n"});
    if (recallIndex !== null && text !== props.recall[recallIndex]) {
        recallIndex = null;
    }
    if (text !== lastText) {
        lastText = text;
        emit("change", text);
    }
}

function syncTrigger(current: Editor): void {
    // 输入法组字时冻结查询，组字结束的事务再更新。
    if (current.view.composing) {
        return;
    }
    if (deferredDraft) {
        deferredDraft = false;
        queueMicrotask(applyDraft);
    }
    const next = promptTriggerKey.getState(current.state)?.active ?? null;
    const prev = trigger.value;
    if (prev?.trigger !== next?.trigger || prev?.query !== next?.query || prev?.from !== next?.from || prev?.to !== next?.to || prev?.atStart !== next?.atStart) {
        trigger.value = next;
    }
}

function dismissTrigger(view: EditorView): void {
    if (promptTriggerKey.getState(view.state)?.active) {
        view.dispatch(view.state.tr.setMeta(promptTriggerKey, DISMISS_TRIGGER));
    }
}

const menuOpen = computed(() => focused.value && !props.readonly && trigger.value !== null && historyQuery.value === null);

const menu = computed<PromptEditorMenu | null>(() => {
    const active = trigger.value;
    if (!menuOpen.value || !active) {
        return null;
    }
    return props.resolveMenu({trigger: active.trigger, query: active.query, atStart: active.atStart});
});

watch(menu, (next) => {
    activeItemId.value = keepActive(next?.items ?? [], activeItemId.value);
});

watch(menuOpen, (open, wasOpen) => {
    if (open && !wasOpen && trigger.value) {
        emit("menu-open", {trigger: trigger.value.trigger});
    }
});

/**
 * 菜单项按组排成 SuggestionMenu 的分组：相邻的同组项是一段，组标题画在段首（与原来一样，组不合并不重排）。
 * 宿主的上下键在 `suggestionMenuOptions` 的顺序上移动，与这里排出的顺序相同。
 */
function toGroups(items: readonly PromptEditorMenuItem[]): SuggestionMenuGroup[] {
    const groups: {id: string; label?: string; items: SuggestionMenuItem[]}[] = [];
    items.forEach((item, index) => {
        const last = groups.at(-1);
        if (last === undefined || (item.group ?? undefined) !== last.label) groups.push({id: String(index), label: item.group || undefined, items: []});
        groups.at(-1)!.items.push({id: item.id, label: item.label, iconClass: item.iconClass, hint: item.description, disabled: item.disabled});
    });
    return groups;
}

/** 当前项的选项 id（`aria-activedescendant`）；当前项不在可选项里时为 null。 */
function activeOptionId(groups: readonly SuggestionMenuGroup[], activeId: string | null): string | null {
    const index = suggestionMenuOptions(groups).findIndex((item) => item.id === activeId);
    return index < 0 ? null : suggestionOptionId(menuId, index);
}

const menuGroups = computed(() => toGroups(menu.value?.items ?? []));
const menuSide = computed(() => (props.menuPlacement === "below" ? "bottom" : "top"));

function keepActive(items: readonly PromptEditorMenuItem[], current: string | null): string | null {
    if (items.some((item) => item.id === current && !item.disabled)) {
        return current;
    }
    return items.find((item) => !item.disabled)?.id ?? null;
}

function moveActive(items: readonly PromptEditorMenuItem[], current: string | null, delta: number): string | null {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) {
        return null;
    }
    const index = enabled.findIndex((item) => item.id === current);
    const next = index < 0 ? (delta > 0 ? 0 : enabled.length - 1) : (index + delta + enabled.length) % enabled.length;
    return enabled[next]!.id;
}

function confirmItem(id: string): void {
    const current = editor.value;
    const active = trigger.value;
    const item = menu.value?.items.find((candidate) => candidate.id === id);
    if (!current || !active || !item || item.disabled) {
        return;
    }
    insertParsed(current, item.insertText + (item.continues ? "" : " "), {from: active.from, to: active.to, structure: false});
    current.view.focus();
}

function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (event.isComposing || event.keyCode === 229) {
        return false;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === "v") {
        rawPasteArmed = true;
        return false;
    }
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a" && isEmptyPrompt(view.state.doc)) {
        return true;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "r") {
        void openHistory(view);
        return true;
    }
    if (menuOpen.value && handleMenuKey(view, event)) {
        return true;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && handleRecallKey(view, event)) {
        return true;
    }
    if (event.key === "Escape") {
        emit("escape");
        return true;
    }
    if (event.key === "Tab" && event.shiftKey) {
        emit("shift-tab");
        return true;
    }
    if (event.key === "Enter") {
        if (mod) {
            emit("submit", {mod: true});
            return true;
        }
        if (!event.shiftKey && props.enterSubmits) {
            emit("submit", {mod: false});
            return true;
        }
        return insertParagraphAtGap(view.state, view.dispatch) || splitLine(view);
    }
    if ((event.key === "Home" || event.key === "End") && !mod && !event.altKey) {
        return moveToLineEdge(view, event.key === "Home" ? "start" : "end", event.shiftKey);
    }
    if (event.key === "Backspace") {
        return deleteAdjacentAtom(view.state, view.dispatch, -1);
    }
    if (event.key === "Delete") {
        return deleteAdjacentAtom(view.state, view.dispatch, 1);
    }
    return false;
}

function moveToLineEdge(view: EditorView, side: "start" | "end", extend: boolean): boolean {
    const {selection} = view.state;
    const edge = selection instanceof TextSelection ? lineEdge(view, side) : null;
    if (edge === null) {
        return false;
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, extend ? selection.anchor : edge, edge)).scrollIntoView());
    return true;
}

function splitLine(view: EditorView): boolean {
    const {state} = view;
    const tr = state.tr.deleteSelection();
    const pos = tr.selection.from;
    if (tr.doc.resolve(pos).parent.type.name !== "paragraph") {
        return false;
    }
    tr.split(pos);
    view.dispatch(tr.scrollIntoView());
    return true;
}

function handleMenuKey(view: EditorView, event: KeyboardEvent): boolean {
    const items = menu.value?.items ?? [];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        activeItemId.value = moveActive(items, activeItemId.value, event.key === "ArrowDown" ? 1 : -1);
        return true;
    }
    if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && !event.ctrlKey && !event.metaKey) {
        // 没有可确认的项时回车照常发送、Tab 照常移动焦点。
        if (activeItemId.value === null) {
            return false;
        }
        confirmItem(activeItemId.value);
        return true;
    }
    if (event.key === "Escape") {
        dismissTrigger(view);
        return true;
    }
    return false;
}

/** 正文是否完全为空：没有文字、标签与粘贴块。 */
function isDocEmpty(doc: PMNode): boolean {
    return doc.childCount === 1 && doc.firstChild?.type.name === "paragraph" && doc.firstChild.childCount === 0;
}

/** 光标在正文第一个段落的视觉首行（上）或最后一个段落的视觉末行（下）。 */
function atEdgeLine(view: EditorView, direction: "up" | "down"): boolean {
    const {selection, doc} = view.state;
    if (!selection.empty || selection.$from.parent.type.name !== "paragraph") {
        return false;
    }
    const index = selection.$from.index(0);
    for (let other = 0; other < doc.childCount; other += 1) {
        const isOuter = direction === "up" ? other < index : other > index;
        if (isOuter && doc.child(other).type.name === "paragraph") {
            return false;
        }
    }
    return isDocEmpty(doc) || view.endOfTextblock(direction);
}

function handleRecallKey(view: EditorView, event: KeyboardEvent): boolean {
    if (props.recall.length === 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || props.readonly) {
        return false;
    }
    const {doc} = view.state;
    const browsing = recallIndex !== null && lastText === props.recall[recallIndex] && pendingLocalIds(doc).size === 0;
    if (event.key === "ArrowUp") {
        if (!(isDocEmpty(doc) || browsing) || !atEdgeLine(view, "up")) {
            return false;
        }
        const next = (browsing ? recallIndex! : -1) + 1;
        if (next < props.recall.length) {
            applyRecall(next);
        }
        return true;
    }
    if (!browsing || !atEdgeLine(view, "down")) {
        return false;
    }
    applyRecall(recallIndex! > 0 ? recallIndex! - 1 : null);
    return true;
}

/** 调出一条已发送的内容（null 为空正文），整体替换正文并发出 change；可以撤销。 */
function applyRecall(index: number | null): void {
    const current = editor.value;
    if (!current) {
        return;
    }
    const text = index === null ? "" : props.recall[index] ?? "";
    const doc = current.schema.nodeFromJSON(parsePromptText(text, {commands: props.commands}));
    const tr = current.state.tr.replaceWith(0, current.state.doc.content.size, doc.content);
    tr.setSelection(edgeSelection(tr.doc, "end"));
    recallIndex = index;
    current.view.dispatch(tr.scrollIntoView());
}

async function openHistory(view: EditorView): Promise<void> {
    if (props.readonly) {
        return;
    }
    dismissTrigger(view);
    historyQuery.value = "";
    historyActiveId.value = historyItems.value[0]?.id ?? null;
    focusSearchWhenMounted = true;
    await nextTick();
    historySearchRef.value?.focus();
}

/** 菜单的内容由浮层原语在打开后才挂上，搜索框可能晚于 nextTick 出现：它挂上时补一次聚焦。 */
let focusSearchWhenMounted = false;
function setHistorySearch(element: unknown): void {
    historySearchRef.value = element instanceof HTMLInputElement ? element : null;
    if (historySearchRef.value !== null && focusSearchWhenMounted) {
        focusSearchWhenMounted = false;
        historySearchRef.value.focus();
    }
}

const historyGroups = computed(() => toGroups(historyItems.value));
const historyDescendant = computed(() => activeOptionId(historyGroups.value, historyActiveId.value) ?? undefined);

const historyItems = computed<PromptEditorMenuItem[]>(() => {
    if (historyQuery.value === null) {
        return [];
    }
    const query = historyQuery.value.trim().toLowerCase();
    return props.recall.flatMap((entry, index) => {
        if (query && !entry.toLowerCase().includes(query)) {
            return [];
        }
        const lines = countPromptLines(entry);
        return [{
            id: String(index),
            label: entry.split("\n").find((line) => line.trim()) ?? entry,
            description: lines > 1 ? t("prompt.lines", {count: lines}) : undefined,
            insertText: entry,
        }];
    });
});

watch(historyItems, (items) => {
    historyActiveId.value = keepActive(items, historyActiveId.value);
});

function closeHistory(refocus: boolean): void {
    historyQuery.value = null;
    historyActiveId.value = null;
    if (refocus) {
        editor.value?.view.focus();
    }
}

function selectHistory(id: string): void {
    closeHistory(true);
    applyRecall(Number(id));
}

function onHistoryKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        historyActiveId.value = moveActive(historyItems.value, historyActiveId.value, event.key === "ArrowDown" ? 1 : -1);
    }
    else if (event.key === "Enter") {
        event.preventDefault();
        if (historyActiveId.value !== null) {
            selectHistory(historyActiveId.value);
        }
    }
    else if (event.key === "Escape") {
        event.preventDefault();
        closeHistory(true);
    }
}

/** 焦点离开搜索框、又不在菜单里（菜单传送出去了，不在组件的 DOM 里）：关掉输入历史，焦点去向不管。 */
function onHistoryFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (historyMenuRef.value?.contains(next) !== true) {
        closeHistory(false);
    }
}

/** 插入点两侧同一行的原文，决定插入的文字里哪些写法能成为标签。 */
function insertionContext(doc: PMNode, from: number, to: number): {before: string; after: string; firstLine: boolean} {
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    const fromInLine = $from.parent.type.name === "paragraph";
    const toInLine = $to.parent.type.name === "paragraph";
    return {
        before: fromInLine ? $from.parent.textBetween(0, $from.parentOffset, undefined, atomLeafText) : "",
        after: toInLine ? $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, atomLeafText) : "",
        firstLine: fromInLine && $from.index(0) === 0,
    };
}

function insertParsed(current: Editor, text: string, options: {from?: number; to?: number; structure: boolean}): void {
    const {state} = current;
    const from = options.from ?? state.selection.from;
    const to = options.to ?? state.selection.to;
    const blocks = parsePromptInsertion(text, {commands: props.commands, ...insertionContext(state.doc, from, to), structure: options.structure});
    const renumbered = renumberInsertion(blocks, usedPromptNumbers(docNodes(state.doc)), highWater);
    highWater = renumbered.highWater;
    current.view.dispatch(replaceWithBlocks(state.tr, from, to, renumbered.nodes));
}

function insertPlain(current: Editor, text: string, at?: {from: number; to: number}): void {
    const {state} = current;
    const blocks = text.split("\n").map((line): PromptNodeJSON => line ? {type: "paragraph", content: [{type: "text", text: line}]} : {type: "paragraph"});
    current.view.dispatch(replaceWithBlocks(state.tr, at?.from ?? state.selection.from, at?.to ?? state.selection.to, blocks));
}

function allocate(doc: PMNode, set: PromptNumberSet): number {
    highWater[set] = Math.max(highWater[set], maxPromptNumbers(docNodes(doc))[set]) + 1;
    return highWater[set];
}

function pasteTiered(current: Editor, text: string, at?: {from: number; to: number}): void {
    const policy = pastePolicy.value;
    const tier = classifyPaste(text, policy, props.acceptFiles);
    if (tier === "inline") {
        insertParsed(current, text, {...at, structure: false});
    }
    else if (tier === "block") {
        insertPasteBlock(current, pasteContent(text), policy.blockPlacement, at);
    }
    else {
        attachText(current, text, at);
    }
}

function insertPasteBlock(current: Editor, content: string, placement: PromptEditorPastePolicy["blockPlacement"], at?: {from: number; to: number}): void {
    const {state} = current;
    const from = at?.from ?? state.selection.from;
    const to = at?.to ?? state.selection.to;
    const number = allocate(state.doc, "file");
    if (placement === "inline") {
        current.view.dispatch(replaceWithBlocks(state.tr, from, to, [pasteBlockNode(number, content)]));
        return;
    }
    const start = startBlockPosition(state.doc);
    const tr = replaceWithBlocks(state.tr, from, to, [{type: "paragraph", content: [tokenNode(pasteMarkerAttrs(number))]}]);
    tr.insert(tr.mapping.map(start, -1), current.schema.nodeFromJSON(pasteBlockNode(number, content)));
    current.view.dispatch(tr.scrollIntoView());
}

function attachText(current: Editor, text: string, at?: {from: number; to: number}): void {
    const number = allocate(current.state.doc, "file");
    const name = `paste-${number}.txt`;
    const content = pasteContent(text);
    addPending(current, [{
        file: new File([content], name, {type: "text/plain"}),
        kind: "file",
        name,
        number,
        excerpt: {preview: content.split("\n").slice(0, 2).join("\n"), lines: countPromptLines(content)},
    }], at);
}

type PendingItem = {file: File; kind: PromptEditorAttachmentKind; name: string; number: number; excerpt: PromptAttachmentExcerpt | null};

function addFiles(current: Editor, list: readonly File[], at?: {from: number; to: number}): void {
    const rejected: Record<PromptEditorAttachmentKind, number> = {image: 0, file: 0};
    const accepted: PendingItem[] = [];
    for (const file of list) {
        const kind: PromptEditorAttachmentKind = file.type.startsWith("image/") ? "image" : "file";
        if (kind === "image" ? !props.acceptImages : !props.acceptFiles) {
            rejected[kind] += 1;
            continue;
        }
        accepted.push({file, kind, name: file.name || kind, number: allocate(current.state.doc, kind), excerpt: null});
    }
    for (const kind of ["image", "file"] as const) {
        if (rejected[kind] > 0) {
            emit("attachment-reject", {kind, count: rejected[kind]});
        }
    }
    if (accepted.length > 0) {
        addPending(current, accepted, at);
    }
}

function addPending(current: Editor, items: readonly PendingItem[], at?: {from: number; to: number}): void {
    const added = items.map((item) => ({localId: tracker.register(item.file, item.kind, item.excerpt), item}));
    const nodes = added.map(({localId, item}): PromptNodeJSON => ({
        type: PROMPT_PENDING_NODE,
        attrs: {localId, kind: item.kind, name: item.name, number: item.number} satisfies PromptPendingAttrs,
    }));
    const {state} = current;
    current.view.dispatch(replaceWithBlocks(state.tr, at?.from ?? state.selection.from, at?.to ?? state.selection.to, [{type: "paragraph", content: nodes}]));
    for (const {localId, item} of added) {
        tracker.announce(localId, item.kind);
    }
}

function handlePaste(_view: EditorView, event: ClipboardEvent): boolean {
    const raw = rawPasteArmed;
    rawPasteArmed = false;
    const current = editor.value;
    const data = event.clipboardData;
    if (props.readonly) {
        return true;
    }
    if (!current || !data) {
        return false;
    }
    const pastedFiles = Array.from(data.files);
    if (pastedFiles.length > 0) {
        addFiles(current, pastedFiles);
        return true;
    }
    const text = normalizePastedText(data.getData("text/plain"));
    if (!text) {
        return true;
    }
    if (raw) {
        insertPlain(current, text);
    }
    else if (data.getData("text/html").includes("data-pm-slice")) {
        // 本编辑器复制出来的：文字就是原文，按结构读回，不分档。
        insertParsed(current, text, {structure: true});
    }
    else {
        pasteTiered(current, text);
    }
    return true;
}

function handleDrop(view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean {
    if (moved) {
        return false;
    }
    event.preventDefault();
    const current = editor.value;
    const data = event.dataTransfer;
    if (props.readonly || !current || !data) {
        return true;
    }
    const pos = view.posAtCoords({left: event.clientX, top: event.clientY})?.pos ?? current.state.selection.from;
    const at = {from: pos, to: pos};
    const droppedFiles = Array.from(data.files);
    if (droppedFiles.length > 0) {
        addFiles(current, droppedFiles, at);
    }
    else {
        const text = normalizePastedText(data.getData("text/plain"));
        if (text && data.getData("text/html").includes("data-pm-slice")) {
            insertParsed(current, text, {...at, structure: true});
        }
        else if (text) {
            pasteTiered(current, text, at);
        }
    }
    view.focus();
    return true;
}

const cards = computed<PromptAttachmentCard[]>(() => {
    void docRevision.value;
    const doc = editor.value?.state.doc;
    return doc ? tracker.cards(doc, attachmentStates.value, props.resolveThumbnail) : [];
});

function cardNode(id: string): {node: PMNode; pos: number} | null {
    const doc = editor.value?.state.doc;
    const pos = Number(id.replace(/^pos:/u, ""));
    const node = doc && Number.isInteger(pos) ? doc.nodeAt(pos) : null;
    return node ? {node, pos} : null;
}

function removeCard(id: string): void {
    const current = editor.value;
    const found = cardNode(id);
    if (current && found) {
        current.view.dispatch(current.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
        highlighted.value = null;
    }
}

function retryCard(id: string): void {
    const found = cardNode(id);
    if (found?.node.type.name === PROMPT_PENDING_NODE) {
        emit("attachment-retry", {localId: tracker.hostId(String(found.node.attrs.localId))});
    }
}

function activateCard(id: string): void {
    const found = cardNode(id);
    if (!found) {
        return;
    }
    const attrs = found.node.attrs;
    const number = Number(attrs.number);
    const target = found.node.type.name === PROMPT_PENDING_NODE ? null : String(attrs.target);
    const name = String(found.node.type.name === PROMPT_PENDING_NODE ? attrs.name : attrs.label);
    emit("token-activate", attrs.kind === "image" ? {kind: "image", number, target} : {kind: "file", number, name, target});
}

/** 焦点在正文与粘贴块的编辑框之间移动不算进出：编辑框在正文元素里面，只看焦点是否离开了正文元素。 */
function onContentFocusIn(): void {
    if (!focused.value) {
        focused.value = true;
        emit("focus");
    }
}

function onContentFocusOut(event: FocusEvent): void {
    const dom = editor.value?.view.dom;
    if (focused.value && !(event.relatedTarget instanceof Node && dom?.contains(event.relatedTarget))) {
        focused.value = false;
        emit("blur");
    }
}

function onBodyMouseDown(event: MouseEvent): void {
    const current = editor.value;
    const target = event.target as HTMLElement | null;
    if (!current || target?.closest(".ProseMirror")) {
        return;
    }
    event.preventDefault();
    focusAt("end");
}

/** TipTap 的 focus("end") 在正文以粘贴块结尾时会全选，这里自己放光标。 */
function focusAt(side: "start" | "end"): void {
    const current = editor.value;
    if (!current) {
        return;
    }
    current.view.dispatch(current.state.tr.setSelection(edgeSelection(current.state.doc, side)).scrollIntoView());
    current.view.focus();
}

/** 会随菜单与只读变化的可访问属性直接写到正文元素上；ProseMirror 只增删它自己设过的属性。 */
watchEffect(() => {
    const dom = editor.value?.view.dom;
    if (!dom) {
        return;
    }
    setAttribute(dom, "aria-label", props.ariaLabel || props.placeholder || null);
    setAttribute(dom, "aria-readonly", String(props.readonly));
    setAttribute(dom, "aria-expanded", menuOpen.value ? "true" : "false");
    setAttribute(dom, "aria-controls", menuOpen.value ? menuId : null);
    setAttribute(dom, "aria-activedescendant", menuOpen.value ? activeOptionId(menuGroups.value, activeItemId.value) : null);
});

function setAttribute(element: HTMLElement, name: string, value: string | null): void {
    if (value === null) {
        element.removeAttribute(name);
    }
    else {
        element.setAttribute(name, value);
    }
}

defineExpose({
    focus(at: "start" | "end" = "end"): void {
        focusAt(at);
    },
    insertText(text: string): void {
        const current = editor.value;
        if (current && !props.readonly) {
            insertParsed(current, normalizePastedText(text), {structure: true});
        }
    },
    insertFiles(files: readonly File[]): void {
        const current = editor.value;
        if (current && !props.readonly && files.length > 0) {
            addFiles(current, files);
        }
    },
    openTrigger(char: string): void {
        const current = editor.value;
        if (!current || props.readonly) {
            return;
        }
        // 先聚焦再插：菜单只在聚焦时打开，插入位置也要是末尾（按钮被点时光标可能在正文中间或不在编辑器里）。
        focusAt("end");
        const {state} = current;
        const before = state.doc.textBetween(Math.max(0, state.selection.from - 1), state.selection.from, "\n", PROMPT_ATOM_CHAR);
        current.view.dispatch(state.tr.insertText(triggerNeedsSpace(before) ? ` ${char}` : char));
    },
});
</script>

<template>
    <div
        ref="rootRef"
        class="prompt-editor"
        :class="{'is-bare': props.bare, 'is-fill': props.fill, 'is-focused': focused, 'is-readonly': props.readonly}"
        data-prompt-editor
    >
        <PromptAttachmentStrip
            :cards="cards"
            :highlighted="highlighted"
            :readonly="props.readonly"
            @activate="activateCard"
            @remove="removeCard"
            @retry="retryCard"
            @hover="highlighted = $event"
        />
        <div
            ref="bodyRef"
            class="prompt-editor__body"
            :style="{minHeight: `${props.minHeight}px`, maxHeight: props.fill ? undefined : `${props.maxHeight}px`}"
            @mousedown="onBodyMouseDown"
        >
            <EditorContent
                v-if="editor"
                :editor="editor"
                class="prompt-editor__content"
                v-bind="{onFocusin: onContentFocusIn, onFocusout: onContentFocusOut}"
            />
        </div>
        <!-- 候选菜单与输入历史：与外框同宽，按 menuPlacement 在上方或下方，不跟随光标（ui/prompt-editor.md 的“不做”）。 -->
        <SuggestionMenu
            v-if="menu"
            :id="menuId"
            :groups="menuGroups"
            :active-id="activeItemId"
            :anchor="rootRef"
            :label="menu.title || undefined"
            :loading="menu.loading"
            :loading-text="t('prompt.menuLoading')"
            :empty-text="menu.emptyText || t('prompt.menuEmpty')"
            :side="menuSide"
            match-anchor-width
            @select="confirmItem"
            @highlight="activeItemId = $event"
        >
            <template v-if="menu.title" #header>
                <div class="nb-ui-menu-label">{{ menu.title }}</div>
            </template>
        </SuggestionMenu>
        <SuggestionMenu
            v-else-if="historyQuery !== null"
            :id="menuId"
            ref="historyMenuRef"
            :groups="historyGroups"
            :active-id="historyActiveId"
            :anchor="rootRef"
            :label="t('prompt.historyTitle')"
            :empty-text="props.recall.length > 0 ? t('prompt.historyNoMatch') : t('prompt.historyEmpty')"
            :side="menuSide"
            match-anchor-width
            @select="selectHistory"
            @highlight="historyActiveId = $event"
        >
            <template #header>
                <div class="prompt-editor__history-search">
                    <span class="prompt-editor__history-search-icon i-lucide-search" aria-hidden="true" />
                    <input
                        :ref="setHistorySearch"
                        class="prompt-editor__history-search-input"
                        type="text"
                        :value="historyQuery"
                        :placeholder="t('prompt.historySearch')"
                        :aria-label="t('prompt.historySearch')"
                        role="combobox"
                        aria-expanded="true"
                        :aria-controls="menuId"
                        :aria-activedescendant="historyDescendant"
                        autocomplete="off"
                        spellcheck="false"
                        @input="historyQuery = ($event.target as HTMLInputElement).value"
                        @keydown="onHistoryKeydown"
                        @focusout="onHistoryFocusOut"
                    >
                </div>
                <div class="nb-ui-menu-label">{{ t("prompt.historyTitle") }}</div>
            </template>
        </SuggestionMenu>
    </div>
</template>

<style scoped>
.prompt-editor {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    border: 1px solid var(--control-outline, var(--border-color));
    border-radius: 0.625rem;
    background: var(--bg-input);
    transition: border-color 120ms ease, box-shadow 120ms ease;
}

.prompt-editor.is-focused {
    border-color: var(--focus-outline, var(--accent-main));
    box-shadow: var(--focus-ring);
}

.prompt-editor.is-readonly {
    background: var(--bg-subtle);
}

.prompt-editor.is-bare,
.prompt-editor.is-bare.is-focused {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
}

.prompt-editor__body {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
    cursor: text;
}

/* 父元素没有确定的高度时 100% 退成 auto，仍随内容长高。 */
.prompt-editor.is-fill {
    height: 100%;
}

.prompt-editor.is-fill > .prompt-editor__body {
    flex: 1 1 auto;
}

.prompt-editor__content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
}

.prompt-editor__content :deep(.prompt-editor__prosemirror) {
    flex: 1 1 auto;
    padding: 0.45rem 0.6rem;
    color: var(--text-main);
    font-size: var(--text-sm);
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    outline: none;
}

.prompt-editor__content :deep(.prompt-editor__prosemirror p) {
    margin: 0;
}

.prompt-editor__content :deep(.prompt-editor__prosemirror p.is-editor-empty:first-child::before) {
    float: left;
    height: 0;
    color: var(--text-muted);
    content: attr(data-placeholder);
    pointer-events: none;
}

/*
 * ProseMirror 在 Chrome 与 Safari 里会在“行尾是不可编辑的行内节点”时插一张占位图。在 Chrome 里，
 * 从行尾标签右边按下鼠标往回拖时，这张图让选区锚点跟着鼠标走，拖不出选区；隐藏后拖选正常，
 * 点在标签右边照样能把光标放到标签后面（Chromium 上由 smoke 验证）。Safari 的光标绘制可能受影响，本组件只承诺 Chromium。
 */
.prompt-editor__content :deep(img.ProseMirror-separator) {
    display: none !important;
}

.prompt-editor__content :deep(.ProseMirror-gapcursor) {
    position: relative;
    display: block;
    height: 1.2rem;
}

.prompt-editor__content :deep(.ProseMirror-gapcursor::after) {
    position: absolute;
    top: 0.2rem;
    display: block;
    width: 1px;
    height: 1rem;
    border-left: 1px solid var(--text-main);
    content: "";
    animation: prompt-editor-caret 1.1s steps(2, start) infinite;
}

.prompt-editor__history-search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 4px;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--divider);
}

.prompt-editor__history-search-icon {
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    color: var(--text-muted);
}

.prompt-editor__history-search-input {
    min-width: 0;
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
}

.prompt-editor__history-search-input::placeholder {
    color: var(--text-muted);
}

@keyframes prompt-editor-caret {
    to {
        visibility: hidden;
    }
}
</style>
