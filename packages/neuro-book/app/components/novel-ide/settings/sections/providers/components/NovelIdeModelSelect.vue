<script setup lang="ts">
import {computed} from "vue";
import {FormSelect} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

/**
 * 模型下拉。用 nb-ui 的 `FormSelect`，与设置界面里其余下拉同一套外观。
 *
 * 注意它是浮层化的：菜单 teleport 到 body 并取注入的 `NB_POPOVER_Z_INDEX`。宿主若自带
 * 遮罩（旧 app `Dialog` 的 z-9000），必须自己把注入值抬上去，否则菜单压在遮罩下面点不到
 * （`components/common/Dialog.vue` 已提供）。旧 app `FormSelect` 没这个问题，因为面板内联在宿主子树里。
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
