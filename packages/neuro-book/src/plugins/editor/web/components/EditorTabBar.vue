<script setup lang="ts">
/** 编辑组的标签条（同名 .md）：标签里的内容与外观，语义、键盘、多行与分区在 `TabStrip`。 */
import {TabStrip} from "@notnotype/nb-layout/vue";
import {computed} from "vue";

import {editorTabKey} from "nbook/plugins/workbench/shared/contracts";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

export interface TabItem {
    readonly id: string;
    readonly label: string;
    /** 悬停提示：完整地址。 */
    readonly title: string;
    readonly preview: boolean;
    readonly dirty: boolean;
    readonly active: boolean;
    readonly pinned: boolean;
    /** 文件图标；页面标签没有。 */
    readonly icon: CatppuccinIcon | null;
    /** 同名提示（`…/notes`、根名或编辑器名，docs/specs/workbench/editor.md 输出 56）；不同名时为 null。 */
    readonly hint: string | null;
}

const props = withDefaults(defineProps<{
    tabs: ReadonlyArray<TabItem>;
    label: string;
    closeLabel: (label: string) => string;
    unpinLabel: (label: string) => string;
    unsavedLabel: string;
    /** 固定标签的读屏文字（固定改变“关闭其他”“关闭右侧”的行为，只靠图钉与位置读屏器听不出来）。 */
    pinnedLabel: string;
    /** 多行（设置 `wrapTabs`）：固定标签单独一行，普通标签放不下时换行；否则一行横向滚动。 */
    wrap?: boolean;
    /** 这一组是活动组：别的组的活动标签文字降为次级色。 */
    groupActive?: boolean;
    /** 标签的可访问描述：怎么用键盘拿起（docs/specs/ui/workbench-layout.md 输出 31）。 */
    dragHint?: string;
}>(), {wrap: true, groupActive: true, dragHint: ""});
const emit = defineEmits<{
    (event: "activate", id: string): void;
    /** 双击：preview 转正。 */
    (event: "keep", id: string): void;
    (event: "close", id: string): void;
    /** 点固定标签的图钉：取消固定。 */
    (event: "unpin", id: string): void;
    (event: "move", id: string, delta: -1 | 1): void;
    /** 右键、Shift+F10 或菜单键：在视口坐标 (x, y) 打开这个标签的菜单。 */
    (event: "menu", id: string, x: number, y: number): void;
}>();

/** 多行时固定标签单独一行（输出 54）；单行时固定标签只是排在最前，与普通标签同一行，分区只写在标签上。 */
const partitions = computed(() => {
    if (!props.wrap) return undefined;
    const normal = {id: "normal", layout: "wrap" as const};
    return props.tabs.some((tab) => tab.pinned) ? [{id: "pinned", layout: "scroll" as const}, normal] : [normal];
});

const byKey = computed(() => new Map(props.tabs.map((tab) => [editorTabKey(tab.id), tab])));
const items = computed(() => props.tabs.map((tab) => ({
    id: editorTabKey(tab.id),
    title: tab.label,
    tooltip: tab.title,
    partition: tab.pinned ? "pinned" : "normal",
    attrs: {
        "data-editor-tab": tab.id,
        ...(tab.preview ? {"data-editor-tab-preview": ""} : {}),
        ...(tab.dirty ? {"data-editor-tab-dirty": ""} : {}),
        ...(tab.pinned ? {"data-editor-tab-pinned": ""} : {}),
    },
})));
const active = computed(() => {
    const id = props.tabs.find((tab) => tab.active)?.id;
    return id === undefined ? null : editorTabKey(id);
});
const tabOf = (key: string): TabItem => byKey.value.get(key) as TabItem;
/** 把标签键换回标签 id 再发：编辑器的事件都按 id。 */
const idOf = (key: string): string => tabOf(key).id;
</script>

<template>
    <TabStrip
        class="editor-tabs text-[length:var(--text-sm)]"
        :items="items"
        :active="active"
        :label="label"
        :partitions="partitions"
        overflow="scroll"
        :drag-hint="dragHint"
        :data-wrap="wrap ? '' : undefined"
        :data-group-active="groupActive ? '' : undefined"
        data-editor-tabs
        @activate="(key: string) => emit('activate', idOf(key))"
        @keep="(key: string) => emit('keep', idOf(key))"
        @close="(key: string) => emit('close', idOf(key))"
        @reorder="(key: string, delta: -1 | 1) => emit('move', idOf(key), delta)"
        @context-menu="(key: string, at: {x: number; y: number}) => emit('menu', idOf(key), at.x, at.y)"
    >
        <template #tab="{item}">
            <FileIcon v-if="tabOf(item.id).icon !== null" :icon="tabOf(item.id).icon!" class="editor-tab__icon" />
            <span class="editor-tab__label" :class="tabOf(item.id).preview ? 'italic' : ''" data-editor-tab-label>{{ item.title }}</span>
            <span v-if="tabOf(item.id).hint !== null" class="editor-tab__hint" data-editor-tab-hint>{{ tabOf(item.id).hint }}</span>
            <span v-if="tabOf(item.id).pinned" class="sr-only">（{{ pinnedLabel }}）</span>
            <span v-if="tabOf(item.id).dirty" class="sr-only">（{{ unsavedLabel }}）</span>
        </template>
        <template #action="{item}">
            <!-- 状态位：固定的是图钉（点它取消固定）；否则未保存是圆点，活动、悬停或聚焦时换成关闭。不进 Tab 顺序（键盘用 Delete）。 -->
            <button
                v-if="tabOf(item.id).pinned"
                type="button"
                class="editor-tab__action nb-ui-focus-ring-inset"
                :aria-label="unpinLabel(item.title)"
                tabindex="-1"
                :data-editor-tab-unpin="idOf(item.id)"
                data-editor-tab-action
                data-no-drag-start
                @click="emit('unpin', idOf(item.id))"
            >
                <span v-if="tabOf(item.id).dirty" class="editor-tab__dot" aria-hidden="true"></span>
                <span class="i-lucide-pin size-3.5" :class="tabOf(item.id).dirty ? 'editor-tab__reveal' : ''" aria-hidden="true"></span>
            </button>
            <button
                v-else
                type="button"
                class="editor-tab__action editor-tab__close nb-ui-focus-ring-inset"
                :aria-label="closeLabel(item.title)"
                tabindex="-1"
                :data-editor-tab-close="idOf(item.id)"
                data-editor-tab-action
                data-no-drag-start
                @click="emit('close', idOf(item.id))"
            >
                <span v-if="tabOf(item.id).dirty" class="editor-tab__dot" aria-hidden="true"></span>
                <span class="i-lucide-x size-3.5 editor-tab__reveal" aria-hidden="true"></span>
            </button>
        </template>
    </TabStrip>
</template>

<style scoped>
/*
 * VS Code 式的标签条（docs/specs/workbench/editor.md 输出 53、54）：条底比正文低一档（主题角色 `--editor-tabs-surface`），
 * 活动标签与正文同色、顶部两角圆。高度：最多显示 3 行，组矮时由编辑组的 flex 收到 1 行（见 EditorGroup），超出部分在
 * 标签区里纵向滚动。
 */
.editor-tabs {
    --editor-tab-h: 34px;
    min-width: 0;
    min-height: var(--editor-tab-h);
    max-height: calc(var(--editor-tab-h) * 3);
    background: var(--editor-tabs-surface);
}

.editor-tabs :deep(.nb-tab-strip__list) {
    align-self: stretch;
    max-height: inherit;
    min-height: inherit;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
}

.editor-tabs :deep(.nb-tab-strip__row) {
    /*
     * 末尾留 4px：编辑组的左缘可能落在半像素上，浏览器把可滚动宽度向下取整，没有这点余量时滚到底，最后一个标签仍被裁掉
     * 一像素左右。
     */
    padding-inline-end: 4px;
}

.editor-tabs :deep(.nb-tab-frame) {
    max-width: 240px;
    height: var(--editor-tab-h);
    padding-inline: 10px 4px;
    border-radius: 6px 6px 0 0;
    color: var(--text-secondary);
}

.editor-tabs :deep(.nb-tab-frame:hover) {
    background: color-mix(in srgb, var(--panel-surface) 50%, var(--editor-tabs-surface));
}

.editor-tabs :deep(.nb-tab-frame.is-active) {
    background: var(--panel-surface);
    color: var(--text-main);
}

/* 不是活动组：活动标签仍是正文色的一块，文字降为次级色。 */
.editor-tabs:not([data-group-active]) :deep(.nb-tab-frame.is-active) {
    color: var(--text-secondary);
}

/* 开放式分隔线：同一行相邻标签之间 1px，上下各留四分之一；活动或悬停标签的两侧不画（输出 53）。 */
.editor-tabs :deep(.nb-tab-frame + .nb-tab-frame)::before {
    content: "";
    position: absolute;
    left: 0;
    top: 25%;
    bottom: 25%;
    width: 1px;
    background: var(--divider);
    pointer-events: none;
}

.editor-tabs :deep(.nb-tab-frame.is-active)::before,
.editor-tabs :deep(.nb-tab-frame.is-active + .nb-tab-frame)::before,
.editor-tabs :deep(.nb-tab-frame:hover)::before,
.editor-tabs :deep(.nb-tab-frame:hover + .nb-tab-frame)::before {
    opacity: 0;
}

.editor-tabs :deep(.nb-tab) {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    text-align: left;
}

.editor-tab__icon {
    flex: none;
}

.editor-tab__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 提示与名字分着标签的宽度：提示至多占一半，过长同样截断，不把名字挤没、不溢出到相邻标签。 */
.editor-tab__hint {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
}

/* 圆点与关闭（或图钉）叠在同一格里：换来换去不改变宽度。 */
.editor-tab__action {
    display: grid;
    flex: none;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-inline-start: 4px;
    border-radius: 4px;
    color: var(--text-muted);
}

.editor-tab__action:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.editor-tab__action > * {
    grid-area: 1 / 1;
}

.editor-tab__dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
}

/*
 * 关闭按钮按标签显隐（输出 58）：只在活动、悬停、键盘聚焦的标签上显示，其余时候隐藏但占位，标签宽度不变。未保存的标签
 * 平时是圆点，同样的时机换成关闭（固定标签换成图钉）。不能悬停的设备上一直显示。
 */
.editor-tab__reveal {
    visibility: hidden;
}

.editor-tabs :deep(.nb-tab-frame.is-active) .editor-tab__reveal,
.editor-tabs :deep(.nb-tab-frame:hover) .editor-tab__reveal,
.editor-tabs :deep(.nb-tab-frame:focus-within) .editor-tab__reveal {
    visibility: visible;
}

.editor-tabs :deep(.nb-tab-frame.is-active) .editor-tab__dot,
.editor-tabs :deep(.nb-tab-frame:hover) .editor-tab__dot,
.editor-tabs :deep(.nb-tab-frame:focus-within) .editor-tab__dot {
    display: none;
}

@media (hover: none) {
    .editor-tab__reveal {
        visibility: visible;
    }

    .editor-tab__dot {
        display: none;
    }
}
</style>
