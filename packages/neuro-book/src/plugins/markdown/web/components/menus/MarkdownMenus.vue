<script setup lang="ts">
/** Markdown 控件的菜单层（同名 .md）：工具栏之外的浮动菜单与它们共用的输入弹层。 */
import {removeSlashBlock} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {computed, ref, watch} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownBlockGutter from "./MarkdownBlockGutter.vue";
import MarkdownContextMenu from "./MarkdownContextMenu.vue";
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
/** `+` 刚插入、还只有 `/` 的那一块：斜杠菜单放弃时删掉（输出 15）。选了一项时 `/` 已经被删掉，这里按内容判断，不会误删。 */
let insertedBlock: number | null = null;
function onInserted(pos: number): void {
    insertedBlock = pos;
}
function onSlashClosed(): void {
    if (insertedBlock !== null && props.editor !== null) removeSlashBlock(props.editor, insertedBlock);
    insertedBlock = null;
}
const anchor = computed(() => (props.editor === null ? null : selectionAnchor(props.editor, props.scroller)));
const promptLabel = computed(() => (prompting.value === null ? "" : props.menus.label(prompting.value === "ruby" ? "promptRuby" : "promptBilingual")));

// 换文档、变只读：弹层的选区已经不是打开时那份（Spec 的“时序与寿命”）；`+` 插入的位置也作废。
watch(() => [props.binding, props.readonly] as const, () => {
    prompting.value = null;
    insertedBlock = null;
}, {flush: "sync"});

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
        @closed="onSlashClosed"
    />
    <MarkdownBlockGutter
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        @inserted="onInserted"
    />
    <MarkdownContextMenu
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
    />
    <MarkdownTextPrompt :open="prompting !== null" :anchor="anchor" :label="promptLabel" @submit="submit" @cancel="cancel" @dismiss="prompting = null" />
</template>
