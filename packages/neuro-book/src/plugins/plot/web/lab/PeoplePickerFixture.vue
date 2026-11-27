<script setup lang="ts">
/**
 * “选要看的人”：选中的人是受控的模型。注入剧情的翻译端口（`plot-text.ts`）。
 */
import PeoplePicker from "nbook/plugins/plot/web/components/PeoplePicker.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {providePlotText} from "./plot-text";

const props = defineProps<LabFixtureProps>();
providePlotText(props.scene);

const subject = useLabSubject<typeof PeoplePicker>(() => props.input, ["update:modelValue"]);
</script>

<template>
    <PeoplePicker data-lab-subject  v-bind="subject.bindings.value" />
</template>
