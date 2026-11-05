<script setup lang="ts">
/** 拖放的拖影、预备区与落点反馈（同名 .md）：受控，只画宿主算好的东西。 */
import {DropFeedbackOverlay, DropIndicatorLabel} from "@notnotype/nb-layout/vue";
import type {DropFeedbackPreview} from "@notnotype/nb-layout/vue";
import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";

defineOptions({name: "WorkbenchDragFeedback"});

withDefaults(defineProps<{
    /** 跟着指针的拖影：拖动源的图标与标题，`x`、`y` 是指针的视口坐标；没有拖动为 null。 */
    ghost: {readonly label: string; readonly icon: string; readonly x: number; readonly y: number} | null;
    /**
     * 拖动时浮出的预备区：没显示的 Part 显示出来会在的矩形（视口坐标）、名称与图标；`active` 是指针正停在上面的那块，
     * 它由落点高亮接管，不再画自己的提示。
     */
    zones?: ReadonlyArray<{readonly part: string; readonly rect: {readonly left: number; readonly top: number; readonly right: number; readonly bottom: number}; readonly label: string; readonly icon: string; readonly active: boolean}>;
    /** 落点预览：插入线或接收区域；没有可显示的落点为 null。 */
    preview: DropFeedbackPreview | null;
    /** 落点提示与播报的文字；空字符串不显示提示。 */
    label: string;
    /** 动作种类与拖动的视图数，写到覆盖层根的 `data-drop-kind`、`data-drop-count`，供探针读。 */
    kind: string;
    count: number;
}>(), {zones: () => []});

defineEmits<{
    /** 放下后的收尾淡出完了：宿主清掉收尾的预览。 */
    (event: "settled"): void;
}>();
</script>

<template>
    <!-- 单一根（不占盒子）：反馈都在 body 下（拖影与预备区在这里传送，落点预览由覆盖层自己传送），attrs 落在这里。 -->
    <div class="workbench-drag-feedback">
        <Teleport to="body">
            <TransitionGroup name="workbench-reveal-zone">
                <div
                    v-for="zone in zones"
                    :key="zone.part"
                    class="workbench-reveal-zone"
                    data-drag-feedback
                    :data-reveal-zone="zone.part"
                    :data-reveal-active="zone.active ? 'true' : undefined"
                    :style="{left: `${zone.rect.left}px`, top: `${zone.rect.top}px`, width: `${zone.rect.right - zone.rect.left}px`, height: `${zone.rect.bottom - zone.rect.top}px`, zIndex: NB_Z_INDEX.dropFeedback}"
                >
                    <div class="workbench-reveal-zone__box">
                        <span class="workbench-reveal-zone__hint"><span class="workbench-reveal-zone__icon" :class="zone.icon" aria-hidden="true"></span>{{ zone.label }}</span>
                    </div>
                </div>
            </TransitionGroup>
            <div v-if="ghost !== null" class="workbench-drag-ghost" data-drag-feedback data-workbench-drag-ghost :style="{left: `${ghost.x + 12}px`, top: `${ghost.y + 12}px`, zIndex: NB_Z_INDEX.dragFeedback}">
                <DropIndicatorLabel :label="ghost.label" :icon-class="ghost.icon" />
            </div>
        </Teleport>
        <DropFeedbackOverlay :preview="preview" :label="label" data-drag-feedback :data-drop-kind="kind" :data-drop-count="count" @settled="$emit('settled')" />
    </div>
</template>

<style scoped>
.workbench-drag-feedback {
    display: contents;
}

/*
 * 预备区叠在当前布局上、不接指针（会话按几何找它，真实落点优先）：半透明的面板底加虚线框，中央一枚图标加名称。
 * 拖动开始时淡入，结束或取消时淡出；指针停在上面时提示让给落点高亮的“放到 X”。
 */
.workbench-reveal-zone {
    position: fixed;
    padding: 4px;
    pointer-events: none;
}

.workbench-reveal-zone__box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border: 1px dashed color-mix(in srgb, var(--accent-main) 45%, transparent);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--panel-surface) 72%, transparent);
}

.workbench-reveal-zone__hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: opacity var(--motion-fast) var(--ease-standard);
}

.workbench-reveal-zone[data-reveal-active] .workbench-reveal-zone__hint {
    opacity: 0;
}

.workbench-reveal-zone__icon {
    width: 14px;
    height: 14px;
}

.workbench-reveal-zone-enter-active,
.workbench-reveal-zone-leave-active {
    transition: opacity var(--motion-base) var(--ease-standard);
}

.workbench-reveal-zone-enter-from,
.workbench-reveal-zone-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .workbench-reveal-zone-enter-active,
    .workbench-reveal-zone-leave-active {
        transition: none;
    }
}

/* 拖影跟着指针，不挡命中：命中按 `elementsFromPoint` 求，`data-drag-feedback` 也会被跳过。 */
.workbench-drag-ghost {
    position: fixed;
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
