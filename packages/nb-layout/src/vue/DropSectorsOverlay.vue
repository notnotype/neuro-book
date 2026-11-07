<script setup lang="ts">
/** 落点分区（同名 .md）：拖动经过面板正文时画出这块面板能往哪放。形状由 `layoutDropSectors` 算，这里只画。 */
import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";
import {computed} from "vue";

import type {GridDropRect} from "../grid-drop";
import type {LayoutDropSector, LayoutDropSectorId} from "../layout-drop";

defineOptions({inheritAttrs: false});

const props = defineProps<{
    /** 这块面板正文的矩形（视口坐标）；没有为 null，整层不渲染。 */
    rect: GridDropRect | null;
    sectors: ReadonlyArray<LayoutDropSector>;
    /** 指针此刻落在哪块；没有为 null。 */
    active: LayoutDropSectorId | null;
    /** 每块写的字；不给不写。当前块不写：`DropFeedbackOverlay` 的提示在说它。 */
    labels?: Partial<Record<LayoutDropSectorId, string>>;
    /** 外观：`indicator` 压暗内容、线显眼；`live` 不压暗、只留淡线（实时布局，在卡片后面）。缺省 `indicator`。 */
    variant?: "indicator" | "live";
    /** 不传送到 body，就地画，`rect` 相对定位的祖先：要夹在卡片与面板之间时放进 `NestedGrid` 的 `overlay` 插槽。 */
    inline?: boolean;
}>();

/** 比这小的块不写字：编辑组最窄 220px，左右窄带约 62px，写了会压到边外和中央的字上。 */
const LABEL_MIN_WIDTH = 96;
const LABEL_MIN_HEIGHT = 28;

const box = computed(() => {
    const {rect} = props;
    if (rect === null) return null;
    const placed = {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`};
    return props.inline === true ? placed : {...placed, zIndex: NB_Z_INDEX.dropSectors};
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
    <Teleport to="body" :disabled="inline === true">
        <div v-if="box !== null && shapes.length > 0" v-bind="$attrs" class="nb-drop-sectors" :class="[variant === 'live' ? 'nb-drop-sectors--live' : '', inline === true ? 'nb-drop-sectors--inline' : '']" data-drag-feedback data-drop-sectors aria-hidden="true" :style="box">
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
/* 压暗走不透明度加调暗，不用模糊：底下的内容还要认得出（t01 决定 14）。 */
.nb-drop-sectors {
    position: fixed;
    overflow: hidden;
    /* 圆角是宿主的事：外壳给卡片下面两个角。 */
    border-radius: var(--layout-sector-radius, 0);
    background: var(--layout-scrim);
    pointer-events: none;
    animation: nb-drop-sectors-in var(--motion-fast) var(--ease-standard);
}

.nb-drop-sectors--inline {
    position: absolute;
}

.nb-drop-sectors--live {
    background: transparent;
}

.nb-drop-sectors--live .nb-drop-sectors__sector {
    fill: transparent;
    stroke: var(--layout-live-sector-line);
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
    fill: var(--layout-sector-fill);
    stroke: var(--layout-sector-line);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    transition: fill var(--motion-fast) var(--ease-standard), stroke var(--motion-fast) var(--ease-standard);
}

.nb-drop-sectors__sector--active {
    fill: var(--layout-sector-active-fill);
    stroke: var(--layout-sector-active-line);
    stroke-width: 1.5px;
}

.nb-drop-sectors__label {
    position: absolute;
    padding: 3px 12px;
    border-radius: var(--radius-pill);
    background: var(--panel-surface);
    box-shadow: 0 0 0 1px var(--layout-sector-line);
    color: var(--text-main);
    font-size: var(--text-xs);
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
        stroke: var(--layout-sector-active-line);
    }
}
</style>
