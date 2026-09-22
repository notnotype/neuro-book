<script setup lang="ts">
/**
 * 底部 Panel 部件：承载底部视图（终端、问题、输出等）的外壳卡片。
 *
 * 职责边界（提案「三种拖动，三个 owner」）：
 * - 部件**不拥有拖拽、不写尺寸、不读 store、不做持久化**；
 * - 拖拽改变高度由外壳与 nb-ui `Splitter` 承担；
 * - 尺寸常量单一来源 `app/utils/workbench/layout.ts`；
 * - 卡片语言：面 --panel-surface、描边 --panel-outline、圆角 --radius-panel、阴影 --elevation-raised；
 * - 单根、三个具名插槽：`tabs`（标签条）/ `actions`（动作区）/ `content`（内容区，以及默认插槽）。
 */
import {computed} from "vue";
import WorkbenchPanelTab from "./WorkbenchPanelTab.vue";

export type WorkbenchPanelTabItem = {
    id: string;
    label: string;
    icon?: string;
    badge?: string | number;
    closable?: boolean;
    disabled?: boolean;
};

const props = withDefaults(defineProps<{
    /** 当前激活的标签 id */
    activeTab?: string;
    /** 面板是否已收起（收起时仅保留标签头，内容区隐藏；高度由外壳/Splitter控制） */
    collapsed?: boolean;
    /** 内容区呈现合同；缺省 'fill'（由视图自己管理滚动与留白，如 Terminal） */
    layout?: "scroll" | "fill";
    /** 可选标题或无障碍名称 */
    title?: string;
    /** 可选声明式标签列表（当不使用 #tabs 插槽自定义时使用） */
    tabs?: WorkbenchPanelTabItem[];
}>(), {
    activeTab: "",
    collapsed: false,
    layout: "fill",
    title: "底部面板",
    tabs: () => [],
});

const emit = defineEmits<{
    (event: "update:activeTab", tabId: string): void;
    (event: "update:collapsed", collapsed: boolean): void;
    (event: "tab-click", tabId: string): void;
    (event: "tab-close", tabId: string): void;
    (event: "toggle-collapse"): void;
}>();

defineSlots<{
    /** 覆盖或填充标签条区 */
    tabs?(): unknown;
    /** 头部右侧动作区（例如收起、清空、关闭等按钮） */
    actions?(): unknown;
    /** 内容区 */
    content?(): unknown;
    /** 默认插槽（content 未提供时作为内容区） */
    default?(): unknown;
}>();

function onTabClick(tabId: string): void {
    emit("update:activeTab", tabId);
    emit("tab-click", tabId);
}

function onTabClose(tabId: string): void {
    emit("tab-close", tabId);
}
</script>

<template>
    <section
        class="workbench-panel-surface"
        :class="{
            'workbench-panel-surface--collapsed': collapsed,
        }"
        :aria-label="title"
        :data-panel-collapsed="collapsed ? 'true' : 'false'"
        :data-panel-layout="layout"
        :data-panel-active-tab="activeTab"
    >
        <header
            class="workbench-panel-surface__head"
            data-shell-focus-target="panel-title"
            tabindex="-1"
        >
            <div class="workbench-panel-surface__tabs" role="tablist">
                <slot name="tabs">
                    <WorkbenchPanelTab
                        v-for="tab in tabs"
                        :key="tab.id"
                        :id="tab.id"
                        :label="tab.label"
                        :icon="tab.icon"
                        :badge="tab.badge"
                        :closable="tab.closable"
                        :disabled="tab.disabled"
                        :active="tab.id === activeTab"
                        @click="onTabClick"
                        @close="onTabClose"
                    />
                </slot>
            </div>

            <div v-if="$slots.actions" class="workbench-panel-surface__actions">
                <slot name="actions"></slot>
            </div>
        </header>

        <div
            v-show="!collapsed"
            class="workbench-panel-surface__content"
            :class="{
                'workbench-panel-surface__content--padded': layout === 'scroll',
                'workbench-panel-surface__content--scrolling': layout === 'scroll',
            }"
        >
            <slot name="content"><slot></slot></slot>
        </div>
    </section>
</template>

<style scoped>
/*
 * 底部面板是一块卡片：面 / 描边 / 圆角 / 阴影全部取自 nb-ui 的主题角色变量，
 * 与容器部件、活动栏同一套材质语言：
 *   面   --panel-surface
 *   描边 var(--border-w) solid var(--panel-outline)
 *   圆角 --radius-panel
 *   阴影 --elevation-raised
 * 分隔线取 --divider。
 */
.workbench-panel-surface {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
    box-shadow: var(--elevation-raised);
}

.workbench-panel-surface--collapsed {
    height: auto;
}

/* 头部：标签列表 + 尾部动作区 */
.workbench-panel-surface__head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    height: var(--space-8);
    padding-inline: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
}

/* 头部是可编程聚焦的落点（外壳在最大化时把焦点交给它）：自己不该有可见焦点环的负担。 */
.workbench-panel-surface__head:focus {
    outline: none;
}

/* 标签列表区：水平横向排列，允许横向滚动但不显示滚动条 */
.workbench-panel-surface__tabs {
    display: flex;
    /*
     * 确定份额（basis 0）：内容宽会让整行变窄时把动作区挤成 0，而动作区必须是**确定的**盒子
     * （见 `WorkbenchTitleActions.md` 的宿主合同）。放不下的标签在自己的盒子里横向滚动。
     */
    flex: 4 1 0;
    align-items: center;
    min-width: 0;
    height: 100%;
    overflow-x: auto;
    scrollbar-width: none;
}

.workbench-panel-surface__tabs::-webkit-scrollbar {
    display: none;
}

/* 动作区贴右，按 --space-2 间隙排列；可压缩：标题操作放不下的项自己折进「更多」。 */
.workbench-panel-surface__actions {
    display: flex;
    /*
     * 确定的宽度盒：标签列表按内容宽（可缩可滚动），剩下的空间全给动作区，
     * 这样标题操作部件量到的可用宽度不随折叠结果变化（见 `WorkbenchTitleActions.md`）。
     */
    flex: 1 1 0;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-left: auto;
}

/* 内容区：由 layout 合同决定滚动归属与留白 */
.workbench-panel-surface__content {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.workbench-panel-surface__content--padded {
    padding: var(--panel-p);
}

.workbench-panel-surface__content--scrolling {
    overflow-y: auto;
}
</style>
