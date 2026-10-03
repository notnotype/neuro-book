<script setup lang="ts">
import {computed, watch} from "vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";

const HEADER_HEIGHT = 44;
const MAX_HEIGHT_RATIO = 0.9;
const RESTORE_HEIGHT = 280;

const props = withDefaults(defineProps<{
    /** 是否显示面板 */
    visible: boolean;
    /** 当前面板高度，0 表示完全收起 */
    height: number;
    /** 面板外层附加类 */
    panelClass?: string;
    /** 正文区域附加类 */
    bodyClass?: string;
}>(), {
    panelClass: "",
    bodyClass: "",
});

const emit = defineEmits<{
    (e: "update:height", value: number): void;
    (e: "close"): void;
}>();

const isResizing = ref(false);
const resizeHandleRef = ref<HTMLElement | null>(null);
const lastExpandedHeight = ref(RESTORE_HEIGHT);
const isCollapsed = computed(() => props.height <= HEADER_HEIGHT);
const visibleHeight = computed(() => `${Math.max(props.height, HEADER_HEIGHT)}px`);
const bodyVisible = computed(() => props.height > HEADER_HEIGHT);
const currentHeaderTitle = computed(() => isCollapsed.value ? "展开面板" : "收起面板");

/**
 * 开始拖拽 detail 面板高度。
 */
const {isResizing: resizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.height),
    minSize: HEADER_HEIGHT,
    maxSize: computed(() => import.meta.client ? window.innerHeight * MAX_HEIGHT_RATIO : RESTORE_HEIGHT),
    edge: "top",
    enabled: computed(() => props.visible),
    onResizeEnd: (height) => emit("update:height", height),
});

/**
 * 切换高度到 0 / 最近一次展开高度。
 */
function toggleHeight(): void {
    if (isCollapsed.value) {
        emit("update:height", Math.max(lastExpandedHeight.value, RESTORE_HEIGHT));
        return;
    }

    emit("update:height", HEADER_HEIGHT);
}

watch(() => props.height, (nextHeight) => {
    if (nextHeight > HEADER_HEIGHT) {
        lastExpandedHeight.value = nextHeight;
    }
}, {immediate: true});

watch(resizing, (nextResizing) => {
    isResizing.value = nextResizing;
}, {immediate: true});
</script>

<template>
    <!-- 通用侧边 detail 面板壳 -->
    <div
        v-if="visible"
        class="relative z-10 flex shrink-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-panel)] shadow-[0_-4px_16px_color-mix(in_srgb,var(--shadow-color)_6%,transparent)] transition-[height] duration-150 ease-out"
        :class="[panelClass, isResizing ? 'select-none transition-none' : '']"
        :style="isResizing ? panelStyle : { height: visibleHeight }"
    >
        <!-- 拖拽手柄 -->
        <div ref="resizeHandleRef" class="group absolute -top-1 left-0 right-0 z-30 h-2 cursor-row-resize">
            <div
                class="mt-0.5 h-[2px] w-full bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100"
                :class="isResizing ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"
            ></div>
        </div>

        <!-- 头部 -->
        <div class="sticky top-0 z-20 flex h-[44px] shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
            <div class="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 overflow-hidden" @click="toggleHeight">
                <slot name="header"></slot>
            </div>

            <div class="ml-3 flex shrink-0 items-center gap-1.5">
                <slot name="actions"></slot>
                <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :title="currentHeaderTitle"
                    @click="toggleHeight"
                >
                    <span :class="isCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-4 w-4"></span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]"
                    title="关闭详情"
                    @click="emit('close')"
                >
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </div>

        <!-- 正文 -->
        <div v-show="bodyVisible" class="min-h-0 flex-1 overflow-y-auto custom-scrollbar" :class="bodyClass">
            <slot></slot>
        </div>
    </div>
</template>
