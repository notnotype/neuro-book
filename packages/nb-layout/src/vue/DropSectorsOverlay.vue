<script setup lang="ts">
/** 落点分区（同名 .md）：拖动经过面板正文时画出这块面板能往哪放。形状由宿主算（工作台用 `layoutDropSectors`），这里只画。 */
import {computed} from "vue";

import type {GridDropRect} from "../grid-drop";

defineOptions({inheritAttrs: false});

const props = defineProps<{
    /** 这块面板正文的矩形（视口坐标）；没有为 null，整层不渲染。 */
    rect: GridDropRect | null;
    /** 每块的 id 与多边形顶点（视口坐标）；id 写进 `data-drop-sector`。 */
    sectors: ReadonlyArray<{readonly id: string; readonly points: ReadonlyArray<readonly [number, number]>}>;
    /** 指针此刻落在哪块；没有为 null。 */
    active: string | null;
    /** 每块写的字，按 id 取；不给不写。当前块不写：`DropFeedbackOverlay` 的提示在说它。 */
    labels?: Readonly<Record<string, string | undefined>>;
}>();

/** 比这小的块不写字：编辑组最窄 220px，左右窄带约 62px，写了会压到边外和中央的字上。 */
const LABEL_MIN_WIDTH = 96;
const LABEL_MIN_HEIGHT = 28;

const box = computed(() => {
    const {rect} = props;
    if (rect === null) return null;
    return {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`};
});

const shapes = computed(() => {
    const {rect} = props;
    if (rect === null) return [];
    return props.sectors.map((sector) => {
        const xs = sector.points.map(([x]) => x);
        const ys = sector.points.map(([, y]) => y);
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const label = props.labels?.[sector.id] ?? null;
        const fits = (maxX - minX) * (rect.right - rect.left) >= LABEL_MIN_WIDTH && (maxY - minY) * (rect.bottom - rect.top) >= LABEL_MIN_HEIGHT;
        return {
            id: sector.id,
            // viewBox 是 100×100、不保持比例：比例坐标乘 100 就贴满正文。
            points: sector.points.map(([x, y]) => `${x * 100},${y * 100}`).join(" "),
            label: fits && sector.id !== props.active ? label : null,
            labelStyle: {left: `${((minX + maxX) / 2) * 100}%`, top: `${((minY + maxY) / 2) * 100}%`},
        };
    });
});
</script>

<template>
    <Teleport to="body">
        <div v-if="box !== null && shapes.length > 0" v-bind="$attrs" class="nb-drop-sectors" data-drag-feedback data-drop-sectors aria-hidden="true" :style="box">
            <svg class="nb-drop-sectors__shapes" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                    v-for="shape in shapes"
                    :key="shape.id"
                    class="nb-drop-sectors__sector"
                    :class="shape.id === active ? 'nb-drop-sectors__sector--active' : ''"
                    :points="shape.points"
                    :data-drop-sector="shape.id"
                    :data-drop-sector-active="shape.id === active ? '' : undefined"
                />
            </svg>
            <template v-for="shape in shapes" :key="shape.id">
                <span v-if="shape.label !== null" class="nb-drop-sectors__label" :style="shape.labelStyle" :data-drop-sector-label="shape.id">{{ shape.label }}</span>
            </template>
        </div>
    </Teleport>
</template>

<style scoped>
/* 压暗走不透明度加调暗，不用模糊：底下的内容还要认得出。 */
.nb-drop-sectors {
    position: fixed;
    /* 整页层级：nb-ui 的桥接给出层级登记表里的值，低于 `DropFeedbackOverlay`（同名 .md）。 */
    z-index: var(--nb-layout-z-drop-sectors, 59);
    overflow: hidden;
    /* 圆角是宿主的事：外壳给卡片下面两个角。 */
    border-radius: var(--nb-layout-sector-radius, 0);
    background: var(--nb-layout-scrim, color-mix(in srgb, color-mix(in srgb, #000 30%, Canvas) 60%, transparent));
    pointer-events: none;
    animation: nb-drop-sectors-in var(--nb-layout-motion-fast, 120ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

@keyframes nb-drop-sectors-in {
    from {
        opacity: 0;
    }
}

.nb-drop-sectors__shapes {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.nb-drop-sectors__sector {
    fill: var(--nb-layout-sector-fill, color-mix(in srgb, Highlight 5%, transparent));
    stroke: var(--nb-layout-sector-line, color-mix(in srgb, Highlight 65%, transparent));
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    transition: fill var(--nb-layout-motion-fast, 120ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1)), stroke var(--nb-layout-motion-fast, 120ms) var(--nb-layout-ease-layout, cubic-bezier(0.23, 1, 0.32, 1));
}

.nb-drop-sectors__sector--active {
    fill: var(--nb-layout-sector-active-fill, color-mix(in srgb, Highlight 12%, transparent));
    stroke: var(--nb-layout-sector-active-line, color-mix(in srgb, Highlight 70%, transparent));
    stroke-width: 1.5px;
}

.nb-drop-sectors__label {
    position: absolute;
    padding: 3px 12px;
    border-radius: var(--nb-layout-radius-pill, 999px);
    background: var(--nb-layout-panel-surface, Canvas);
    box-shadow: 0 0 0 1px var(--nb-layout-sector-line, color-mix(in srgb, Highlight 65%, transparent));
    color: var(--nb-layout-text-main, CanvasText);
    font-size: var(--nb-layout-text-xs, 12px);
    transform: translate(-50%, -50%);
    white-space: nowrap;
}

/* 系统色会把半透明的压暗换成不透明的底，盖住内容：只留线。 */
@media (forced-colors: active) {
    .nb-drop-sectors {
        background: transparent;
    }

    .nb-drop-sectors__sector {
        fill: transparent;
        stroke: CanvasText;
    }

    .nb-drop-sectors__sector--active {
        stroke: Highlight;
        stroke-width: 3px;
    }
}

@media (prefers-contrast: more) {
    .nb-drop-sectors__sector {
        stroke: var(--nb-layout-sector-active-line, color-mix(in srgb, Highlight 70%, transparent));
    }
}
</style>
