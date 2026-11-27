<script setup lang="ts">
/**
 * 确认条的夹具：注入 canon 的翻译端口（`canon-text.ts`），填的值与意图是场景的双向绑定，由 Lab 管；`save`、`cancel`、`recheck` 记成事件。
 */
import ConfirmBar from "nbook/plugins/canon/web/components/editing/ConfirmBar.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ConfirmBar>(() => props.input, ["save", "cancel", "recheck"]);
</script>

<template>
    <ConfirmBar data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
