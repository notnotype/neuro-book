<script setup lang="ts">
/**
 * `GridStructureScene` 的叶内容：带实例编号、输入框与滚动内容，结构变化后核对它们还在；`ResizeObserver` 的次数用来核对新叶的
 * 内容只排一次版。
 */
import {onBeforeUnmount, onMounted, ref, useTemplateRef} from "vue";

const props = defineProps<{id: string; createInstance: () => number}>();

const instance = props.createInstance();
const resizes = ref(0);
const rootEl = useTemplateRef<HTMLElement>("rootEl");
let observer: ResizeObserver | null = null;

onMounted(() => {
    observer = new ResizeObserver(() => {
        resizes.value += 1;
    });
    if (rootEl.value !== null) observer.observe(rootEl.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <div ref="rootEl" class="grid-structure-leaf" :data-structure-leaf="id" :data-structure-instance="instance" :data-structure-resizes="resizes">
        <button type="button" data-structure-first>{{ id }}</button>
        <input data-structure-input :aria-label="`${id} 的输入框`" />
        <div data-structure-scroll class="grid-structure-leaf__scroll">
            <div class="grid-structure-leaf__tall">滚动内容</div>
        </div>
        <button type="button" data-structure-last>{{ id }} 末尾</button>
    </div>
</template>

<style scoped>
.grid-structure-leaf {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 8px;
    background: var(--panel-surface);
}

.grid-structure-leaf input {
    min-width: 0;
}

.grid-structure-leaf__scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
}

.grid-structure-leaf__tall {
    height: 2000px;
}
</style>
