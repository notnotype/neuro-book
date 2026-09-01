<script setup lang="ts">
import {computed, nextTick, ref} from "vue";

// 线性标签页（仅标签栏，内容面板由消费方渲染）。
// 与 SegmentedControl 的分工：Tabs 用于页面/区块级导航（底部指示线），SegmentedControl 用于紧凑的互斥模式切换。
export type TabsItem = {
    value: string;
    label: string;
    iconClass?: string;
    count?: number | string;
    disabled?: boolean;
};
export type TabsSize = "sm" | "md";

const props = withDefaults(defineProps<{
    modelValue: string;
    items: TabsItem[];
    ariaLabel?: string;
    size?: TabsSize;
}>(), {
    ariaLabel: "",
    size: "md",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
}>();

const tablistRef = ref<HTMLDivElement | null>(null);

const enabledItems = computed(() => props.items.filter((item) => !item.disabled));

function isSelected(item: TabsItem): boolean {
    return item.value === props.modelValue;
}

function select(item: TabsItem): void {
    if (item.disabled) {
        return;
    }
    emit("update:modelValue", item.value);
}

/** 方向键/Home/End 在启用的标签间移动选中项，并把焦点跟到新标签上 */
function handleKeydown(event: KeyboardEvent): void {
    const enabled = enabledItems.value;
    if (enabled.length === 0) {
        return;
    }
    const currentIndex = Math.max(0, enabled.findIndex((item) => item.value === props.modelValue));
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % enabled.length;
    } else if (event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (event.key === "Home") {
        nextIndex = 0;
    } else if (event.key === "End") {
        nextIndex = enabled.length - 1;
    }
    if (nextIndex === null) {
        return;
    }
    event.preventDefault();
    const nextItem = enabled[nextIndex];
    if (!nextItem) {
        return;
    }
    emit("update:modelValue", nextItem.value);
    void nextTick(() => {
        const tabs = Array.from(tablistRef.value?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []);
        tabs.find((tab) => tab.dataset.tabValue === nextItem.value)?.focus();
    });
}

function tabClass(item: TabsItem): string {
    if (isSelected(item)) {
        return "text-[var(--text-main)] after:bg-[var(--accent-main)]";
    }
    return "text-[var(--text-secondary)] hover:text-[var(--text-main)] after:bg-transparent";
}
</script>

<template>
    <!--
        标签栏：底边线 + 选中项指示线。

        指示线必须**待在盒子里**（after:bottom-0），不能靠负偏移压在边线上。
        原因是这条 overflow-x-auto：CSS 规定两轴只要有一轴不是 visible，另一轴的 visible
        就计算成 auto，所以这里的 overflow-y 实际是 auto。指示线原来写 bottom:-1px，
        有 1px 落在 padding box 外面，于是标签栏**多出一条竖向滚动条**——一条 26px 高的
        标签栏配一根滚动条，看起来像坏了。负 margin 会踩同一个坑，换成绝对定位并没有绕开。

        代价：指示线现在贴在边线上方而不是压住它，视觉上厚度少 1px。
    -->
    <div ref="tablistRef" role="tablist" :aria-label="props.ariaLabel || undefined" class="flex items-end gap-[var(--space-2)] overflow-x-auto border-b-[length:var(--border-w)] border-[color:var(--divider)]" @keydown="handleKeydown">
        <button
            v-for="item in props.items"
            :key="item.value"
            type="button"
            role="tab"
            :data-tab-value="item.value"
            :aria-selected="isSelected(item)"
            :tabindex="isSelected(item) ? 0 : -1"
            :disabled="item.disabled"
            class="nb-ui-focus-ring relative inline-flex shrink-0 items-center gap-[var(--space-2)] whitespace-nowrap [font-weight:var(--weight-medium)] transition-colors [transition-duration:var(--motion-fast)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:transition-colors after:[transition-duration:var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-45"
            :class="[props.size === 'sm' ? 'h-[var(--control-h-sm)] px-[calc(var(--control-px)*0.8)] text-[var(--text-xs)]' : 'h-[var(--control-h-md)] px-[var(--control-px)] text-[var(--text-sm)]', tabClass(item)]"
            @click="select(item)"
        >
            <span v-if="item.iconClass" :class="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0"></span>
            <span>{{ item.label }}</span>
            <span v-if="item.count !== undefined" class="rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-[var(--space-1)] font-mono text-[var(--text-2xs)] text-[var(--text-muted)]">{{ item.count }}</span>
        </button>
    </div>
</template>
