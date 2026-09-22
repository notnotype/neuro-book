<script setup lang="ts">
import {computed, useAttrs} from "vue";
import {
    FormSelect as NbFormSelect,
    type FormSelectDirection,
    type FormSelectOption,
    type FormSelectSize,
} from "@notnotype/nb-ui/components";

/**
 * 历史组件原地代理桥接（common/form/FormSelect -> @notnotype/nb-ui FormSelect）。
 *
 * 保持原有 SelectOption / SelectSize 类型、props 与 emits 100% 向后兼容，
 * 底层统一收敛至标准 Reka UI 无头基元与黄金 4 阶立体微反光浮层，
 * 一举净化全工程 45+ 处历史调用点的浮层材质与同心律。
 */

export type SelectSize = "default" | "sm";
export type SelectOption = FormSelectOption;

defineOptions({inheritAttrs: false});
const attrs = useAttrs();

const props = withDefaults(defineProps<{
    modelValue?: string;
    options: SelectOption[];
    id?: string;
    name?: string;
    placeholder?: string;
    /** 语义尺寸，sm 用于表格、行内编辑器这类紧凑表单。 */
    size?: SelectSize;
    dropdownDirection?: FormSelectDirection;
    disabled?: boolean;
    required?: boolean;
    hideCheckmark?: boolean;
}>(), {
    modelValue: "",
    id: "",
    name: "",
    placeholder: "",
    size: "default",
    dropdownDirection: "auto",
    disabled: false,
    required: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const model = computed({
    get: () => props.modelValue,
    set: (val: string) => emit("update:modelValue", val),
});
</script>

<template>
    <NbFormSelect
        v-bind="attrs"
        v-model="model"
        :options="options"
        :id="id || undefined"
        :name="name || undefined"
        :placeholder="placeholder"
        :size="size"
        :dropdown-direction="dropdownDirection"
        :disabled="disabled"
        :required="required"
        :hide-checkmark="hideCheckmark"
        @focus="emit('focus', $event)"
    />
</template>
