<script setup lang="ts">
/** `GridLeavingScene` 的卡片正文：数据经属性传进来，宿主删了它的数据之后这里读的还是那一份（推荐的写法，见 NestedGrid.md 的内容层）。 */
defineProps<{id: string; card: {readonly title: string; readonly body: string}}>();
</script>

<template>
    <div class="grid-leaving-card" :data-leaving-card="id">
        <p>{{ card.body }}</p>
        <input :data-leaving-input="id" :aria-label="`${card.title} 的输入框`" />
    </div>
</template>

<style scoped>
.grid-leaving-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 12px;
    background: rgb(60, 90, 200);
    color: white;
}
</style>
