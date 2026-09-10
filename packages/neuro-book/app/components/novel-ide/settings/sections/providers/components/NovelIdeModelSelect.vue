<script setup lang="ts">
import {computed} from "vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

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

const selectOptions = computed<SelectOption[]>(() => {
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
    <div :class="props.disabled ? 'pointer-events-none opacity-60' : ''">
        <FormSelect
            :model-value="selectedValue"
            :options="selectOptions"
            :placeholder="props.placeholder || t('settings.panels.modelSelect.placeholder')"
            :dropdown-direction="props.dropdownDirection"
            @update:model-value="handleUpdate"
        />
    </div>
</template>
