<script setup lang="ts">
/**
 * 一个标签的正文。这里放一个能打字的框：换标签、挪进别的编组之后打的字还在，因为内容层按 key 留着同一个实例，
 * 只换它所在的叶，不重建。叶里有能聚焦的东西，F6 才走得进来。
 *
 * 标签名经属性传进来，不按 key 查模型：关掉最后一个标签时，库把这份内容留到编组缩回去为止，那时模型里已经没有它了。
 */
defineProps<{tab: string}>();
</script>

<template>
    <div :id="`panel-${tab}`" class="panel" role="tabpanel" :aria-labelledby="`tab-${tab}`">
        <textarea class="panel__text" :aria-label="`Contents of ${tab}`" :data-panel-text="tab" spellcheck="false" :placeholder="`Type in ${tab}…`" />
    </div>
</template>

<style scoped>
.panel {
    display: flex;
    height: 100%;
    background: #fff;
}
.panel__text {
    flex: 1;
    padding: 12px;
    border: 0;
    resize: none;
    font: 13px/1.5 ui-monospace, monospace;
    outline: none;
}
</style>
