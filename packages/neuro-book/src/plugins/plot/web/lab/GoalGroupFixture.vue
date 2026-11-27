<script setup lang="ts">
/**
 * 一个人的目标与态度：`open` 记成事件。注入剧情的翻译端口（`plot-text.ts`）。
 */
import GoalGroup from "nbook/plugins/plot/web/components/GoalGroup.vue";

import type {ChapterIndex} from "nbook/plugins/plot/web/labels";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {providePlotText} from "./plot-text";

const props = defineProps<LabFixtureProps>();
/** 章表不是 JSON 数据，由夹具给：第 1 到 40 章，id 就是章号。 */
const CHAPTERS: ChapterIndex = new Map(Array.from({length: 40}, (_, index) => [String(index + 1), index + 1]));
providePlotText(props.scene);

const subject = useLabSubject<typeof GoalGroup>(() => props.input, ["open"]);
</script>

<template>
    <GoalGroup data-lab-subject class="w-full" v-bind="subject.bindings.value" :chapters="CHAPTERS" />
</template>
