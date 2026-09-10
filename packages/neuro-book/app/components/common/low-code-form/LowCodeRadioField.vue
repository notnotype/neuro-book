<script setup lang="ts">
import {RadioGroup, SegmentedControl} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import type {RadioOption} from "@notnotype/nb-ui/components";
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

const hasOptionDescription = computed(() => props.field.options.some((option) => option.description));
const selectedKey = computed(() => {
    const matched = props.field.options.find((option) => option.value === props.modelValue);
    return matched ? optionKey(matched.value) : "";
});
const options = computed(() => props.field.options.map((option) => ({
    value: optionKey(option.value),
    label: option.label,
    description: option.description,
    disabled: props.disabled || option.disabled,
})));

function updateSelected(value: SegmentedControlValue): void {
    const option = typeof value === "string" ? optionByKey(props.field.options, value) : undefined;
    if (option && !option.disabled) {
        emit("update:modelValue", option.value);
    }
}
</script>

<template>
    <RadioGroup
        v-if="hasOptionDescription"
        :model-value="selectedKey"
        :options="options as RadioOption[]"
        :disabled="props.disabled"
        @update:model-value="updateSelected"
    />
    <SegmentedControl
        v-else
        :model-value="selectedKey"
        :options="options"
        :full-width="true"
        @update:model-value="updateSelected"
    />
</template>
