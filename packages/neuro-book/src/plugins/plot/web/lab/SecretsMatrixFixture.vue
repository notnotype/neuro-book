<script setup lang="ts">
/**
 * 保密表：`open` 记成事件；`compact` 的场景是窄的版式。注入剧情的翻译端口（`plot-text.ts`）。
 */
import SecretsMatrix from "nbook/plugins/plot/web/components/SecretsMatrix.vue";

import type {ChapterIndex} from "nbook/plugins/plot/web/labels";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {providePlotText} from "./plot-text";

const props = defineProps<LabFixtureProps>();
/** 章表不是 JSON 数据，由夹具给：第 1 到 40 章，id 就是章号。 */
const CHAPTERS: ChapterIndex = new Map(Array.from({length: 40}, (_, index) => [String(index + 1), index + 1]));
providePlotText(props.scene);

const subject = useLabSubject<typeof SecretsMatrix>(() => props.input, ["open"]);
</script>

<template>
    <SecretsMatrix data-lab-subject class="w-full" v-bind="subject.bindings.value" :chapters="CHAPTERS" />
</template>
