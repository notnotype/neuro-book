<script setup lang="ts">
/** 浮动窗的轨宽手柄挂在一扇假窗里（相对定位、300 高，右边一栏是视图段）：手柄是绝对定位、按窗的右边摆的。 */
import WorkbenchFloatRailHandle from "nbook/plugins/workbench/web/components/WorkbenchFloatRailHandle.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchFloatRailHandle>(() => props.input, ["preview", "commit"]);
</script>

<template>
    <div class="relative h-[300px] w-full overflow-hidden rounded-[var(--radius-card,8px)] border border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div class="absolute inset-y-0 right-0 border-l border-[var(--border-color)]" :style="{width: `${Number(props.input?.props?.width ?? 260)}px`}"></div>
        <WorkbenchFloatRailHandle data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
