<script setup lang="ts">
/**
 * 条目页骨架的夹具：注入 canon 的翻译端口（`canon-text.ts`），位置、按计划、分页是场景的双向绑定，由 Lab 管；`open-entry`、`retry` 记成事件；分页内容放一段占位。
 */
import EntryPage from "nbook/plugins/canon/web/components/entry-page/EntryPage.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof EntryPage>(() => props.input, ["open-entry", "retry", "delete", "edit-name", "edit-summary", "aliases", "move", "add-component", "remove-component", "restore"]);
</script>

<template>
    <EntryPage data-lab-subject class="w-full" v-bind="subject.bindings.value">
        <p class="text-[length:var(--text-sm)] text-[var(--text-muted)]">（分页内容：文字、数据、情节各由自己的组件画，见它们的场景）</p>
    </EntryPage>
</template>
