<script setup lang="ts">
/**
 * 侧栏“剧情”：`table`、`line` 记成事件。注入剧情的翻译端口（`plot-text.ts`）。
 */
import PlotSidebar from "nbook/plugins/plot/web/components/PlotSidebar.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {providePlotText} from "./plot-text";

const props = defineProps<LabFixtureProps>();
providePlotText(props.scene);

const subject = useLabSubject<typeof PlotSidebar>(() => props.input, ["table", "line"]);
</script>

<template>
    <PlotSidebar data-lab-subject class="h-full w-full" v-bind="subject.bindings.value" />
</template>
