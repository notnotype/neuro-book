<script setup lang="ts">
/**
 * 一扇窗的正文：一个能打字的框。内容层按窗的 id 留着同一个实例，窗在浮动与平铺之间来回、最小化再回来，
 * 打的字都还在；关闭时内容从内容层拿掉，实例卸载，字就没了。
 *
 * 标题经属性传进来，不按 id 去查模型：窗关闭时它的叶可能还留着缩回去，那几帧里这个组件还在、还会重新渲染。
 */
defineProps<{id: string; title: string}>();
</script>

<template>
    <div class="body">
        <textarea class="body__text" :aria-label="`Contents of ${title}`" :data-window-text="id" spellcheck="false" :placeholder="`Type in ${title}…`" />
    </div>
</template>

<style scoped>
.body {
    display: flex;
    height: 100%;
    background: #fbfbfd;
}
.body__text {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    border: 0;
    resize: none;
    background: transparent;
    font: 13px/1.5 ui-monospace, monospace;
    outline: none;
}
</style>
