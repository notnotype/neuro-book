<script setup lang="ts">
/**
 * 数据分页的字段表界面（docs/specs/canon/author-ui.md 输出 12、13）：通用字段表，以及 canon 给人物交的界面（多列语义档的各句）。
 * 经 `context` 读字段与来历；展开着哪个字段记在 `context.state.open`，切走再回来还在。
 */
import {computed, shallowRef} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {ComponentViewContext} from "../component-views";
import {useOriginPagesMap} from "../origin-pages";
import {fieldRows, isSemantic, originRows, semanticNotes} from "../rows";
import {useCanonText} from "../text";
import FieldTable from "./FieldTable.vue";
import OriginList from "./OriginList.vue";
import RecordForm from "./RecordForm.vue";

const props = withDefaults(defineProps<{
    context: ComponentViewContext;
    /** 语义档的字段在值下面列出起点与之后记下的每一句（人物的界面）。 */
    semanticNotes?: boolean;
    /** 只列这几个字段（字段名）；不给时列全部（专门界面经 `context.FieldTable` 嵌一节时用）。 */
    only?: readonly string[];
}>(), {semanticNotes: false, only: undefined});

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
const semanticPaths = computed(() => (props.semanticNotes ? context.declarations.filter(isSemantic).map((declaration) => `${prefix}${declaration.id}`).filter((path) => fieldOf(path) in context.fields && shown(path)) : []));
const keys = computed(() => [...new Set([...(open.value === null ? [] : [open.value]), ...semanticPaths.value])]);
// 版本、位置、模式任一变了都重读（来历按位置算）。
const stamp = (): string => `${String(context.version)}|${JSON.stringify(context.position)}|${context.mode}`;
const pages = useOriginPagesMap(() => keys.value, (path) => (cursor) => context.origins(fieldOf(path), cursor), stamp);

const rows = computed(() => fieldRows(context.namespace, context.fields, context.declarations, context.place, text).filter((row) => shown(row.path)).map((row) => {
    const notes = semanticPaths.value.includes(row.path) ? pages.value.get(row.path)?.state.value : undefined;
    // 只列最近的一页；更早的写一句还有几步（第一批不给语义档的各句分页）。
    return notes === undefined ? row : {...row, notes: semanticNotes(notes, context.place, text), ...(notes.remaining > 0 ? {notesEarlier: notes.remaining} : {})};
}));

const openPages = computed(() => (open.value === null ? undefined : pages.value.get(open.value)));
// “改”：只在实际模式、写得了时可用；不可用时按钮上写原因（输出 16、28）。
const port = useText();
const editReason = computed(() => (context.blocked === null ? "" : port.t(context.blocked)));

const toggle = (path: string): void => {
    open.value = open.value === path ? null : path;
    recordErrors.value = {};
};

/*
 * 记一句、记一笔（输出 17）：展开着的字段是语义档或数时，来历下面一行表单，落在所选位置。别的种类在剧情里变了走“改”。
 * 填了一半的输入按字段存在分页状态里，切走再回来还在。
 */
interface RecordDraft {
    readonly delta: string;
    readonly text: string;
}
const recordable = (path: string): boolean => {
    const declaration = declarationOf(path);
    return isSemantic(declaration) || declaration?.kind === "number";
};
const drafts = computed(() => (context.state.records ?? {}) as Readonly<Record<string, RecordDraft>>);
const draftOf = (path: string): RecordDraft => drafts.value[path] ?? {delta: "", text: ""};
const setDraft = (path: string, patch: Partial<RecordDraft>): void => {
    context.state.records = {...drafts.value, [path]: {...draftOf(path), ...patch}};
    if (recordErrors.value[path] !== undefined) recordErrors.value = {...recordErrors.value, [path]: ""};
};
const recordReason = computed(() => (editReason.value !== "" ? editReason.value : context.position.kind === "initial" ? text("blocked.initial") : ""));
/** 失败的原因按字段记：保存中作者展开了别的字段，回来的原因仍写在记的那个字段下面。改了输入就清掉那个字段的。 */
const recordErrors = shallowRef<Readonly<Record<string, string>>>({});
/** 正在保存的字段。一次只记一笔：保存中展开别的字段，它的表单也是保存中。 */
const savingPath = shallowRef<string | null>(null);
const submit = async (path: string): Promise<void> => {
    if (savingPath.value !== null) return;
    savingPath.value = path;
    const draft = draftOf(path);
    const delta = Number(draft.delta.trim().replace(/,/gu, ""));
    const result = await context.record(fieldOf(path), {text: draft.text.trim(), ...(isSemantic(declarationOf(path)) ? {} : {delta})});
    savingPath.value = null;
    if (result.ok) setDraft(path, {delta: "", text: ""});
    recordErrors.value = {...recordErrors.value, [path]: result.ok ? "" : port.t(result.reason)};
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
                v-if="recordable(path)"
                class="mt-2"
                :semantic="isSemantic(declarationOf(path))"
                :delta="draftOf(path).delta"
                :text="draftOf(path).text"
                :blocked-reason="recordReason"
                :error="recordErrors[path] ?? ''"
                :saving="savingPath !== null"
                @update:delta="(value: string) => setDraft(path, {delta: value})"
                @update:text="(value: string) => setDraft(path, {text: value})"
                @submit="submit(path)"
            />
        </template>
    </FieldTable>
</template>
