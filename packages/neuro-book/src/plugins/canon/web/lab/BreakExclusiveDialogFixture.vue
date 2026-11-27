<script setup lang="ts">
/**
 * 强行解除对话框的夹具：注入 canon 的翻译端口（`canon-text.ts`）；开关是场景的双向绑定，由 Lab 管；`confirm` 记成事件。
 */
import BreakExclusiveDialog from "nbook/plugins/canon/web/components/revisions/BreakExclusiveDialog.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof BreakExclusiveDialog>(() => props.input, ["confirm"]);
</script>

<template>
    <BreakExclusiveDialog data-lab-subject v-bind="subject.bindings.value" />
</template>
