<script setup lang="ts">
/** 编辑器里打 `:` 的表情补全（同名 .md）。 */
import {SuggestionMenu, suggestionMenuOptions, suggestionOptionId} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup} from "@notnotype/nb-ui/components";
import {activeSticker, dismissSticker, insertStickerAtTrigger} from "@notnotype/nb-markdown/editor";
import type {StickerMatch} from "@notnotype/nb-markdown/editor";
import {posToDOMRect} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import {computed, onBeforeUnmount, ref, shallowRef, useId, watch} from "vue";

import type {StickerPicker} from "nbook/plugins/stickers/shared/contracts";

const props = defineProps<{editor: Editor | null; scroller: HTMLElement | null; readonly: boolean; binding: string | null; picker: StickerPicker}>();

const LIMIT = 8;
const match = shallowRef<StickerMatch | null>(null);
const composing = ref(false);
const activeId = ref<string | null>(null);

const items = computed(() => (match.value === null ? [] : props.picker.search(match.value.query, LIMIT)));
const groups = computed<SuggestionMenuGroup[]>(() => [{id: "stickers", items: items.value.map((item) => ({id: item.raw, label: item.name, imageUrl: item.url, hint: item.packTitle}))}]);
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

const menuId = `markdown-sticker-${useId()}`;

function choose(id: string): void {
    const editor = props.editor;
    const item = items.value.find((candidate) => candidate.raw === id);
    if (editor === null || item === undefined) return;
    match.value = null;
    if (insertStickerAtTrigger(editor, item.raw)) props.picker.used(item);
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
        if (props.editor !== null) dismissSticker(props.editor);
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
    // 组字中保留上一次的查询：拼音字母不是查询，`open` 已按组字收起。
    if (editor?.view.composing === true) return;
    match.value = editor === null ? null : activeSticker(editor);
}

/** 失焦时收起：菜单按下不夺焦，所以失焦就是离开了。 */
const onBlur = (): void => {
    if (open.value && props.editor !== null) dismissSticker(props.editor);
};

function attach(editor: Editor, scroller: HTMLElement): () => void {
    editor.on("transaction", sync);
    editor.on("blur", onBlur);
    scroller.addEventListener("keydown", onKeyDown, true);
    scroller.addEventListener("compositionstart", onCompositionStart, true);
    // 冒泡阶段：ProseMirror 在 `view.dom` 上的处理器先跑，`view.composing` 这时才为假（同斜杠菜单）。
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

watch(() => props.binding, () => {
    sync();
});

// 焦点留在正文：读屏经 `aria-activedescendant` 知道当前项（`SuggestionMenu.md`）。
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
}, {flush: "post"});
</script>

<template>
    <SuggestionMenu
        v-if="open"
        :id="menuId"
        :groups="groups"
        :active-id="activeId"
        :anchor="anchor"
        side="bottom"
        @select="choose"
        @highlight="(id: string) => { activeId = id; }"
    />
</template>
