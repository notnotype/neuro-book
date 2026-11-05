<script setup lang="ts">
/** Markdown 控件的菜单层（同名 .md）：工具栏之外的浮动菜单与它们共用的输入弹层。 */
import type {Editor} from "@tiptap/core";
import {computed, ref} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownSelectionMenu from "./MarkdownSelectionMenu.vue";
import MarkdownSlashMenu from "./MarkdownSlashMenu.vue";
import MarkdownTextPrompt from "./MarkdownTextPrompt.vue";
import {selectionAnchor} from "./selection-anchor";

const props = defineProps<{
    editor: Editor | null;
    scroller: HTMLElement | null;
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    binding: string | null;
}>();

const prompting = ref<"ruby" | "bilingual" | null>(null);
const anchor = computed(() => (props.editor === null ? null : selectionAnchor(props.editor, props.scroller)));
const promptLabel = computed(() => (prompting.value === null ? "" : props.menus.label(prompting.value === "ruby" ? "promptRuby" : "promptBilingual")));

function submit(text: string): void {
    const action = prompting.value;
    prompting.value = null;
    if (action !== null) props.menus.run(action, {text});
}
function cancel(): void {
    prompting.value = null;
    props.editor?.commands.focus();
}

defineExpose({
    /** 工具栏的“⋯”里点了注音或双语。 */
    prompt(action: "ruby" | "bilingual"): void {
        prompting.value = action;
    },
});
</script>

<template>
    <MarkdownSelectionMenu
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        :suspended="prompting !== null"
        @prompt="(action) => { prompting = action; }"
    />
    <MarkdownSlashMenu
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        @prompt="(action) => { prompting = action; }"
    />
    <MarkdownTextPrompt :open="prompting !== null" :anchor="anchor" :label="promptLabel" @submit="submit" @cancel="cancel" />
</template>
