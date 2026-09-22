<script setup lang="ts">
import {FormInput} from "@notnotype/nb-ui/components";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

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

const numberText = computed(() => typeof props.modelValue === "number" && Number.isFinite(props.modelValue) ? String(props.modelValue) : "");

/**
 * 解析数字输入；空值保留为 null，由服务端 schema 决定是否合法。
 */
function updateNumber(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
        emit("update:modelValue", null);
        return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        emit("update:modelValue", null);
        return;
    }
    emit("update:modelValue", props.field.integer ? Math.trunc(parsed) : parsed);
}
</script>

<template>
    <FormInput
        :model-value="numberText"
        type="number"
        :step="props.field.step !== undefined ? String(props.field.step) : undefined"
        :min="props.field.min !== undefined ? String(props.field.min) : undefined"
        :max="props.field.max !== undefined ? String(props.field.max) : undefined"
        :placeholder="props.field.placeholder"
        :readonly="props.disabled"
        @update:model-value="updateNumber"
    />
</template>
