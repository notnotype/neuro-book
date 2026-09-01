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
        class="nb-lab-panel flex h-full min-h-0 flex-col overflow-hidden"
        :class="isLeft ? 'nb-lab-panel--left' : 'nb-lab-panel--right'"
        :style="props.collapsed ? {width: `${props.collapsedWidth}px`, flex: `0 0 ${props.collapsedWidth}px`} : undefined"
    >
        <template v-if="props.collapsed">
            <div class="nb-lab-panel-rail flex justify-center">
                <button
                    ref="toggleRef"
                    type="button"
                    class="nb-lab-panel-toggle"
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
            <div class="nb-lab-panel-head flex shrink-0 items-center">
                <span class="nb-lab-panel-title min-w-0 flex-1 truncate">{{ props.title }}</span>
                <slot name="actions"></slot>
                <button
                    ref="toggleRef"
                    type="button"
                    class="nb-lab-panel-toggle shrink-0"
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

<style scoped>
/* 尺寸与圆角走主题 token，颜色走配色变量——两条轴分开，换主题时这一栏才会跟着变形状 */
.nb-lab-panel {
    background: var(--bg-sidebar);
}

.nb-lab-panel--left {
    border-right: var(--border-w) solid var(--border-color);
}

.nb-lab-panel--right {
    border-left: var(--border-w) solid var(--border-color);
}

.nb-lab-panel-rail {
    padding-top: var(--space-4);
}

.nb-lab-panel-head {
    height: var(--control-h-lg);
    gap: var(--space-4);
    padding: 0 var(--space-5);
    border-bottom: var(--border-w) solid var(--border-color);
}

.nb-lab-panel-title {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
}

.nb-lab-panel-toggle {
    display: inline-flex;
    height: var(--control-h-sm);
    width: var(--control-h-sm);
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    transition:
        background-color var(--motion-fast) var(--ease-standard),
        color var(--motion-fast) var(--ease-standard);
}

.nb-lab-panel-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.nb-lab-panel-toggle:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 2px;
}
</style>
