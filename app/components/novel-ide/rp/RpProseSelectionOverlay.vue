<script setup lang="ts">
/**
 * RP 正文选区浮动按钮：监听 selectionchange，当选区落在正文滚动区内的单个 tick section 里时，
 * 在选区末尾附近浮出「生成插画」按钮；点击后上抛 {tickDir, anchorText, occurrence, text}。
 * occurrence = 锚点文字在该 section 渲染文本中、选区之前完整出现的次数（0-based），
 * 服务端按同样语义在 prose.md 源码中定位第 N 次出现。
 */

const props = defineProps<{
    /** 正文滚动容器（RpProsePanel 的 scrollRef）。 */
    container: HTMLElement | null;
    enabled: boolean;
}>();

const emit = defineEmits<{
    (e: "generate", payload: {tickDir: string; anchorText: string; occurrence: number; text: string}): void;
}>();

/** 锚点文字上限：与服务端 DTO（500）留余量，过长的选区截断后仍能唯一定位。 */
const ANCHOR_MAX_CHARS = 300;
/** 选区最少字符数，低于此不出按钮（误触保护）。 */
const MIN_SELECTION_CHARS = 4;

const visible = ref(false);
/** 按钮相对滚动容器 offsetParent 的定位。 */
const position = ref({top: 0, left: 0});
const pending = ref<{tickDir: string; anchorText: string; occurrence: number; text: string} | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function hide(): void {
    visible.value = false;
    pending.value = null;
}

/** 从 Range 节点向上找 tick section。 */
function tickSectionOf(node: Node | null): HTMLElement | null {
    const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
    return element?.closest<HTMLElement>("[data-tick-dir]") ?? null;
}

/**
 * 计算选区上下文；不满足条件（跨 section、空选区、容器外）返回 null。
 */
function resolveSelection(): {payload: {tickDir: string; anchorText: string; occurrence: number; text: string}; rect: DOMRect} | null {
    const container = props.container;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
        return null;
    }
    const startSection = tickSectionOf(range.startContainer);
    const endSection = tickSectionOf(range.endContainer);
    if (!startSection || startSection !== endSection) {
        return null;
    }
    const text = selection.toString().trim();
    if (text.length < MIN_SELECTION_CHARS) {
        return null;
    }
    const tickDir = startSection.dataset.tickDir ?? "";
    if (!tickDir) {
        return null;
    }
    const anchorText = text.slice(0, ANCHOR_MAX_CHARS);
    // occurrence：section 起点 → 选区起点的文本里，anchorText 完整出现的次数。
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(startSection);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const prefixText = prefixRange.toString();
    let occurrence = 0;
    let searchIndex = prefixText.indexOf(anchorText);
    while (searchIndex >= 0) {
        occurrence += 1;
        searchIndex = prefixText.indexOf(anchorText, searchIndex + 1);
    }
    return {payload: {tickDir, anchorText, occurrence, text}, rect: range.getBoundingClientRect()};
}

/** selectionchange 去抖处理：更新按钮位置或隐藏。 */
function handleSelectionChange(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!props.enabled) {
            hide();
            return;
        }
        const resolved = resolveSelection();
        const container = props.container;
        if (!resolved || !container) {
            hide();
            return;
        }
        const containerRect = container.getBoundingClientRect();
        // 按钮浮在选区末尾下方；相对容器坐标（容器是 overlay 的 offsetParent）。
        position.value = {
            top: resolved.rect.bottom - containerRect.top + container.scrollTop + 6,
            left: Math.min(
                Math.max(resolved.rect.right - containerRect.left - 40, 8),
                container.clientWidth - 112,
            ),
        };
        pending.value = resolved.payload;
        visible.value = true;
    }, 120);
}

/** 滚动时直接隐藏（重算位置意义不大，重新选择即可）。 */
function handleScroll(): void {
    if (visible.value) {
        hide();
    }
}

function handleClick(): void {
    const payload = pending.value;
    hide();
    window.getSelection()?.removeAllRanges();
    if (payload) {
        emit("generate", payload);
    }
}

watch(() => props.container, (container, previous) => {
    previous?.removeEventListener("scroll", handleScroll);
    container?.addEventListener("scroll", handleScroll, {passive: true});
}, {immediate: true});

onMounted(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
});

onBeforeUnmount(() => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    props.container?.removeEventListener("scroll", handleScroll);
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
});
</script>

<template>
    <!-- RP 选区生图浮动按钮：mousedown.prevent 防止点击瞬间清空选区 -->
    <button
        v-if="visible"
        type="button"
        class="absolute z-40 flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--text-main)] shadow-md transition-colors hover:border-[var(--accent-main)] hover:text-[var(--accent-text)]"
        :style="{top: `${position.top}px`, left: `${position.left}px`}"
        @mousedown.prevent
        @click="handleClick"
    >
        <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
        {{ $t("comfyui.rp.generate") }}
    </button>
</template>
