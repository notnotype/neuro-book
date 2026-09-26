<script setup lang="ts">
import {computed} from "vue";
import HighlightBox from "../HighlightBox.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof HighlightBox>(() => props.input);
const targetSize = computed(() => subject.bindings.value.rect);
</script>

<template>
    <div class="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div
            data-lab-target
            class="flex items-center justify-center rounded border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]"
            :style="{width: `${targetSize?.width ?? 260}px`, height: `${targetSize?.height ?? 120}px`}"
        >
            被框住的目标
        </div>
        <p class="max-w-sm text-center text-xs text-[var(--text-muted)]">
            框画在视口坐标上，不改目标自己的样式。在数据 tab 里改 rect 看框跟不跟得上，
            把 <code>rect</code> 改成 null 看它是否完全不渲染。
        </p>

        <HighlightBox data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
