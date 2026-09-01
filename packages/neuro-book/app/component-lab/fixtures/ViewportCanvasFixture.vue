<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ViewportCanvas from "../ViewportCanvas.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const width = ref(390);
const height = ref(844);

const knobs = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        minSize: typeof data.minSize === "number" ? data.minSize : 200,
        showSize: typeof data.showSize === "boolean" ? data.showSize : true,
        cells: typeof data.cells === "number" ? data.cells : 6,
    };
});

const presets: Record<string, [number, number]> = {
    phone: [390, 844],
    tablet: [768, 1024],
    free: [0, 0],
};

watch(() => props.scene, (scene) => {
    const [w, h] = presets[scene] ?? presets.phone!;
    width.value = w;
    height.value = h;
}, {immediate: true});

function onWidth(value: number): void {
    width.value = value;
    emitLabEvent("update:width", value);
}

function onHeight(value: number): void {
    height.value = value;
    emitLabEvent("update:height", value);
}
</script>

<template>
    <ViewportCanvas
        data-lab-subject
        :width="width"
        :height="height"
        :min-size="knobs.minSize"
        :show-size="knobs.showSize"
        @update:width="onWidth"
        @update:height="onHeight"
    >
        <div class="flex h-full flex-col gap-3 p-4">
            <p class="text-sm text-[var(--text-main)]">
                这块内容用来看盒子尺寸变化时里面怎么重排。拖右边、下边或右下角的手柄改尺寸，
                也可以用 Tab 聚焦手柄后按方向键。
            </p>
            <div class="grid grid-cols-2 gap-2">
                <div v-for="i in knobs.cells" :key="i" class="rounded border border-[var(--border-color)] p-3 text-xs text-[var(--text-muted)]">
                    格子 {{ i }}
                </div>
            </div>
        </div>
    </ViewportCanvas>
</template>
