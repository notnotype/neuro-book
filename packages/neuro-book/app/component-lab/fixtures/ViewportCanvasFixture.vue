<script setup lang="ts">
import ViewportCanvas from "../ViewportCanvas.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ViewportCanvas>(() => props.input);
</script>

<template>
    <ViewportCanvas
        data-lab-subject
        v-bind="subject.bindings.value"
    >
        <template v-if="subject.slots.value.default" #default>
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
        </template>
    </ViewportCanvas>
</template>
