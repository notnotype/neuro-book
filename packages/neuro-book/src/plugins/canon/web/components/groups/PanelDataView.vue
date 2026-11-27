<script setup lang="ts">
/**
 * canon 给面板（`nbook.canon.panel`）交的数据分页界面（docs/specs/canon/author-ui.md 输出 14）：经 `context` 读字段，选中的值卡记在
 * `context.state.selected`，它的流水就是来历，经 `context.origins` 按页读。打开分页时选中第一张。
 */
import {computed, shallowRef} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {ComponentViewContext} from "../../component-views";
import {useOriginPagesMap} from "../../origin-pages";
import {fieldRows, originRows} from "../../rows";
import {useCanonText} from "../../text";
import PanelView from "./PanelView.vue";
import RecordForm from "../editing/RecordForm.vue";

const props = defineProps<{context: ComponentViewContext}>();

const text = useCanonText();
const context = props.context;
const prefix = `${context.namespace}.`;

const cards = computed(() => fieldRows(context.namespace, context.fields, context.declarations, context.place, text));
const selected = computed(() => {
    const chosen = context.state.selected;
    return typeof chosen === "string" && cards.value.some((card) => card.path === chosen) ? chosen : cards.value[0]?.path;
});
// 版本、位置、模式任一变了都重读（流水按位置算）。
const stamp = (): string => `${String(context.version)}|${JSON.stringify(context.position)}|${context.mode}`;
const pages = useOriginPagesMap(() => (selected.value === undefined ? [] : [selected.value]), (path) => (cursor) => context.origins(path.slice(prefix.length), cursor), stamp);
const ledger = computed(() => (selected.value === undefined ? undefined : pages.value.get(selected.value)?.state.value));
const declaration = computed(() => context.declarations.find((item) => `${prefix}${item.id}` === selected.value));

const port = useText();
const editReason = computed(() => (context.blocked === null ? "" : port.t(context.blocked)));

/* 记一笔（输出 17）：填了一半的输入在分页状态里，切走再回来还在；原因与保存中随组件。 */
interface RecordDraft {
    delta: string;
    text: string;
}
const draft = computed<RecordDraft>(() => {
    const given = context.state.record as RecordDraft | undefined;
    return given ?? {delta: "", text: ""};
});
const setDraft = (patch: Partial<RecordDraft>): void => {
    context.state.record = {...draft.value, ...patch};
};
// 按计划、写不了的原因在 `blocked` 里；初值上不能记（记一笔落在所选位置，输出 17）。
const recordReason = computed(() => (editReason.value !== "" ? editReason.value : context.position.kind === "initial" ? text("blocked.initial") : ""));
const recordError = shallowRef("");
const saving = shallowRef(false);
const submit = async (): Promise<void> => {
    const path = selected.value;
    if (path === undefined || saving.value) return;
    saving.value = true;
    const delta = Number(draft.value.delta.trim().replace(/,/gu, ""));
    const result = await context.record(path.slice(prefix.length), {text: draft.value.text.trim(), ...(declaration.value?.precision === "semantic" ? {} : {delta})});
    saving.value = false;
    if (result.ok) {
        context.state.record = {delta: "", text: ""};
        recordError.value = "";
    } else recordError.value = port.t(result.reason);
};
</script>

<template>
    <PanelView
        :cards="cards"
        :selected="selected"
        :ledger="ledger === undefined ? [] : originRows(ledger, declaration, context.place, text)"
        :ledger-remaining="ledger?.remaining ?? 0"
        :ledger-loading="ledger?.loading ?? true"
        :ledger-failed="ledger?.failed ?? false"
        :ledger-reason="ledger?.reason ?? ''"
        @select="(path: string) => (context.state.selected = path)"
        @more="selected !== undefined && pages.get(selected)?.more()"
        @retry="selected !== undefined && pages.get(selected)?.retry()"
        editing
        :edit-reason="editReason"
        @change="(id: string) => context.open({kind: 'change', id})"
        @edit="(path: string) => context.edit(path.slice(prefix.length))"
    >
        <template #record>
            <RecordForm
                :semantic="declaration?.precision === 'semantic'"
                :delta="draft.delta"
                :text="draft.text"
                :blocked-reason="recordReason"
                :error="recordError"
                :saving="saving"
                @update:delta="(value: string) => setDraft({delta: value})"
                @update:text="(value: string) => setDraft({text: value})"
                @submit="submit()"
            />
        </template>
    </PanelView>
</template>
