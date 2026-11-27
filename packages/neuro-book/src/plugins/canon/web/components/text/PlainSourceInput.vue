<script setup lang="ts">
/** 主文字整篇源文字输入的退路（同名 .md）：普通文本框，合同与编辑器的代码输入框相同。 */
import {ref} from "vue";

import {Textarea} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{modelValue: string; label: string; language?: string; readonly?: boolean}>(), {language: "plaintext", readonly: false});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []}>();

const area = ref<{readonly $el: HTMLTextAreaElement} | null>(null);

defineExpose({
    focus: (caret?: "start" | "end"): void => {
        const element = area.value?.$el;
        if (element === undefined) return;
        element.focus();
        if (caret === undefined) return;
        const at = caret === "start" ? 0 : element.value.length;
        element.setSelectionRange(at, at);
    },
    cursorOffset: (): number | null => area.value?.$el.selectionStart ?? null,
    /** 在光标处写入一段文字（有选区时换掉选区），光标落在它后面；照用户输入交出去。只读时不做，返回假。 */
    insert: (text: string): boolean => {
        const element = area.value?.$el;
        if (element === undefined || props.readonly) return false;
        const at = element.selectionStart + text.length;
        element.setRangeText(text, element.selectionStart, element.selectionEnd);
        element.setSelectionRange(at, at);
        element.dispatchEvent(new Event("input", {bubbles: true}));
        return true;
    },
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
