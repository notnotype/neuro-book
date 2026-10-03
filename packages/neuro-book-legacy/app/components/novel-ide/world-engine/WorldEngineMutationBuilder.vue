<script setup lang="ts">
import WorldEngineMutationActionButtons from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationActionButtons.vue";
import WorldEngineMutationListControls from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationListControls.vue";
import WorldEngineObjectValueEditor from "nbook/app/components/novel-ide/world-engine/WorldEngineObjectValueEditor.vue";
import {type WorldMutationOp, type WorldPreviewSchemaAttr} from "nbook/app/utils/world-engine-preview";
import type {SubjectStateDto, WorldSubjectDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

type BuilderValueMode = "hidden" | "number" | "boolean" | "enum" | "ref" | "object" | "json" | "text";
type MutationBuilderModel = {
    subjectId: string;
    path: string;
    op: WorldMutationOp;
    value: string;
};
type ObjectBuilderRow = {
    key: string;
    value: string;
    enabled: boolean;
};

const props = defineProps<{
    disabled?: boolean;
    builder: MutationBuilderModel;
    subjects: WorldSubjectDto[];
    selectedSubjectTypeLabel: string;
    builderAttrs: WorldPreviewSchemaAttr[];
    builderHasSchemaAttr: boolean;
    builderOpOptions: WorldMutationOp[];
    builderValueHint: string;
    builderValueMode: BuilderValueMode;
    enumValueOptions: Array<{label: string; value: string}>;
    refValueOptions: Array<{label: string; value: string}>;
    objectBuilderRows: ObjectBuilderRow[];
    objectHasFixedFields: boolean;
    objectFieldValueMode: (rowKey: string) => BuilderValueMode;
    objectFieldEnumOptions: (rowKey: string) => Array<{label: string; value: string}>;
    objectFieldRefOptions: (rowKey: string) => Array<{label: string; value: string}>;
    mutationLoadOptions: Array<{label: string; value: string}>;
    mutationLoadIndex: string;
    stateResult: SubjectStateDto[];
    addMutationAction?: (mode: "append" | "replace") => void;
    deleteSelectedMutationAction?: () => void;
    duplicateSelectedMutationAction?: () => void;
    insertAfterSelectedMutationAction?: () => void;
    replaceSelectedMutationAction?: () => void;
    updateBuilderFieldAction?: (field: keyof MutationBuilderModel, value: string) => void;
}>();

const emit = defineEmits<{
    (e: "update-builder-field", field: keyof MutationBuilderModel, value: string): void;
    (e: "update-object-row", index: number, patch: Partial<ObjectBuilderRow>): void;
    (e: "update-mutation-load-index", value: string): void;
    (e: "add-object-row"): void;
    (e: "remove-object-row", index: number): void;
    (e: "load-mutation", index: number): void;
    (e: "add-mutation", mode: "append" | "replace"): void;
    (e: "insert-after-selected-mutation"): void;
    (e: "duplicate-selected-mutation"): void;
    (e: "replace-selected-mutation"): void;
    (e: "delete-selected-mutation"): void;
    (e: "move-selected-mutation", direction: "up" | "down"): void;
}>();

/** 读取原生表单事件里的字符串值，避免模板里重复类型断言。 */
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
}

/** 更新 Builder 字段；真实 Workbench 优先走函数 prop，保留 emit 给 mock/旧入口。 */
function updateBuilderField(field: keyof MutationBuilderModel, value: string): void {
    if (props.updateBuilderFieldAction) {
        props.updateBuilderFieldAction(field, value);
        return;
    }
    emit("update-builder-field", field, value);
}

function attrPath(name: string): string {
    return `/${name.split(".").filter(Boolean).map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}
</script>

<template>
    <!-- Mutation Builder 表单 -->
    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
        <fieldset class="m-0 border-0 p-0 disabled:opacity-70" :disabled="props.disabled">
            <div class="mb-2 flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Mutation Builder</div>
                    <span class="shrink-0 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">{{ builderValueHint }}</span>
                </div>
                <WorldEngineMutationListControls
                    :disabled="props.disabled"
                    :selected-subject-type-label="selectedSubjectTypeLabel"
                    :mutation-load-options="mutationLoadOptions"
                    :mutation-load-index="mutationLoadIndex"
                    @update-mutation-load-index="emit('update-mutation-load-index', $event)"
                    @load-mutation="emit('load-mutation', $event)"
                    @move-selected-mutation="emit('move-selected-mutation', $event)"
                />
            </div>
            <div class="grid grid-cols-2 gap-2">
                <select :value="builder.subjectId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('subjectId', inputValue($event))">
                    <option v-for="subject in subjects" :key="`builder:${subject.id}`" :value="subject.id">{{ subject.id }} · {{ subject.type }}</option>
                </select>
                <select :value="builder.path" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('path', inputValue($event))">
                    <option v-if="builder.path && !builderHasSchemaAttr" :value="builder.path">自定义 · {{ builder.path }}</option>
                    <option v-for="attr in builderAttrs" :key="`builder-attr:${attr.name}`" :value="attrPath(attr.name)">{{ attr.name }}</option>
                </select>
                <input :value="builder.path" list="world-engine-builder-attrs" class="col-span-2 h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 font-mono text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="JSON Pointer path, e.g. /equipment/weapon /memory/师门" @input="updateBuilderField('path', inputValue($event))">
                <datalist id="world-engine-builder-attrs">
                    <option v-for="attr in builderAttrs" :key="`builder-attr-option:${attr.name}`" :value="attrPath(attr.name)"></option>
                </datalist>
                <select :value="builder.op" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('op', inputValue($event))">
                    <option v-for="op in builderOpOptions" :key="op" :value="op">{{ op }}</option>
                </select>
                <input v-if="builderValueMode === 'number'" :value="builder.value" type="number" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="value" @input="updateBuilderField('value', inputValue($event))">
                <select v-else-if="builderValueMode === 'boolean'" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('value', inputValue($event))">
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
                <select v-else-if="builderValueMode === 'enum'" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('value', inputValue($event))">
                    <option v-for="option in enumValueOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <select v-else-if="builderValueMode === 'ref' && refValueOptions.length" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" @change="updateBuilderField('value', inputValue($event))">
                    <option v-for="option in refValueOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input v-else-if="builderValueMode === 'ref'" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="subject://" @input="updateBuilderField('value', inputValue($event))">
                <WorldEngineObjectValueEditor
                    v-else-if="builderValueMode === 'object'"
                    :builder-value="builder.value"
                    :object-builder-rows="objectBuilderRows"
                    :object-has-fixed-fields="objectHasFixedFields"
                    :object-field-value-mode="objectFieldValueMode"
                    :object-field-enum-options="objectFieldEnumOptions"
                    :object-field-ref-options="objectFieldRefOptions"
                    @update-object-row="(index, patch) => emit('update-object-row', index, patch)"
                    @add-object-row="emit('add-object-row')"
                    @remove-object-row="emit('remove-object-row', $event)"
                />
                <textarea v-else-if="builderValueMode === 'json'" :value="builder.value" rows="4" class="col-span-2 min-h-[96px] resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 font-mono text-[12px] leading-5 outline-none focus:border-[var(--accent-main)]" placeholder="{&quot;key&quot;: &quot;value&quot;}" title="当前 value 需要填写 JSON object" @input="updateBuilderField('value', inputValue($event))"></textarea>
                <input v-else-if="builderValueMode === 'text'" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)]" placeholder="value" @input="updateBuilderField('value', inputValue($event))">
                <input v-else class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] opacity-50 outline-none" disabled placeholder="remove">
            </div>
            <WorldEngineMutationActionButtons
                :disabled="props.disabled"
                :can-use-selected-mutation="Boolean(mutationLoadOptions.length)"
                :add-mutation-action="props.addMutationAction"
                :delete-selected-mutation-action="props.deleteSelectedMutationAction"
                :duplicate-selected-mutation-action="props.duplicateSelectedMutationAction"
                :insert-after-selected-mutation-action="props.insertAfterSelectedMutationAction"
                :replace-selected-mutation-action="props.replaceSelectedMutationAction"
                @add-mutation="emit('add-mutation', $event)"
                @insert-after-selected-mutation="emit('insert-after-selected-mutation')"
                @duplicate-selected-mutation="emit('duplicate-selected-mutation')"
                @replace-selected-mutation="emit('replace-selected-mutation')"
                @delete-selected-mutation="emit('delete-selected-mutation')"
            />
        </fieldset>
    </div>
</template>
