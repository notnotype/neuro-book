<script setup lang="ts">
/**
 * 条目文字的夹具：注入 canon 的翻译端口（`canon-text.ts`），`value`、`close`、`entry`、`edit` 记成事件；开着的那一处的浮层里放一句占位的来历。
 */
import EntryText from "nbook/plugins/canon/web/components/EntryText.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof EntryText>(() => props.input, ["value", "close", "entry", "edit"]);
</script>

<template>
    <EntryText data-lab-subject class="w-full" v-bind="subject.bindings.value">
        <template #origin="{address}"><p class="text-[length:var(--text-sm)] text-[var(--text-muted)]">（{{ address.path }} 的来历由 OriginList 画，见它的场景）</p></template>
    </EntryText>
</template>
