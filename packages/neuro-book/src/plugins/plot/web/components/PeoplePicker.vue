<script setup lang="ts">
/**
 * “选要看的人”（docs/specs/plot/author-ui.md 输出 10）：一个按钮写“选要看的人（选中数 / 候选数）”，点了在弹层里多选。受控：选中的
 * 人由页面给，改了发 `update:modelValue`；超过上限时多出的那一项不加上，弹层里写一句上限。
 */
import {computed} from "vue";

import {Button, CheckboxGroup, Popover} from "@notnotype/nb-ui/components";

import {usePlotText} from "../text";

const props = withDefaults(defineProps<{
    /** 候选的人：id 与名字，按显示的先后。 */
    candidates: readonly {readonly id: string; readonly name: string}[];
    /** 选中的人的 id。 */
    modelValue: readonly string[];
    /** 至多选几个；默认 12。 */
    max?: number;
}>(), {max: 12});

const emit = defineEmits<{(event: "update:modelValue", value: string[]): void}>();

const text = usePlotText();
const options = computed(() => props.candidates.map((candidate) => ({value: candidate.id, label: candidate.name})));
const choose = (next: string[]): void => {
    // 新加的超过上限时不加：保留原来选中的，按候选的先后。
    emit("update:modelValue", next.length > props.max ? [...props.modelValue] : next);
};
</script>

<template>
    <Popover align="end">
        <template #trigger>
            <Button size="sm" variant="ghost">{{ text("secrets.pick", {chosen: props.modelValue.length, total: props.candidates.length}) }}</Button>
        </template>
        <div class="flex max-h-80 w-64 flex-col gap-2 overflow-auto p-3" role="group" :aria-label="text('secrets.pickTitle')">
            <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("secrets.pickLimit", {count: props.max}) }}</p>
            <CheckboxGroup :model-value="[...props.modelValue]" :options="options" @update:model-value="choose" />
        </div>
    </Popover>
</template>
