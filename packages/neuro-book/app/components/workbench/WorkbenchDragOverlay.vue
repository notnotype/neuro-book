<script setup lang="ts">
/**
 * 工作台的**唯一** Custom `DragOverlay` 薄适配：跟指针走的那一份拖动反馈。
 *
 * 为什么必须有它：不配 `DragOverlay` 时 dnd-kit 的 Feedback 会把**源元素本身**弹成 `position: fixed`
 * 跟着指针跑，再插一个隐藏副本（`[data-dnd-placeholder]`）占住原位——源看起来"被拿走了"、矩形在动。
 * 配上这一层之后，源元素原地不动，只有本组件渲染的标签跟着指针；占位副本也不再生成。
 *
 * 本组件不认识 resolver、端口、Geometry：`source` 只是 `useWorkbenchDrop` 给出的**冻结载荷**，
 * 有没有值决定"是不是工作台自己的拖动"（页面里别的 DnD 区域不借这一层）；标题与图标由宿主从呈现里取好传进来。
 * 区域 / 插入线的反馈仍归 `WorkbenchDropOverlay`，两者不重叠。
 *
 * 同一份 manager 里别的拖动（例如面板分隔条）也用这个元素当反馈：那时槽内是空的，只有"源留在原位"这一条
 * 生效——对分隔条来说正是想要的（它本来就该待在边线上，而不是跟着指针飞）。
 *
 * 空闲时元素留在文档里但**脱离布局**（`position: absolute`）：`DragOverlay` 必须在拖动开始前就在位，
 * Feedback 才能把它当作反馈元素；而它一个 flex 子项都不该多占（父容器的 `gap` 会把空盒子也算进去）。
 * 拖动期间库自己注入的样式以 `!important` 把它改成 `fixed` 并接管坐标，这里的 `absolute` 自然让位。
 */
import {DragOverlay} from "@dnd-kit/vue";
import {DropIndicatorLabel} from "@notnotype/nb-ui/components";
import type {WorkbenchDropSource} from "nbook/app/utils/workbench/workbench-drop";

const props = defineProps<{
    /** 拖动中的冻结源载荷；`null` 表示这一刻没有本层的拖动（槽内什么都不渲染）。 */
    source: WorkbenchDropSource | null;
    /** 源条目的当前标题（i18n 与回落规则归宿主）。 */
    label: string;
    /** 源条目的图标 class；没给就只显示标题。 */
    iconClass?: string;
}>();
</script>

<template>
    <DragOverlay :drop-animation="null" class="workbench-drag-overlay">
        <!-- `data-workbench-drag-overlay`：验收脚本按它数"活动中的 Custom Overlay"，所以只在真拖动时出现，
             且与标签自身"空文案不渲染"的规则解耦（标记说的是拖动在不在，不是文案长不长）。 -->
        <span v-if="props.source !== null" data-workbench-drag-overlay>
            <DropIndicatorLabel :label="props.label" :icon-class="props.iconClass" />
        </span>
    </DragOverlay>
</template>

<style scoped>
/* 空闲时脱离布局（见组件注释）：拖动开始后由库的 `!important` 规则接管定位。 */
.workbench-drag-overlay {
    position: absolute;
    width: max-content;
    min-width: max-content;
}
</style>
