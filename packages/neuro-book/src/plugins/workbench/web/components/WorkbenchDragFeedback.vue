<script setup lang="ts">
/** 拖放的拖影与落点反馈（同名 .md）：受控，只画宿主算好的东西。 */
import type {GridDropPoint} from "@notnotype/nb-layout";
import type {LayoutDropSectorId} from "@notnotype/nb-workbench-layout";
import {DropFeedbackOverlay, DropIndicatorLabel, DropSectorsOverlay} from "@notnotype/nb-layout/vue";
import type {DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";

import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

import type {LayoutDragSectors} from "../layout-drag";

defineOptions({name: "WorkbenchDragFeedback"});

const props = withDefaults(defineProps<{
    /** 跟着指针的拖影：拖动源的图标（视图的图标类，或文件图标）与标题；没有拖动为 null。跟手时位置经 `moveGhost` 写。 */
    ghost: {readonly label: string; readonly icon?: string; readonly fileIcon?: CatppuccinIcon | null} | null;
    /** 拖影一开始的位置（视口坐标）：不跟手的场景（Lab）用。 */
    ghostAt?: GridDropPoint;
    /** 落点预览：插入线或接收区域；没有可显示的落点为 null。 */
    preview: DropFeedbackPreview | null;
    /** 落点提示与播报的文字；空字符串不显示提示。 */
    label: string;
    /** 动作种类，写到覆盖层根的 `data-drop-kind`，供探针读。 */
    kind: string;
    /** 落点分区；没有为 null。 */
    sectors?: LayoutDragSectors | null;
    /** 落点分区每块写的字。 */
    sectorLabels?: Partial<Record<LayoutDropSectorId, string>>;
    /** 实时布局的落点文字：常驻的状态节点读给读屏。实时区域要先在 DOM 里，内容变了才播报。 */
    liveStatus?: string;
}>(), {ghostAt: () => ({x: 0, y: 0}), sectors: null, sectorLabels: () => ({}), liveStatus: ""});

/** 拖影离指针的距离。 */
const GHOST_OFFSET_PX = 12;
let ghostEl: HTMLElement | null = null;
let ghostPoint: GridDropPoint = props.ghostAt;

function writeGhost(): void {
    if (ghostEl !== null) ghostEl.style.transform = `translate(${String(ghostPoint.x + GHOST_OFFSET_PX)}px, ${String(ghostPoint.y + GHOST_OFFSET_PX)}px)`;
}

/** 拖影是 `v-if` 的：刚出现时写上最新的位置。 */
function attachGhost(element: unknown): void {
    ghostEl = element instanceof HTMLElement ? element : null;
    writeGhost();
}

defineExpose({
    /** 写拖影的位置（视口坐标）。跟手的东西不走渲染：每帧走属性的话，宿主要跟着每帧重渲染。 */
    moveGhost: (point: GridDropPoint): void => {
        ghostPoint = point;
        writeGhost();
    },
});
</script>

<template>
    <!-- 单一根（不占盒子）：反馈都在 body 下（拖影在这里传送，落点预览由覆盖层自己传送），attrs 落在这里。 -->
    <div class="workbench-drag-feedback">
        <Teleport to="body">
            <div v-if="ghost !== null" :ref="attachGhost" class="workbench-drag-ghost" data-drag-feedback data-workbench-drag-ghost :style="{zIndex: NB_Z_INDEX.dragFeedback}">
                <DropIndicatorLabel :label="ghost.label" :icon-class="ghost.icon">
                    <template v-if="ghost.fileIcon != null" #icon><FileIcon :icon="ghost.fileIcon" /></template>
                </DropIndicatorLabel>
            </div>
        </Teleport>
        <span class="sr-only" role="status" data-drag-live-status>{{ liveStatus }}</span>
        <DropSectorsOverlay class="workbench-drag-feedback__sectors" :rect="sectors?.rect ?? null" :sectors="sectors?.items ?? []" :active="sectors?.active ?? null" :labels="sectorLabels" />
        <DropFeedbackOverlay :preview="preview" :label="label" data-drag-feedback :data-drop-kind="kind" />
    </div>
</template>

<style scoped>
.workbench-drag-feedback {
    display: contents;
}

/* 正文在卡片的下半截：卡片主题下下面两个角是圆的，压暗不露到卡片外面。 */
:global(.workbench-drag-feedback__sectors) {
    --nb-layout-sector-radius: 0 0 var(--shell-card-radius, 0) var(--shell-card-radius, 0);
}

/* 拖影跟着指针，不挡命中：命中按 `elementsFromPoint` 求，`data-drag-feedback` 也会被跳过。 */
.workbench-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
}
</style>

<style>
/* 拖动进行中（会话在根元素上写的标记）：整页抓手光标、不扩选文字。 */
:root[data-workbench-dragging],
:root[data-workbench-dragging] * {
    cursor: grabbing !important;
    user-select: none !important;
}

/* 指针在面板上但放不进去：松手取消（docs/specs/ui/workbench-layout.md 输出 39）。 */
:root[data-workbench-dragging][data-drop-rejected],
:root[data-workbench-dragging][data-drop-rejected] * {
    cursor: not-allowed !important;
}

/*
 * 拖动源保持原尺寸：按钮按下的缩放在拖动开始后撤掉（按住期间 `:active` 会一直生效）。只写 `scale`：与
 * `transform` 写在同一条规则里时，构建的 CSS 压缩会把两者并成一条 `transform`，`scale` 就丢了。
 */
:root[data-workbench-dragging] :is([data-tool-entry], [data-panel-tab]),
:root[data-workbench-dragging] :is([data-tool-entry], [data-panel-tab]) * {
    scale: 1 !important;
}
</style>
