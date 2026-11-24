<script setup lang="ts">
/**
 * 一个工具窗的正文：几行不能聚焦的字，加一个能打字的框。框里打的字在换工具窗、挪到别的条、收起再展开之后都还在：
 * 内容层按 key 留着同一个实例，只换它所在的叶，停放时不卸载。字旁边的空白点不到任何可聚焦的东西，焦点会落到页面上，
 * 快捷键因此要挂在 window 上。
 */
const props = defineProps<{tool: string; title: string}>();

/** 每个工具窗的一行示意内容（标题已经在面板头上，这里不重复）。 */
const SUMMARY: Readonly<Record<string, string>> = {
    project: "my-app · 3 files",
    structure: "main.ts › start()",
    bookmarks: "No bookmarks",
    outline: "main.ts: 2 functions",
    terminal: "~/my-app $",
    problems: "No problems",
};
const summary = SUMMARY[props.tool] ?? "";
</script>

<template>
    <div class="panel" role="region" :aria-label="title" :data-tool-panel="tool">
        <p class="panel__line">{{ summary }}</p>
        <textarea class="panel__text" :aria-label="`Notes for ${title}`" :data-tool-text="tool" spellcheck="false" />
    </div>
</template>

<style scoped>
.panel {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px;
    gap: 6px;
    background: #fafbfc;
    overflow: hidden;
}
.panel__line {
    flex: none;
    margin: 0;
    color: #667;
}
.panel__text {
    flex: 1;
    min-height: 0;
    resize: none;
    border: 1px solid #d5d9e0;
    font: 12px/1.5 ui-monospace, monospace;
}
</style>
