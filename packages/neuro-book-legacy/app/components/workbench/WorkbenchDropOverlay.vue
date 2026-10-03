<script setup lang="ts">
/**
 * 工作台拖放反馈适配器：把 `resolveWorkbenchDrop` 的 `preview` 与业务 `kind` 接到共享的
 * `DropFeedbackOverlay`（`@notnotype/nb-ui/components`）。
 *
 * 这里只剩业务语义：kind → 图标、`data-drop-kind` / `data-drop-orientation` / `data-drop-count`
 * 透传到覆盖层根（Lab 探针与验收脚本靠这三个属性读落点种类、轴与并入数量）。几何、内缩、标签测量、
 * 观察器生命周期与 aria-live 都在公共组件里，本组件不留第二套渲染状态。
 * 覆盖层结构、公共选择器与 ARIA 合同见 `DropFeedbackOverlay.vue`。
 */
import {computed} from "vue";
import {DropFeedbackOverlay} from "@notnotype/nb-ui/components";
import type {WorkbenchDropPreview} from "nbook/app/utils/workbench/workbench-drop";

const props = defineProps<{
    /** 当前预览；没有有效目标时 `null`（此时整层不渲染）。 */
    preview: WorkbenchDropPreview | null;
    /** 语义文案（「移动容器」「并入 N 个视图」由 `count` 给出，i18n 归调用方）。 */
    label: string;
    /** 动作种类：`data-drop-kind` 标记与提示图标都按它取。 */
    kind: string;
}>();

/** kind → 图标：静态字面量，供应用图标扫描；未知 kind 不猜图标，只留文案。 */
const KIND_ICON_CLASS: Readonly<Record<string, string>> = {
    "move-view": "i-lucide-move",
    "detach-view": "i-lucide-panel-top",
    "move-container": "i-lucide-panels-top-left",
    "merge-container": "i-lucide-combine",
    // `noop` 带预览时只承诺「保持当前布局」（内容叶中央 / 原位锚点）：图标与 Editor 的 keep 档同源。
    "noop": "i-lucide-layout-dashboard",
};

const iconClass = computed(() => Object.hasOwn(KIND_ICON_CLASS, props.kind) ? KIND_ICON_CLASS[props.kind] : undefined);
</script>

<template>
    <DropFeedbackOverlay
        :preview="preview === null ? null : {areaRect: preview.areaRect, entryRect: preview.entryRect, indicator: preview.indicator, orientation: preview.orientation, armed: preview.armed}"
        :label="label"
        :icon-class="iconClass"
        :data-drop-kind="kind"
        :data-drop-orientation="preview?.orientation ?? 'vertical'"
        :data-drop-count="preview?.count ?? 0"
    />
</template>
