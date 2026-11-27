<script setup lang="ts">
/**
 * 剧情读取失败的那一条：`retry` 记成事件。注入剧情的翻译端口（`plot-text.ts`）。
 */
import ReadFailure from "nbook/plugins/plot/web/components/ReadFailure.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {providePlotText} from "./plot-text";

const props = defineProps<LabFixtureProps>();
providePlotText(props.scene);

const subject = useLabSubject<typeof ReadFailure>(() => props.input, ["retry"]);
</script>

<template>
    <ReadFailure data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
