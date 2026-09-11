<script setup lang="ts">
import {computed} from "vue";
import {FormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

/**
 * 模型下拉。零件用 nb-ui 的 `FormSelect`——设置界面里的下拉必须是同一套外观，
 * 这里换掉旧 app 的 FormSelect 就是为了这一条（旧的那套只在这一处还能看到）。
 */

const DEFAULT_OPTION_VALUE = "__follow_default__";

const props = withDefaults(defineProps<{
    modelValue: string | null;
    models: EnabledModelOptionDto[];
    allowDefault?: boolean;
    defaultLabel?: string;
    placeholder?: string;
    disabled?: boolean;
    dropdownDirection?: "auto" | "down" | "up";
}>(), {
    allowDefault: false,
    defaultLabel: "",
    placeholder: "",
    disabled: false,
    dropdownDirection: "auto",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

const {t} = useI18n();

const selectOptions = computed<FormSelectOption[]>(() => {
    const options = props.models.map((model) => ({
        value: model.key,
        label: model.label,
    }));

    if (!props.allowDefault) {
        return options;
    }

    return [{
        value: DEFAULT_OPTION_VALUE,
        label: props.defaultLabel || t("settings.panels.modelSelect.followDefault"),
    }, ...options];
});

const selectedValue = computed(() => {
    if (props.allowDefault && !props.modelValue) {
        return DEFAULT_OPTION_VALUE;
    }

    return props.modelValue ?? "";
});

/**
 * 统一处理模型选择变更。
 */
function handleUpdate(value: string): void {
    if (props.allowDefault && value === DEFAULT_OPTION_VALUE) {
        emit("update:modelValue", null);
        return;
    }

    emit("update:modelValue", value || null);
}
</script>

<template>
    <!-- 通用模型选择下拉 -->
    <FormSelect
        :model-value="selectedValue"
        :options="selectOptions"
        :placeholder="props.placeholder || t('settings.panels.modelSelect.placeholder')"
        :dropdown-direction="props.dropdownDirection"
        :disabled="props.disabled"
        :aria-label="t('settings.panels.modelSelect.placeholder')"
        @update:model-value="handleUpdate"
    />
</template>
