<script setup lang="ts">
/**
 * Lab 宿主登记的状态栏项：本会话改的字数（docs/specs/agent/contributions.md 输出 22 的样例）。组件的属性是对话视图的 `ctx`，
 * 画一小段行内内容；这里的数字是样本，真实的插件自己从 `ctx` 或自己的服务算。
 */
import type {AgentConversationContext} from "@notnotype/nb-agent-ui";

defineProps<{ctx: AgentConversationContext}>();
</script>

<template>
    <span class="inline-flex items-center gap-0.5 whitespace-nowrap" data-lab-word-count><span class="i-lucide-pen-line" aria-hidden="true" />改了 1,234 字</span>
</template>
