<script setup lang="ts">
/** 编辑器区的根（同名 .md）：按 grid 排列编辑组，承载关闭询问与编辑器区内的键位。 */
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {DropFeedbackOverlay, useGridLayout, useLayoutExtent, NestedGrid} from "@notnotype/nb-layout/vue";
import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import type {Component} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {EditorArea} from "../area";
import type {EmptyTip} from "../empty-tips";
import type {EditorState} from "../editor-registry";
import type {EditorPageSource} from "../pages";
import {useEditorText} from "../text";
import {nameOf} from "../documents/address";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import {tabLabel} from "../tab-label";
import {pageIdOf} from "../pages";
import {createTabDrag} from "../tab-drag";
import type {TabDrag, TabDrop} from "../tab-drag";
import EditorGroup from "./EditorGroup.vue";
import type {EditorGroupTabMenu, EditorGroupTitleActions} from "./EditorGroup.vue";

/** 编辑器区内的键位对应的意图：宿主把它换成命令执行（组件不认识命令）。 */
export type EditorIntent = "save" | "close" | "split-right";

const props = withDefaults(defineProps<{
    area: EditorArea;
    control: (editor: string) => EditorState;
    pages?: EditorPageSource | null;
    emptyTips?: ReadonlyArray<EmptyTip>;
    /** 活动组的标题动作（`title-actions.ts`）：只画在 `group` 那一组；没有时为 null。 */
    titleActions?: EditorGroupTitleActions | null;
    /** 标签的右键菜单（输出 57），每组都用。 */
    tabMenu?: EditorGroupTabMenu | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54）；缺省开。 */
    wrapTabs?: boolean;
    /** 面包屑（设置 `nbook.editor/breadcrumbs`，输出 60）；缺省开。 */
    breadcrumbs?: boolean;
    /** 作品名（面包屑的第一段）；未绑定作品为 null。 */
    workTitle?: string | null;
}>(), {pages: null, emptyTips: () => [], titleActions: null, tabMenu: null, wrapTabs: true, breadcrumbs: true, workTitle: null});
const port = useText();
const t = useEditorText();
const emit = defineEmits<{(event: "intent", intent: EditorIntent): void; (event: "run-tip", command: string): void; (event: "title-action", key: string): void; (event: "tab-menu", tabId: string, key: string): void}>();

const root = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(root);
const grid = computed(() => props.area.groups.grid);
const host = useGridLayout({grid, extent, contextKey: () => "editor", onApplied: () => props.area.layoutChanged()});
// 组模型原地改了树（拆分、关闭组）：重算布局。
watch(() => props.area.groups.layoutVersion.value, () => host.invalidate());

/** 编辑器区内的键位：只在编辑器区有焦点时处理，交给宿主执行同一条命令（命令声明里不写全局键位）。 */
const plain = (event: KeyboardEvent): boolean => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
const KEYS: ReadonlyArray<{readonly test: (event: KeyboardEvent) => boolean; readonly intent: EditorIntent}> = [
    {test: (event) => plain(event) && event.key.toLowerCase() === "s", intent: "save"},
    {test: (event) => plain(event) && event.key.toLowerCase() === "w", intent: "close"},
    {test: (event) => plain(event) && event.key === "\\", intent: "split-right"},
];

const onKeydown = (event: KeyboardEvent): void => {
    const match = KEYS.find((key) => key.test(event));
    if (match === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    emit("intent", match.intent);
};

const onFocusOut = (event: FocusEvent): void => {
    if (root.value !== null && !root.value.contains(event.relatedTarget as Node | null)) props.area.focused.value = false;
};
// 新焦点落在编辑器区之外才算用户离开：控件重挂时焦点暂时落到页面根，页面根不触发 focusin，不撤销等待中的焦点交接。
// 焦点也可能从页面根直接去资源管理器（关闭标签拿下了原来的焦点），编辑器区收不到 focusout，所以在 document 上看。
const onDocumentFocusIn = (event: FocusEvent): void => {
    if (root.value !== null && event.target instanceof Node && !root.value.contains(event.target)) props.area.focusLeft();
};
onMounted(() => document.addEventListener("focusin", onDocumentFocusIn));
onBeforeUnmount(() => document.removeEventListener("focusin", onDocumentFocusIn));

/**
 * 拖动标签（输出 55）：手势与落点在 `tab-drag.ts`，这里给它结构键、画反馈、提交。结构键包括各组的标签 id、固定状态与多行
 * 设置：起拖后它们变了，那一场拖动取消。
 */
const drop = shallowRef<TabDrop | null>(null);
const pointer = shallowRef<{readonly tabId: string; readonly x: number; readonly y: number} | null>(null);
let tabDrag: TabDrag | null = null;
onMounted(() => {
    if (root.value === null) return;
    tabDrag = createTabDrag(root.value, {
        structure: () => JSON.stringify([props.wrapTabs ?? true, props.area.groups.groups.value.map((group) => [group.id, group.tabs.map((tab) => [tab.id, tab.kind === "file" && tab.pinned === true])])]),
        show: (next) => {
            drop.value = next;
        },
        follow: (next) => {
            pointer.value = next;
        },
        commit: (action) => {
            if (action.kind === "split") props.area.moveToNewGroup(action.tabId, action.group, action.edge);
            else void props.area.moveTab(action.tabId, action.place);
        },
    });
});
onBeforeUnmount(() => tabDrag?.dispose());
const DROP_LABELS = {"move": "drop.move", "keep": "drop.keep", "split-left": "drop.splitLeft", "split-right": "drop.splitRight", "split-top": "drop.splitTop", "split-bottom": "drop.splitBottom"} as const;
/** 跟手的拖影：被拖标签的图标与名字（与标签条上写的相同），画在指针右下。标签在拖动中没了时整场已经取消。 */
const ghost = computed(() => {
    const at = pointer.value;
    if (at === null) return null;
    const tab = props.area.groups.groups.value.flatMap((group) => group.tabs).find((candidate) => candidate.id === at.tabId);
    if (tab === undefined) return null;
    return {label: tabLabel(props.area, tab, port, props.pages ?? null), icon: pageIdOf(tab.address) === null ? fileIconForName(nameOf(tab.address)) : null, x: at.x, y: at.y};
});
const dropLabel = computed(() => (drop.value === null ? "" : t(DROP_LABELS[drop.value.label])));

const dialog = computed(() => props.area.dialog.value);
</script>

<template>
    <div
        ref="root"
        class="h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--panel-surface)]"
        data-editor-area
        @keydown="onKeydown"
        @focusin="area.focused.value = true"
        @focusout="onFocusOut"
    >
        <p v-if="area.notice.value !== null" class="flex items-center gap-2 border-b border-[color:var(--divider)] px-3 py-1.5 text-xs text-[var(--status-warning)]" role="status" data-editor-notice>
            <span class="min-w-0 flex-1">{{ port.t(area.notice.value) }}</span>
            <Button size="sm" variant="ghost" @click="area.dismissNotice()">{{ t("area.dismiss") }}</Button>
        </p>
        <NestedGrid
            v-if="host.node.value !== null"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="extent === null"
            context-key="editor"
            :revision="host.revision.value"
            :on-gesture-commit="host.onGestureCommit"
        >
            <template #leaf="{node}">
                <EditorGroup
                    :area="area"
                    :group-id="node.id"
                    :control="control"
                    :pages="pages ?? null"
                    :empty-tips="emptyTips ?? []"
                    :title-actions="titleActions != null && titleActions.group === node.id ? titleActions : null"
                    :tab-menu="tabMenu ?? null"
                    :wrap-tabs="wrapTabs"
                    :breadcrumbs="breadcrumbs"
                    :work-title="workTitle"
                    @tab-menu="(tabId: string, key: string) => emit('tab-menu', tabId, key)"
                    @run-tip="(command) => emit('run-tip', command)"
                    @title-action="(key) => emit('title-action', key)"
                />
            </template>
        </NestedGrid>
        <Teleport to="body">
            <div v-if="ghost !== null" class="editor-drag-ghost" :style="{left: `${ghost.x + 12}px`, top: `${ghost.y + 12}px`, zIndex: NB_Z_INDEX.dragFeedback}" aria-hidden="true" data-editor-drag-ghost>
                <FileIcon v-if="ghost.icon !== null" :icon="ghost.icon" />
                <span class="truncate">{{ ghost.label }}</span>
            </div>
        </Teleport>
        <DropFeedbackOverlay :preview="drop?.preview ?? null" :label="dropLabel" :data-editor-drop="drop === null ? undefined : drop.label" />
        <Dialog
            :open="dialog !== null"
            :title="t(dialog?.saveable === false ? 'closeDialog.titleUnrepresentable' : 'closeDialog.title', {name: dialog === null ? '' : nameOf(dialog.address)})"
            size="sm"
            @request-close="area.answer('cancel')"
        >
            <p class="text-sm" data-editor-close-dialog>{{ t(dialog?.saveable === false ? "closeDialog.bodyUnrepresentable" : "closeDialog.body") }}</p>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-editor-close-cancel @click="area.answer('cancel')">{{ t("closeDialog.cancel") }}</Button>
                    <Button variant="secondary" size="sm" data-editor-close-discard @click="area.answer('discard')">{{ t("closeDialog.discard") }}</Button>
                    <Button v-if="dialog?.saveable !== false" variant="primary" size="sm" data-editor-close-save @click="area.answer('save')">{{ t("closeDialog.save") }}</Button>
                </div>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
/*
 * 拖影：与标签同字号、同底色的一小块（图标加名字），跟着指针、不挡命中（落点用 elementFromPoint 算）。它在 body 下，
 * 不受编辑器区的裁剪；scoped 的类名照样生效。
 */
.editor-drag-ghost {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    height: 28px;
    padding-inline: 10px 12px;
    border: var(--border-w) solid var(--control-outline);
    border-radius: var(--radius-control);
    background: var(--panel-surface);
    box-shadow: var(--elevation-raised);
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
}
</style>

<style>
/* 标签拖动进行中（tab-drag.ts 在编辑器区的根上写的标记；指针捕获在根上，光标随根）：抓手光标、不扩选文字。 */
[data-editor-tab-dragging],
[data-editor-tab-dragging] * {
    cursor: grabbing !important;
    user-select: none !important;
}
</style>
