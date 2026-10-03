<script setup lang="ts">
import {FormTextarea} from "@notnotype/nb-ui/components";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: "",
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

const textValue = computed(() => typeof props.modelValue === "string" ? props.modelValue : "");
</script>

<template>
    <FormTextarea
        :model-value="textValue"
        :rows="props.field.rows ?? 3"
        :placeholder="props.field.placeholder"
        :disabled="props.disabled"
        @update:model-value="emit('update:modelValue', $event)"
    />
</template>
