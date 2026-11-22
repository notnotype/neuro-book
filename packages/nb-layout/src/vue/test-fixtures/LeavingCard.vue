<script setup lang="ts">
/** 留着的内容里的子组件（`NestedGrid.dom.test.ts` 的“离开的内容”）：数据经属性传进来，宿主删了它的数据之后读的还是那一份。 */
defineProps<{card: {title: string; items: string[]}; id: string; log: string[]}>();
</script>
<template>
    <em :data-card="id">{{ (log.push(`card:${id}`), card.title) }}<Transition><b v-if="card.title">t</b></Transition></em>
</template>
