<script setup lang="ts">
/**
 * 工作台容器区段部件：承载容器内的一个独立 Section。
 *
 * 对应 VS Code 侧栏的多 Section 结构（如文件树、大纲、时间线）：
 * - 单根 <section class="workbench-container-section">；
 * - 紧凑头部（约 22-24px，消费 --control-h-sm）：折叠 chevron + 标题 + 可选上下文标签 + 动作区；
 * - 内容区支持 scroll / fill 两档排版，支持空态说明文字；
 * - 区段自身不设卡片圆角、不设外部描边，卡片语言由宿主 WorkbenchContainerSurface 拥有；
 * - 折叠状态可在内部 state 独立闭环，亦支持受控 v-model:collapsed。
 */
import {computed, ref, useSlots, watch} from "vue";
import type {ViewLayoutMode} from "nbook/app/utils/workbench/descriptors";

const props = withDefaults(defineProps<{
    /** 区段标识 */
    id?: string;
    /** 区段标题 */
    title: string;
    /** 可选上下文标签（如当前文件名或条目统计） */
    contextLabel?: string;
    /** 是否可折叠；缺省为 true */
    collapsible?: boolean;
    /** 受控折叠态；缺省由内部 state 维护 */
    collapsed?: boolean;
    /** 排版合同：scroll 拥有内部滚动与边距；fill 吸收高度由视图管理滚动 */
    layout?: ViewLayoutMode;
    /** 是否强制标记为空态 */
    empty?: boolean;
    /** 空态说明文案 */
    emptyText?: string;
}>(), {
    id: "",
    contextLabel: "",
    collapsible: true,
    collapsed: undefined,
    layout: "scroll",
    empty: false,
    emptyText: "",
});

const emit = defineEmits<{
    (e: "update:collapsed", value: boolean): void;
    (e: "toggle", value: boolean): void;
}>();

defineSlots<{
    /** 默认插槽：区段内容 */
    default?(): unknown;
    /** 具名内容插槽：同 default */
    content?(): unknown;
    /** 上下文标签自定义插槽 */
    context?(): unknown;
    /** 区段右侧动作区（点选不触发折叠） */
    actions?(): unknown;
    /** 自定义空态展示 */
    empty?(): unknown;
}>();

const slots = useSlots();
const internalCollapsed = ref(props.collapsed ?? false);

watch(() => props.collapsed, (val) => {
    if (val !== undefined) {
        internalCollapsed.value = val;
    }
});

const isCollapsed = computed(() => {
    if (!props.collapsible) {
        return false;
    }
    return props.collapsed !== undefined ? props.collapsed : internalCollapsed.value;
});
const hasContentSlot = computed(() => {
    return Boolean(slots.default || slots.content);
});

const showEmpty = computed(() => {
    if (props.empty) {
        return true;
    }
    return !hasContentSlot.value && Boolean(props.emptyText || slots.empty);
});

function toggle(): void {
    if (!props.collapsible) {
        return;
    }
    const next = !isCollapsed.value;
    internalCollapsed.value = next;
    emit("update:collapsed", next);
    emit("toggle", next);
}
</script>

<template>
    <section
        class="workbench-container-section"
        :data-section="id || undefined"
        :data-collapsed="isCollapsed ? 'true' : 'false'"
        :data-layout="layout"
    >
        <div class="workbench-container-section__header">
            <button
                v-if="collapsible"
                type="button"
                class="workbench-container-section__toggle"
                :aria-expanded="!isCollapsed"
                :aria-controls="id ? `section-body-${id}` : undefined"
                @click="toggle"
            >
                <span
                    class="workbench-container-section__chevron i-lucide-chevron-right"
                    :class="{'workbench-container-section__chevron--expanded': !isCollapsed}"
                    aria-hidden="true"
                ></span>
                <span class="workbench-container-section__title">{{ title }}</span>
            </button>
            <span v-else class="workbench-container-section__title">{{ title }}</span>

            <span
                v-if="contextLabel || $slots.context"
                class="workbench-container-section__context"
            >
                <slot name="context">{{ contextLabel }}</slot>
            </span>

            <div
                v-if="$slots.actions"
                class="workbench-container-section__actions"
                @click.stop
            >
                <slot name="actions"></slot>
            </div>
        </div>

        <div
            v-show="!isCollapsed"
            :id="id ? `section-body-${id}` : undefined"
            class="workbench-container-section__body"
            :class="{
                'workbench-container-section__body--scroll': layout === 'scroll',
                'workbench-container-section__body--fill': layout === 'fill',
            }"
        >
            <div
                v-if="showEmpty"
                class="workbench-container-section__empty"
            >
                <slot name="empty">{{ emptyText }}</slot>
            </div>
            <slot v-else name="content">
                <slot></slot>
            </slot>
        </div>
    </section>
</template>

<style scoped>
/*
 * Section 是容器卡片内的**平铺分区**：
 * 不具有卡片阴影、外边框与卡片圆角（卡片语言只属于外层容器）。
 * 分隔由父容器通过 1px 细线（var(--border-w) solid var(--divider)）组织。
 */
.workbench-container-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    width: 100%;
}

/* fill 档在 flex-col 容器里吸收剩余高度，折叠时仅保留头部高 */
.workbench-container-section[data-layout="fill"]:not([data-collapsed="true"]) {
    flex: 1 1 0px;
}

.workbench-container-section[data-collapsed="true"],
.workbench-container-section[data-layout="scroll"] {
    flex: 0 0 auto;
}

/*
 * 区段头部：紧凑行高（消费 --control-h-sm），小字号。
 * 静止态背景透明，悬停时使用 --bg-hover。
 */
.workbench-container-section__header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: var(--control-h-sm);
    padding-inline: var(--panel-p);
    background: transparent;
    user-select: none;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

.workbench-container-section__header:hover {
    background-color: var(--bg-hover);
}

.workbench-container-section__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
}

.workbench-container-section__toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.workbench-container-section__chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform var(--motion-fast) var(--ease-standard);
}

.workbench-container-section__chevron--expanded {
    transform: rotate(90deg);
}

.workbench-container-section__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-main);
    line-height: var(--leading-tight);
}

.workbench-container-section__context {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-tight);
    padding-left: var(--space-2);
}

.workbench-container-section__actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 0 auto;
}

.workbench-container-section__body {
    min-height: 0;
    min-width: 0;
    width: 100%;
}

.workbench-container-section__body--scroll {
    overflow-y: auto;
    padding: var(--space-2) var(--panel-p);
}

.workbench-container-section__body--fill {
    flex: 1 1 0px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.workbench-container-section__empty {
    padding: var(--space-3) var(--panel-p);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-ui);
}
</style>
