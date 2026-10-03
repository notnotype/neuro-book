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

/**
 * checkbox 语义只保存 string/number option value。
 *
 * 只有组件渲染出来的**可选**选项参与增删：选项已下线（未知值）或当前 disabled 的历史值
 * 只能由配置带进来，切换其它项时不能把它们静默丢掉——`LowCodeForm` 对未知值有专门的
 * unavailable 提示，disabled 项的值同样属于用户草稿。
 */
function updateSelected(keys: string[]): void {
    const selectedKeys = new Set(keys);
    const manageable = props.field.options.filter((option) => !option.disabled);
    const untouched = selectedValues.value.filter((value) => !manageable.some((option) => option.value === value));
    const checked = manageable
        .filter((option) => selectedKeys.has(optionKey(option.value)))
        .map((option) => option.value);
    emit("update:modelValue", [...checked, ...untouched]);
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
