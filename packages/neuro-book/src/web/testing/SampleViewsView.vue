<script lang="ts">
/** 模块作用域：所有样例视图共用的创建计数（写在 `<script setup>` 里就成了每个实例各一份）。 */
const counters = {next: 1};
</script>

<script setup lang="ts">
/**
 * `test.sample-views` 的视图组件：自己持有输入与滚动，显示实例编号、代际、是否可见与所在区域，供 e2e 判断实例没有
 * 重建、代际只在重试时变。开关 `FAIL_RENDER` 列出的视图在渲染时抛错。
 */
import {FormInput} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {SAMPLE_VIEWS_SWITCHES} from "nbook/shared/testing/sample-views-contract";

const props = defineProps<{context: ViewContext; focusedPart?: string}>();

const failing = (globalThis.localStorage?.getItem(SAMPLE_VIEWS_SWITCHES.failRender) ?? "").split(",");
if (failing.includes(props.context.id)) throw new Error(`样例视图 ${props.context.id} 按开关渲染出错`);

const instance = counters.next;
counters.next += 1;
const draft = ref("");
const lines = Array.from({length: 60}, (_, index) => `${props.context.id} · 第 ${String(index + 1)} 行`);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2 text-sm" :data-sample-view="context.id" :data-instance="instance" :data-generation="context.generation" :data-visible="context.visible.value ? 'true' : 'false'" :data-location="context.location.value" :data-focused-part="focusedPart">
        <div class="text-xs text-[var(--text-muted)]">实例 #{{ instance }} · 代际 {{ context.generation }} · {{ context.location.value }}</div>
        <div data-sample-input><FormInput v-model="draft" size="sm" placeholder="样例输入" /></div>
        <div class="min-h-0 flex-1 overflow-auto" data-sample-scroll>
            <p v-for="line in lines" :key="line" class="py-0.5 text-[var(--text-secondary)]">{{ line }}</p>
        </div>
    </div>
</template>
