<script setup lang="ts">
import {useBook} from "../host/book";

/** 出处“章.段”：点开在抽屉里显示那几段原文（viewer 输出 19）；Ctrl（macOS 上 ⌘）点开在另一半（输出 67）。出处没有右键菜单。 */
const props = defineProps<{refText: string}>();
const book = useBook();
function onClick(event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) book.openBeside({kind: "source", ref: props.refText});
    else book.openSource(props.refText);
}
</script>

<template>
    <button type="button" class="ref-link" :title="`看原文 ${refText}`" @click.stop="onClick">{{ refText }}</button>
</template>

<style scoped>
.ref-link {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    color: var(--accent-text);
    white-space: nowrap;
}
.ref-link:hover {
    text-decoration: underline;
}
</style>
