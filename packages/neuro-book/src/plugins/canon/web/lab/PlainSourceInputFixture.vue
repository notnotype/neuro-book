<script setup lang="ts">
/** 源文字输入的退路的夹具：文字是受控的模型。 */
import PlainSourceInput from "nbook/plugins/canon/web/components/text/PlainSourceInput.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof PlainSourceInput>(() => props.input, ["update:modelValue", "focus", "blur"]);
</script>

<template>
    <PlainSourceInput data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
