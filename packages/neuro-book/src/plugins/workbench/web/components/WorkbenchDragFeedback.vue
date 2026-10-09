<script setup lang="ts">
/** 拖放的拖影与落点反馈（同名 .md）：受控，只画宿主算好的东西。 */
import {DropFeedbackOverlay, DropIndicatorLabel} from "@notnotype/nb-ui/components";
import type {DropFeedbackPreview} from "@notnotype/nb-ui/components";

defineOptions({name: "WorkbenchDragFeedback"});

defineProps<{
    /** 跟着指针的拖影：拖动源的图标与标题，`x`、`y` 是指针的视口坐标；没有拖动为 null。 */
    ghost: {readonly label: string; readonly icon: string; readonly x: number; readonly y: number} | null;
    /** 落点预览：插入线或接收区域；没有可显示的落点为 null。 */
    preview: DropFeedbackPreview | null;
    /** 落点提示与播报的文字；空字符串不显示提示。 */
    label: string;
    /** 动作种类与拖动的视图数，写到覆盖层根的 `data-drop-kind`、`data-drop-count`，供探针读。 */
    kind: string;
    count: number;
}>();
</script>

<template>
    <Teleport to="body">
        <div v-if="ghost !== null" class="workbench-drag-ghost" data-drag-feedback data-workbench-drag-ghost :style="{left: `${ghost.x + 12}px`, top: `${ghost.y + 12}px`}">
            <DropIndicatorLabel :label="ghost.label" :icon-class="ghost.icon" />
        </div>
    </Teleport>
    <DropFeedbackOverlay :preview="preview" :label="label" data-drag-feedback :data-drop-kind="kind" :data-drop-count="count" />
</template>

<style scoped>
/* 拖影跟着指针，不挡命中：命中按 `elementsFromPoint` 求，`data-drag-feedback` 也会被跳过。 */
.workbench-drag-ghost {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
}
</style>

<style>
/* 拖动进行中（会话在根元素上写的标记）：整页抓手光标、不扩选文字。 */
:root[data-workbench-dragging],
:root[data-workbench-dragging] * {
    cursor: grabbing !important;
    user-select: none !important;
}

/*
 * 拖动源保持原尺寸：按钮按下的缩放在拖动开始后撤掉（指针捕获在源上，`:active` 会一直生效）。只写 `scale`：与
 * `transform` 写在同一条规则里时，构建的 CSS 压缩会把两者并成一条 `transform`，`scale` 就丢了。
 */
:root[data-workbench-dragging] :is([data-drag-container], [data-drag-view]),
:root[data-workbench-dragging] :is([data-drag-container], [data-drag-view]) * {
    scale: 1 !important;
}
</style>
