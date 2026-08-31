<script setup lang="ts">
import {ref, watch} from "vue";
import ViewportCanvas from "../ViewportCanvas.vue";

const props = defineProps<{scene: string}>();

const width = ref(390);
const height = ref(844);

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
</script>

<template>
    <ViewportCanvas v-model:width="width" v-model:height="height">
        <div class="flex h-full flex-col gap-3 p-4">
            <p class="text-sm text-[var(--text-main)]">
                这块内容用来看盒子尺寸变化时里面怎么重排。拖右边、下边或右下角的手柄改尺寸，
                也可以用 Tab 聚焦手柄后按方向键。
            </p>
            <div class="grid grid-cols-2 gap-2">
                <div v-for="i in 6" :key="i" class="rounded border border-[var(--border-color)] p-3 text-xs text-[var(--text-muted)]">
                    格子 {{ i }}
                </div>
            </div>
        </div>
    </ViewportCanvas>
</template>
