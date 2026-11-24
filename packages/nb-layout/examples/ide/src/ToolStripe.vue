<script setup lang="ts">
/**
 * 一条按钮条：这一条上的工具窗按钮，点一下开关。拖动不在这里：整个网格一场拖动会话，按 `data-tool-button` 认来源。
 *
 * 数据全经属性传进来（这一条上的工具窗与它的区此刻显示的），不自己去查模型：条是网格里的一块叶，按钮条的内容由主界面决定。
 * 选中态用 `aria-pressed`：它是开关，读屏念“已按下”；样式也读这个属性，不另写一套类。
 */
defineProps<{
    /** 这一条对应的区，写在 `data-strip` 上，e2e 与拖动都按它认条。 */
    strip: string;
    label: string;
    tools: readonly {readonly id: string; readonly title: string}[];
    /** 这一条的区此刻显示的工具窗；区收着时是 `null`。 */
    open: string | null;
}>();

const emit = defineEmits<{toggle: [tool: string]}>();
</script>

<template>
    <div class="stripe" :class="{'stripe--row': strip === 'bottom'}" role="toolbar" :aria-label="label" data-tool-strip :data-strip="strip" :aria-orientation="strip === 'bottom' ? 'horizontal' : 'vertical'">
        <button v-for="tool in tools" :key="tool.id" type="button" class="stripe__button" :data-tool-button="tool.id" :aria-pressed="open === tool.id" @click="emit('toggle', tool.id)">{{ tool.title }}</button>
    </div>
</template>

<style scoped>
.stripe {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    background: #eef0f4;
}
.stripe--row {
    flex-direction: row;
}
.stripe__button {
    padding: 8px 0;
    border: 0;
    background: none;
    color: #394152;
    font: inherit;
    font-size: 12px;
    cursor: grab;
    writing-mode: vertical-rl;
    transition: background-color var(--nb-layout-motion-fast, 120ms);
}
.stripe--row .stripe__button {
    padding: 0 10px;
    writing-mode: horizontal-tb;
}
.stripe__button:hover {
    background: #dde1e8;
}
.stripe__button[aria-pressed="true"] {
    background: #4f6bed;
    color: #fff;
}
</style>
