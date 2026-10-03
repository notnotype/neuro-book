<script setup lang="ts">
import {FormSelect, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";
import {optionByKey, optionKey} from "nbook/app/components/common/low-code-form/low-code-form-utils";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: null,
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

const selectedKey = computed(() => {
    const option = props.field.options.find((item) => item.value === props.modelValue);
    return option ? optionKey(option.value) : "";
});
const selectOptions = computed<FormSelectOption[]>(() => props.field.options.map((option) => ({
    value: optionKey(option.value),
    label: option.label,
    description: option.description,
})));

function updateSelected(key: string): void {
    const option = optionByKey(props.field.options, key);
    if (option && !option.disabled) {
        emit("update:modelValue", option.value);
    }
}
</script>

<template>
    <div :class="props.disabled ? 'pointer-events-none opacity-75' : ''">
        <FormSelect :model-value="selectedKey" :options="selectOptions" :placeholder="props.field.placeholder" @update:model-value="updateSelected" />
    </div>
</template>
