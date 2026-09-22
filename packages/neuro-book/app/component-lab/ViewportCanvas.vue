<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {LAB_DEFAULT_BACKDROP, LAB_DEFAULT_ZOOM} from "./stage-backdrops";

type ResizeAxis = "width" | "height" | "both";

const KEYBOARD_STEP = 10;
const KEYBOARD_FINE_STEP = 1;

const props = withDefaults(defineProps<{
    width: number;
    height: number;
    minSize?: number;
    showSize?: boolean;
    zoom?: number;
    backdrop?: string;
    displayMode?: "tight" | "fill";
}>(), {
    minSize: 200,
    showSize: true,
    zoom: LAB_DEFAULT_ZOOM,
    backdrop: LAB_DEFAULT_BACKDROP,
    displayMode: "tight",
});

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const innerRef = ref<HTMLElement | null>(null);
const boxRef = ref<HTMLElement | null>(null);
// 拖动期间的草稿尺寸。松手才上报，因此拖动中的每一帧只存在于这里。
const draftWidth = ref<number | null>(null);
const draftHeight = ref<number | null>(null);
const dragging = ref(false);

const shownWidth = computed(() => draftWidth.value ?? props.width);
const shownHeight = computed(() => draftHeight.value ?? props.height);

const minWidth = computed(() => (props.displayMode === "tight" ? 120 : props.minSize));
const minHeight = computed(() => (props.displayMode === "tight" ? 32 : props.minSize));

const boxStyle = computed(() => {
    const style: Record<string, string> = {
        // 缩放用 CSS zoom 而不是 transform: scale。scale 只改绘制不改布局，被缩小的盒子
        // 仍占原尺寸的位置，居中和滚动条全都对不上，还得再套一层壳去补回布局尺寸。
        // zoom 参与布局，「不限尺寸」那一维也能照常撑开。
        zoom: String(props.zoom),
        // 手柄是盒子的子元素，会跟着一起缩。缩到 50% 时 8px 的抓取区只剩 4px，
        // 所以按倍率的倒数把它补回来。
        "--lab-inv-zoom": String(1 / props.zoom),
    };

    if (shownWidth.value > 0) {
        style.width = `${shownWidth.value}px`;
    } else if (props.displayMode === "fill") {
        style.width = "100%";
        style.justifySelf = "stretch";
    } else {
        // tight 模式：小部件在未指定宽度时，默认给予 640px 舒适操作宽度（不超过视区）
        style.width = "640px";
        style.maxWidth = "calc(100% - 2 * var(--space-7))";
    }

    if (shownHeight.value > 0) {
        style.height = `${shownHeight.value}px`;
    } else if (props.displayMode === "fill") {
        style.height = "100%";
        style.alignSelf = "stretch";
        style.minHeight = "min(640px, 100%)";
    } else {
        // tight 模式：完全自适应组件实际内容高度，绝不强制撑开假大空白
        style.height = "auto";
    }

    return style;
});

const measuredWidth = ref(0);
const measuredHeight = ref(0);

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
    if (boxRef.value && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                measuredWidth.value = Math.round(rect.width / props.zoom);
                measuredHeight.value = Math.round(rect.height / props.zoom);
            }
        });
        resizeObserver.observe(boxRef.value);
    }
});
onBeforeUnmount(() => {
    resizeObserver?.disconnect();
});

const sizeLabel = computed(() => {
    const w = shownWidth.value > 0
        ? `${Math.round(shownWidth.value)}`
        : (measuredWidth.value > 0 ? `${measuredWidth.value}` : "自适应");
    const h = shownHeight.value > 0
        ? `${Math.round(shownHeight.value)}`
        : (measuredHeight.value > 0 ? `${measuredHeight.value}` : "自适应");
    const isAuto = shownWidth.value <= 0 && shownHeight.value <= 0;
    const autoTag = isAuto ? " (自适应)" : (shownHeight.value <= 0 ? " (高自适应)" : "");
    const zoom = props.zoom === 1 ? "" : `　·　${Math.round(props.zoom * 100)}%`;
    return `${w} × ${h}${autoTag}${zoom}`;
});

function resetSize(): void {
    emit("update:width", 0);
    emit("update:height", 0);
}

/** 不限制的那一维没有数值可拖，取当前实测尺寸作为拖动起点。 */
function currentSize(axis: "width" | "height"): number {
    const declared = axis === "width" ? props.width : props.height;
    if (declared > 0) {
        return declared;
    }
    const box = boxRef.value;
    if (!box) {
        return axis === "width" ? minWidth.value : minHeight.value;
    }
    // getBoundingClientRect 给的是屏幕像素，zoom 已经乘进去了，除回来才是声明尺寸
    const rect = box.getBoundingClientRect();
    return Math.round((axis === "width" ? rect.width : rect.height) / props.zoom);
}

function startDrag(axis: ResizeAxis, event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dragging.value = true;

    const startX = event.clientX;
    const startY = event.clientY;
    const startW = currentSize("width");
    const startH = currentSize("height");
    // 起拖下限：取当前尺寸与最小限制的较小值，杜绝瞬间由 79px 跃迁至 200px 的跳动
    const safeMinWidth = Math.min(minWidth.value, startW);
    const safeMinHeight = Math.min(minHeight.value, startH);

    const move = (moveEvent: PointerEvent): void => {
        if (axis === "width" || axis === "both") {
            const deltaX = (moveEvent.clientX - startX) / props.zoom;
            // 居中扩展：由于盒子居中对齐，左右两边对称扩缩，因此拖动右手柄时宽度增量为 2 * deltaX
            draftWidth.value = Math.max(safeMinWidth, Math.round(startW + 2 * deltaX));
        }
        if (axis === "height" || axis === "both") {
            const deltaY = (moveEvent.clientY - startY) / props.zoom;
            if (props.displayMode === "tight") {
                // tight 模式下盒子垂直居中，双向扩缩
                draftHeight.value = Math.max(safeMinHeight, Math.round(startH + 2 * deltaY));
            } else {
                // fill 模式下单向向下扩缩
                draftHeight.value = Math.max(safeMinHeight, Math.round(startH + deltaY));
            }
        }
    };

    const finish = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        if (draftWidth.value !== null) {
            emit("update:width", Math.round(draftWidth.value));
        }
        if (draftHeight.value !== null) {
            emit("update:height", Math.round(draftHeight.value));
        }
        draftWidth.value = null;
        draftHeight.value = null;
        dragging.value = false;
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
}

/** 按键是离散动作，没有中间过程，因此每按一次就上报一次。 */
function handleKeydown(axis: ResizeAxis, event: KeyboardEvent): void {
    const step = event.shiftKey ? KEYBOARD_FINE_STEP : KEYBOARD_STEP;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") {
        deltaX = -step;
    } else if (event.key === "ArrowRight") {
        deltaX = step;
    } else if (event.key === "ArrowUp") {
        deltaY = -step;
    } else if (event.key === "ArrowDown") {
        deltaY = step;
    } else {
        return;
    }

    const acceptsX = axis === "width" || axis === "both";
    const acceptsY = axis === "height" || axis === "both";
    if ((deltaX !== 0 && !acceptsX) || (deltaY !== 0 && !acceptsY)) {
        return;
    }

    event.preventDefault();
    if (deltaX !== 0) {
        emit("update:width", Math.max(minWidth.value, Math.round(currentSize("width") + deltaX)));
    }
    if (deltaY !== 0) {
        emit("update:height", Math.max(minHeight.value, Math.round(currentSize("height") + deltaY)));
    }
}
</script>

<template>
    <!-- 尺寸画布：宽高受控，盒子大于舞台时靠滚动看 -->
    <div class="nb-lab-stage h-full min-h-0 w-full overflow-auto">
        <!--
            用 grid + place-items: center 居中，不用 flex 的 justify-content: center。
            两者在「内容比容器大」时不一样：flex 居中会把溢出的那一半推到 scroll 起点之外，
            向左滚也看不到；grid 的轨道在这种情况下退化成 max-content，起点仍在 padding 处。
        -->
        <div ref="innerRef" class="nb-lab-stage-inner" :class="`nb-lab-stage-inner--${props.displayMode}`">
            <div
                v-if="props.showSize"
                class="nb-lab-stage-size tabular-nums cursor-pointer select-none transition-colors hover:text-[var(--text-main)]"
                title="双击恢复自适应尺寸"
                @dblclick="resetSize"
            >
                {{ sizeLabel }}
            </div>

            <div
                ref="boxRef"
                class="nb-lab-stage-box relative"
                :class="[`nb-lab-stage-box--${props.backdrop}`, dragging ? 'select-none' : '']"
                :style="boxStyle"
            >
                <div class="nb-lab-stage-content h-full w-full overflow-auto">
                    <slot></slot>
                </div>

                <div
                    class="nb-lab-stage-handle nb-lab-stage-handle--e"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整宽度"
                    :aria-valuenow="Math.round(shownWidth)"
                    :aria-valuemin="minWidth"
                    tabindex="0"
                    @pointerdown.prevent="startDrag('width', $event)"
                    @keydown="handleKeydown('width', $event)"
                ></div>

                <div
                    class="nb-lab-stage-handle nb-lab-stage-handle--s"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="调整高度"
                    :aria-valuenow="Math.round(shownHeight)"
                    :aria-valuemin="minHeight"
                    tabindex="0"
                    @pointerdown.prevent="startDrag('height', $event)"
                    @keydown="handleKeydown('height', $event)"
                ></div>

                <div
                    class="nb-lab-stage-handle nb-lab-stage-handle--se"
                    role="separator"
                    aria-label="同时调整宽高"
                    tabindex="0"
                    @pointerdown.prevent="startDrag('both', $event)"
                    @keydown="handleKeydown('both', $event)"
                ></div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 舞台与盒子的形状走主题 token：换主题时圆角、留白、抬起感应该一起变 */

/* 舞台本身不上色：它是盒子四周的留白，透出 LabShell 铺的窗体底纹。
   给它一层实心 --bg-subtle 的话，整块中栏会变成一片大平色，
   底纹与玻璃在这里就都看不见了——盒子外面本来就该是「桌面」。 */
.nb-lab-stage {
    background: transparent;
}

.nb-lab-stage-inner {
    display: grid;
    min-height: 100%;
    width: 100%;
    box-sizing: border-box;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-7);
}

/* tight 模式：小部件在舞台中央垂直+水平居中，行高自适应包裹内容 */
.nb-lab-stage-inner--tight {
    grid-template-rows: auto auto;
    place-content: safe center;
}

/* fill 模式：全景工作区视图纵向撑满舞台 */
.nb-lab-stage-inner--fill {
    grid-template-rows: auto 1fr;
    align-content: stretch;
}

.nb-lab-stage-size {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

/* 盒子是内容盒：默认厚玻璃的面板色，被测组件才有一个确定的底。
   底可以换（见 stage-backdrops.ts），换的是这一层的 background。
   要一块完全不受桌面影响的底来判读组件自己的颜色，把画布底切到「纯白」或「纯黑」。 */
.nb-lab-stage-box {
    /* 自适应画布不能以标签整排的 min-content 宽度反撑 grid 轨道。显式尺寸仍由 width 控制。 */
    min-width: 0;
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-panel);
    box-shadow: var(--elevation-raised, none);
}

/* 内容层跟着裁圆角，但不能裁在盒子上——三个拖动手柄定位在盒子外侧，
   盒子一旦 overflow: hidden 手柄就消失了。 */
.nb-lab-stage-content {
    border-radius: inherit;
}

/* ——— 画布底 ——— */

/* 盒子的面：厚玻璃，不是实心。留那几个百分点的透光是为了让这块面和背后的桌面还有关系——
   完全不透光的白板压在窗体底纹上像贴上去的，与整页的玻璃语言脱节。
   页面可以用 --lab-surface / --lab-surface-blur 改写；不改写时落回主题的实心面板色。 */
.nb-lab-stage-box--panel {
    background: var(--lab-surface, var(--panel-surface, var(--bg-panel)));
    backdrop-filter: var(--lab-surface-blur, none);
    -webkit-backdrop-filter: var(--lab-surface-blur, none);
}

.nb-lab-stage-box--page {
    background: var(--bg-main);
}

/* 不给面，桌面直接透上来。盒子退成一个纯框，用来看组件自己画不画底、
   以及它压在一个不受控的背景上会不会读不清。 */
.nb-lab-stage-box--none {
    background: transparent;
}

/* 主题自带的那张「桌面壁纸」。没声明它的主题落到面板色，不至于变成透明。 */
.nb-lab-stage-box--theme {
    background-color: var(--bg-main);
    background-image: var(--window-backdrop, none);
    background-size: cover;
    background-position: center;
}

/* 棋盘格验的是透明度：半透明的面压上去，能一眼看出透出来多少 */
.nb-lab-stage-box--checker {
    background-color: var(--bg-main);
    background-image:
        linear-gradient(45deg, color-mix(in srgb, var(--text-main) 10%, transparent) 25%, transparent 25%),
        linear-gradient(-45deg, color-mix(in srgb, var(--text-main) 10%, transparent) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--text-main) 10%, transparent) 75%),
        linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--text-main) 10%, transparent) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.nb-lab-stage-box--grid {
    background-color: var(--panel-surface, var(--bg-panel));
    background-image: radial-gradient(color-mix(in srgb, var(--text-main) 14%, transparent) 1.2px, transparent 1.2px);
    background-size: 18px 18px;
}

/* 极光是给玻璃用的：大面积、低频、高饱和，模糊之后仍有色相流动可看 */
.nb-lab-stage-box--mesh {
    background-color: var(--panel-surface, var(--bg-panel));
    background-image:
        radial-gradient(at 10% 20%, color-mix(in srgb, var(--accent-main) 32%, transparent) 0, transparent 50%),
        radial-gradient(at 85% 15%, color-mix(in srgb, var(--status-info) 35%, transparent) 0, transparent 50%),
        radial-gradient(at 50% 85%, color-mix(in srgb, var(--status-warning) 28%, transparent) 0, transparent 50%),
        radial-gradient(at 90% 85%, color-mix(in srgb, var(--accent-main) 30%, transparent) 0, transparent 50%);
}

/* 纯黑纯白是对比度的两个极端，故意不走配色变量：它要跳出当前配色才有意义 */
.nb-lab-stage-box--light {
    background: #ffffff;
}

.nb-lab-stage-box--dark {
    background: #000000;
}

/* ——— 拖动手柄 ——— */

.nb-lab-stage-handle {
    position: absolute;
    z-index: 10;
    background: transparent;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

.nb-lab-stage-handle:hover {
    background: color-mix(in srgb, var(--accent-main) 35%, transparent);
}

.nb-lab-stage-handle:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 1px;
}

/* 抓取区按缩放倒数补回来：盒子被 zoom 缩小时手柄跟着缩，50% 下 8px 只剩 4px */
.nb-lab-stage-handle--e {
    top: 0;
    right: calc(-4px * var(--lab-inv-zoom, 1));
    bottom: calc(12px * var(--lab-inv-zoom, 1));
    width: calc(8px * var(--lab-inv-zoom, 1));
    cursor: ew-resize;
}

.nb-lab-stage-handle--s {
    left: 0;
    right: calc(12px * var(--lab-inv-zoom, 1));
    bottom: calc(-4px * var(--lab-inv-zoom, 1));
    height: calc(8px * var(--lab-inv-zoom, 1));
    cursor: ns-resize;
}

.nb-lab-stage-handle--se {
    right: calc(-4px * var(--lab-inv-zoom, 1));
    bottom: calc(-4px * var(--lab-inv-zoom, 1));
    width: calc(12px * var(--lab-inv-zoom, 1));
    height: calc(12px * var(--lab-inv-zoom, 1));
    cursor: nwse-resize;
}
</style>
