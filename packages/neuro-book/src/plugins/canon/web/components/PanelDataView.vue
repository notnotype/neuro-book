<script setup lang="ts">
/**
 * canon 给面板（`nbook.canon.panel`）交的数据分页界面（docs/specs/canon/author-ui.md 输出 14）：经 `context` 读字段，选中的值卡记在
 * `context.state.selected`，它的流水就是来历，经 `context.origins` 按页读。打开分页时选中第一张。
 */
import {computed} from "vue";

import type {ComponentViewContext} from "../component-views";
import {useOriginPagesMap} from "../origin-pages";
import {fieldRows, originRows} from "../rows";
import {useCanonText} from "../text";
import PanelView from "./PanelView.vue";

const props = defineProps<{context: ComponentViewContext}>();

const text = useCanonText();
const context = props.context;
const prefix = `${context.namespace}.`;

const cards = computed(() => fieldRows(context.namespace, context.fields, context.declarations, context.place, text));
const selected = computed(() => {
    const chosen = context.state.selected;
    return typeof chosen === "string" && cards.value.some((card) => card.path === chosen) ? chosen : cards.value[0]?.path;
});
const pages = useOriginPagesMap(() => (selected.value === undefined ? [] : [selected.value]), (path) => (cursor) => context.origins(path.slice(prefix.length), cursor), () => context.version);
const ledger = computed(() => (selected.value === undefined ? undefined : pages.value.get(selected.value)?.state.value));
const declaration = computed(() => context.declarations.find((item) => `${prefix}${item.id}` === selected.value));
</script>

<template>
    <PanelView
        :cards="cards"
        :selected="selected"
        :ledger="ledger === undefined ? [] : originRows(ledger, declaration, context.place, text)"
        :ledger-remaining="ledger?.remaining ?? 0"
        :ledger-loading="ledger?.loading ?? true"
        :ledger-failed="ledger?.failed ?? false"
        @select="(path: string) => (context.state.selected = path)"
        @more="selected !== undefined && pages.get(selected)?.more()"
        @retry="selected !== undefined && pages.get(selected)?.retry()"
        @change="(id: string) => context.open({kind: 'change', id})"
    />
</template>
