<script setup lang="ts">
/** 块按钮与块菜单（同名 .md）。 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import {blockAt, canConvertTo, insertSlashBlock, selectBlock, selectWholeBlock} from "@notnotype/nb-markdown/editor";
import type {BlockTarget} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import {EDITING_ACTIONS, EDITOR_BLOCK_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import {copyOrCut} from "./clipboard";

const props = defineProps<{editor: Editor | null; scroller: HTMLElement | null; editing: EditorEditing; menus: EditorMenus; readonly: boolean; binding: string | null}>();
const emit = defineEmits<{(event: "inserted", pos: number): void}>();

/** 按钮组 22 + 1 + 18 宽、24 高；右缘离正文 14px（决定 9）。 */
const GROUP_WIDTH = 41;
const GROUP_HEIGHT = 24;
const GAP = 14;

const target = shallowRef<BlockTarget | null>(null);
const at = ref({top: 0, left: 0});
const menuOpen = ref(false);
const menuAt = ref({x: 0, y: 0});
/** 拖动中手柄是拖动源：拿掉它 `dragend` 可能收不到，`view.dragging` 就清不掉。 */
let dragging = false;

/** 按钮对着这一块第一行的垂直中间：有文字的量第一个文字位置，原子块量节点的顶。 */
function place(editor: Editor, scroller: HTMLElement, block: BlockTarget): void {
    const scrollerBox = scroller.getBoundingClientRect();
    const proseLeft = editor.view.dom.getBoundingClientRect().left;
    let top: number;
    if (block.kind === "whole") {
        const dom = editor.view.nodeDOM(block.pos);
        top = (dom instanceof Element ? dom.getBoundingClientRect().top : scrollerBox.top) + 4;
    } else {
        const line = editor.view.coordsAtPos(Math.min(block.pos + (block.kind === "list-item" || block.kind === "container" ? 2 : 1), editor.state.doc.content.size));
        if (line.bottom > line.top) {
            top = (line.top + line.bottom) / 2 - GROUP_HEIGHT / 2;
        } else {
            // 折叠的提示块：内容是隐藏的，量出来是全 0，改量块本身。
            const dom = editor.view.nodeDOM(block.pos);
            top = (dom instanceof Element ? dom.getBoundingClientRect().top : scrollerBox.top) + 4;
        }
    }
    at.value = {
        top: top - scrollerBox.top + scroller.scrollTop,
        // 版心窄到没有页边时压进留白，不越出滚动容器。
        left: Math.max(2, proseLeft - scrollerBox.left + scroller.scrollLeft - GAP - GROUP_WIDTH),
    };
}

const onPointerMove = (event: PointerEvent): void => {
    const editor = props.editor;
    const scroller = props.scroller;
    if (editor === null || scroller === null || props.readonly || menuOpen.value) return;
    if ((event.target as Element | null)?.closest("[data-markdown-gutter]") != null) return;
    const prose = editor.view.dom.getBoundingClientRect();
    // 指针在左侧留白里时也算这一行的块。
    const found = editor.view.posAtCoords({left: Math.min(Math.max(event.clientX, prose.left + 1), prose.right - 1), top: event.clientY});
    const block = found === null ? null : blockAt(editor.state.doc, found.pos);
    // 还是同一块时不重新量：`pointermove` 很密，量位置会强制布局。正文变了或滚动了都会先收起，所以位置不会过时。
    const current = target.value;
    if (block !== null && current !== null && block.pos === current.pos && block.end === current.end) return;
    target.value = block;
    if (block !== null) place(editor, scroller, block);
};
const hide = (): void => {
    if (!menuOpen.value && !dragging) target.value = null;
};
// 正文变了或滚动了，指针没动：位置已经不对，等下一次指针移动。不进撤销历史的是交出后的写法回填，只改属性，用户正要去点按钮时不收起。
const onTransaction = ({transaction}: {transaction: {docChanged: boolean; getMeta: (key: string) => unknown}}): void => {
    if (transaction.docChanged && transaction.getMeta("addToHistory") !== false) hide();
};

function attach(editor: Editor, scroller: HTMLElement): () => void {
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerleave", hide);
    scroller.addEventListener("scroll", hide, {passive: true});
    editor.on("transaction", onTransaction);
    return () => {
        scroller.removeEventListener("pointermove", onPointerMove);
        scroller.removeEventListener("pointerleave", hide);
        scroller.removeEventListener("scroll", hide);
        editor.off("transaction", onTransaction);
    };
}
let detach: (() => void) | null = null;
watch(() => [props.editor, props.scroller] as const, ([editor, scroller]) => {
    detach?.();
    detach = editor !== null && scroller !== null ? attach(editor, scroller) : null;
}, {immediate: true});
onBeforeUnmount(() => detach?.());
watch(() => [props.binding, props.readonly] as const, () => {
    menuOpen.value = false;
    target.value = null;
});

function onPlus(event: MouseEvent): void {
    const editor = props.editor;
    const block = target.value;
    if (editor === null || block === null) return;
    editor.commands.focus();
    emit("inserted", insertSlashBlock(editor, block, event.altKey ? "before" : "after"));
}

function onHandleClick(event: MouseEvent): void {
    const editor = props.editor;
    const block = target.value;
    if (editor === null || block === null) return;
    selectBlock(editor, block);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuAt.value = {x: box.left, y: box.bottom + 6};
    menuOpen.value = true;
}

/**
 * 拖动用浏览器的拖放：起拖门槛由浏览器定，落点线是 StarterKit 的 dropcursor，放下由 ProseMirror 处理。整块选中后交 `view.dragging`，
 * 它按选区删原位。ProseMirror 只在 `view.dom` 上听 `dragend`，手柄在外面，所以这里自己清：不清的话之后外部拖入会把旧块当成
 * 要移动的内容，插入它并删掉选区（输出 16）。
 */
function onDragStart(event: DragEvent): void {
    const editor = props.editor;
    const block = target.value;
    if (editor === null || block === null || event.dataTransfer === null) return;
    selectWholeBlock(editor, block);
    const slice = editor.state.selection.content();
    const {dom, text} = editor.view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    event.dataTransfer.effectAllowed = "copyMove";
    const image = editor.view.nodeDOM(block.pos);
    if (image instanceof Element) event.dataTransfer.setDragImage(image, 0, 0);
    editor.view.dragging = {slice, move: true};
    dragging = true;
}
function onDragEnd(): void {
    dragging = false;
    if (props.editor !== null) props.editor.view.dragging = null;
    target.value = null;
}

const CONVERT: ReadonlyArray<EditingActionId> = ["paragraph", "heading-1", "heading-2", "heading-3", "bullet-list", "ordered-list", "task-list", "quote", "callout", "code-block"];
/** 块类型的分节：基本｜列表｜块。 */
const CONVERT_BREAKS: ReadonlySet<EditingActionId> = new Set(["bullet-list", "quote"]);

function convert(action: EditingActionId): void {
    // 列表项与容器转“正文”是解开，别的类型走工具栏同一条命令。
    const kind = target.value?.kind;
    props.menus.run(action === "paragraph" && (kind === "list-item" || kind === "container") ? "block-unwrap" : action);
}

const items = computed<ContextMenuItem[]>(() => {
    const editor = props.editor;
    if (editor === null || !menuOpen.value) return [];
    const action = (id: EditingActionId): ContextMenuItem => {
        const shortcut = props.menus.shortcut(id);
        return {
            label: props.menus.title(id),
            iconClass: EDITING_ACTIONS[id].icon,
            ...(shortcut === null ? {} : {shortcut}),
            disabled: !props.editing.enabled(id),
            action: () => props.menus.run(id),
        };
    };
    const children = CONVERT.flatMap((id): ContextMenuItem[] => {
        const entry: ContextMenuItem = {
            label: props.menus.title(id),
            iconClass: EDITING_ACTIONS[id].icon,
            type: "checkbox",
            checked: props.editing.active(id),
            disabled: !canConvertTo(editor.state, id),
            action: () => convert(id),
        };
        return CONVERT_BREAKS.has(id) ? [{separator: true}, entry] : [entry];
    });
    const contributed = props.menus.contributed(EDITOR_BLOCK_POINT).flat().map((entry): ContextMenuItem => ({
        label: entry.label,
        ...(entry.icon === null ? {} : {iconClass: entry.icon}),
        disabled: !entry.enabled,
        action: () => props.menus.runContributed(EDITOR_BLOCK_POINT, entry.id),
    }));
    return [
        {label: props.menus.label("convert"), iconClass: "i-lucide-repeat", children},
        {separator: true},
        action("block-duplicate"),
        {
            label: props.menus.label("copy"),
            iconClass: "i-lucide-copy",
            action: () => {
                if (target.value !== null) selectWholeBlock(editor, target.value);
                copyOrCut(editor, "copy");
            },
        },
        {separator: true},
        action("block-up"),
        action("block-down"),
        ...(contributed.length > 0 ? [{separator: true}, ...contributed] : []),
        {separator: true},
        {...action("block-delete"), tone: "danger"},
    ];
});

function onRequestClose(reason: string): void {
    if (reason !== "outside") props.editor?.commands.focus();
    target.value = null;
}
</script>

<template>
    <Teleport v-if="props.scroller !== null" :to="props.scroller">
        <div
            v-if="target !== null && !props.readonly"
            class="markdown-gutter"
            data-markdown-gutter
            :style="{top: `${at.top}px`, left: `${at.left}px`}"
        >
            <button
                type="button"
                tabindex="-1"
                class="markdown-gutter__button w-[22px]"
                :aria-label="props.menus.label('insertBlock')"
                :title="props.menus.label('insertBlock')"
                @mousedown.prevent
                @click="onPlus"
            >
                <span class="i-lucide-plus h-4 w-4" aria-hidden="true" />
            </button>
            <button
                type="button"
                tabindex="-1"
                draggable="true"
                class="markdown-gutter__button w-[18px] cursor-grab"
                :aria-label="props.menus.label('blockMenu')"
                :title="props.menus.label('blockMenu')"
                @click="onHandleClick"
                @dragstart="onDragStart"
                @dragend="onDragEnd"
            >
                <span class="i-lucide-grip-vertical h-4 w-4" aria-hidden="true" />
            </button>
        </div>
    </Teleport>
    <ContextMenu :open="menuOpen" :x="menuAt.x" :y="menuAt.y" :items="items" @update:open="(next: boolean) => { menuOpen = next; }" @request-close="onRequestClose" />
</template>

<style scoped>
.markdown-gutter {
    position: absolute;
    z-index: 1;
    display: flex;
    gap: 1px;
    align-items: center;
    height: 24px;
}

.markdown-gutter__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    border-radius: 4px;
    color: color-mix(in srgb, var(--text-main) 35%, transparent);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.markdown-gutter__button:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
}
</style>
