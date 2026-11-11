<script setup lang="ts">
/**
 * 数据分页的字段表界面（docs/specs/canon/author-ui.md 输出 12、13）：通用字段表，以及 canon 给人物交的界面（多列语义档的各句）。
 * 经 `context` 读字段与来历；展开着哪个字段记在 `context.state.open`，切走再回来还在。
 */
import {computed} from "vue";

import type {ComponentViewContext} from "../component-views";
import {useOriginPagesMap} from "../origin-pages";
import {fieldRows, isSemantic, originRows, semanticNotes} from "../rows";
import {useCanonText} from "../text";
import FieldTable from "./FieldTable.vue";
import OriginList from "./OriginList.vue";

const props = withDefaults(defineProps<{
    context: ComponentViewContext;
    /** 语义档的字段在值下面列出起点与之后记下的每一句（人物的界面）。 */
    semanticNotes?: boolean;
}>(), {semanticNotes: false});

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

const semanticPaths = computed(() => (props.semanticNotes ? context.declarations.filter(isSemantic).map((declaration) => `${prefix}${declaration.id}`).filter((path) => fieldOf(path) in context.fields) : []));
const keys = computed(() => [...new Set([...(open.value === null ? [] : [open.value]), ...semanticPaths.value])]);
// 版本、位置、模式任一变了都重读（来历按位置算）。
const stamp = (): string => `${String(context.version)}|${JSON.stringify(context.position)}|${context.mode}`;
const pages = useOriginPagesMap(() => keys.value, (path) => (cursor) => context.origins(fieldOf(path), cursor), stamp);

const rows = computed(() => fieldRows(context.namespace, context.fields, context.declarations, context.place, text).map((row) => {
    const notes = semanticPaths.value.includes(row.path) ? pages.value.get(row.path)?.state.value : undefined;
    // 只列最近的一页；更早的写一句还有几步（第一批不给语义档的各句分页）。
    return notes === undefined ? row : {...row, notes: semanticNotes(notes, context.place, text), ...(notes.remaining > 0 ? {notesEarlier: notes.remaining} : {})};
}));

const openPages = computed(() => (open.value === null ? undefined : pages.value.get(open.value)));
const toggle = (path: string): void => {
    open.value = open.value === path ? null : path;
};
</script>

<template>
    <FieldTable :rows="rows" :open="open ?? undefined" @value="toggle">
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
        </template>
    </FieldTable>
</template>
