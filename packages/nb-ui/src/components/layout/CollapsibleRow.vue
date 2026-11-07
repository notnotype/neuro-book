<script setup lang="ts">
import {computed} from "vue";

import Spinner from "../display/Spinner.vue";

export type CollapsibleRowStatus = "running" | "error" | "done";

const props = withDefaults(defineProps<{
    icon: string;
    label: string;
    detail?: string;
    stat?: {added: number | null; removed: number | null} | null;
    status?: CollapsibleRowStatus;
    expanded?: boolean;
    /** 运行中转圈的无障碍名称；不传时用 Spinner 的缺省文字。 */
    runningLabel?: string;
}>(), {
    detail: "",
    stat: null,
    status: "done",
    expanded: undefined,
    runningLabel: undefined,
});

const emit = defineEmits<{
    (e: "update:expanded", expanded: boolean): void;
}>();

defineSlots<{
    default?: () => unknown;
}>();

const expandable = computed(() => props.expanded !== undefined);
// 一侧为 0 而另一侧有改动时，0 那一侧只是噪音。
const showAdded = computed(() => props.stat !== null && props.stat.added !== null && (props.stat.added > 0 || !(props.stat.removed !== null && props.stat.removed > 0)));
const showRemoved = computed(() => props.stat !== null && props.stat.removed !== null && (props.stat.removed > 0 || !(props.stat.added !== null && props.stat.added > 0)));
</script>

<template>
    <div class="nb-collapsible-row" :data-status="props.status">
        <component
            :is="expandable ? 'button' : 'div'"
            :type="expandable ? 'button' : undefined"
            class="nb-collapsible-row__row nb-ui-focus-ring-inset"
            :aria-expanded="expandable ? props.expanded : undefined"
            @click="expandable && emit('update:expanded', !props.expanded)"
        >
            <span :class="[props.icon, 'nb-collapsible-row__icon']" aria-hidden="true" />
            <span class="nb-collapsible-row__label">{{ props.label }}</span>
            <span v-if="props.detail" class="nb-collapsible-row__detail">{{ props.detail }}</span>
            <span v-if="props.stat" class="nb-collapsible-row__stat">
                <span v-if="showAdded" class="nb-collapsible-row__added">+{{ props.stat.added }}</span>
                <span v-if="showRemoved" class="nb-collapsible-row__removed">-{{ props.stat.removed }}</span>
            </span>
            <Spinner v-if="props.status === 'running'" size="sm" v-bind="props.runningLabel === undefined ? {} : {label: props.runningLabel}" class="nb-collapsible-row__spinner" />
        </component>
        <div v-if="expandable && props.expanded && $slots.default" class="nb-collapsible-row__content">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.nb-collapsible-row {
    min-width: 0;
}

/* 左右内边距是宿主的覆盖点 --nb-collapsible-row-px：行排在已有缩进的列表里时收窄，图标与上下文对齐。 */
.nb-collapsible-row__row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    min-height: 24px;
    padding: 0 var(--nb-collapsible-row-px, 8px);
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

button.nb-collapsible-row__row:hover {
    background: var(--bg-hover);
}

.nb-collapsible-row[data-status="error"] .nb-collapsible-row__row {
    color: var(--status-danger);
}

.nb-collapsible-row__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.nb-collapsible-row[data-status="error"] .nb-collapsible-row__icon {
    color: var(--status-danger);
}

.nb-collapsible-row__label {
    flex-shrink: 0;
}

.nb-collapsible-row__detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-collapsible-row__stat {
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
}

.nb-collapsible-row__detail + .nb-collapsible-row__stat {
    margin-left: 0;
}

.nb-collapsible-row__added {
    color: var(--status-success);
}

.nb-collapsible-row__removed {
    color: var(--status-danger);
}

.nb-collapsible-row__spinner {
    flex-shrink: 0;
    margin-left: auto;
}

.nb-collapsible-row__content {
    padding: 2px 0 4px 20px;
}
</style>
