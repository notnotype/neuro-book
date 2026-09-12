<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
    menuMaxHeight?: string;
    rootClass?: string;
    compact?: boolean;
}>(), {
    menuClass: "left-0 top-full mt-2 min-w-full",
    menuMaxHeight: "none",
    rootClass: "relative w-full",
    compact: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

/**
 * 切换菜单显示状态。
 */
const toggle = (): void => {
    open.value = !open.value;
};

/**
 * 选中菜单项。
 */
const select = (value: string): void => {
    emit("select", value);
    open.value = false;
};

onClickOutside(rootRef, () => {
    open.value = false;
});
</script>

<template>
    <!-- 下拉菜单容器 -->
    <div ref="rootRef" :class="props.rootClass">
        <div class="flex w-full items-center" @click.stop="toggle">
            <slot />
        </div>

        <div
            v-if="open"
            class="absolute z-[60] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 shadow-xl backdrop-blur-sm"
            :class="menuClass"
            :style="{ maxHeight: menuMaxHeight }"
        >
            <button
                v-for="item in props.items"
                :key="item.value"
                class="mb-1 flex w-full items-center justify-between gap-3 rounded-md px-2.5 text-left transition-colors last:mb-0"
                :class="[
                    props.compact ? 'py-1.5 text-[12px]' : 'py-1.5 text-sm',
                    item.active ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
                ]"
                @click.stop="select(item.value)"
            >
                <span class="inline-flex min-w-0 items-center gap-2">
                    <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 text-[var(--text-muted)]"></span>
                    <span class="truncate">{{ item.label }}</span>
                </span>
                <span v-if="item.rightIconClass" :class="item.rightIconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
            </button>
        </div>
    </div>
</template>
