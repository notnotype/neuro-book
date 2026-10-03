<script setup lang="ts">
const props = withDefaults(defineProps<{
    title?: string;
    variant?: "default" | "danger";
    size?: "sm" | "md";
    disabled?: boolean;
}>(), {
    title: "",
    variant: "default",
    size: "md",
    disabled: false,
});
</script>

<template>
    <!-- 通用紧凑图标按钮 -->
    <button
        type="button"
        :title="props.title"
        :disabled="props.disabled"
        class="inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        :class="[
            props.size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
            props.variant === 'danger'
                ? 'text-[var(--text-muted)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
        ]"
    >
        <slot />
    </button>
</template>
