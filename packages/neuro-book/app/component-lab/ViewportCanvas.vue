<script setup lang="ts">
import {computed, ref} from "vue";
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
}>(), {
    minSize: 200,
    showSize: true,
    zoom: LAB_DEFAULT_ZOOM,
    backdrop: LAB_DEFAULT_BACKDROP,
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

// 两维的「不限尺寸」不是同一件事，因为舞台横向铺满、纵向顶对齐：
//   宽 —— 撑满舞台。一个缩成内容宽的盒子看不出「不限宽度」是什么状态。
//   高 —— 就是组件自己的高度。这里原来也写了 alignSelf: stretch，但纵向的轨道按内容定高，
//         那一行从来没有生效过；顶对齐之后更不该生效——组件本来就该露出它的自然高度。
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
    } else {
        style.justifySelf = "stretch";
    }
    if (shownHeight.value > 0) {
        style.height = `${shownHeight.value}px`;
    }
    return style;
});

const sizeLabel = computed(() => {
    const w = shownWidth.value > 0 ? `${Math.round(shownWidth.value)}` : "自动";
    const h = shownHeight.value > 0 ? `${Math.round(shownHeight.value)}` : "自动";
    const zoom = props.zoom === 1 ? "" : `　·　${Math.round(props.zoom * 100)}%`;
    return `${w} × ${h}${zoom}`;
});

/**
 * 从光标的**绝对位置**反推尺寸，而不是「起始尺寸 + 位移」。
 *
 * 两个轴的式子不一样，因为盒子在舞台里**横向居中、纵向顶对齐**：
 *
 * - 宽：居中的盒子加宽 W 会左右各外扩 W/2，按位移累加的话右手柄只走光标的一半，就是之前
 *   那个不跟手。居中时被拖的那条边到中心的距离是宽度的一半，于是 宽 = 2 ×（光标 − 中心）；
 *   盒子长到比舞台还宽之后它不再居中、左边缘钉死，换成 宽 = 光标 − 左边缘。
 *   两条式子在「刚好填满」那一点取值相同，切换处不会跳。
 * - 高：上边缘顶死在舞台顶部、不随高度移动，所以直接是 高 = 光标 − 上边缘。
 *   顶对齐之前这一轴也走上面那条居中式子，改成顶对齐就必须跟着换，否则下手柄走一半。
 *
 * 每一帧都重新量，所以中途改缩放、拖出滚动条都自动跟上。
 */
function sizeFromPointer(axis: "width" | "height", pointer: number): number {
    if (axis === "height") {
        const box = boxRef.value;
        if (box === null) {
            return props.minSize;
        }
        // rect 是屏幕像素，zoom 已经乘进去了，除回来才是声明尺寸
        return Math.max(props.minSize, (pointer - box.getBoundingClientRect().top) / props.zoom);
    }

    const inner = innerRef.value;
    if (inner === null) {
        return props.minSize;
    }
    const rect = inner.getBoundingClientRect();
    const style = getComputedStyle(inner);
    const padStart = Number.parseFloat(style.paddingLeft);
    const padEnd = Number.parseFloat(style.paddingRight);
    const avail = inner.clientWidth - padStart - padEnd;
    const contentStart = rect.left + padStart;

    const centered = 2 * (pointer - (contentStart + avail / 2));
    const onScreen = centered <= avail ? centered : pointer - contentStart;
    return Math.max(props.minSize, onScreen / props.zoom);
}

/** 不限制的那一维没有数值可拖，取当前实测尺寸作为拖动起点。 */
function currentSize(axis: "width" | "height"): number {
    const declared = axis === "width" ? props.width : props.height;
    if (declared > 0) {
        return declared;
    }
    const box = boxRef.value;
    if (!box) {
        return props.minSize;
    }
    // getBoundingClientRect 给的是屏幕像素，zoom 已经乘进去了，除回来才是声明尺寸
    const rect = box.getBoundingClientRect();
    return (axis === "width" ? rect.width : rect.height) / props.zoom;
}

function startDrag(axis: ResizeAxis, event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dragging.value = true;

    const move = (moveEvent: PointerEvent): void => {
        if (axis === "width" || axis === "both") {
            draftWidth.value = sizeFromPointer("width", moveEvent.clientX);
        }
        if (axis === "height" || axis === "both") {
            draftHeight.value = sizeFromPointer("height", moveEvent.clientY);
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
        emit("update:width", Math.max(props.minSize, currentSize("width") + deltaX));
    }
    if (deltaY !== 0) {
        emit("update:height", Math.max(props.minSize, currentSize("height") + deltaY));
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
        <div ref="innerRef" class="nb-lab-stage-inner">
            <div
                v-if="props.showSize"
                class="nb-lab-stage-size tabular-nums"
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
                    :aria-valuemin="props.minSize"
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
                    :aria-valuemin="props.minSize"
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
    min-width: max-content;
    /* 顶对齐而不是居中：组件比舞台矮的时候，居中会在它上下各留一大片空，
       盒子读起来像浮在中间不知道钉在哪。顶对齐之后空白全归到下面一块，
       那块空白就是中栏这扇窗透出来的桌面本身，正好是它该有的样子。
       下手柄的算法跟这一条绑死，见 sizeFromPointer。 */
    align-content: start;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-7);
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
