<script setup lang="ts">
import {computed} from "vue";

import Spinner from "../display/Spinner.vue";

export type CollapsibleCardStatus = "running" | "waiting" | "success" | "error" | "neutral";

const props = withDefaults(defineProps<{
    icon: string;
    title: string;
    subtitle?: string;
    status?: CollapsibleCardStatus;
    expanded?: boolean;
    /** 运行中转圈的无障碍名称；不传时用 Spinner 的缺省文字。 */
    runningLabel?: string;
}>(), {
    subtitle: "",
    status: "neutral",
    expanded: undefined,
    runningLabel: undefined,
});

const emit = defineEmits<{
    (e: "update:expanded", expanded: boolean): void;
}>();

defineSlots<{
    default?: () => unknown;
    actions?: () => unknown;
}>();

const collapsible = computed(() => props.expanded !== undefined);
const bodyVisible = computed(() => props.expanded !== false);
const statusIcon = computed(() => {
    switch (props.status) {
        case "success": return "i-lucide-check";
        case "error": return "i-lucide-circle-alert";
        case "waiting": return "i-lucide-circle-pause";
        default: return "";
    }
});
</script>

<template>
    <div class="nb-collapsible-card" :data-status="props.status">
        <div class="nb-collapsible-card__head">
            <component
                :is="collapsible ? 'button' : 'div'"
                :type="collapsible ? 'button' : undefined"
                class="nb-collapsible-card__trigger nb-ui-focus-ring-inset"
                :aria-expanded="collapsible ? props.expanded : undefined"
                @click="collapsible && emit('update:expanded', !props.expanded)"
            >
                <span :class="[props.icon, 'nb-collapsible-card__icon']" aria-hidden="true" />
                <span class="nb-collapsible-card__title">{{ props.title }}</span>
                <span v-if="props.subtitle" class="nb-collapsible-card__subtitle">{{ props.subtitle }}</span>
                <Spinner v-if="props.status === 'running'" size="sm" v-bind="props.runningLabel === undefined ? {} : {label: props.runningLabel}" class="nb-collapsible-card__spinner" />
                <span v-else-if="statusIcon" :class="[statusIcon, 'nb-collapsible-card__status']" aria-hidden="true" />
                <span v-if="collapsible" :class="[props.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right', 'nb-collapsible-card__chevron']" aria-hidden="true" />
            </component>
            <div v-if="$slots.actions" class="nb-collapsible-card__actions">
                <slot name="actions" />
            </div>
        </div>
        <div v-if="bodyVisible && $slots.default" class="nb-collapsible-card__body">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.nb-collapsible-card {
    min-width: 0;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
}

.nb-collapsible-card[data-status="error"] {
    border-color: var(--status-danger-border);
}

.nb-collapsible-card__head {
    display: flex;
    align-items: center;
    min-width: 0;
}

.nb-collapsible-card__trigger {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: inherit;
    color: var(--text-main);
    font-size: var(--text-xs);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

button.nb-collapsible-card__trigger:hover {
    background: var(--bg-hover);
}

.nb-collapsible-card__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.nb-collapsible-card__title {
    flex-shrink: 0;
    font-weight: var(--weight-medium);
}

.nb-collapsible-card__subtitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-collapsible-card__spinner,
.nb-collapsible-card__status,
.nb-collapsible-card__chevron {
    flex-shrink: 0;
    margin-left: auto;
}

.nb-collapsible-card__subtitle + .nb-collapsible-card__spinner,
.nb-collapsible-card__subtitle + .nb-collapsible-card__status,
.nb-collapsible-card__subtitle + .nb-collapsible-card__chevron {
    margin-left: 0;
}

.nb-collapsible-card__status,
.nb-collapsible-card__chevron {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.nb-collapsible-card[data-status="success"] .nb-collapsible-card__status {
    color: var(--status-success);
}

.nb-collapsible-card[data-status="error"] .nb-collapsible-card__status {
    color: var(--status-danger);
}

.nb-collapsible-card[data-status="waiting"] .nb-collapsible-card__status {
    color: var(--status-warning);
}

.nb-collapsible-card__actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    padding-right: 6px;
}

.nb-collapsible-card__body {
    padding: 0 8px 8px;
    font-size: var(--text-xs);
}
</style>
