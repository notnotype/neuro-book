<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed} from "vue";

import {useUiText} from "../../text-port";

// 空状态占位：列表/查询无数据时的居中提示，action 插槽放主操作按钮；icon 插槽换掉圆底里的图标（例如加载中放 Spinner）。
const props = withDefaults(defineProps<{
    iconClass?: string;
    title?: string;
    description?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    iconClass: "i-lucide-inbox",
    description: "",
});

const text = useUiText();
// 未传 title 时用目录里的缺省文案；显式传（含空串）以属性为准。
const titleText = computed(() => props.title ?? text("emptyState.title"));
</script>

<template>
    <div class="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-muted)]">
            <slot name="icon"><span :class="props.iconClass" class="h-5 w-5"></span></slot>
        </span>
        <div class="max-w-sm">
            <p class="text-sm font-medium text-[var(--text-main)]">{{ titleText }}</p>
            <p v-if="props.description || $slots.default" class="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                <slot>{{ props.description }}</slot>
            </p>
        </div>
        <div v-if="$slots.action" class="mt-1">
            <slot name="action" />
        </div>
    </div>
</template>
