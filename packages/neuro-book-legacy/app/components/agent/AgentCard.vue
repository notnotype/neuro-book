<script setup lang="ts">
import {computed} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    icon: string;
    title: string;
    subtitle?: string;
    status?: "running" | "waiting" | "success" | "error" | "neutral";
    expanded?: boolean;
}>(), {
    subtitle: "",
    status: "neutral",
    expanded: undefined,
});

const emit = defineEmits<{
    (e: "toggle", expanded: boolean): void;
}>();

defineSlots<{
    default?: () => unknown;
    actions?: () => unknown;
}>();

const {t} = useI18n();

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
    <div class="agent-card" :data-status="props.status">
        <div class="agent-card__head">
            <component
                :is="collapsible ? 'button' : 'div'"
                :type="collapsible ? 'button' : undefined"
                class="agent-card__trigger"
                :aria-expanded="collapsible ? props.expanded : undefined"
                @click="collapsible && emit('toggle', !props.expanded)"
            >
                <span :class="[props.icon, 'agent-card__icon']" aria-hidden="true" />
                <span class="agent-card__title">{{ props.title }}</span>
                <span v-if="props.subtitle" class="agent-card__subtitle">{{ props.subtitle }}</span>
                <Spinner v-if="props.status === 'running'" size="sm" :label="t('agentView.turn.running')" class="agent-card__spinner" />
                <span v-else-if="statusIcon" :class="[statusIcon, 'agent-card__status']" aria-hidden="true" />
                <span v-if="collapsible" :class="[props.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right', 'agent-card__chevron']" aria-hidden="true" />
            </component>
            <div v-if="$slots.actions" class="agent-card__actions">
                <slot name="actions" />
            </div>
        </div>
        <div v-if="bodyVisible && $slots.default" class="agent-card__body">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.agent-card {
    min-width: 0;
    border: var(--border-w, 1px) solid var(--acv-card-border, var(--border-color));
    border-radius: var(--acv-card-radius, var(--radius-control));
    background: var(--acv-card-bg, transparent);
    box-shadow: var(--acv-card-shadow, none);
}

.agent-card[data-status="error"] {
    border-color: var(--acv-card-error-border, var(--status-danger-border));
}

.agent-card__head {
    display: flex;
    align-items: center;
    min-width: 0;
}

.agent-card__trigger {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: var(--acv-card-head-py, 6px) var(--acv-card-px, 8px);
    border-radius: inherit;
    color: var(--text-main);
    font-size: 12px;
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

button.agent-card__trigger:hover {
    background: var(--bg-hover);
}

.agent-card__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.agent-card__title {
    flex-shrink: 0;
    font-weight: var(--weight-medium, 500);
}

.agent-card__subtitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-card__spinner,
.agent-card__status,
.agent-card__chevron {
    flex-shrink: 0;
    margin-left: auto;
}

.agent-card__subtitle + .agent-card__spinner,
.agent-card__subtitle + .agent-card__status,
.agent-card__subtitle + .agent-card__chevron {
    margin-left: 0;
}

.agent-card__status,
.agent-card__chevron {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.agent-card[data-status="success"] .agent-card__status {
    color: var(--status-success);
}

.agent-card[data-status="error"] .agent-card__status {
    color: var(--status-danger);
}

.agent-card[data-status="waiting"] .agent-card__status {
    color: var(--status-warning);
}

.agent-card__actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    padding-right: 6px;
}

.agent-card__body {
    padding: 0 var(--acv-card-px, 8px) var(--acv-card-body-pb, 8px);
    font-size: 12px;
}
</style>
