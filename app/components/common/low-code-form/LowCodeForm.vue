<script setup lang="ts">
import LowCodeCheckboxField from "nbook/app/components/common/low-code-form/LowCodeCheckboxField.vue";
import LowCodeComboboxField from "nbook/app/components/common/low-code-form/LowCodeComboboxField.vue";
import LowCodeFieldShell from "nbook/app/components/common/low-code-form/LowCodeFieldShell.vue";
import LowCodeNumberField from "nbook/app/components/common/low-code-form/LowCodeNumberField.vue";
import LowCodePromptListField from "nbook/app/components/common/low-code-form/LowCodePromptListField.vue";
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
const presetName = ref("");

type StoredProfilePreset = {
    id: string;
    name: string;
    settingsJson: string;
    updatedAt: string;
};

/** 读取当前表单内保存的整套 Profile 预设。 */
function storedPresets(): StoredProfilePreset[] {
    const storagePath = props.form.presets?.storagePath;
    const raw = storagePath ? readLowCodePath(props.modelValue, storagePath) : undefined;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [];
        }
        if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.settingsJson !== "string" || typeof value.updatedAt !== "string") {
            return [];
        }
        return [{id: value.id, name: value.name, settingsJson: value.settingsJson, updatedAt: value.updatedAt}];
    });
}

/** 当前激活的 Profile 预设 id；空串表示自定义草稿。 */
function activePresetId(): string {
    const path = props.form.presets?.activePath;
    const value = path ? readLowCodePath(props.modelValue, path) : undefined;
    return typeof value === "string" ? value : "";
}

/** 生成预设快照，排除预设自身的存储字段。 */
function presetSnapshot(): LowCodeJsonObject {
    const meta = props.form.presets;
    if (!meta) {
        return {};
    }
    const excluded = new Set([meta.storagePath, meta.activePath, ...meta.excludedPaths]);
    return Object.fromEntries(Object.entries(props.modelValue).filter(([path]) => !excluded.has(path)));
}

/** 新建或覆盖同名的整套 Profile 设置预设。 */
function savePreset(): void {
    const meta = props.form.presets;
    const name = presetName.value.trim();
    if (!meta || !name || props.disabled) {
        return;
    }
    const existing = storedPresets().find((preset) => preset.name === name);
    const preset: StoredProfilePreset = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        settingsJson: JSON.stringify(presetSnapshot()),
        updatedAt: new Date().toISOString(),
    };
    const presets = [...storedPresets().filter((item) => item.id !== preset.id), preset];
    let next = setLowCodePath(props.modelValue, meta.storagePath, presets);
    next = setLowCodePath(next, meta.activePath, preset.id);
    emit("update:modelValue", next);
    emit("update:overridePaths", [...new Set([...props.overridePaths, meta.storagePath, meta.activePath])]);
    presetName.value = preset.name;
}

/** 应用预设快照；缺损预设保持当前设置不变。 */
function applyPreset(id: string): void {
    const meta = props.form.presets;
    if (!meta || props.disabled) {
        return;
    }
    if (!id) {
        emit("update:modelValue", setLowCodePath(props.modelValue, meta.activePath, ""));
        return;
    }
    const preset = storedPresets().find((item) => item.id === id);
    if (!preset) {
        return;
    }
    let snapshot: LowCodeJsonObject;
    try {
        const parsed = JSON.parse(preset.settingsJson) as LowCodeJsonValue;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return;
        }
        snapshot = parsed as LowCodeJsonObject;
    } catch {
        return;
    }
    const preservedPresets = storedPresets();
    let next = {...props.modelValue, ...snapshot};
    next = setLowCodePath(next, meta.storagePath, preservedPresets);
    next = setLowCodePath(next, meta.activePath, id);
    emit("update:modelValue", next);
    emit("update:overridePaths", [...new Set([...props.overridePaths, ...Object.keys(snapshot), meta.storagePath, meta.activePath])]);
    presetName.value = preset.name;
}

/** 删除当前预设，不改变已经应用到表单的设置值。 */
function removePreset(): void {
    const meta = props.form.presets;
    const activeId = activePresetId();
    if (!meta || !activeId || props.disabled) {
        return;
    }
    let next = setLowCodePath(props.modelValue, meta.storagePath, storedPresets().filter((preset) => preset.id !== activeId));
    next = setLowCodePath(next, meta.activePath, "");
    emit("update:modelValue", next);
    presetName.value = "";
}

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

/** 连续相同 section 只渲染一次标题；无 section 的普通表单保持原布局。 */
function startsSection(field: LowCodeFieldDto, index: number): boolean {
    if (!field.section) return false;
    return props.form.fields[index - 1]?.section?.key !== field.section.key;
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
        <!-- 整套 Profile 设置预设 -->
        <div v-if="props.form.presets" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/25 p-3">
            <div class="mb-2 text-xs font-semibold text-[var(--text-main)]">设置预设</div>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                <select :value="activePresetId()" :disabled="props.disabled" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)]" @change="applyPreset(($event.target as HTMLSelectElement).value)">
                    <option value="">自定义草稿</option>
                    <option v-for="preset in storedPresets()" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
                </select>
                <input v-model="presetName" :disabled="props.disabled" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-main)]" placeholder="预设名称" />
                <button type="button" class="h-8 rounded-md bg-[var(--accent)] px-3 text-xs text-[var(--text-on-accent)] disabled:opacity-50" :disabled="props.disabled || !presetName.trim()" @click="savePreset">创建/更新预设草稿</button>
                <button type="button" class="h-8 rounded-md border border-[var(--status-danger-border)] px-3 text-xs text-[var(--status-danger)] disabled:opacity-40" :disabled="props.disabled || !activePresetId()" @click="removePreset">删除</button>
            </div>
            <p class="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">预设包含提示词条目与本 Profile 特色设置，不包含模型参数和运行策略。创建或更新后仍需点击页面顶部“保存设定”才能持久化。</p>
        </div>
        <!-- Profile 表单字段按服务端声明分区，分区本身不参与 settings 存储 -->
        <template v-for="(field, index) in props.form.fields" :key="field.path">
            <div v-if="startsSection(field, index)" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                <div class="text-xs font-semibold text-[var(--text-main)]">{{ field.section?.label }}</div>
                <p v-if="field.section?.description" class="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{{ field.section.description }}</p>
            </div>
            <LowCodeFieldShell :field="field" :issues="issuesForField(field)">
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
            <LowCodePromptListField v-else-if="field.component === 'prompt-list'" :field="field" :model-value="fieldValue(field)" :disabled="fieldDisabled(field)" @update:model-value="updateField(field, $event)" />

            </LowCodeFieldShell>
        </template>
    </div>
</template>
