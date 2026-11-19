<script setup lang="ts">
/**
 * 页头的线选择：选中的线记成事件 `update:line`。注入 canon 的翻译端口（`canon-text.ts`）。
 */
import LineSelect from "nbook/plugins/canon/web/components/LineSelect.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof LineSelect>(() => props.input, ["update:line"]);
</script>

<template>
    <LineSelect data-lab-subject v-bind="subject.bindings.value" />
</template>
