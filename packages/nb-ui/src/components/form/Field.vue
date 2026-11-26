<script setup lang="ts">
import {computed, provide, useId} from "vue";
import {NB_FIELD_CONTEXT_KEY} from "./field-context";

const props = withDefaults(defineProps<{
    label?: string;
    description?: string;
    error?: string;
    for?: string;
    required?: boolean;
    /**
     * 组形态：根是 `div`，标签是带 id 的元素，不是 `<label for>`。给单选组、复选组这类由几个控件组成的字段用，它们读
     * 上下文的 `labelId` 写 `aria-labelledby`；`<label>` 里放一组单选，读屏读不出组名。
     */
    group?: boolean;
}>(), {
    label: "",
    description: "",
    error: "",
    for: "",
    required: false,
    group: false,
});

const generatedId = useId();
const inputId = computed(() => props.for || `nb-field-${generatedId}`);
const labelId = computed(() => props.label ? `${inputId.value}-label` : undefined);
const descriptionId = computed(() => props.description ? `${inputId.value}-description` : undefined);
const errorId = computed(() => props.error ? `${inputId.value}-error` : undefined);
const ariaDescribedby = computed(() => [errorId.value, descriptionId.value].filter(Boolean).join(" ") || undefined);
const invalid = computed(() => Boolean(props.error));

provide(NB_FIELD_CONTEXT_KEY, {
    inputId,
    labelId,
    descriptionId,
    errorId,
    ariaDescribedby,
    required: computed(() => props.required),
    invalid,
});
</script>

<template>
    <component :is="props.group ? 'div' : 'label'" class="block space-y-1.5" :for="props.group ? undefined : inputId" :data-nb-field-group="props.group ? '' : undefined">
        <span v-if="props.label" :id="labelId" class="block text-[length:var(--text-sm)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">
            {{ props.label }}<span v-if="props.required" class="ml-1 text-[var(--status-danger)]">*</span>
        </span>
        <!--
            错误不在字段下插一行字（会让表单重排）：控件标红，原因只给读屏；看得见的原因由宿主写在固定位置（ui-development-spec 的“表单与无障碍”）。
            这个元素放在插槽之前：`space-y-1.5` 给除最后一个之外的子元素加下边距，放在插槽之后时控件不再是最后一个，下面多出 6px，
            整个表单跟着下移。它是绝对定位的（`sr-only`），自己的边距不占版面。
        -->
        <span v-if="props.error" :id="errorId" class="sr-only">{{ props.error }}</span>
        <slot :input-id="inputId" :description-id="descriptionId" :error-id="errorId" :aria-describedby="ariaDescribedby" :invalid="invalid" />
        <span v-if="props.description" :id="descriptionId" class="block text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ props.description }}</span>
    </component>
</template>
