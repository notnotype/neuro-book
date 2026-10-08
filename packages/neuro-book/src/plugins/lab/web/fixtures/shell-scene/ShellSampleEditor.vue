<script setup lang="ts">
/**
 * 外壳场景编辑器槽里的样例内容：自己持有输入与滚动，显示实例编号与累计的创建、卸载次数。外壳承诺换位置、隐藏、
 * 最大化、紧凑往返都不卸载编辑器内容（docs/specs/ui/workbench-shell.md 外壳一输出 10），在同一场景里连续操作时这
 * 三个数不变就说明没有重挂（换场景会重挂整个 fixture，不能用来验证）。计数放在模块里，跨实例累计。
 */
import {FormInput} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref} from "vue";

const counters = {next: 1, created: 0, unmounted: 0};

const instance = counters.next;
counters.next += 1;
counters.created += 1;
const created = ref(counters.created);
const unmounted = ref(counters.unmounted);
const draft = ref("");
const lines = Array.from({length: 80}, (_, index) => `第 ${String(index + 1)} 行：用来验证滚动位置在搬动后保留`);

onBeforeUnmount(() => {
    counters.unmounted += 1;
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-2 p-3 text-sm" :data-shell-sample="instance" :data-created="created" :data-unmounted="unmounted">
        <div class="text-xs text-[var(--text-muted)]">样例编辑器 · 实例 #{{ instance }} · 创建 {{ created }} · 卸载 {{ unmounted }}</div>
        <div data-shell-sample-input><FormInput v-model="draft" size="sm" placeholder="输入几个字，再搬动面板" /></div>
        <div class="min-h-0 flex-1 overflow-auto" data-shell-sample-scroll>
            <p v-for="line in lines" :key="line" class="py-0.5 text-[var(--text-secondary)]">{{ line }}</p>
        </div>
    </div>
</template>
