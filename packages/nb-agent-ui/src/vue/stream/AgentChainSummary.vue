<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";
import {useAgentText} from "../host";

const props = withDefaults(defineProps<{
    expanded: boolean;
    label: string;
    icon?: string;
    alert?: string;
    running?: boolean;
} & /* @vue-ignore */ HTMLAttributes>(), {
    icon: "i-lucide-list-tree",
    alert: "",
    running: false,
});

const emit = defineEmits<{
    (e: "update:expanded", expanded: boolean): void;
}>();

const {t} = useAgentText();
</script>

<template>
    <button
        type="button"
        class="agent-chain-summary"
        :aria-expanded="props.expanded"
        @click="emit('update:expanded', !props.expanded)"
    >
        <Spinner v-if="props.running" size="sm" :label="t('turn.running')" class="agent-chain-summary__icon" />
        <span v-else :class="[props.icon, 'agent-chain-summary__icon']" aria-hidden="true" />
        <span class="agent-chain-summary__label">{{ props.label }}</span>
        <span v-if="props.alert" class="agent-chain-summary__alert">{{ props.alert }}</span>
        <span class="i-lucide-chevron-right agent-chain-summary__chevron" aria-hidden="true" />
    </button>
</template>

<style scoped>
/* 过程入口，注意力低于正文：宽度随内容，淡色，悬停才出现浅底。 */
.agent-chain-summary {
    display: flex;
    align-self: flex-start;
    align-items: center;
    gap: 6px;
    width: fit-content;
    max-width: 100%;
    min-width: 0;
    min-height: 24px;
    padding: 0 6px 0 var(--nb-agent-summary-px, 4px);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.agent-chain-summary:hover,
.agent-chain-summary[aria-expanded="true"] {
    color: var(--text-secondary);
}

.agent-chain-summary:hover {
    background: var(--bg-hover);
}

.agent-chain-summary__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
}

.agent-chain-summary__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-chain-summary__alert {
    flex-shrink: 0;
    color: var(--status-danger);
    white-space: nowrap;
}

.agent-chain-summary__chevron {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    opacity: 0.7;
    transition: transform var(--motion-fast) var(--ease-standard);
}

.agent-chain-summary[aria-expanded="true"] .agent-chain-summary__chevron {
    transform: rotate(90deg);
}
</style>
