<script setup lang="ts">
/** Markdown 控件的菜单层（同名 .md）：工具栏之外的浮动菜单与它们共用的输入弹层。 */
import {holdCaret, holdSelection, linksTouching, releaseSelection, removeSlashBlock, selectedRubyText, selectRubyAt, sharedHref} from "@notnotype/nb-markdown/editor";
import {relativeTarget} from "@notnotype/nb-markdown";
import type {Editor} from "@tiptap/core";
import {computed, inject, onBeforeUnmount, ref, useTemplateRef, watch} from "vue";

import type {EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";
import type {StickerPickerItem} from "nbook/plugins/stickers/shared/contracts";

import {nbookTargets} from "../../host";
import type {MarkdownMedia} from "../../media";
import {markdownStickerPickerKey} from "../../parts/stickers";

import MarkdownCommentLayer from "./comments/MarkdownCommentLayer.vue";
import MarkdownBlockGutter from "./MarkdownBlockGutter.vue";
import MarkdownContextMenu from "./MarkdownContextMenu.vue";
import MarkdownImageCard from "./MarkdownImageCard.vue";
import MarkdownSelectionMenu from "./MarkdownSelectionMenu.vue";
import MarkdownSlashMenu from "./MarkdownSlashMenu.vue";
import MarkdownStickerCard from "./MarkdownStickerCard.vue";
import MarkdownStickerMenu from "./MarkdownStickerMenu.vue";
import MarkdownTextPrompt from "./MarkdownTextPrompt.vue";
import {altOfName, altOfUrl} from "./image-card-text";
import {linkRequest} from "./link-input";
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
    /** 此刻正在编辑的文件的地址：链接与图片写成相对它的地址（输出 57）。按函数取，换文档不重建。 */
    base: () => string | null;
    /** 插图能力（输出 54、58）：null 是宿主没有提供，插图卡片只能插入网址的图片。 */
    media: MarkdownMedia | null;
}>();

/** 要输入一段文字的卡片：注音、双语、链接共用 `MarkdownTextPrompt`；插图卡片另有自己的组件。 */
type PromptKind = "ruby" | "bilingual" | "link";
const prompting = ref<PromptKind | null>(null);
const imageOpen = ref(false);
/** 表情选择器（输出 62）：没装表情包插件时为 null，没有按钮、斜杠项与 `:` 补全。 */
const picker = inject(markdownStickerPickerKey, null);
const stickerOpen = ref(false);
/** 卡片与选择器开着：选区菜单不显示，批注浮层不弹。 */
const cardOpen = computed(() => prompting.value !== null || imageOpen.value || stickerOpen.value);
/** 光标在链接里的卡片：有没有“去掉链接”、碰到的几条地址是否不同（不同时不预填、不能确认）。 */
const linkMixed = ref(false);
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
const imageSession = ref(0);

/** 卡片开着时焦点在卡片里，浏览器不画正文的选区：选区画成高亮；链接与插图卡片没有选区时在光标处画一条竖线（输出 52、54）。 */
function hold(editor: Editor, caret: boolean): void {
    if (!holdSelection(editor) && caret) holdCaret(editor);
}

function openPrompt(action: PromptKind | "image" | "sticker"): void {
    const editor = props.editor;
    if (editor === null) return;
    if (action === "image") {
        openImage();
        return;
    }
    if (action === "sticker") {
        openSticker();
        return;
    }
    if (imageOpen.value) imageOpen.value = false;
    if (stickerOpen.value) stickerOpen.value = false;
    const hasRuby = action === "ruby" && props.editing.active("ruby");
    let initial = hasRuby ? selectedRubyText(editor) ?? "" : "";
    let removable = hasRuby;
    linkMixed.value = false;
    if (action === "link") {
        // 光标在链接里、或选区碰到链接：预填地址，多一个“去掉链接”；碰到的几条地址不同时不预填、不能确认。
        const touched = linksTouching(editor);
        const href = sharedHref(touched);
        initial = href ?? "";
        removable = touched.length > 0;
        linkMixed.value = touched.length > 0 && href === null;
    }
    promptInitial.value = initial;
    promptRemovable.value = removable;
    promptSession.value += 1;
    // 卡片开着时又点了一段注音的小字：卡片留着，高亮换到新的选区。新选区是空的（双语只要光标）时 `holdSelection` 不画，
    // 所以先撤掉旧的。
    if (prompting.value !== null) {
        releaseSelection(editor);
        hold(editor, action === "link");
    }
    prompting.value = action;
}

function openImage(): void {
    const editor = props.editor;
    if (editor === null || props.readonly || !props.editing.enabled("image")) return;
    if (prompting.value !== null) prompting.value = null;
    if (stickerOpen.value) stickerOpen.value = false;
    imageSession.value += 1;
    if (imageOpen.value) releaseSelection(editor);
    imageOpen.value = true;
    hold(editor, true);
}

/** 表情选择器（输出 62）：锚在光标（同插图卡片），选区画成高亮、没有选区时光标处画竖线，与别的卡片互斥。 */
function openSticker(): void {
    const editor = props.editor;
    if (editor === null || picker === null || props.readonly || !props.editing.enabled("sticker")) return;
    if (prompting.value !== null) prompting.value = null;
    if (imageOpen.value) imageOpen.value = false;
    if (stickerOpen.value) releaseSelection(editor);
    stickerOpen.value = true;
    hold(editor, true);
}

watch(prompting, (now, before) => {
    const editor = props.editor;
    if (editor === null) return;
    if (now !== null && before === null) hold(editor, now === "link");
    else if (now === null) releaseSelection(editor);
}, {flush: "sync"});
watch(imageOpen, (now) => {
    const editor = props.editor;
    if (editor === null) return;
    if (now) hold(editor, true);
    else releaseSelection(editor);
}, {flush: "sync"});
watch(stickerOpen, (now) => {
    const editor = props.editor;
    if (editor === null || now) return;
    releaseSelection(editor);
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
/**
 * Ctrl+K（macOS 上 ⌘K）开链接卡片（输出 52）：只在焦点在正文里时（属性面板的输入框里不算）；只读、输入法组字中、此刻不能加链接
 * （代码块里）时不响应，浏览器自己的 Ctrl+K（地址栏搜索）也不拦。
 */
function onKeyDown(event: KeyboardEvent): void {
    const editor = props.editor;
    if (editor === null || props.readonly || event.isComposing || !props.menus.matches("link", event)) return;
    if (!(event.target instanceof Node) || !editor.view.dom.contains(event.target) || !props.editing.enabled("link")) return;
    event.preventDefault();
    openPrompt("link");
}
let detach: (() => void) | null = null;
watch(() => props.scroller, (scroller) => {
    detach?.();
    detach = null;
    if (scroller === null) return;
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("keydown", onKeyDown);
    detach = () => {
        scroller.removeEventListener("pointerdown", onPointerDown);
        scroller.removeEventListener("keydown", onKeyDown);
    };
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
/** 输入卡片各自的文字：标题（输入框的读屏名称）、移除的动作与它的图标。 */
const PROMPTS: Readonly<Record<PromptKind, {readonly label: string; readonly remove: "ruby-remove" | "link-remove"; readonly removeIcon?: string}>> = {
    ruby: {label: "promptRuby", remove: "ruby-remove"},
    bilingual: {label: "promptBilingual", remove: "ruby-remove"},
    link: {label: "promptLink", remove: "link-remove", removeIcon: "i-lucide-unlink"},
};
const promptSpec = computed(() => (prompting.value === null ? null : PROMPTS[prompting.value]));
const promptLabel = computed(() => (promptSpec.value === null ? "" : props.menus.label(promptSpec.value.label)));
const promptRemoveLabel = computed(() => (promptSpec.value === null || !promptRemovable.value ? undefined : props.menus.title(promptSpec.value.remove)));
const linkAccepts = (text: string): boolean => linkRequest(text, props.base()) !== null;

// 换文档、变只读：弹层的选区已经不是打开时那份（Spec 的“时序与寿命”）；`+` 插入的位置也作废。
watch(() => [props.binding, props.readonly] as const, () => {
    prompting.value = null;
    imageOpen.value = false;
    stickerOpen.value = false;
    insertedBlock = null;
}, {flush: "sync"});

function submit(text: string): void {
    const action = prompting.value;
    prompting.value = null;
    if (action === null) return;
    if (action !== "link") {
        props.menus.run(action, {text});
        return;
    }
    const request = linkRequest(text, props.base());
    if (request === null) return;
    props.menus.run("link", {href: request.href, label: request.label});
    props.editor?.commands.focus();
}
function cancel(): void {
    prompting.value = null;
    props.editor?.commands.focus();
}
function remove(): void {
    const spec = promptSpec.value;
    prompting.value = null;
    if (spec === null) return;
    props.menus.run(spec.remove);
    if (spec.remove === "link-remove") props.editor?.commands.focus();
}

/** 插图卡片选定了一张图：作品里的图写成相对当前文件的地址，说明取文件名（输出 54、57）；网址的图原样。 */
function insertImage(image: {readonly address: string | null; readonly url: string | null; readonly name: string}): void {
    imageOpen.value = false;
    const src = image.url ?? (image.address === null ? null : relativeTarget(props.base(), image.address, nbookTargets) ?? image.address);
    if (src === null) return;
    const alt = image.url === null ? altOfName(image.name) : altOfUrl(image.url);
    props.menus.run("image", {src, alt});
    props.editor?.commands.focus();
}
function cancelImage(): void {
    imageOpen.value = false;
    props.editor?.commands.focus();
}

/**
 * 选择器里选了表情：插在光标处、记进最近用过（输出 41、43）。用控件的编辑动作（与命令 `nbook.edit.sticker` 同一个实现）而不经命令
 * 服务：要同步知道插进去没有，按住 Shift 连着插时光标已在表情后面，竖线马上跟着挪过去。
 */
function pickSticker(item: StickerPickerItem, keepOpen: boolean): void {
    const editor = props.editor;
    if (editor === null || picker === null) return;
    releaseSelection(editor);
    if (props.editing.run("sticker", {text: item.raw})) picker.used(item);
    if (keepOpen) {
        hold(editor, true);
        return;
    }
    stickerOpen.value = false;
    editor.commands.focus();
}
/** 选择器关上：Esc 时焦点回正文；焦点离开面板（点了别的控件、Tab 出去）时焦点已在别处，不抢回来。 */
function closeSticker(reason: "escape" | "blur"): void {
    stickerOpen.value = false;
    if (reason === "escape") props.editor?.commands.focus();
}

defineExpose({
    /** 工具栏的“⋯”里点了注音、双语、链接或图片。 */
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
        :suspended="cardOpen || commentWriting"
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
    <MarkdownStickerMenu
        v-if="picker !== null"
        :editor="props.editor"
        :scroller="props.scroller"
        :readonly="props.readonly"
        :binding="props.binding"
        :picker="picker"
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
        :blocked="cardOpen || contextOpen"
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
        :remove-label="promptRemoveLabel"
        :remove-icon="promptSpec?.removeIcon"
        :wide="prompting === 'link'"
        :locked="prompting === 'link' && linkMixed"
        :accepts="prompting === 'link' ? linkAccepts : undefined"
        @submit="submit"
        @cancel="cancel"
        @remove="remove"
        @dismiss="prompting = null"
    />
    <MarkdownImageCard
        :open="imageOpen"
        :session="imageSession"
        :anchor="anchor"
        :menus="props.menus"
        :media="props.media"
        :current="props.base()"
        @insert="insertImage"
        @cancel="cancelImage"
        @dismiss="imageOpen = false"
    />
    <MarkdownStickerCard
        v-if="picker !== null"
        :open="stickerOpen"
        :anchor="anchor"
        :picker="picker"
        @pick="pickSticker"
        @close="closeSticker"
    />
</template>
