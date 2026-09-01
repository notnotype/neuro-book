<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import HighlightBox from "../HighlightBox.vue";
import type {HighlightTone} from "../highlight-box.types";
import {useElementRect} from "../use-element-rect";

const props = defineProps<{scene: string; data?: unknown}>();

const knobs = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        label: typeof data.label === "string" ? data.label : "",
        tone: data.tone === "probe" ? ("probe" as HighlightTone) : ("subject" as HighlightTone),
        width: typeof data.width === "number" ? data.width : 260,
        height: typeof data.height === "number" ? data.height : 120,
        show: data.show !== false,
    };
});

const targetRef = ref<HTMLElement | null>(null);
const {rect, track, measure} = useElementRect();

onMounted(() => {
    track(targetRef.value);
});
// 改宽高不换节点，ResizeObserver 能看见尺寸变化，但换场景会重挂节点，要重新盯
watch(() => props.scene, () => {
    track(targetRef.value);
    measure();
});

const shownRect = computed(() => (knobs.value.show ? rect.value : null));
</script>

<template>
    <div class="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div
            ref="targetRef"
            class="flex items-center justify-center rounded border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]"
            :style="{width: `${knobs.width}px`, height: `${knobs.height}px`}"
        >
            被框住的目标
        </div>
        <p class="max-w-sm text-center text-xs text-[var(--text-muted)]">
            框画在视口坐标上，不改目标自己的样式。在数据 tab 里改宽高看框跟不跟得上，
            把 <code>show</code> 改成 false 看它是否完全不渲染。
        </p>

        <HighlightBox :rect="shownRect" :label="knobs.label" :tone="knobs.tone" />
    </div>
</template>
