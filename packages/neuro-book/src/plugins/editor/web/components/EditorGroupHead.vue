<script setup lang="ts">
/** 一个编辑组的头（同名 .md）：提示条、标签条、标题动作与标签的右键菜单。画在工作台的外框里，内容从它下面开始。 */
import {Button, ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {buttonBudget} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import type {EditorArea} from "../area";
import {nameOf} from "../documents/address";
import {pageIdOf} from "../pages";
import type {EditorPageSource} from "../pages";
import {tabHints} from "../tab-hints";
import {tabLabel} from "../tab-label";
import type {TabMenuEntry} from "../tab-menu";
import {useEditorText} from "../text";
import {EDITOR_TITLE_MAX_BUTTONS, EDITOR_TITLE_TAB_RESERVE} from "../title-actions";
import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";
import {useEditorGroupRoot} from "./useEditorGroupRoot";
import type {EditorIntent} from "./useEditorGroupRoot";

export interface EditorGroupTabMenu {
    /** 标签的菜单项；标签已不在为 null。 */
    readonly entries: (tabId: string) => ReadonlyArray<TabMenuEntry> | null;
    /** 菜单身份；标签已不在为 null。 */
    readonly identity: (tabId: string) => string | null;
}

export interface EditorGroupTitleActions {
    /** 拿到标题动作的组（活动组）。 */
    readonly group: string;
    /** 按组给出的按钮个数拼好的标题动作。 */
    readonly model: (maxButtons: number) => TitleActionsModel;
    /** “⋯”的菜单身份：活动组、活动标签与地址。 */
    readonly identity: string;
}

const props = withDefaults(defineProps<{
    area: EditorArea;
    groupId: string;
    pages?: EditorPageSource | null;
    /** 标签条右侧的标题动作：只有活动组拿到，别的组为 null（docs/specs/workbench/editor.md 输出 34）。 */
    titleActions?: EditorGroupTitleActions | null;
    /** 标签的右键菜单（输出 57）；没有时右键不出菜单。 */
    tabMenu?: EditorGroupTabMenu | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54）；缺省开。 */
    wrapTabs?: boolean;
}>(), {pages: null, titleActions: null, tabMenu: null, wrapTabs: true});

const emit = defineEmits<{
    (event: "intent", intent: EditorIntent): void;
    /** 点了标题动作：交出它的 key，由宿主执行。 */
    (event: "title-action", key: string): void;
    /** 点了标签菜单的一项：交出被右击的标签 id 与项的 key，由宿主执行。 */
    (event: "tab-menu", tabId: string, key: string): void;
}>();

const port = useText();
const t = useEditorText();

const root = useEditorGroupRoot({area: () => props.area, groupId: () => props.groupId, intent: (intent) => emit("intent", intent), root: "head"});

const group = computed(() => props.area.groups.shown.value.find((candidate) => candidate.id === props.groupId) ?? null);
const active = computed(() => props.area.groups.activeGroup.value === props.groupId);

const tabs = computed((): TabItem[] => {
    const shown = (group.value?.tabs ?? []).map((tab) => ({tab, page: pageIdOf(tab.address), label: tabLabel(props.area, tab, port, props.pages)}));
    // 同名提示只看文件标签（输出 56）。
    const hints = tabHints(shown.flatMap(({tab, page, label}) => (page === null && tab.kind === "file" ? [{id: tab.id, label, address: tab.address, editor: tab.editor}] : [])), {
        root: (scheme) => t(scheme === "project" ? "root.project" : "root.user"),
        editor: (id) => port.t(props.area.editors.declaration(id)?.title ?? id),
    });
    return shown.map(({tab, page, label}): TabItem => ({
        id: tab.id,
        label,
        title: page === null ? tab.address : label,
        preview: tab.preview,
        dirty: props.area.documents.get(tab.address)?.dirty.value === true,
        active: tab.id === group.value?.active,
        pinned: tab.kind === "file" && tab.pinned === true,
        icon: page === null ? fileIconForName(nameOf(tab.address)) : null,
        hint: hints.get(tab.id) ?? null,
    }));
});

/** 打开着的标签菜单：被右击的标签、位置与打开时的身份；身份变了（标签关闭、换组、换编辑器）就关上（输出 57）。 */
const tabMenuState = shallowRef<{readonly tabId: string; readonly x: number; readonly y: number; readonly identity: string} | null>(null);
const openTabMenu = (tabId: string, x: number, y: number): void => {
    const identity = props.tabMenu?.identity(tabId) ?? null;
    tabMenuState.value = identity === null ? null : {tabId, x, y, identity};
};
watch(() => (tabMenuState.value === null ? null : props.tabMenu?.identity(tabMenuState.value.tabId) ?? null), (identity) => {
    if (tabMenuState.value !== null && identity !== tabMenuState.value.identity) tabMenuState.value = null;
});
const tabMenuItems = computed((): ContextMenuItem[] => {
    const opened = tabMenuState.value;
    if (opened === null) return [];
    return (props.tabMenu?.entries(opened.tabId) ?? []).map((entry) => (entry.kind === "separator"
        ? {separator: true}
        : {
            label: entry.label,
            disabled: entry.disabled,
            ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
            ...(entry.reason === null ? {} : {title: entry.reason}),
            action: () => emit("tab-menu", opened.tabId, entry.key),
        }));
});

/** 标签条一行的宽度：标题动作按它决定放几个按钮，标签条至少留一个截断标签的宽度（输出 34）。 */
const stripRow = ref<HTMLElement | null>(null);
const stripWidth = ref<number | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
    const element = stripRow.value;
    if (element === null || typeof ResizeObserver !== "function") return;
    observer = new ResizeObserver(() => {
        stripWidth.value = element.clientWidth > 0 ? element.clientWidth : null;
    });
    observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());

const titleModel = computed((): TitleActionsModel | null => (props.titleActions === null ? null : props.titleActions.model(buttonBudget(stripWidth.value, EDITOR_TITLE_TAB_RESERVE, EDITOR_TITLE_MAX_BUTTONS))));
const hasTitleActions = computed(() => titleModel.value !== null && (titleModel.value.buttons.length > 0 || titleModel.value.menu.length > 0));
</script>

<template>
    <div
        ref="head"
        class="editor-group-head"
        :data-editor-group-head="groupId"
        :data-editor-group-head-active="active ? '' : undefined"
        @keydown="root.onKeydown"
        @focusin="root.onFocusIn"
        @focusout="root.onFocusOut"
        @pointerdown="root.onPointerDown"
    >
        <!-- 提示是整个编辑器区一条（例如换文档前有未裁决输入）：显示在动作发生的活动组顶部。 -->
        <p v-if="active && area.notice.value !== null" class="editor-group-head__notice" role="status" data-editor-notice>
            <span class="editor-group-head__notice-text">{{ port.t(area.notice.value) }}</span>
            <Button size="sm" variant="ghost" @click="area.dismissNotice()">{{ t("area.dismiss") }}</Button>
        </p>
        <!-- 标签多时标签条自己横向滚动，标题动作固定在右侧、不随之滚动。 -->
        <div ref="stripRow" class="editor-group-head__strip" :data-panel-strip="groupId">
            <EditorTabBar
                class="editor-group-head__tabs"
                :tabs="tabs"
                :label="t('area.tabsLabel')"
                :close-label="(name: string) => t('tab.close', {name})"
                :unpin-label="(name: string) => t('tab.unpin', {name})"
                :unsaved-label="t('tab.unsaved')"
                :pinned-label="t('tab.pinned')"
                :wrap="wrapTabs"
                :group-active="active"
                :drag-hint="t('tab.dragHint')"
                @activate="(id: string) => area.activate(id)"
                @keep="(id: string) => area.keep(id)"
                @unpin="(id: string) => area.setPinned(id, false)"
                @close="(id: string) => void area.close(id)"
                @move="(id: string, delta: -1 | 1) => area.groups.move(id, delta)"
                @menu="openTabMenu"
            />
            <ContextMenu :open="tabMenuState !== null" :x="tabMenuState?.x ?? 0" :y="tabMenuState?.y ?? 0" :items="tabMenuItems" @request-close="tabMenuState = null" />
            <TitleActions
                v-if="hasTitleActions"
                class="editor-group-head__title-actions"
                :model="titleModel!"
                :identity="titleActions!.identity"
                :more-label="t('area.moreActions')"
                data-editor-title-actions
                data-no-drag
                data-hover-actions
                @run="(key: string) => emit('title-action', key)"
            />
        </div>
    </div>
</template>

<style scoped>
/*
 * 组矮的时候先收标签条（至少一行，在自己里面纵向滚动），提示条不收缩。工作台给头的上限（WorkbenchSurface）。底色与标签条同一档，标题动作落在最后一行的右侧。
 */
.editor-group-head {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.editor-group-head__notice {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    color: var(--status-warning);
    font-size: var(--text-xs);
}

.editor-group-head__notice-text {
    flex: 1 1 0;
    min-width: 0;
}

.editor-group-head__strip {
    display: flex;
    flex: 0 1 auto;
    align-items: stretch;
    min-height: 34px;
    overflow: hidden;
    background: var(--editor-tabs-surface);
}

.editor-group-head__tabs {
    flex: 1 1 auto;
    min-width: 0;
}

.editor-group-head__title-actions {
    align-self: flex-end;
    height: 34px;
    padding-inline: var(--space-1) var(--space-2);
}
</style>
