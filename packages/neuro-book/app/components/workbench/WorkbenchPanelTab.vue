<script setup lang="ts">
/**
 * 底部 Panel 的标签项子组件：可复用零件。
 *
 * 规范与契约：
 * - 单根 `<button>`，role="tab"，aria-selected 反映选中态；
 * - 激活态：文字高亮（--text-main）、字重加粗（--weight-strong）、底部指示条（--accent-main）；
 * - 闲置态：文字次级（--text-muted），悬停给出背景（--overlay-item-active）与文字提亮；
 * - 支持角标（--radius-pill，--text-2xs 计数专用字号）；
 * - 可选关闭按钮（悬停危险色 --status-danger）。
 */
const props = withDefaults(defineProps<{
    /** 标签唯一标识 */
    id: string;
    /** 标签文本 */
    label: string;
    /** 图标 class（例如 i-lucide-terminal） */
    icon?: string;
    /** 标签角标（数字或文本，例如 44） */
    badge?: string | number;
    /** 是否处于激活态 */
    active?: boolean;
    /** 是否显示关闭按钮 */
    closable?: boolean;
    /** 是否禁用 */
    disabled?: boolean;
}>(), {
    icon: undefined,
    badge: undefined,
    active: false,
    closable: false,
    disabled: false,
});

const emit = defineEmits<{
    (event: "click", id: string, e: MouseEvent): void;
    (event: "close", id: string, e: MouseEvent): void;
}>();

defineSlots<{
    default?(): unknown;
    icon?(): unknown;
    badge?(): unknown;
}>();

function onClick(e: MouseEvent): void {
    if (props.disabled) return;
    emit("click", props.id, e);
}

function onClose(e: MouseEvent): void {
    if (props.disabled) return;
    emit("close", props.id, e);
}
</script>

<template>
    <button
        type="button"
        role="tab"
        class="workbench-panel-tab"
        :class="{
            'workbench-panel-tab--active': active,
            'workbench-panel-tab--disabled': disabled,
        }"
        :aria-selected="active ? 'true' : 'false'"
        :disabled="disabled"
        :data-tab-id="id"
        :data-tab-active="active ? 'true' : 'false'"
        @click="onClick"
    >
        <slot name="icon">
            <span v-if="icon" :class="icon" class="workbench-panel-tab__icon" aria-hidden="true" />
        </slot>

        <span class="workbench-panel-tab__label">
            <slot>{{ label }}</slot>
        </span>

        <slot name="badge">
            <span v-if="badge !== undefined && badge !== null && badge !== ''" class="workbench-panel-tab__badge">
                {{ badge }}
            </span>
        </slot>

        <span
            v-if="closable"
            class="workbench-panel-tab__close"
            role="button"
            tabindex="-1"
            :aria-label="'关闭 ' + label"
            @click.stop="onClose"
        >
            <span class="i-lucide-x workbench-panel-tab__close-icon" aria-hidden="true" />
        </span>
    </button>
</template>

<style scoped>
.workbench-panel-tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-8);
    padding: 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    line-height: 1;
    white-space: nowrap;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    user-select: none;
    transition:
        color var(--motion-fast) var(--ease-standard),
        background-color var(--motion-fast) var(--ease-standard),
        border-color var(--motion-fast) var(--ease-standard);
}

.workbench-panel-tab:hover:not(:disabled) {
    color: var(--text-main);
    background: var(--overlay-item-active);
}

.workbench-panel-tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.workbench-panel-tab--active {
    color: var(--text-main);
    font-weight: var(--weight-strong);
    border-bottom-color: var(--accent-main);
}

.workbench-panel-tab--disabled {
    cursor: not-allowed;
    opacity: 0.4;
}

.workbench-panel-tab__icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}

.workbench-panel-tab__label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.workbench-panel-tab__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    line-height: 1;
    color: var(--text-secondary);
    background: var(--bg-subtle);
    border-radius: var(--radius-pill);
}

.workbench-panel-tab--active .workbench-panel-tab__badge {
    color: var(--text-main);
    background: var(--bg-panel);
}

.workbench-panel-tab__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: calc(-1 * var(--space-1));
    color: var(--text-muted);
    border-radius: var(--radius-control);
    transition:
        color var(--motion-fast) var(--ease-standard),
        background-color var(--motion-fast) var(--ease-standard);
}

.workbench-panel-tab__close:hover {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 16%, transparent);
}

.workbench-panel-tab__close-icon {
    width: 12px;
    height: 12px;
}
</style>
