<script setup lang="ts">
/**
 * 新建条目对话框的夹具：注入 canon 的翻译端口（`canon-text.ts`）；开关与填的草稿是场景的双向绑定，由 Lab 管；`confirm` 记成事件。
 */
import NewEntryDialog from "nbook/plugins/canon/web/components/entries/NewEntryDialog.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof NewEntryDialog>(() => props.input, ["confirm", "search-parent", "search-same-as"]);
</script>

<template>
    <NewEntryDialog data-lab-subject v-bind="subject.bindings.value" />
</template>
