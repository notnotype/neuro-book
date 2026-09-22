<script setup lang="ts">
/**
 * 设置区段的整块状态占位：加载中 / 加载失败。
 *
 * 页面级加载态与失败态都占满它们要交代的那块区域（`h-full`），所以调用方只需给它一个有高度的容器；
 * 不做骨架（占位形状会暗示还不知道的结构），加载文案必须能独立成立，失败给原因和重试。
 */
import {Button} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    variant: "loading" | "error";
    /** 说明文字；加载态留空用默认文案，失败态传真实原因 */
    message?: string;
    /** 重试按钮文案；留空用默认文案 */
    actionLabel?: string;
}>(), {
    message: "",
    actionLabel: "",
});

const emit = defineEmits<{
    (event: "retry"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <div
        v-if="props.variant === 'loading'"
        role="status"
        aria-busy="true"
        class="flex h-full min-h-0 flex-col items-center justify-center gap-[var(--space-2)] text-center"
    >
        <span class="i-lucide-loader-2 h-5 w-5 animate-spin text-[var(--text-muted)]" aria-hidden="true"></span>
        <span class="text-[var(--text-sm)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ props.message || t("settings.state.loading") }}</span>
    </div>

    <div
        v-else
        role="alert"
        class="flex h-full min-h-0 flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-6)] text-center"
    >
        <span class="i-lucide-triangle-alert h-6 w-6 shrink-0 text-[var(--status-danger)]" aria-hidden="true"></span>
        <span class="max-w-[var(--measure-read)] text-[var(--text-sm)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ props.message }}</span>
        <Button size="sm" variant="secondary" @click="emit('retry')">{{ props.actionLabel || t("settings.state.reload") }}</Button>
    </div>
</template>
