<script setup lang="ts">
/** 主文字一块的源文字输入的退路（同名 .md）：普通文本框，合同与编辑器的代码输入框相同。 */
import {ref} from "vue";

import {Textarea} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{modelValue: string; label: string; language?: string; readonly?: boolean}>(), {language: "plaintext", readonly: false});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []}>();

const area = ref<{readonly $el: HTMLTextAreaElement} | null>(null);

defineExpose({
    focus: (): void => area.value?.$el.focus(),
    cursorOffset: (): number | null => area.value?.$el.selectionStart ?? null,
});
</script>

<template>
    <Textarea
        ref="area"
        class="plain-source"
        variant="bare"
        autosize
        :rows="2"
        :max-rows="40"
        :readonly="props.readonly"
        :aria-label="props.label"
        :model-value="props.modelValue"
        data-plain-source
        @update:model-value="(value: string) => emit('update:modelValue', value)"
        @focus="emit('focus')"
        @blur="emit('blur')"
    />
</template>

<style scoped>
.plain-source {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.7;
}
</style>
