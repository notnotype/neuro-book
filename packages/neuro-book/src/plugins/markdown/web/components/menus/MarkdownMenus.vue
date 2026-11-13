<script setup lang="ts">
/** Markdown 控件的菜单层（同名 .md）：工具栏之外的浮动菜单与它们共用的输入弹层。 */
import {holdSelection, releaseSelection, removeSlashBlock, selectedRubyText, selectRubyAt} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {computed, onBeforeUnmount, ref, useTemplateRef, watch} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownCommentLayer from "./comments/MarkdownCommentLayer.vue";
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
    /** 批注页边此刻画得出来（输出 33）：`MarkdownControl` 按开关与宽度算好。 */
    marginDrawn: boolean;
}>();

const prompting = ref<"ruby" | "bilingual" | null>(null);
const commentLayer = useTemplateRef<InstanceType<typeof MarkdownCommentLayer>>("commentLayer");
/** 批注卡片在“写”：选区菜单不显示（同注音卡片开着）。 */
const commentWriting = ref(false);
/** 右键菜单开着：批注浮层不弹（点在批注文字上时光标会移进去）。 */
const contextOpen = ref(false);
/** 卡片里预填的文字与有没有“移除注音”：按打开那一刻的选区算（输出 9）。 */
const promptInitial = ref("");
const promptRemovable = ref(false);
/** 每打开一次加一：卡片开着时换到另一段注音，读音相同也要清掉写了一半的字。 */
const promptSession = ref(0);

function openPrompt(action: "ruby" | "bilingual"): void {
    const editor = props.editor;
    if (editor === null) return;
    const hasRuby = action === "ruby" && props.editing.active("ruby");
    promptInitial.value = hasRuby ? selectedRubyText(editor) ?? "" : "";
    promptRemovable.value = hasRuby;
    promptSession.value += 1;
    // 卡片开着时又点了一段注音的小字：卡片留着，高亮换到新的选区。新选区是空的（双语只要光标）时 `holdSelection` 不画，
    // 所以先撤掉旧的。
    if (prompting.value !== null) {
        releaseSelection(editor);
        holdSelection(editor);
    }
    prompting.value = action;
}

// 卡片开着时焦点在卡片里，浏览器不画正文的选区：画成高亮，关上时撤掉。换文档时控件存状态之前已经撤掉（`MarkdownControl` 的 leave）。
watch(prompting, (now, before) => {
    const editor = props.editor;
    if (editor === null) return;
    if (now !== null && before === null) holdSelection(editor);
    else if (now === null) releaseSelection(editor);
}, {flush: "sync"});

/**
 * 点注音小字：选中这段注音，打开修改（输出 9）。按下就处理、不让浏览器再处理这次按下：小字里放不下光标。带修饰键的按下
 * （Shift 扩展选区、macOS 上 Ctrl 加点是右键）照常交给浏览器与编辑器。
 */
function onPointerDown(event: PointerEvent): void {
    const editor = props.editor;
    if (editor === null || props.readonly || event.button !== 0) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !selectRubyAt(editor, event.target)) return;
    event.preventDefault();
    openPrompt("ruby");
}
let detach: (() => void) | null = null;
watch(() => props.scroller, (scroller) => {
    detach?.();
    detach = null;
    if (scroller === null) return;
    scroller.addEventListener("pointerdown", onPointerDown);
    detach = () => scroller.removeEventListener("pointerdown", onPointerDown);
}, {immediate: true});
onBeforeUnmount(() => detach?.());
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
function remove(): void {
    prompting.value = null;
    props.menus.run("ruby-remove");
}

defineExpose({
    /** 工具栏的“⋯”里点了注音或双语。 */
    prompt: openPrompt,
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
        :suspended="prompting !== null || commentWriting"
        @prompt="(action) => (action === 'comment' ? commentLayer?.beginAdd() : openPrompt(action))"
    />
    <MarkdownSlashMenu
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        @prompt="openPrompt"
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
        @comment="(block) => (block === null ? commentLayer?.beginAdd() : commentLayer?.beginAddBlock(block))"
    />
    <MarkdownContextMenu
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        @comment="commentLayer?.beginAdd()"
        @open="(open) => { contextOpen = open; }"
    />
    <MarkdownCommentLayer
        ref="commentLayer"
        :editor="props.editor"
        :scroller="props.scroller"
        :editing="props.editing"
        :menus="props.menus"
        :readonly="props.readonly"
        :binding="props.binding"
        :blocked="prompting !== null || contextOpen"
        :margin-drawn="props.marginDrawn"
        @writing="(writing) => { commentWriting = writing; }"
    />
    <MarkdownTextPrompt
        :open="prompting !== null"
        :session="promptSession"
        :anchor="anchor"
        :label="promptLabel"
        :confirm-label="props.menus.label('promptConfirm')"
        :initial="promptInitial"
        :remove-label="promptRemovable ? props.menus.title('ruby-remove') : undefined"
        @submit="submit"
        @cancel="cancel"
        @remove="remove"
        @dismiss="prompting = null"
    />
</template>
