<script setup lang="ts">
/** 编辑组的标签条（同名 .md）。 */
import {computed, nextTick, ref, watch} from "vue";

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
}>(), {wrap: true, groupActive: true});
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

const list = ref<HTMLElement | null>(null);

/** 多行时固定标签单独一行（输出 54）；单行时固定标签只是排在最前，与普通标签同一行。 */
const rows = computed(() => {
    const pinned = props.tabs.filter((tab) => tab.pinned);
    if (!props.wrap) return [{key: "all", tabs: [...props.tabs]}];
    const normal = {key: "normal", tabs: props.tabs.filter((tab) => !tab.pinned)};
    return pinned.length > 0 ? [{key: "pinned", tabs: pinned}, normal] : [normal];
});

const tabElement = (id: string): HTMLElement | null => list.value?.querySelector<HTMLElement>(`[data-editor-tab="${id}"]`) ?? null;

/** 把活动标签滚到完整可见：横向滚它所在的那一行，纵向滚整个标签区（多行超过 3 行时）。只动标签条自己的滚动。 */
const reveal = (id: string): void => {
    // 等下一帧再量：新标签刚插入、或刚换了单行与多行时宽度还没落定，太早量会差几像素。
    void nextTick(() => requestAnimationFrame(() => {
        const tab = tabElement(id)?.parentElement;
        const strip = list.value;
        if (tab === null || tab === undefined || strip === null) return;
        const row = tab.parentElement;
        const box = tab.getBoundingClientRect();
        if (row !== null && row.scrollWidth > row.clientWidth) {
            const view = row.getBoundingClientRect();
            // 滚动量向外取整：`scrollLeft` 会被截到整像素，差的零点几像素会让标签边缘仍被裁掉。
            if (box.left < view.left) row.scrollLeft -= Math.ceil(view.left - box.left);
            else if (box.right > view.right) row.scrollLeft += Math.ceil(box.right - view.right);
        }
        const view = strip.getBoundingClientRect();
        if (box.top < view.top) strip.scrollTop -= Math.ceil(view.top - box.top);
        else if (box.bottom > view.bottom) strip.scrollTop += Math.ceil(box.bottom - view.bottom);
    }));
};
watch(() => [props.tabs.find((tab) => tab.active)?.id, props.wrap] as const, ([id]) => {
    if (id !== undefined) reveal(id);
}, {immediate: true});

const focusTab = (tab: TabItem | undefined): void => {
    if (tab === undefined) return;
    emit("activate", tab.id);
    void nextTick(() => tabElement(tab.id)?.focus());
};

/** 多行时 ↑/↓：上一行或下一行里水平位置离它最近的标签（按此刻的几何算，换行位置随宽度变）。 */
const verticalNeighbor = (id: string, direction: -1 | 1): TabItem | undefined => {
    const current = tabElement(id)?.getBoundingClientRect();
    if (current === undefined) return undefined;
    const center = current.left + current.width / 2;
    let best: {tab: TabItem; rowDistance: number; distance: number} | undefined;
    for (const tab of props.tabs) {
        const box = tabElement(tab.id)?.getBoundingClientRect();
        if (box === undefined) continue;
        const rowDistance = (box.top - current.top) * direction;
        // 只看那个方向上的行，取最近的一行里水平最近的。
        if (rowDistance < current.height / 2) continue;
        const distance = Math.abs(box.left + box.width / 2 - center);
        if (best === undefined || rowDistance < best.rowDistance - 1 || (Math.abs(rowDistance - best.rowDistance) <= 1 && distance < best.distance)) best = {tab, rowDistance, distance};
    }
    return best?.tab;
};

const onKeydown = (event: KeyboardEvent, id: string): void => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        emit("menu", id, box.left, box.bottom);
        return;
    }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        emit("move", id, event.key === "ArrowLeft" ? -1 : 1);
        return;
    }
    const index = props.tabs.findIndex((tab) => tab.id === id);
    const at = (offset: number): TabItem | undefined => props.tabs[(offset + props.tabs.length) % props.tabs.length];
    switch (event.key) {
        case "ArrowLeft":
            event.preventDefault();
            focusTab(at(index - 1));
            return;
        case "ArrowRight":
            event.preventDefault();
            focusTab(at(index + 1));
            return;
        case "ArrowUp":
        case "ArrowDown":
            if (!props.wrap) return;
            event.preventDefault();
            focusTab(verticalNeighbor(id, event.key === "ArrowUp" ? -1 : 1));
            return;
        case "Home":
            event.preventDefault();
            focusTab(props.tabs[0]);
            return;
        case "End":
            event.preventDefault();
            focusTab(props.tabs[props.tabs.length - 1]);
            return;
        case "Delete":
            event.preventDefault();
            emit("close", id);
    }
};

/** 中键关闭：按下时阻止浏览器的自动滚动。 */
const onAuxClick = (event: MouseEvent, id: string): void => {
    if (event.button === 1) {
        event.preventDefault();
        emit("close", id);
    }
};
</script>

<template>
    <div ref="list" role="tablist" :aria-label="label" class="editor-tabs text-[length:var(--text-sm)]" :data-wrap="wrap ? '' : undefined" :data-group-active="groupActive ? '' : undefined" data-editor-tabs>
        <div v-for="row in rows" :key="row.key" class="editor-tabs__row" :data-row="row.key">
            <div
                v-for="tab in row.tabs"
                :key="tab.id"
                class="editor-tab-frame"
                :class="{'is-active': tab.active, 'is-pinned': tab.pinned}"
            >
                <button
                    type="button"
                    role="tab"
                    class="editor-tab nb-ui-focus-ring-inset"
                    :aria-selected="tab.active ? 'true' : 'false'"
                    :tabindex="tab.active ? 0 : -1"
                    :title="tab.title"
                    :data-editor-tab="tab.id"
                    :data-editor-tab-preview="tab.preview ? '' : undefined"
                    :data-editor-tab-dirty="tab.dirty ? '' : undefined"
                    :data-editor-tab-pinned="tab.pinned ? '' : undefined"
                    @click="emit('activate', tab.id)"
                    @dblclick="emit('keep', tab.id)"
                    @auxclick="onAuxClick($event, tab.id)"
                    @mousedown="(event: MouseEvent) => event.button === 2 && event.preventDefault()"
                    @contextmenu.prevent="(event: MouseEvent) => emit('menu', tab.id, event.clientX, event.clientY)"
                    @keydown="onKeydown($event, tab.id)"
                >
                    <FileIcon v-if="tab.icon !== null" :icon="tab.icon" class="editor-tab__icon" />
                    <span class="editor-tab__label" :class="tab.preview ? 'italic' : ''" data-editor-tab-label>{{ tab.label }}</span>
                    <span v-if="tab.hint !== null" class="editor-tab__hint" data-editor-tab-hint>{{ tab.hint }}</span>
                    <span v-if="tab.pinned" class="sr-only">（{{ pinnedLabel }}）</span>
                    <span v-if="tab.dirty" class="sr-only">（{{ unsavedLabel }}）</span>
                </button>
                <!-- 状态位：固定的是图钉（点它取消固定）；否则未保存是圆点，活动、悬停或聚焦时换成关闭。不进 Tab 顺序（键盘用 Delete）。 -->
                <button
                    v-if="tab.pinned"
                    type="button"
                    class="editor-tab__action nb-ui-focus-ring-inset"
                    :aria-label="unpinLabel(tab.label)"
                    tabindex="-1"
                    :data-editor-tab-unpin="tab.id"
                    data-editor-tab-action
                    @click="emit('unpin', tab.id)"
                >
                    <span v-if="tab.dirty" class="editor-tab__dot" aria-hidden="true"></span>
                    <span class="i-lucide-pin size-3.5" :class="tab.dirty ? 'editor-tab__reveal' : ''" aria-hidden="true"></span>
                </button>
                <button
                    v-else
                    type="button"
                    class="editor-tab__action editor-tab__close nb-ui-focus-ring-inset"
                    :aria-label="closeLabel(tab.label)"
                    tabindex="-1"
                    :data-editor-tab-close="tab.id"
                    data-editor-tab-action
                    @click="emit('close', tab.id)"
                >
                    <span v-if="tab.dirty" class="editor-tab__dot" aria-hidden="true"></span>
                    <span class="i-lucide-x size-3.5 editor-tab__reveal" aria-hidden="true"></span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * VS Code 式的标签条（docs/specs/workbench/editor.md 输出 53、54）：条底比正文低一档（主题角色 `--editor-tabs-surface`），
 * 活动标签与正文同色、顶部两角圆。高度：最多显示 3 行，组矮时由编辑组的 flex 收到 1 行（见 EditorGroup），超出部分在
 * 标签区里纵向滚动。
 */
.editor-tabs {
    --editor-tab-h: 34px;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: var(--editor-tab-h);
    max-height: calc(var(--editor-tab-h) * 3);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--editor-tabs-surface);
}

.editor-tabs__row {
    display: flex;
    flex: none;
    min-width: 0;
    /*
     * 末尾留 4px：编辑组的左缘可能落在半像素上，浏览器把可滚动宽度向下取整，没有这点余量时滚到底，最后一个标签仍被裁掉
     * 一像素左右。
     */
    padding-inline-end: 4px;
    overflow-x: auto;
    scrollbar-width: none;
}

.editor-tabs[data-wrap] .editor-tabs__row[data-row="normal"] {
    flex-wrap: wrap;
    overflow-x: hidden;
}

.editor-tab-frame {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    max-width: 240px;
    height: var(--editor-tab-h);
    padding-inline: 10px 4px;
    border-radius: 6px 6px 0 0;
    color: var(--text-secondary);
}

.editor-tab-frame:hover {
    background: color-mix(in srgb, var(--panel-surface) 50%, var(--editor-tabs-surface));
}

.editor-tab-frame.is-active {
    background: var(--panel-surface);
    color: var(--text-main);
}

/* 不是活动组：活动标签仍是正文色的一块，文字降为次级色。 */
.editor-tabs:not([data-group-active]) .editor-tab-frame.is-active {
    color: var(--text-secondary);
}

/* 开放式分隔线：同一行相邻标签之间 1px，上下各留四分之一；活动或悬停标签的两侧不画（输出 53）。 */
.editor-tab-frame + .editor-tab-frame::before {
    content: "";
    position: absolute;
    left: 0;
    top: 25%;
    bottom: 25%;
    width: 1px;
    background: var(--divider);
    pointer-events: none;
}

.editor-tab-frame.is-active::before,
.editor-tab-frame.is-active + .editor-tab-frame::before,
.editor-tab-frame:hover::before,
.editor-tab-frame:hover + .editor-tab-frame::before {
    opacity: 0;
}

.editor-tab {
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

.editor-tab-frame.is-active .editor-tab__reveal,
.editor-tab-frame:hover .editor-tab__reveal,
.editor-tab-frame:focus-within .editor-tab__reveal {
    visibility: visible;
}

.editor-tab-frame.is-active .editor-tab__dot,
.editor-tab-frame:hover .editor-tab__dot,
.editor-tab-frame:focus-within .editor-tab__dot {
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
