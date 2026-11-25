<script setup lang="ts">
/** 时间点的夹具：注入 canon 的翻译端口（`canon-text.ts`）；位置与“算上计划”是场景的双向绑定，由 Lab 管。放在靠右的一行里，同页头。 */
import PositionPicker from "nbook/plugins/canon/web/components/PositionPicker.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PositionPicker>(() => props.input, []);
</script>

<template>
    <div class="flex w-full justify-end p-4">
        <PositionPicker data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
