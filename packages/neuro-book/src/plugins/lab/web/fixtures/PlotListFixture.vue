<script setup lang="ts">
/**
 * 情节列表的夹具：注入 canon 的翻译端口（`canon-text.ts`），`open`、`more` 记成事件。
 */
import PlotList from "nbook/plugins/canon/web/components/groups/PlotList.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PlotList>(() => props.input, ["open", "more"]);
</script>

<template>
    <PlotList data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
