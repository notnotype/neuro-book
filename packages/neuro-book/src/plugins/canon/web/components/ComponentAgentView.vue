<script setup lang="ts">
/**
 * 设定组分页的“给 AI 看”（同名 .md，docs/specs/canon/author-ui.md 输出 54）：字由宿主用 `canon/shared/agent-fields.ts` 的
 * `fieldsText` 写好，和后端 `canon_read` 给模型的是同一个函数写的；这里只显示。
 */
import {useCanonText} from "../text";

const props = defineProps<{
    text: string;
    position: string;
}>();

const text = useCanonText();
</script>

<template>
    <div data-agent-view>
        <p class="mb-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("entry.views.agentPosition", {position: props.position}) }}</p>
        <pre class="component-agent-view__text" data-agent-text>{{ props.text }}</pre>
    </div>
</template>

<style scoped>
.component-agent-view__text {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-main);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
}
</style>
