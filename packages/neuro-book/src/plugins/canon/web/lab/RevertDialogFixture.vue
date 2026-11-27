<script setup lang="ts">
/**
 * 还原对话框的夹具：注入 canon 的翻译端口（`canon-text.ts`）；开关是场景的双向绑定，由 Lab 管；`confirm`、`recheck` 记成事件。
 */
import RevertDialog from "nbook/plugins/canon/web/components/revisions/RevertDialog.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof RevertDialog>(() => props.input, ["confirm", "recheck"]);
</script>

<template>
    <RevertDialog data-lab-subject v-bind="subject.bindings.value" />
</template>
