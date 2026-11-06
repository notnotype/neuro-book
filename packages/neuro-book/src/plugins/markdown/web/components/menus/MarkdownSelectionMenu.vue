<script setup lang="ts">
/** 选区浮动菜单（同名 .md）。 */
import {AnchoredPopover, IconButton, Toolbar} from "@notnotype/nb-ui/components";
import type {Editor} from "@tiptap/core";
import {NodeSelection} from "@tiptap/pm/state";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {EDITING_ACTIONS, EDITOR_SELECTION_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId, EditorEditing, EditorMenus} from "nbook/plugins/editor/shared/contracts";

import MarkdownColorButton from "./MarkdownColorButton.vue";
import {LINK_COMMAND} from "./palette";
import {selectionAnchor} from "./selection-anchor";

const props = defineProps<{
    editor: Editor | null;
    scroller: HTMLElement | null;
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    /** 换文档时变：恢复出来的选区不算刚选的（输出 7）。 */
    binding: string | null;
    /** 别的弹层（注音的输入框）开着时不显示。 */
    suspended: boolean;
}>();
const emit = defineEmits<{(event: "prompt", action: "ruby"): void}>();

/**
 * 这些状态只由指针、键盘与编辑器事件推进，不写 ProseMirror 插件视图：换文档时 `plugins` 数组换了，插件视图会全部重建
 * （`MarkdownControl.md`）。`settled` 是“用户选完了”：按下指针或按键时为假，松开时为真，所以拖选中不出现。
 */
const settled = ref(false);
const dismissed = ref(false);
const composing = ref(false);
const focused = ref(false);
const selectionTick = ref(0);

const onPointerDown = (): void => {
    settled.value = false;
    dismissed.value = false;
};
const onPointerUp = (): void => {
    settled.value = true;
};
const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
        dismissed.value = true;
        return;
    }
    settled.value = false;
};
const onKeyUp = (): void => {
    settled.value = true;
};
const onCompositionStart = (): void => {
    composing.value = true;
};
const onCompositionEnd = (): void => {
    composing.value = false;
};
// 文档变化本身不收起：点菜单里的粗体也改文档，选区还在，菜单要留着接着用。打字时选区已经没了，由“选区非空”这一条收起。
const onTransaction = ({transaction}: {transaction: {selectionSet: boolean}}): void => {
    selectionTick.value += 1;
    if (transaction.selectionSet) dismissed.value = false;
};
const onFocus = (): void => {
    focused.value = true;
};
const onBlur = (): void => {
    focused.value = false;
};

function attach(editor: Editor, scroller: HTMLElement): () => void {
    scroller.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    scroller.addEventListener("keydown", onKeyDown, true);
    scroller.addEventListener("keyup", onKeyUp, true);
    scroller.addEventListener("compositionstart", onCompositionStart, true);
    scroller.addEventListener("compositionend", onCompositionEnd, true);
    editor.on("transaction", onTransaction);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    focused.value = editor.isFocused;
    return () => {
        scroller.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        scroller.removeEventListener("keydown", onKeyDown, true);
        scroller.removeEventListener("keyup", onKeyUp, true);
        scroller.removeEventListener("compositionstart", onCompositionStart, true);
        scroller.removeEventListener("compositionend", onCompositionEnd, true);
        editor.off("transaction", onTransaction);
        editor.off("focus", onFocus);
        editor.off("blur", onBlur);
    };
}

let detach: (() => void) | null = null;
watch(() => [props.editor, props.scroller] as const, ([editor, scroller]) => {
    detach?.();
    detach = editor !== null && scroller !== null ? attach(editor, scroller) : null;
}, {immediate: true});
onBeforeUnmount(() => detach?.());

// 换文档：恢复出来的选区不算刚选的。
watch(() => props.binding, () => {
    settled.value = false;
    dismissed.value = false;
    selectionTick.value += 1;
});

const anchor = computed(() => (props.editor === null ? null : selectionAnchor(props.editor, props.scroller)));

const visible = computed(() => {
    void selectionTick.value;
    const editor = props.editor;
    if (editor === null || props.readonly || props.suspended) return false;
    if (!settled.value || dismissed.value || composing.value) return false;
    // 焦点在菜单的按钮或色板上时也算（色板传送到 body，按钮按下不夺焦，所以这里只差打开的色板）。
    const inMenu = document.activeElement?.closest("[data-markdown-menu-layer]") != null;
    if (!focused.value && !inMenu) return false;
    // 节点选区是块菜单选中的一整块，不是用户选的文字。
    const {selection} = editor.state;
    return !selection.empty && !(selection instanceof NodeSelection) && props.editing.enabled("bold");
});

const FORMATS: ReadonlyArray<EditingActionId> = ["bold", "italic", "strike", "code"];
const contributed = computed(() => props.menus.contributed(EDITOR_SELECTION_POINT).flat());
const hasLink = computed(() => props.menus.has(LINK_COMMAND));

const buttonTitle = (id: EditingActionId): string => {
    const shortcut = props.menus.shortcut(id);
    return shortcut === null ? props.menus.title(id) : `${props.menus.title(id)} (${shortcut})`;
};
</script>

<template>
    <AnchoredPopover :open="visible" :anchor="anchor">
        <Toolbar variant="flat" :aria-label="props.menus.label('selection')" class="markdown-selection-menu" data-markdown-selection-menu>
            <IconButton
                v-for="id in FORMATS"
                :key="id"
                size="sm"
                :variant="props.editing.active(id) ? 'accent' : 'default'"
                :title="buttonTitle(id)"
                :aria-label="props.menus.title(id)"
                :aria-pressed="props.editing.active(id)"
                :icon-class="EDITING_ACTIONS[id].icon"
                @click="props.menus.run(id)"
            />
            <span class="mx-1 h-4 w-px shrink-0 bg-[var(--divider)]" aria-hidden="true" />
            <IconButton v-if="hasLink" size="sm" icon-class="i-lucide-link" :title="props.menus.title('link')" :aria-label="props.menus.title('link')" @click="props.menus.execute(LINK_COMMAND)" />
            <MarkdownColorButton action="text-color" :editing="props.editing" :menus="props.menus" :readonly="props.readonly" />
            <MarkdownColorButton action="highlight" :editing="props.editing" :menus="props.menus" :readonly="props.readonly" />
            <span class="mx-1 h-4 w-px shrink-0 bg-[var(--divider)]" aria-hidden="true" />
            <IconButton size="sm" :icon-class="EDITING_ACTIONS.ruby.icon" :title="props.menus.title('ruby')" :aria-label="props.menus.title('ruby')" @click="emit('prompt', 'ruby')" />
            <IconButton size="sm" :icon-class="EDITING_ACTIONS['clear-format'].icon" :title="props.menus.title('clear-format')" :aria-label="props.menus.title('clear-format')" @click="props.menus.run('clear-format')" />
            <template v-if="contributed.length > 0">
                <span class="mx-1 h-4 w-px shrink-0 bg-[var(--divider)]" aria-hidden="true" />
                <IconButton
                    v-for="entry in contributed"
                    :key="entry.id"
                    size="sm"
                    :title="entry.label"
                    :aria-label="entry.label"
                    :icon-class="entry.icon ?? 'i-lucide-puzzle'"
                    :disabled="!entry.enabled"
                    @click="props.menus.runContributed(EDITOR_SELECTION_POINT, entry.id)"
                />
            </template>
        </Toolbar>
    </AnchoredPopover>
</template>

<style scoped>
.markdown-selection-menu {
    width: auto;
    padding: 4px;
}
</style>
