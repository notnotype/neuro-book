<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";

export type CollapsibleSidePanelSide = "left" | "right";

const props = withDefaults(defineProps<{
    title: string;
    collapsed: boolean;
    side?: CollapsibleSidePanelSide;
    collapsedWidth?: number;
}>(), {
    side: "left",
    collapsedWidth: 40,
});

const emit = defineEmits<{
    (e: "update:collapsed", value: boolean): void;
}>();

const bodyRef = ref<HTMLElement | null>(null);
const toggleRef = ref<HTMLElement | null>(null);

const isLeft = computed(() => props.side === "left");

// 收起按钮指向它会缩过去的方向；展开按钮指向它会长出来的方向。
const toggleIconClass = computed(() => {
    if (props.collapsed) {
        return isLeft.value ? "i-lucide-chevron-right" : "i-lucide-chevron-left";
    }
    return isLeft.value ? "i-lucide-chevron-left" : "i-lucide-chevron-right";
});

// pre flush 让这里读到的还是收起之前的 activeElement；等 DOM 换完再把焦点接住，
// 否则内容区被销毁后焦点会掉回 body。展开时不抢焦点，展开可能由别处触发。
watch(() => props.collapsed, (isCollapsed) => {
    if (!isCollapsed) {
        return;
    }
    const active = document.activeElement;
    const focusWasInside = active instanceof HTMLElement && bodyRef.value?.contains(active) === true;
    if (!focusWasInside) {
        return;
    }
    void nextTick(() => toggleRef.value?.focus());
}, {flush: "pre"});
</script>

<template>
    <!-- 可收起侧栏：收起状态受控，宽度由父容器决定 -->
    <div
        class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-sidebar)]"
        :class="isLeft ? 'border-r border-[var(--border-color)]' : 'border-l border-[var(--border-color)]'"
        :style="props.collapsed ? {width: `${props.collapsedWidth}px`, flex: `0 0 ${props.collapsedWidth}px`} : undefined"
    >
        <template v-if="props.collapsed">
            <div class="flex justify-center pt-2">
                <button
                    ref="toggleRef"
                    type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-main)]"
                    :title="props.title"
                    :aria-label="props.title"
                    :aria-expanded="false"
                    @click="emit('update:collapsed', false)"
                >
                    <span :class="toggleIconClass" class="h-4 w-4"></span>
                </button>
            </div>
        </template>

        <template v-else>
            <!-- 标题栏高度固定，切换内容不引起布局位移 -->
            <div class="flex h-[38px] shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-3">
                <span class="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-muted)]">{{ props.title }}</span>
                <slot name="actions"></slot>
                <button
                    ref="toggleRef"
                    type="button"
                    class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-main)]"
                    :title="props.title"
                    :aria-label="props.title"
                    :aria-expanded="true"
                    @click="emit('update:collapsed', true)"
                >
                    <span :class="toggleIconClass" class="h-4 w-4"></span>
                </button>
            </div>

            <div ref="bodyRef" class="min-h-0 flex-1 overflow-y-auto">
                <slot></slot>
            </div>
        </template>
    </div>
</template>
