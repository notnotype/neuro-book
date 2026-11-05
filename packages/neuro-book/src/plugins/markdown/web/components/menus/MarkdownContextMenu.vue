<script setup lang="ts">
/** 正文右键菜单（同名 .md）。 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import type {Editor} from "@tiptap/core";
import {Selection} from "@tiptap/pm/state";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {EDITOR_BODY_CONTEXT_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {copyOrCut, paste} from "./clipboard";

const props = defineProps<{editor: Editor | null; scroller: HTMLElement | null; editing: EditorEditing; menus: EditorMenus; readonly: boolean; binding: string | null}>();

const open = ref(false);
const at = ref({x: 0, y: 0});

/** 点在选区内保留选区，点在选区外光标移到点击处（输出 21）。聚焦让这一组成为活动组：`EditorGroup` 的 `pointerdown` 只认左键。 */
const onContextMenu = (event: MouseEvent): void => {
    const editor = props.editor;
    if (editor === null || (event.target as Element | null)?.closest("[data-markdown-gutter]") != null) return;
    event.preventDefault();
    editor.view.focus();
    const found = editor.view.posAtCoords({left: event.clientX, top: event.clientY});
    if (found !== null) {
        const {from, to} = editor.state.selection;
        // `near`：点在分割线这类地方时位置不在文本块里，不能直接放文字光标。
        if (found.pos < from || found.pos > to) editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(found.pos))));
    }
    at.value = {x: event.clientX, y: event.clientY};
    open.value = true;
};

let detach: (() => void) | null = null;
watch(() => props.scroller, (scroller) => {
    detach?.();
    if (scroller === null) {
        detach = null;
        return;
    }
    scroller.addEventListener("contextmenu", onContextMenu);
    detach = () => scroller.removeEventListener("contextmenu", onContextMenu);
}, {immediate: true});
onBeforeUnmount(() => detach?.());
watch(() => props.binding, () => {
    open.value = false;
});

function pasteWith(plain: boolean): void {
    const editor = props.editor;
    if (editor === null) return;
    void paste(editor, plain).then((failure) => {
        if (failure !== null) props.menus.notify(failure);
    }).catch((error: unknown) => props.menus.reportError(error));
}

const items = computed<ContextMenuItem[]>(() => {
    const editor = props.editor;
    if (editor === null) return [];
    const selected = props.editing.hasSelection.value;
    const copy: ContextMenuItem = {label: props.menus.label("copy"), iconClass: "i-lucide-copy", shortcut: props.menus.keyLabel("Mod+C"), disabled: !selected, action: () => copyOrCut(editor, "copy")};
    const selectAll: ContextMenuItem = {label: props.menus.label("selectAll"), shortcut: props.menus.keyLabel("Mod+A"), action: () => editor.chain().focus().selectAll().run()};
    if (props.readonly) return [copy, selectAll];
    const contributed = props.menus.contributed(EDITOR_BODY_CONTEXT_POINT).map((section) => section.map((entry): ContextMenuItem => ({
        label: entry.label,
        ...(entry.icon === null ? {} : {iconClass: entry.icon}),
        disabled: !entry.enabled,
        action: () => props.menus.runContributed(EDITOR_BODY_CONTEXT_POINT, entry.id),
    })));
    return [
        {label: props.menus.label("cut"), iconClass: "i-lucide-scissors", shortcut: props.menus.keyLabel("Mod+X"), disabled: !selected, action: () => copyOrCut(editor, "cut")},
        copy,
        {label: props.menus.label("paste"), iconClass: "i-lucide-clipboard", shortcut: props.menus.keyLabel("Mod+V"), action: () => pasteWith(false)},
        {label: props.menus.label("pastePlain"), iconClass: "i-lucide-clipboard-type", shortcut: props.menus.keyLabel("Mod+Shift+V"), action: () => pasteWith(true)},
        {separator: true},
        selectAll,
        ...contributed.flatMap((section): ContextMenuItem[] => [{separator: true}, ...section]),
    ];
});

function onRequestClose(reason: string): void {
    // 选了一项或按 Esc：焦点回正文。点外面时焦点已随用户落到别处，不抢回。
    if (reason !== "outside") props.editor?.commands.focus();
}
</script>

<template>
    <ContextMenu :open="open" :x="at.x" :y="at.y" :items="items" @update:open="(next: boolean) => { open = next; }" @request-close="onRequestClose" />
</template>
