<script setup lang="ts">
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import WorldEngineWorkbenchPreviewValueInput from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewValueInput.vue";
import type {
    SubjectStateDto,
    WorldSlicePatchDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSubject,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";
import type {WorldPatchOp} from "nbook/app/utils/world-engine-preview";

type PatchEditorRow = {
    canMoveDown: boolean;
    canMoveUp: boolean;
    dirty: boolean;
    highlighted: boolean;
    index: number;
    mutation: WorldSlicePatchDto;
    opOptions: WorldPatchOp[];
    rowKey: string;
    valueDraft: string;
};

const props = withDefaults(defineProps<{
    busy?: boolean;
    canAdd?: boolean;
    dirty: boolean;
    emptyText?: string;
    error?: string;
    pathOptions: SelectOption[];
    rows: PatchEditorRow[];
    schema: WorldWorkbenchPreviewSchema;
    snapshotSubjects: SubjectStateDto[];
    subjects: WorldWorkbenchPreviewSubject[];
    totalPatchCount: number;
}>(), {
    busy: false,
    canAdd: false,
    emptyText: "当前 subject 在此切片没有 mutation",
    error: "",
});

const emit = defineEmits<{
    (e: "append"): void;
    (e: "delete", index: number): void;
    (e: "duplicate", index: number): void;
    (e: "move", index: number, direction: "up" | "down"): void;
    (e: "reset"): void;
    (e: "save"): void;
    (e: "submit"): void;
    (e: "update-op", index: number, value: string): void;
    (e: "update-path", index: number, value: string): void;
    (e: "update-summary", index: number, value: string): void;
    (e: "update-value", index: number, value: string): void;
}>();

/** 将 op 列表转成项目通用 select 的选项。 */
function opSelectOptions(row: PatchEditorRow): SelectOption[] {
    return row.opOptions.map((op) => ({
        label: op,
        value: op,
    }));
}

/** 从原生输入事件读取字符串值。 */
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
}
</script>

<template>
    <!-- 当前 subject 的 patch 编辑器：主行编辑 patch 字段，次行编辑 summary -->
    <div class="flex min-h-0 flex-1 flex-col">
        <div class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
                <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">本切片变更</span>
                <span v-if="props.dirty" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--we-warning)]">patch draft</span>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !props.canAdd" title="新增当前 subject 的 patch" @click="emit('append')">
                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                    新增
                </button>
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 text-[11px] font-medium text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !props.dirty" title="保存本切片 mutations" @click="emit('save')">
                    <span class="i-lucide-save h-3.5 w-3.5"></span>
                    保存
                </button>
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !props.dirty" title="还原本切片 mutations" @click="emit('reset')">
                    <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                    还原
                </button>
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-2 custom-scrollbar pr-1">
            <article
                v-for="row in props.rows"
                :key="row.rowKey"
                :data-mutation-index="row.index"
                data-testid="mutation-editor-row"
                class="flex flex-col gap-2 rounded-md border border-[var(--we-border)] p-2.5 text-[11px] transition-colors"
                :class="row.highlighted ? 'bg-[var(--we-warning-soft)] border-[var(--we-warning)]' : row.dirty ? 'bg-[var(--we-bg-active)]' : 'bg-[var(--we-bg-panel)]'"
            >
                <div class="flex items-start justify-between gap-2">
                    <div class="flex min-w-0 flex-1 items-start gap-2">
                        <label class="min-w-0 flex-1">
                            <Combobox :model-value="row.mutation.path" :options="props.pathOptions" placeholder="/hp" :disabled="props.busy" size="sm" @update:model-value="emit('update-path', row.index, $event ?? '')" />
                        </label>
                        <label class="min-w-0 w-[104px] shrink-0">
                            <FormSelect :model-value="row.mutation.op" :options="opSelectOptions(row)" :disabled="props.busy" size="sm" dropdown-direction="auto" hide-checkmark @update:model-value="emit('update-op', row.index, $event)" />
                        </label>
                    </div>

                    <div class="mt-0.5 flex shrink-0 items-center justify-end gap-0.5">
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-40" title="上移 patch" :disabled="props.busy || !row.canMoveUp" @click="emit('move', row.index, 'up')">
                            <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-40" title="下移 patch" :disabled="props.busy || !row.canMoveDown" @click="emit('move', row.index, 'down')">
                            <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-accent-strong)] disabled:opacity-40" title="复制 patch" :disabled="props.busy" @click="emit('duplicate', row.index)">
                            <span class="i-lucide-copy h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-danger)] disabled:opacity-40" title="删除 patch" :disabled="props.busy || props.totalPatchCount <= 1" @click="emit('delete', row.index)">
                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>

                <div class="min-w-0">
                    <WorldEngineWorkbenchPreviewValueInput
                        :model-value="row.valueDraft"
                        :mutation="row.mutation"
                        :schema="props.schema"
                        :snapshot-subjects="props.snapshotSubjects"
                        :subjects="props.subjects"
                        @update:model-value="emit('update-value', row.index, $event)"
                        @submit="emit('submit')"
                    />
                </div>

                <label class="flex h-7 min-w-0 items-center gap-2 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 transition-colors focus-within:border-[var(--we-accent-border)] focus-within:bg-[var(--we-bg-panel)]">
                    <span class="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--we-text-muted)]">
                        <span>summary</span>
                        <span v-if="row.dirty" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1 py-0 text-[9px] normal-case tracking-normal text-[var(--we-warning)]">dirty</span>
                        <span v-if="row.highlighted" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1 py-0 text-[9px] normal-case tracking-normal text-[var(--we-warning)]">issue target</span>
                    </span>
                    <input :value="row.mutation.summary ?? ''" class="h-full w-full min-w-0 bg-transparent text-[11px] text-[var(--we-text-main)] outline-none disabled:opacity-60" placeholder="本次 patch 的人话说明" :disabled="props.busy" @input="emit('update-summary', row.index, inputValue($event))">
                </label>
            </article>
            <div v-if="!props.rows.length" class="px-3 py-6 text-center text-[12px] text-[var(--we-text-muted)]">{{ props.emptyText }}</div>
        </div>
        <div v-if="props.error" class="mt-2 shrink-0 rounded bg-[var(--we-danger-soft)] px-2 py-1 text-[11px] text-[var(--we-danger)]">{{ props.error }}</div>
    </div>
</template>
