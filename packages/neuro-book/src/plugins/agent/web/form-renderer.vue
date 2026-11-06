<script setup lang="ts">
/**
 * 提问向导的表单（nb-agent-ui 的 `renderers.form`）：把 nb-form 接到向导要的形状。向导不依赖 nb-form，要知道填得对不对才能决定能不能提交，
 * 所以这里按同一份描述校验，经 `update:valid` 告诉它。
 */
import {computed, watch} from "vue";
import {resolveForm, validateForm} from "@notnotype/nb-form";
import {SchemaForm} from "@notnotype/nb-form/vue";

const props = defineProps<{schema: object; modelValue?: unknown}>();
const emit = defineEmits<{"update:modelValue": [value: unknown]; "update:valid": [valid: boolean]}>();

const model = computed(() => resolveForm(props.schema));
const issues = computed(() => (props.modelValue === undefined ? [] : validateForm(model.value, props.modelValue)));

watch(issues, (current) => emit("update:valid", current.length === 0), {immediate: true});
</script>

<template>
    <SchemaForm :schema="props.schema" :model-value="props.modelValue" :issues="issues" :summary="false" @update:model-value="emit('update:modelValue', $event)" />
</template>
