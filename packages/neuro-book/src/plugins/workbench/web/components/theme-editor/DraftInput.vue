<script setup lang="ts">
/** 带本地草稿的单行输入（同名 .md）：停手后才交出，失焦与卸载时立刻交出，外面的值变了就跟着变；空串默认不交出（调用方要清空用自己的按钮）。 */
import {Input} from "@notnotype/nb-ui/components";

import {useDebouncedDraft} from "./use-debounced-draft";

defineOptions({name: "DraftInput"});

const props = withDefaults(defineProps<{
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    size?: "sm" | "md";
    /** 空串也交出（清空就是想清掉）；缺省不交出，因为有的字段不允许空值。 */
    allowEmpty?: boolean;
}>(), {placeholder: "", ariaLabel: "", size: "md", allowEmpty: false});

const emit = defineEmits<{(event: "change", value: string): void}>();

const {draft, input, flush} = useDebouncedDraft(() => props.value, (value) => {
    if (value !== "" || props.allowEmpty) emit("change", value);
});
</script>

<template>
    <div class="draft-input" @focusout="flush">
        <Input :size="size" :model-value="draft" :placeholder="placeholder" :aria-label="ariaLabel === '' ? undefined : ariaLabel" @update:model-value="input($event)" />
    </div>
</template>
