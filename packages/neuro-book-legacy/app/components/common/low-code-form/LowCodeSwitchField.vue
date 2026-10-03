<script setup lang="ts">
import {Switch} from "@notnotype/nb-ui/components";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>(), {
    modelValue: false,
    disabled: false,
});
const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

const checked = computed(() => props.modelValue === true);
</script>

<template>
    <Switch
        :model-value="checked"
        :disabled="props.disabled"
        :aria-label="props.field.label"
        @update:model-value="emit('update:modelValue', $event)"
    />
</template>
