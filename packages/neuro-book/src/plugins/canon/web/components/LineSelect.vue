<script setup lang="ts">
/**
 * 页头的线选择（docs/specs/canon/author-ui.md 输出 34）：改的是窗口在看的线，不是这一页自己的状态。只有主线时什么也不画。
 * 第一项是“跟着章（此刻：线名）”，线名是这一页按自己的位置实际读的那条线；其余是可选的线，按线的树缩进。
 */
import {computed} from "vue";

import {Select} from "@notnotype/nb-ui/components";
import type {SelectOption} from "@notnotype/nb-ui/components";

import type {LineOption} from "../../shared/reads";
import {useCanonText} from "../text";

const props = defineProps<{
    options: readonly LineOption[];
    /** 窗口在看的线；空串是跟着章。 */
    line: string;
    /** 这一页按自己的位置实际读的线。 */
    resolved: string;
    /** 现在不能换线（条目页有没提交的主文字时）。 */
    disabled?: boolean;
}>();

const emit = defineEmits<{(event: "update:line", value: string): void}>();

const text = useCanonText();
/** 选项的值：“跟着章”与线的 id 分开，线的 id 不会撞上它。 */
const FOLLOW = "follow";
const nameOf = (option: LineOption | undefined): string => (option === undefined || option.name === null ? text("line.main") : option.name);
const items = computed<SelectOption[]>(() => [
    {value: FOLLOW, label: text("line.followNow", {line: nameOf(props.options.find((option) => option.id === props.resolved))})},
    ...props.options.map((option) => ({value: `line:${option.id}`, label: `${"　".repeat(option.depth)}${nameOf(option)}`})),
]);
</script>

<template>
    <Select v-if="props.options.length > 1" class="w-48 max-w-full" size="sm" :aria-label="text('line.label')" :options="items" :model-value="props.line === '' ? FOLLOW : `line:${props.line}`" :disabled="props.disabled === true" @update:model-value="(value: string) => emit('update:line', value === FOLLOW ? '' : value.slice('line:'.length))" />
</template>
