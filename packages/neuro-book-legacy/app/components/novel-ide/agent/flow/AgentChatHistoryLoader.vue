<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    hasPrevious?: boolean;
    loading?: boolean;
    error?: string;
}>(), {
    hasPrevious: false,
    loading: false,
    error: "",
});

const emit = defineEmits<{
    (e: "load"): void;
}>();

const {t} = useI18n();

const iconClass = computed(() => {
    if (props.loading) return "i-lucide-loader-circle animate-spin";
    if (props.error) return "i-lucide-rotate-ccw";
    return "i-lucide-chevron-up";
});

const buttonText = computed(() => {
    if (props.loading) return t("agent.chat.loadingPrevious");
    if (props.error) return t("agent.chat.retryPrevious");
    return t("agent.chat.loadPrevious");
});
</script>

<template>
    <div
        v-if="props.hasPrevious || props.loading || props.error"
        class="agent-chat-history-loader mb-4 flex shrink-0 items-center justify-center gap-2 select-none"
    >
        <Button
            size="sm"
            variant="secondary"
            :loading="props.loading"
            :icon-class="iconClass"
            class="text-xs"
            @click="emit('load')"
        >
            {{ buttonText }}
        </Button>
        <span
            v-if="props.error && !props.loading"
            class="max-w-[360px] truncate text-xs text-[var(--status-danger)]"
            :title="props.error"
        >
            {{ props.error }}
        </span>
    </div>
</template>
