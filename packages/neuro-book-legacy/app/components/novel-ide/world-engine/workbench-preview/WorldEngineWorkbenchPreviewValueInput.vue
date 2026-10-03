<script setup lang="ts">
import {computed} from "vue";
import FormNumberInput from "nbook/app/components/common/form/FormNumberInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldSlicePatchDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import {formatWorkbenchPreviewValue} from "nbook/app/utils/world-engine-workbench-preview-value";
import type {
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSubject,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type PreviewSchemaAttr = WorldWorkbenchPreviewSchema["subjectTypes"][number]["attrs"][number];
type ValueInputKind = "boolean" | "enum" | "hidden" | "json" | "number" | "ref" | "text";

const props = defineProps<{
    modelValue: string;
    mutation: WorldSlicePatchDto;
    schema: WorldWorkbenchPreviewSchema;
    snapshotSubjects: SubjectStateDto[];
    subjects: WorldWorkbenchPreviewSubject[];
}>();

const emit = defineEmits<{
    (e: "submit"): void;
    (e: "update:modelValue", value: string): void;
}>();

const draft = computed({
    get: () => props.modelValue,
    set: (value: string) => emit("update:modelValue", value),
});
const attrSchema = computed(() => resolveAttrSchema(props.mutation));
const inputKind = computed<ValueInputKind>(() => resolveInputKind(props.mutation, attrSchema.value));
const booleanOptions: SelectOption[] = [
    {label: "true", value: "true"},
    {label: "false", value: "false"},
];
const refSubjects = computed(() => {
    const refType = refSubjectType(attrSchema.value?.type ?? attrSchema.value?.itemType);
    if (!refType) {
        return [];
    }
    return props.subjects.filter((subject) => subject.type === refType);
});
const refOptions = computed<SelectOption[]>(() => [
    {label: "空值", value: ""},
    ...refSubjects.value.map((subject) => ({
        label: subject.name || subject.id,
        value: `subject://${subject.id}`,
        description: subject.id,
    })),
]);
const enumOptions = computed<SelectOption[]>(() => (attrSchema.value?.enum ?? []).map((value) => ({
    label: formatWorkbenchPreviewValue(value),
    value: formatWorkbenchPreviewValue(value),
})));

/** 根据 mutation 的 subject type 和 JSON Pointer path 找到对应 schema attr。 */
function resolveAttrSchema(mutation: WorldSlicePatchDto): PreviewSchemaAttr | null {
    const subject = props.subjects.find((item) => item.id === mutation.subjectId);
    const subjectType = props.schema.subjectTypes.find((item) => item.type === subject?.type);
    const [rootAttr, ...nestedAttrs] = pathToAttr(mutation.path).split(".").filter(Boolean);
    let attr = subjectType?.attrs.find((item) => item.name === rootAttr) ?? null;
    for (const nestedAttr of nestedAttrs) {
        const nextAttr = attr?.fields?.[nestedAttr] ?? null;
        if (!nextAttr) {
            break;
        }
        attr = nextAttr;
    }
    return attr;
}

/** 根据 schema attr 和当前 value 选择最贴近语义的编辑控件。 */
function resolveInputKind(mutation: WorldSlicePatchDto, attr: PreviewSchemaAttr | null): ValueInputKind {
    if (mutation.op === "remove") {
        return "hidden";
    }
    if (attr?.enum?.length) {
        return "enum";
    }
    if (attr?.kind === "object" && !attr.itemType) {
        return "json";
    }
    if (mutation.value && typeof mutation.value === "object") {
        return "json";
    }
    const valueType = attr?.type ?? attr?.itemType;
    if (valueType === "bool") {
        return "boolean";
    }
    if (valueType === "int" || valueType === "float" || typeof mutation.value === "number") {
        return "number";
    }
    if (refSubjectType(valueType)) {
        return "ref";
    }
    return "text";
}

/** 从 ref(location) 这类 schema type 中解析目标 subject type。 */
function refSubjectType(valueType: string | undefined): string {
    return valueType?.match(/^ref\((.+)\)$/)?.[1] ?? "";
}

function pathToAttr(path: string): string {
    if (!path.startsWith("/")) {
        return path;
    }
    return path.slice(1).split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).join(".");
}

</script>

<template>
    <!-- World Engine Workbench value 输入：按 schema 选择控件 -->
    <FormSelect
        v-if="inputKind === 'boolean'"
        v-model="draft"
        :options="booleanOptions"
        size="sm"
    />
    <input v-else-if="inputKind === 'hidden'" class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-muted)] px-2 font-mono text-[11px] text-[var(--we-text-muted)] opacity-70" disabled value="remove">
    <FormSelect
        v-else-if="inputKind === 'ref'"
        v-model="draft"
        :options="refOptions"
        size="sm"
    />
    <FormSelect
        v-else-if="inputKind === 'enum'"
        v-model="draft"
        :options="enumOptions"
        size="sm"
    />
    <FormNumberInput
        v-else-if="inputKind === 'number'"
        v-model="draft"
        :step="attrSchema?.type === 'float' ? '0.1' : '1'"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        size="sm"
        @submit="emit('submit')"
    />
    <textarea
        v-else-if="inputKind === 'json'"
        v-model="draft"
        class="min-h-16 w-full min-w-0 resize-y rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        @keydown.ctrl.enter.prevent="emit('submit')"
    ></textarea>
    <input
        v-else
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        @keydown.enter.prevent="emit('submit')"
    >
</template>
