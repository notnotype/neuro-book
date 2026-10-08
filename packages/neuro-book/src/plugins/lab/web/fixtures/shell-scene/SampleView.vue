<script lang="ts">
/** 模块作用域：所有样例视图共用的创建与卸载计数（写在 `<script setup>` 里就成了每个实例各一份）。 */
const counters = {next: 1, created: 0, unmounted: 0};

/** 场景让某个视图在渲染时抛错：键是视图 id。 */
export const renderFailures = new Set<string>();
</script>

<script setup lang="ts">
/**
 * 视图场景里的样例视图：自己持有输入与滚动，显示实例编号、代际与是否可见。移动、换轴、切模式、停放都不该重建它：
 * 同一场景里连续操作，实例编号与创建次数不变就说明没有重挂；代际只在重新加载或重试时变。
 */
import {FormInput} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref} from "vue";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

const props = defineProps<{context: ViewContext}>();

if (renderFailures.has(props.context.id)) throw new Error(`样例视图 ${props.context.id} 按场景开关渲染出错`);

const instance = counters.next;
counters.next += 1;
counters.created += 1;
const created = counters.created;
const draft = ref("");
const lines = Array.from({length: 60}, (_, index) => `${props.context.id} · 第 ${String(index + 1)} 行`);

onBeforeUnmount(() => {
    counters.unmounted += 1;
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2 text-sm" :data-sample-view="context.id" :data-instance="instance" :data-created="created" :data-generation="context.generation" :data-visible="context.visible.value ? 'true' : 'false'" :data-location="context.location.value">
        <div class="text-xs text-[var(--text-muted)]">实例 #{{ instance }} · 代际 {{ context.generation }} · {{ context.visible.value ? "可见" : "不可见" }} · {{ context.location.value }}</div>
        <div data-sample-input><FormInput v-model="draft" size="sm" placeholder="输入几个字，再移动视图" /></div>
        <div class="min-h-0 flex-1 overflow-auto" data-sample-scroll>
            <p v-for="line in lines" :key="line" class="py-0.5 text-[var(--text-secondary)]">{{ line }}</p>
        </div>
    </div>
</template>
