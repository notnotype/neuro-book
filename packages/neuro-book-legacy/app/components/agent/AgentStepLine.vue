<script setup lang="ts">
import {computed} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    icon: string;
    label: string;
    detail?: string;
    stat?: {added: number | null; removed: number | null} | null;
    status?: "running" | "error" | "done";
    expanded?: boolean;
}>(), {
    detail: "",
    stat: null,
    status: "done",
    expanded: undefined,
});

const emit = defineEmits<{
    (e: "toggle", expanded: boolean): void;
}>();

defineSlots<{
    default?: () => unknown;
}>();

const {t} = useI18n();

const expandable = computed(() => props.expanded !== undefined);
// 一侧为 0 而另一侧有改动时，0 那一侧只是噪音。
const showAdded = computed(() => props.stat !== null && props.stat.added !== null && (props.stat.added > 0 || !(props.stat.removed !== null && props.stat.removed > 0)));
const showRemoved = computed(() => props.stat !== null && props.stat.removed !== null && (props.stat.removed > 0 || !(props.stat.added !== null && props.stat.added > 0)));
</script>

<template>
    <div class="agent-step" :data-status="props.status">
        <component
            :is="expandable ? 'button' : 'div'"
            :type="expandable ? 'button' : undefined"
            class="agent-step__row"
            :aria-expanded="expandable ? props.expanded : undefined"
            @click="expandable && emit('toggle', !props.expanded)"
        >
            <span :class="[props.icon, 'agent-step__icon']" aria-hidden="true" />
            <span class="agent-step__label">{{ props.label }}</span>
            <span v-if="props.detail" class="agent-step__detail">{{ props.detail }}</span>
            <span v-if="props.stat" class="agent-step__stat">
                <span v-if="showAdded" class="agent-step__added">+{{ props.stat.added }}</span>
                <span v-if="showRemoved" class="agent-step__removed">-{{ props.stat.removed }}</span>
            </span>
            <Spinner v-if="props.status === 'running'" size="sm" :label="t('agentView.turn.running')" class="agent-step__spinner" />
        </component>
        <div v-if="expandable && props.expanded && $slots.default" class="agent-step__content">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.agent-step {
    min-width: 0;
}

.agent-step__row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    min-height: var(--acv-step-h, 24px);
    padding: 0 var(--acv-step-px, 8px);
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

button.agent-step__row:hover {
    background: var(--bg-hover);
}

.agent-step[data-status="error"] .agent-step__row {
    color: var(--status-danger);
}

.agent-step__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.agent-step[data-status="error"] .agent-step__icon {
    color: var(--status-danger);
}

.agent-step__label {
    flex-shrink: 0;
}

.agent-step__detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-step__stat {
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
}

.agent-step__detail + .agent-step__stat {
    margin-left: 0;
}

.agent-step__added {
    color: var(--status-success);
}

.agent-step__removed {
    color: var(--status-danger);
}

.agent-step__spinner {
    flex-shrink: 0;
    margin-left: auto;
}

.agent-step__content {
    padding: 2px 0 4px 20px;
}
</style>
