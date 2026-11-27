<script setup lang="ts">
/**
 * 字段表的夹具：注入 canon 的翻译端口（`canon-text.ts`），`value` 记成事件；展开着的那一行下面放一句占位的来历。
 */
import FieldTable from "nbook/plugins/canon/web/components/groups/FieldTable.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof FieldTable>(() => props.input, ["value", "edit", "edit-element", "remove-element", "add-element"]);
</script>

<template>
    <FieldTable data-lab-subject class="w-full" v-bind="subject.bindings.value">
        <template #origin="{path}"><p class="text-[length:var(--text-sm)] text-[var(--text-muted)]">（{{ path }} 的来历由 OriginList 画，见它的场景）</p></template>
    </FieldTable>
</template>
