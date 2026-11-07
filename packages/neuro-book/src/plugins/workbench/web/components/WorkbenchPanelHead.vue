<script setup lang="ts">
/** 工具面板的面板头（同名 .md）：标签带或当前视图的标题、当前视图的动作、框架按钮。点了只发事件，切换与命令由宿主做。 */
import {TabStrip} from "@notnotype/nb-layout/vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {panelTabDomId, panelTabpanelDomId} from "../state/layout-present";
import "./hover-actions.css";

export interface PanelHeadTab {
    /** 标签键；事件原样带回。 */
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

export interface PanelFrameAction {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly disabled: boolean;
    readonly reason?: string;
    readonly pressed?: boolean;
}

defineOptions({name: "WorkbenchPanelHead"});

const props = withDefaults(defineProps<{
    /** 正被实时布局拖着、还在标签条里的标签：留着盒子、看不见。 */
    draggingTab?: string | null;
    panelId: string;
    /** 标签带的可访问名称；没有标签时显示它。 */
    label: string;
    tabs: ReadonlyArray<PanelHeadTab>;
    active: string | null;
    moreLabel: string;
    /** 标签与内容互相引用的 DOM id 前缀（表面给）。 */
    idPrefix?: string;
    /** 标签的可访问描述：怎么拿起拖动。 */
    dragHint?: string;
    /** 不画标签带，只写活动标签的标题（侧栏这一列，切视图靠活动栏）。 */
    titleOnly?: boolean;
    frameActions?: ReadonlyArray<PanelFrameAction>;
}>(), {draggingTab: null, idPrefix: "workbench-panel", dragHint: "", titleOnly: false, frameActions: () => []});

const emit = defineEmits<{
    (event: "activate", id: string): void;
    /** Alt 加方向键换序（docs/specs/ui/workbench-layout.md 输出 20）。 */
    (event: "reorder", id: string, delta: -1 | 1): void;
    (event: "action", id: string): void;
    /** 标签的右键菜单（键盘是菜单键）；坐标是视口坐标。 */
    (event: "context-menu", id: string, at: {readonly x: number; readonly y: number}): void;
}>();

defineSlots<{
    /** 当前视图的动作。 */
    actions?(): unknown;
}>();

const TAB_MAX_WIDTH = 96;

const items = computed(() => props.tabs.map((tab) => ({id: tab.id, title: tab.label, iconClass: tab.icon})));

const activeTab = computed(() => (props.titleOnly ? (props.tabs.find((tab) => tab.id === props.active) ?? null) : null));

/** 只写标题时的右键：菜单键打出来的 `contextmenu` 没有可靠的指针坐标，菜单开在标题下面。标签带的右键在 `TabStrip` 里。 */
function onTitleContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    if (event.button === 0 && event.clientX === 0 && event.clientY === 0) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        emit("context-menu", id, {x: rect.left, y: rect.bottom});
        return;
    }
    emit("context-menu", id, {x: event.clientX, y: event.clientY});
}
</script>

<template>
    <header class="workbench-panel-head" :data-panel-head="panelId">
        <div class="workbench-panel-head__band" :data-panel-band="panelId" :data-panel-strip="panelId">
            <!-- 头只写标题时它就是拖动源（docs/specs/ui/workbench-layout.md 输出 20）。内容的 `aria-labelledby` 指向它，所以名称就是标题，怎么拖写在描述里。 -->
            <h2 v-if="activeTab !== null" class="workbench-panel-head__title">
                <button
                    :id="panelTabDomId(idPrefix, activeTab.id)"
                    type="button"
                    class="workbench-panel-head__handle nb-ui-focus-ring"
                    tabindex="0"
                    :data-panel-tab="activeTab.id"
                    :aria-description="dragHint === '' ? undefined : dragHint"
                    @click="emit('activate', activeTab!.id)"
                    @contextmenu="onTitleContextMenu($event, activeTab!.id)"
                >{{ activeTab.label }}</button>
            </h2>
            <TabStrip
                v-else-if="items.length > 0"
                class="workbench-panel-head__tabs"
                overflow="adapt"
                :max-item-width="TAB_MAX_WIDTH"
                :more-label="moreLabel"
                more-icon-class="i-lucide-chevron-down"
                :items="items"
                :active="active"
                :label="label"
                :drag-hint="dragHint"
                :placeholder="draggingTab"
                :tab-id-of="(id: string) => panelTabDomId(idPrefix, id)"
                :panel-id-of="(id: string) => panelTabpanelDomId(idPrefix, id)"
                @activate="(id: string) => emit('activate', id)"
                @reorder="(id: string, delta: -1 | 1) => emit('reorder', id, delta)"
                @context-menu="(id: string, at: {x: number; y: number}) => emit('context-menu', id, at)"
            />
            <h2 v-else class="workbench-panel-head__title">{{ label }}</h2>
        </div>
        <div v-if="$slots.actions !== undefined" class="workbench-panel-head__actions" data-no-drag data-hover-actions>
            <slot name="actions"></slot>
        </div>
        <div v-if="frameActions.length > 0" class="workbench-panel-head__actions" data-no-drag>
            <IconButton
                v-for="action in frameActions"
                :key="action.id"
                size="xs"
                :icon-class="action.icon"
                :aria-label="action.label"
                :title="action.disabled && action.reason !== undefined ? action.reason : action.label"
                :disabled="action.disabled"
                :aria-pressed="action.pressed"
                :data-panel-action="action.id"
                @click="emit('action', action.id)"
            />
        </div>
    </header>
</template>

<style scoped>
.workbench-panel-head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    min-width: 0;
    /* 右端是 24px 的图标按钮：右边留 4px，外扩焦点光环（实色 3.5px）不被面板的裁切切掉。 */
    padding-inline: var(--space-1) var(--space-2);
    user-select: none;
}

.workbench-panel-head__band {
    display: flex;
    flex: 1 1 auto;
    align-self: stretch;
    align-items: center;
    min-width: 0;
}

.workbench-panel-head__tabs {
    flex: 1 1 auto;
    min-width: 0;
}

/* 标签的外观：下划线指示，`TabStrip` 只管结构（钩子见它的 .md）。 */
.workbench-panel-head__tabs :deep(.nb-tab-strip__list) {
    column-gap: var(--space-2);
}

.workbench-panel-head__tabs :deep(.nb-tab-strip__row) {
    column-gap: inherit;
}

.workbench-panel-head__tabs :deep(.nb-tab) {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    height: var(--control-h-sm);
    padding-inline: calc(var(--control-px) * 0.8);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition: color var(--motion-fast) var(--ease-layout);
}

.workbench-panel-head__tabs :deep(.nb-tab:hover) {
    color: var(--text-main);
}

.workbench-panel-head__tabs :deep([role="tab"].nb-tab)::after {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: transparent;
    content: "";
    inset-inline: 0;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.workbench-panel-head__tabs :deep(.is-active .nb-tab) {
    color: var(--text-main);
}

.workbench-panel-head__tabs :deep(.is-active [role="tab"].nb-tab)::after {
    background: var(--accent-main);
}

.workbench-panel-head__tabs :deep(.nb-tab__icon) {
    flex-shrink: 0;
    width: 1.15em;
    height: 1.15em;
}

.workbench-panel-head__tabs :deep(.nb-tab__title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.workbench-panel-head__tabs :deep(.nb-tab__chevron) {
    flex-shrink: 0;
    width: 1em;
    height: 1em;
}

.workbench-panel-head__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding-inline-start: var(--space-2);
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 标签与标题是拖动源：触摸按住起拖，不滚动。 */
.workbench-panel-head__tabs :deep([data-panel-tab]) {
    touch-action: none;
}

.workbench-panel-head__handle {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: inherit;
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    touch-action: none;
}

.workbench-panel-head__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}
</style>
