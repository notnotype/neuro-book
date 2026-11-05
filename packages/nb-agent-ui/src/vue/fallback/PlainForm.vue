<script setup lang="ts">
/** 没有注入 `renderers.form` 时的表单：一个 JSON 文本框。对错只看 JSON 能不能解析。 */
import {ref} from "vue";
import {Textarea} from "@notnotype/nb-ui/components";

const props = defineProps<{schema: unknown; modelValue?: unknown}>();
const emit = defineEmits<{"update:modelValue": [value: unknown]; "update:valid": [valid: boolean]}>();

const text = ref(props.modelValue === undefined ? "" : JSON.stringify(props.modelValue, null, 2));

function onInput(value: string): void {
    text.value = value;
    try {
        emit("update:modelValue", JSON.parse(value));
        emit("update:valid", true);
    } catch {
        emit("update:valid", false);
    }
}
</script>

<template>
    <Textarea :model-value="text" :rows="4" class="font-mono" @update:model-value="onInput(String($event))" />
</template>
