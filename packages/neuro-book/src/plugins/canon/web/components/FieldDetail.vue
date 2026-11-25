<script setup lang="ts">
/**
 * 一个值的细节（同名 .md）：语义档是起点、各句、记一句与改起点；别的字段是来历（数另可记一笔）。经 `context` 读写，逻辑在
 * `useFieldDetail`，与通用字段表同一份。
 */
import {computed} from "vue";

import {Button} from "@notnotype/nb-ui/components";

import type {ComponentViewContext} from "../component-views";
import {useFieldDetail} from "../field-detail";
import {isSemantic, originRows, semanticNotes} from "../rows";
import {useCanonText} from "../text";
import OriginList from "./OriginList.vue";
import RecordForm from "./RecordForm.vue";

const props = defineProps<{
    context: ComponentViewContext;
    path: string;
}>();

const text = useCanonText();
const context = props.context;
const full = computed(() => `${context.namespace}.${props.path}`);
const declaration = computed(() => context.declarations.find((item) => item.id === props.path));
const semantic = computed(() => isSemantic(declaration.value));
const detail = useFieldDetail(context, () => [full.value]);
const page = computed(() => detail.pages.value.get(full.value));
const notes = computed(() => (page.value === undefined ? [] : semanticNotes(page.value.state.value, context.place, text) ?? []));
const label = computed(() => declaration.value?.label ?? props.path);
</script>

<template>
    <div class="min-w-0 text-[length:var(--text-sm)]" :data-field-detail="full">
        <template v-if="semantic">
            <ol class="m-0 list-none p-0" :aria-label="text('origin.caption', {label})">
                <li v-if="(page?.state.value.remaining ?? 0) > 0" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("fields.notesMore", {count: page?.state.value.remaining ?? 0}) }}</li>
                <li v-for="(note, index) in notes" :key="index" class="py-0.5"><span class="mr-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ note.where }}</span>{{ note.text }}</li>
            </ol>
            <p v-if="page?.state.value.failed === true" role="alert" class="text-[var(--status-danger)]">{{ text("origin.failed") }}</p>
            <RecordForm
                class="mt-2"
                semantic
                :delta="detail.draftOf(full).delta"
                :text="detail.draftOf(full).text"
                :blocked-reason="detail.recordReason.value"
                :error="detail.recordErrors.value[full] ?? ''"
                :saving="detail.savingPath.value !== null"
                @update:text="(value: string) => detail.setDraft(full, {text: value})"
                @submit="detail.submit(full)"
            />
            <Button size="sm" variant="ghost" :disabled="detail.editReason.value !== ''" :title="detail.editReason.value || undefined" :data-edit="full" @click="context.edit(props.path, {inline: true})">{{ text("detail.editAnchor") }}</Button>
        </template>
        <template v-else>
            <OriginList
                v-if="page !== undefined"
                :caption="text('origin.caption', {label})"
                :rows="originRows(page.state.value, declaration, context.place, text)"
                :remaining="page.state.value.remaining"
                :loading="page.state.value.loading"
                :failed="page.state.value.failed"
                :reason="page.state.value.reason"
                @more="page.more()"
                @retry="page.retry()"
                @change="(id: string) => context.open({kind: 'change', id})"
            />
            <RecordForm
                v-if="detail.recordable(full)"
                class="mt-2"
                :delta="detail.draftOf(full).delta"
                :text="detail.draftOf(full).text"
                :blocked-reason="detail.recordReason.value"
                :error="detail.recordErrors.value[full] ?? ''"
                :saving="detail.savingPath.value !== null"
                @update:delta="(value: string) => detail.setDraft(full, {delta: value})"
                @update:text="(value: string) => detail.setDraft(full, {text: value})"
                @submit="detail.submit(full)"
            />
        </template>
    </div>
</template>
