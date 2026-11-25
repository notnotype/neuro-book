<script setup lang="ts">
/**
 * 数据分页的字段表界面（docs/specs/canon/author-ui.md 输出 12、13）：通用字段表。
 * 经 `context` 读字段与来历；展开着哪个字段记在 `context.state.open`，切走再回来还在。来历与记一笔是 `useFieldDetail`（与专门
 * 界面的 `FieldDetail` 同一份）。
 */
import {computed} from "vue";

import type {ComponentViewContext} from "../component-views";
import {useFieldDetail} from "../field-detail";
import {fieldRows, isSemantic, originRows} from "../rows";
import {useCanonText} from "../text";
import FieldTable from "./FieldTable.vue";
import OriginList from "./OriginList.vue";
import RecordForm from "./RecordForm.vue";

const props = withDefaults(defineProps<{
    context: ComponentViewContext;
    /** 只列这几个字段（字段名）；不给时列全部（专门界面经 `context.FieldTable` 嵌一节时用）。 */
    only?: readonly string[];
}>(), {only: undefined});

const text = useCanonText();
const context = props.context;
const prefix = `${context.namespace}.`;
const fieldOf = (path: string): string => path.slice(prefix.length);
const declarationOf = (path: string) => context.declarations.find((declaration) => declaration.id === fieldOf(path));

const open = computed<string | null>({
    get: () => (typeof context.state.open === "string" ? context.state.open : null),
    set: (value) => {
        context.state.open = value;
    },
});

const shown = (path: string): boolean => props.only === undefined || props.only.includes(fieldOf(path));
const keys = computed(() => (open.value === null ? [] : [open.value]));
const detail = useFieldDetail(context, () => keys.value);
const {pages, editReason, recordReason, recordErrors, savingPath} = detail;

const rows = computed(() => fieldRows(context.namespace, context.fields, context.declarations, context.place, text).filter((row) => shown(row.path)));

const openPages = computed(() => (open.value === null ? undefined : pages.value.get(open.value)));

const toggle = (path: string): void => {
    open.value = open.value === path ? null : path;
    detail.clearErrors();
};
</script>

<template>
    <FieldTable
        :rows="rows"
        :open="open ?? undefined"
        editing
        :edit-reason="editReason"
        @value="toggle"
        @edit="(path: string) => context.edit(fieldOf(path))"
        @add-element="(path: string) => context.listAdd?.(fieldOf(path))"
        @edit-element="(path: string, element: string) => context.listEdit?.(fieldOf(path), element)"
        @remove-element="(path: string, element: string) => context.listRemove?.(fieldOf(path), element)"
    >
        <template #origin="{path}">
            <OriginList
                v-if="openPages !== undefined"
                :caption="text('origin.caption', {label: rows.find((row) => row.path === path)?.label ?? path})"
                :rows="originRows(openPages.state.value, declarationOf(path), context.place, text)"
                :remaining="openPages.state.value.remaining"
                :loading="openPages.state.value.loading"
                :failed="openPages.state.value.failed"
                :reason="openPages.state.value.reason"
                @more="openPages.more()"
                @retry="openPages.retry()"
                @change="(id: string) => context.open({kind: 'change', id})"
            />
            <RecordForm
                v-if="detail.recordable(path)"
                class="mt-2"
                :semantic="isSemantic(declarationOf(path))"
                :delta="detail.draftOf(path).delta"
                :text="detail.draftOf(path).text"
                :blocked-reason="recordReason"
                :error="recordErrors[path] ?? ''"
                :saving="savingPath !== null"
                @update:delta="(value: string) => detail.setDraft(path, {delta: value})"
                @update:text="(value: string) => detail.setDraft(path, {text: value})"
                @submit="detail.submit(path)"
            />
        </template>
    </FieldTable>
</template>
