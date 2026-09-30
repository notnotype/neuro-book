<script setup lang="ts">
/**
 * 状态栏项子组件：可复用零件。
 *
 * 规范与契约：
 * - 单根结构（可点时为 <button>，纯文本时为 <span>）；
 * - 极窄高度契约：占满父级（~22px），内边距 --space-2；
 * - 字号取 --text-2xs（11px，专为角标、序号、计数、时间戳设计的微型字号）；
 * - 变体支持 default / error / warning / info / success（对应 --status-* 语义变量）；
 * - hover 态：default 走 --bg-hover / --text-main，状态色走对应 status 色阶透明叠底。
 */
export type WorkbenchStatusBarItemVariant = "default" | "error" | "warning" | "info" | "success";

const props = withDefaults(defineProps<{
    /** 项目唯一标识 */
    id?: string;
    /** 显示文案 */
    label?: string;
    /** 图标 class */
    icon?: string;
    /** 角标或数值计数 */
    badge?: string | number;
    /** 状态色变体 */
    variant?: WorkbenchStatusBarItemVariant;
    /** 是否可点击交互 */
    clickable?: boolean;
    /** 是否处于激活/选中态 */
    active?: boolean;
    /** 原生 title 悬停说明 */
    title?: string;
    /** 无障碍标签 */
    ariaLabel?: string;
}>(), {
    id: undefined,
    label: undefined,
    icon: undefined,
    badge: undefined,
    variant: "default",
    clickable: true,
    active: false,
    title: undefined,
    ariaLabel: undefined,
});

const emit = defineEmits<{
    (event: "click", e: MouseEvent): void;
}>();

defineSlots<{
    default?(): unknown;
    icon?(): unknown;
    badge?(): unknown;
}>();

function onClick(e: MouseEvent): void {
    if (!props.clickable) return;
    emit("click", e);
}
</script>

<template>
    <button
        v-if="clickable"
        type="button"
        class="workbench-status-bar-item workbench-status-bar-item--clickable"
        :class="[
            `workbench-status-bar-item--${variant}`,
            {'workbench-status-bar-item--active': active},
        ]"
        :data-status-item-id="id"
        :data-status-variant="variant"
        :data-status-active="active ? 'true' : 'false'"
        :title="title"
        :aria-label="ariaLabel || label || title"
        @click="onClick"
    >
        <slot name="icon">
            <span v-if="icon" :class="icon" class="workbench-status-bar-item__icon" aria-hidden="true" />
        </slot>

        <span v-if="label || $slots.default" class="workbench-status-bar-item__label">
            <slot>{{ label }}</slot>
        </span>

        <slot name="badge">
            <span v-if="badge !== undefined && badge !== null && badge !== ''" class="workbench-status-bar-item__badge">
                {{ badge }}
            </span>
        </slot>
    </button>

    <span
        v-else
        class="workbench-status-bar-item"
        :class="[
            `workbench-status-bar-item--${variant}`,
            {'workbench-status-bar-item--active': active},
        ]"
        :data-status-item-id="id"
        :data-status-variant="variant"
        :data-status-active="active ? 'true' : 'false'"
        :title="title"
        :aria-label="ariaLabel || label || title"
    >
        <slot name="icon">
            <span v-if="icon" :class="icon" class="workbench-status-bar-item__icon" aria-hidden="true" />
        </slot>

        <span v-if="label || $slots.default" class="workbench-status-bar-item__label">
            <slot>{{ label }}</slot>
        </span>

        <slot name="badge">
            <span v-if="badge !== undefined && badge !== null && badge !== ''" class="workbench-status-bar-item__badge">
                {{ badge }}
            </span>
        </slot>
    </span>
</template>

<style scoped>
.workbench-status-bar-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: calc(100% - 4px);
    padding: 0 6px;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-2xs);
    font-weight: var(--weight-normal);
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    background: transparent;
    border: none;
    border-radius: var(--radius-control, 4px);
    box-sizing: border-box;
    transition:
        color var(--motion-fast) var(--ease-standard),
        background-color var(--motion-fast) var(--ease-standard),
        opacity var(--motion-fast) var(--ease-standard);
}

.workbench-status-bar-item--clickable {
    cursor: pointer;
}

.workbench-status-bar-item--clickable:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* 悬停态：按变体区分 */
.workbench-status-bar-item--clickable.workbench-status-bar-item--default:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.workbench-status-bar-item--clickable.workbench-status-bar-item--error:hover {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 16%, transparent);
}

.workbench-status-bar-item--clickable.workbench-status-bar-item--warning:hover {
    color: var(--status-warning);
    background: color-mix(in srgb, var(--status-warning) 16%, transparent);
}

.workbench-status-bar-item--clickable.workbench-status-bar-item--info:hover {
    color: var(--status-info);
    background: color-mix(in srgb, var(--status-info) 16%, transparent);
}

.workbench-status-bar-item--clickable.workbench-status-bar-item--success:hover {
    color: var(--status-success);
    background: color-mix(in srgb, var(--status-success) 16%, transparent);
}

/* 激活选中态：微质感品牌主色点缀，告别粗硬发灰块 */
.workbench-status-bar-item--active {
    color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    font-weight: var(--weight-medium);
}

/* 颜色变体 */
.workbench-status-bar-item--error {
    color: var(--status-danger);
}

.workbench-status-bar-item--warning {
    color: var(--status-warning);
}

.workbench-status-bar-item--info {
    color: var(--status-info);
}

.workbench-status-bar-item--success {
    color: var(--status-success);
}

.workbench-status-bar-item__icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    opacity: 0.85;
}

.workbench-status-bar-item:hover .workbench-status-bar-item__icon {
    opacity: 1;
}

.workbench-status-bar-item__label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.workbench-status-bar-item__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    line-height: 1;
    border-radius: var(--radius-pill);
    margin-left: 2px;
}

.workbench-status-bar-item--default .workbench-status-bar-item__badge {
    color: var(--text-main);
    background: var(--bg-subtle);
}

.workbench-status-bar-item--error .workbench-status-bar-item__badge {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 20%, transparent);
}

.workbench-status-bar-item--warning .workbench-status-bar-item__badge {
    color: var(--status-warning);
    background: color-mix(in srgb, var(--status-warning) 20%, transparent);
}

.workbench-status-bar-item--info .workbench-status-bar-item__badge {
    color: var(--status-info);
    background: color-mix(in srgb, var(--status-info) 20%, transparent);
}

.workbench-status-bar-item--success .workbench-status-bar-item__badge {
    color: var(--status-success);
    background: color-mix(in srgb, var(--status-success) 20%, transparent);
}
</style>
