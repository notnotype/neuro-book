<script setup lang="ts">
const props = withDefaults(defineProps<{
    label?: string;
    stacked?: boolean;
}>(), {
    label: "",
    stacked: true,
});
</script>

<template>
    <!-- 通用表单字段容器，统一标签与控件的默认间距 -->
    <div :class="props.stacked ? 'space-y-1.5' : ''">
        <div v-if="props.label" class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {{ props.label }}
        </div>
        <slot />
    </div>
</template>
