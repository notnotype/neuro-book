<script setup lang="ts">
/** 斜杠菜单（同名 .md）。 */
import {SuggestionMenu, suggestionMenuOptions, suggestionOptionId} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup} from "@notnotype/nb-ui/components";
import {activeSlash, dismissSlash, removeSlashQuery} from "@notnotype/nb-markdown/editor";
import type {SlashMatch} from "@notnotype/nb-markdown/editor";
import {posToDOMRect} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {computed, inject, onBeforeUnmount, ref, shallowRef, useId, watch} from "vue";

import {EDITING_ACTIONS, EDITOR_SLASH_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {markdownReportKey} from "../../parts/report";

const props = defineProps<{editor: Editor | null; scroller: HTMLElement | null; editing: EditorEditing; menus: EditorMenus; readonly: boolean; binding: string | null}>();
const emit = defineEmits<{(event: "prompt", action: "bilingual"): void; (event: "closed"): void}>();

const report = inject(markdownReportKey, null);

const BUILTIN: ReadonlyArray<{readonly id: string; readonly actions: ReadonlyArray<EditingActionId>}> = [
    {id: "basic", actions: ["paragraph", "heading-1", "heading-2", "heading-3"]},
    {id: "lists", actions: ["bullet-list", "ordered-list", "task-list"]},
    {id: "blocks", actions: ["quote", "callout", "code-block", "divider", "table", "bilingual"]},
];

/** 菜单的状态只在组件里，不写插件视图（`MarkdownControl.md`）。 */
const match = shallowRef<SlashMatch | null>(null);
const composing = ref(false);
const activeId = ref<string | null>(null);

/** 拼音首字母：第一次打开时才加载（gzip 约 144 KB，不进首屏）；加载完成前与失败时只按名称筛（输出 12）。 */
const initialsOf = shallowRef<((text: string) => string) | null>(null);
let pinyinRequested = false;
function loadPinyin(): void {
    if (pinyinRequested) return;
    pinyinRequested = true;
    import("pinyin-pro").then(({pinyin}) => {
        initialsOf.value = (text) => pinyin(text, {pattern: "first", toneType: "none", type: "array", nonZh: "consecutive"}).join("").replace(/\s+/gu, "").toLowerCase();
    }).catch((error: unknown) => report?.("markdown.pinyin.load-failed", "拼音库加载失败，斜杠菜单只按名称筛选", error));
}

function matches(label: string, query: string): boolean {
    const wanted = query.toLowerCase();
    if (wanted === "") return true;
    return label.toLowerCase().includes(wanted) || initialsOf.value?.(label).startsWith(wanted) === true;
}

const groups = computed<SuggestionMenuGroup[]>(() => {
    const query = match.value?.query ?? "";
    const builtin = BUILTIN.map((group): SuggestionMenuGroup => ({
        id: group.id,
        label: props.menus.label(`slash-${group.id}`),
        items: group.actions
            .map((action) => ({id: action, label: props.menus.title(action), iconClass: EDITING_ACTIONS[action].icon}))
            .filter((item) => matches(item.label, query)),
    }));
    const contributed: SuggestionMenuGroup = {
        id: "contributed",
        items: props.menus.contributed(EDITOR_SLASH_POINT).flat()
            .filter((entry) => entry.enabled && matches(entry.label, query))
            .map((entry) => ({id: `contributed:${entry.id}`, label: entry.label, ...(entry.icon === null ? {} : {iconClass: entry.icon})})),
    };
    return [...builtin, contributed].filter((group) => group.items.length > 0);
});
const options = computed(() => suggestionMenuOptions(groups.value));
const open = computed(() => match.value !== null && !composing.value && !props.readonly && options.value.length > 0);

watch(options, (next) => {
    if (!next.some((item) => item.id === activeId.value)) activeId.value = next[0]?.id ?? null;
}, {immediate: true});

const anchor = computed(() => {
    const editor = props.editor;
    if (editor === null || match.value === null) return null;
    const from = match.value.from;
    return {getBoundingClientRect: () => posToDOMRect(editor.view, Math.min(from, editor.state.doc.content.size), Math.min(from, editor.state.doc.content.size)), ...(props.scroller === null ? {} : {contextElement: props.scroller})};
});

const menuId = `markdown-slash-${useId()}`;

function choose(id: string): void {
    const editor = props.editor;
    if (editor === null) return;
    removeSlashQuery(editor);
    match.value = null;
    if (id.startsWith("contributed:")) props.menus.runContributed(EDITOR_SLASH_POINT, id.slice("contributed:".length));
    else if (id === "bilingual") emit("prompt", "bilingual");
    else props.menus.run(id as EditingActionId);
}

function move(step: number): void {
    const list = options.value;
    if (list.length === 0) return;
    const current = list.findIndex((item) => item.id === activeId.value);
    activeId.value = list[(Math.max(current, 0) + step + list.length) % list.length]?.id ?? null;
}

const onKeyDown = (event: KeyboardEvent): void => {
    if (!open.value || event.isComposing) return;
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter" || event.key === "Tab") {
        if (activeId.value !== null) choose(activeId.value);
    } else if (event.key === "Escape") {
        if (props.editor !== null) dismissSlash(props.editor);
    } else return;
    event.preventDefault();
    event.stopPropagation();
};
const onCompositionStart = (): void => {
    composing.value = true;
};
const onCompositionEnd = (): void => {
    composing.value = false;
    sync();
};

function sync(): void {
    const editor = props.editor;
    const next = editor === null || editor.view.composing ? null : activeSlash(editor);
    if (next === null) {
        // 组字中保留上一次的查询，不让菜单闪一下；`open` 已按组字收起。
        if (editor === null || !editor.view.composing) match.value = null;
        return;
    }
    loadPinyin();
    match.value = next;
}

/** 失焦时收起（输出 10、15）：菜单按下不夺焦，所以失焦就是离开了。 */
const onBlur = (): void => {
    if (open.value && props.editor !== null) dismissSlash(props.editor);
};

function attach(editor: Editor, scroller: HTMLElement): () => void {
    editor.on("transaction", sync);
    editor.on("blur", onBlur);
    scroller.addEventListener("keydown", onKeyDown, true);
    scroller.addEventListener("compositionstart", onCompositionStart, true);
    // 冒泡阶段：ProseMirror 在 `view.dom` 上的处理器先跑，`view.composing` 这时才为假；上屏的文字可能在组字中就进了文档，之后没有事务。
    scroller.addEventListener("compositionend", onCompositionEnd);
    return () => {
        editor.off("transaction", sync);
        editor.off("blur", onBlur);
        scroller.removeEventListener("keydown", onKeyDown, true);
        scroller.removeEventListener("compositionstart", onCompositionStart, true);
        scroller.removeEventListener("compositionend", onCompositionEnd);
    };
}

let detach: (() => void) | null = null;
watch(() => [props.editor, props.scroller] as const, ([editor, scroller]) => {
    detach?.();
    detach = editor !== null && scroller !== null ? attach(editor, scroller) : null;
}, {immediate: true});
onBeforeUnmount(() => detach?.());

// 换文档：查询作废（Spec 的“时序与寿命”）；状态在各文档的编辑状态里，切回来时按它重算。
watch(() => props.binding, () => {
    sync();
});

// 焦点留在正文：读屏经 `aria-activedescendant` 知道当前项（`SuggestionMenu.md`）。属性直接写在视图的 DOM 上，关闭时拿掉。
watch(() => [open.value, activeId.value] as const, ([isOpen, id]) => {
    const dom = props.editor?.view.dom;
    if (dom === undefined) return;
    const index = options.value.findIndex((item) => item.id === id);
    if (isOpen && index >= 0) {
        dom.setAttribute("aria-controls", menuId);
        dom.setAttribute("aria-activedescendant", suggestionOptionId(menuId, index));
    } else {
        dom.removeAttribute("aria-controls");
        dom.removeAttribute("aria-activedescendant");
    }
    if (!isOpen) emit("closed");
}, {flush: "post"});
</script>

<template>
    <SuggestionMenu
        v-if="open"
        :id="menuId"
        :groups="groups"
        :active-id="activeId"
        :anchor="anchor"
        :label="props.menus.label('slash')"
        @select="choose"
        @highlight="(id: string) => { activeId = id; }"
    />
</template>
