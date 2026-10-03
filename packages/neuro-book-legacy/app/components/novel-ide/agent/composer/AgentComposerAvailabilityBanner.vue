<script setup lang="ts">
import {
    projectComposerAvailabilityView,
} from "nbook/app/components/novel-ide/agent/agent-composer-presentation";
import type {
    AgentComposerAvailability,
    AgentComposerAvailabilityAction,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";

const props = defineProps<{
    availability: AgentComposerAvailability;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentComposerAvailabilityAction): void;
}>();

const {t} = useI18n();

const availabilityView = computed(() => projectComposerAvailabilityView(props.availability, t));
</script>

<template>
    <div
        v-if="availabilityView"
        class="flex min-w-0 items-center gap-2 border-b px-2.5 py-2 text-[11px]"
        :class="[availabilityView.borderClass, availabilityView.textClass]"
        role="status"
        aria-live="polite"
    >
        <span :class="availabilityView.icon" class="h-3.5 w-3.5 shrink-0"></span>
        <span class="min-w-0 flex-1 break-words leading-4">{{ availabilityView.message }}</span>
        <button
            v-if="availabilityView.action"
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded border border-current px-2 py-1 font-medium transition-colors hover:bg-[var(--bg-hover)]"
            @click="emit('action', availabilityView.action)"
        >
            <span :class="availabilityView.actionIcon" class="h-3 w-3"></span>
            <span>{{ availabilityView.actionLabel }}</span>
        </button>
    </div>
</template>
