<script setup lang="ts">
import LowCodeCheckboxField from "nbook/app/components/common/low-code-form/LowCodeCheckboxField.vue";
import LowCodeComboboxField from "nbook/app/components/common/low-code-form/LowCodeComboboxField.vue";
import LowCodeFieldShell from "nbook/app/components/common/low-code-form/LowCodeFieldShell.vue";
import LowCodeNumberField from "nbook/app/components/common/low-code-form/LowCodeNumberField.vue";
import LowCodeRadioField from "nbook/app/components/common/low-code-form/LowCodeRadioField.vue";
import LowCodeResourcePresetField from "nbook/app/components/common/low-code-form/LowCodeResourcePresetField.vue";
import LowCodeSelectField from "nbook/app/components/common/low-code-form/LowCodeSelectField.vue";
import LowCodeSwitchField from "nbook/app/components/common/low-code-form/LowCodeSwitchField.vue";
import LowCodeTextareaField from "nbook/app/components/common/low-code-form/LowCodeTextareaField.vue";
import LowCodeTextField from "nbook/app/components/common/low-code-form/LowCodeTextField.vue";
import {
    deleteLowCodePath,
    hasLowCodePath,
    readLowCodePath,
    setLowCodePath,
} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import type {
    LowCodeFieldDto,
    LowCodeFormDto,
    LowCodeFormIssueDto,
    LowCodeJsonObject,
    LowCodeJsonValue,
    LowCodeResourceMutationDto,
} from "nbook/shared/dto/low-code-form.dto";

type LowCodeFormScope = "global" | "project";
type LowCodeFormInheritanceMode = "manual" | "always-override";

const props = withDefaults(defineProps<{
    form: LowCodeFormDto;
    modelValue: LowCodeJsonObject;
    issues?: LowCodeFormIssueDto[];
    scope?: LowCodeFormScope;
    inheritanceMode?: LowCodeFormInheritanceMode;
    inheritedValue?: LowCodeJsonObject;
    overridePaths?: string[];
    resourceMutations?: LowCodeResourceMutationDto[];
    disabled?: boolean;
}>(), {
    issues: () => [],
    scope: "global",
    inheritanceMode: "manual",
    inheritedValue: () => ({}),
    overridePaths: () => [],
    resourceMutations: () => [],
    disabled: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonObject): void;
    (e: "update:overridePaths", value: string[]): void;
    (e: "update:resourceMutations", value: LowCodeResourceMutationDto[]): void;
}>();

const {t} = useI18n();

/**
 * 判断当前字段在 Project Config 中是否为覆盖态。
 */
function isOverridden(field: LowCodeFieldDto): boolean {
    if (props.inheritanceMode === "always-override") {
        return true;
    }
    return props.overridePaths.includes(field.path);
}

/**
 * 读取字段默认值；显式 null 也是有效默认值，不能用空值合并吞掉。
 */
function fieldDefaultValue(field: LowCodeFieldDto): LowCodeJsonValue | undefined {
    return hasLowCodePath(props.form.defaults, field.path)
        ? readLowCodePath(props.form.defaults, field.path)
        : field.defaultValue;
}

/**
 * 读取字段当前展示值。Project 继承态直接读取上层 effective value。
 */
function fieldValue(field: LowCodeFieldDto): LowCodeJsonValue | undefined {
    if (props.scope === "project" && !isOverridden(field)) {
        return hasLowCodePath(props.inheritedValue, field.path)
            ? readLowCodePath(props.inheritedValue, field.path)
            : fieldDefaultValue(field);
    }
    return hasLowCodePath(props.modelValue, field.path)
        ? readLowCodePath(props.modelValue, field.path)
        : fieldDefaultValue(field);
}

/**
 * 写入字段值，并在 Project scope 下自动标记为覆盖。
 */
function updateField(field: LowCodeFieldDto, value: LowCodeJsonValue): void {
    emit("update:modelValue", setLowCodePath(props.modelValue, field.path, value));
    if (props.scope === "project" && props.inheritanceMode === "manual" && !isOverridden(field)) {
        emit("update:overridePaths", [...props.overridePaths, field.path]);
    }
}

/**
 * 切换 Project 字段继承/覆盖模式。
 */
function setOverrideMode(field: LowCodeFieldDto, mode: "inherit" | "override"): void {
    if (mode === "inherit") {
        emit("update:modelValue", deleteLowCodePath(props.modelValue, field.path));
        emit("update:overridePaths", props.overridePaths.filter((path) => path !== field.path));
        emit("update:resourceMutations", props.resourceMutations.filter((mutation) => mutation.fieldPath !== field.path));
        return;
    }
    if (isOverridden(field)) {
        return;
    }
    const inherited = hasLowCodePath(props.inheritedValue, field.path)
        ? readLowCodePath(props.inheritedValue, field.path)!
        : fieldDefaultValue(field) ?? null;
    emit("update:modelValue", setLowCodePath(props.modelValue, field.path, inherited));
    emit("update:overridePaths", [...props.overridePaths, field.path]);
}

/**
 * 取字段对应的服务端 issue。
 */
function issuesForField(field: LowCodeFieldDto): LowCodeFormIssueDto[] {
    const issues = props.issues.filter((issue) => issue.path === field.path);
    return isUnavailableOptionValue(field)
        ? [...issues, {
            path: field.path,
            severity: "warning" as const,
            code: "unavailable_option",
            message: t("settings.panels.profileModels.unavailableValue"),
        }]
        : issues;
}

/**
 * 选择类字段的当前值不在 options 中时，需要显式提示。
 */
function isUnavailableOptionValue(field: LowCodeFieldDto): boolean {
    if (!["select", "combobox", "radio", "checkbox"].includes(field.component) || field.options.length === 0) {
        return false;
    }
    const value = fieldValue(field);
    if (value === undefined || value === null || value === "") {
        return false;
    }
    if (field.component === "checkbox") {
        return Array.isArray(value) && value.some((item) => !field.options.some((option) => option.value === item));
    }
    return !field.options.some((option) => option.value === value);
}

/**
 * 判断 Project patch 中是否已保存过字段。用于外部传入 overridePaths 缺失时兜底。
 */
function fieldHasPatch(field: LowCodeFieldDto): boolean {
    return hasLowCodePath(props.modelValue, field.path);
}

/**
 * 读取字段禁用状态。
 */
function fieldDisabled(field: LowCodeFieldDto): boolean {
    if (props.disabled) {
        return true;
    }
    if (props.scope === "project" && props.inheritanceMode === "manual") {
        return !isOverridden(field) && !fieldHasPatch(field);
    }
    return false;
}

function fieldResourceMutations(field: LowCodeFieldDto): LowCodeResourceMutationDto[] {
    return props.resourceMutations.filter((mutation) => mutation.fieldPath === field.path);
}

function updateFieldResourceMutations(field: LowCodeFieldDto, mutations: LowCodeResourceMutationDto[]): void {
    emit("update:resourceMutations", [
        ...props.resourceMutations.filter((mutation) => mutation.fieldPath !== field.path),
        ...mutations,
    ]);
}
</script>

<template>
    <div class="grid gap-4">
        <LowCodeFieldShell v-for="field in props.form.fields" :key="field.path" :field="field" :issues="issuesForField(field)">
            <template #actions>
                <div v-if="props.scope === 'project' && props.inheritanceMode === 'manual'" class="flex shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5">
                    <button
                        type="button"
                        class="h-6 rounded px-2 text-[11px] transition-colors"
                        :class="!isOverridden(field) ? 'bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        @click="setOverrideMode(field, 'inherit')"
                    >
                        {{ t("settings.panels.profileModels.inherit") }}
                    </button>
                    <button
                        type="button"
                        class="h-6 rounded px-2 text-[11px] transition-colors"
                        :class="isOverridden(field) ? 'bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        @click="setOverrideMode(field, 'override')"
                    >
                        {{ t("settings.panels.profileModels.override") }}
                    </button>
                </div>
            </template>

            <LowCodeTextField v-if="field.component === 'text'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeTextareaField v-else-if="field.component === 'textarea'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeNumberField v-else-if="field.component === 'number'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeSwitchField v-else-if="field.component === 'switch'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeSelectField v-else-if="field.component === 'select'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeComboboxField v-else-if="field.component === 'combobox'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeRadioField v-else-if="field.component === 'radio'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeCheckboxField v-else-if="field.component === 'checkbox'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />
            <LowCodeResourcePresetField v-else-if="field.component === 'resource-preset'" :field="field" :model-value="fieldValue(field)" :scope="props.scope" :disabled="fieldDisabled(field)" :mutations="fieldResourceMutations(field)" @update:model-value="updateField(field, $event)" @update:mutations="updateFieldResourceMutations(field, $event)" />

        </LowCodeFieldShell>
    </div>
</template>
