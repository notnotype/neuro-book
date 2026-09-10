<script setup lang="ts">
import {CheckboxGroup} from "@notnotype/nb-ui/components";
import type {CheckboxOption} from "@notnotype/nb-ui/components";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";
import {optionByKey, optionKey} from "nbook/app/components/common/low-code-form/low-code-form-utils";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: () => [],
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

const selectedValues = computed(() => Array.isArray(props.modelValue) ? props.modelValue : []);
const selectedKeys = computed(() => props.field.options
    .filter((option) => selectedValues.value.includes(option.value))
    .map((option) => optionKey(option.value)));
const options = computed<CheckboxOption[]>(() => props.field.options.map((option) => ({
    value: optionKey(option.value),
    label: option.label,
    description: option.description,
    disabled: props.disabled || option.disabled,
})));

/** checkbox 语义只保存 string/number option value。 */
function updateSelected(keys: string[]): void {
    const values: LowCodeJsonValue[] = [];
    for (const key of keys) {
        const option = optionByKey(props.field.options, key);
        if (option && !option.disabled) {
            values.push(option.value);
        }
    }
    emit("update:modelValue", values);
}
</script>

<template>
    <CheckboxGroup
        :model-value="selectedKeys"
        :options="options"
        orientation="horizontal"
        :disabled="props.disabled"
        @update:model-value="updateSelected"
    />
</template>
