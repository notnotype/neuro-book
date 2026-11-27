<script setup lang="ts">
/**
 * 代码输入框的夹具：文字是受控的模型。`stack` 场景另外排出二十个，看一页里有很多个时只有进入视野的才建 Monaco。
 * Lab 里没有编辑器区，语言登记表与排版选项都没有提供方：只有纯文本与 JSON、缺省排版。
 */
import {computed} from "vue";

import CodeInput from "nbook/plugins/editor/web/components/CodeInput.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof CodeInput>(() => props.input, ["update:modelValue", "focus", "blur"]);

const others = computed(() => (props.scene === "stack" ? Array.from({length: 19}, (_, index) => `第 ${String(index + 2)} 块\n\n这一块在下面，滚到它才建编辑器。`) : []));
</script>

<template>
    <div class="flex w-full flex-col gap-3">
        <CodeInput data-lab-subject class="rounded-[var(--radius-control)] border border-[var(--border-color)]" v-bind="subject.bindings.value" />
        <CodeInput v-for="(text, index) in others" :key="index" class="rounded-[var(--radius-control)] border border-[var(--border-color)]" :model-value="text" :label="`第 ${String(index + 2)} 块`" />
    </div>
</template>
