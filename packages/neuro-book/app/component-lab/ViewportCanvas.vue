<script setup lang="ts">
import {computed, ref} from "vue";

type ResizeAxis = "width" | "height" | "both";

const KEYBOARD_STEP = 10;
const KEYBOARD_FINE_STEP = 1;

const props = withDefaults(defineProps<{
    width: number;
    height: number;
    minSize?: number;
    showSize?: boolean;
}>(), {
    minSize: 200,
    showSize: true,
});

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    (e: "update:height", value: number): void;
}>();

const boxRef = ref<HTMLElement | null>(null);
// 拖动期间的草稿尺寸。松手才上报，因此拖动中的每一帧只存在于这里。
const draftWidth = ref<number | null>(null);
const draftHeight = ref<number | null>(null);
const dragging = ref(false);

const shownWidth = computed(() => draftWidth.value ?? props.width);
const shownHeight = computed(() => draftHeight.value ?? props.height);

// 不限制的那一维要撑满舞台而不是缩成内容大小——一个塌成一行高的盒子
// 看不出「不限尺寸」是什么状态，还会在舞台上留下大片空白。
const boxStyle = computed(() => {
    const style: Record<string, string> = {};
    if (shownWidth.value > 0) {
        style.width = `${shownWidth.value}px`;
    } else {
        style.alignSelf = "stretch";
    }
    if (shownHeight.value > 0) {
        style.height = `${shownHeight.value}px`;
    } else {
        style.flex = "1 1 auto";
        style.minHeight = "0";
    }
    return style;
});

const sizeLabel = computed(() => {
    const w = shownWidth.value > 0 ? `${Math.round(shownWidth.value)}` : "自动";
    const h = shownHeight.value > 0 ? `${Math.round(shownHeight.value)}` : "自动";
    return `${w} × ${h}`;
});

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
    return axis === "width" ? box.offsetWidth : box.offsetHeight;
}

function startDrag(axis: ResizeAxis, event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dragging.value = true;

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = currentSize("width");
    const startHeight = currentSize("height");

    const move = (moveEvent: PointerEvent): void => {
        if (axis === "width" || axis === "both") {
            draftWidth.value = Math.max(props.minSize, startWidth + (moveEvent.clientX - startX));
        }
        if (axis === "height" || axis === "both") {
            draftHeight.value = Math.max(props.minSize, startHeight + (moveEvent.clientY - startY));
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

const handleClass = "absolute z-10 bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-main)] hover:bg-[color-mix(in_srgb,var(--accent-main)_35%,transparent)]";
</script>

<template>
    <!-- 尺寸画布：宽高受控，盒子大于舞台时靠滚动看，不缩放 -->
    <div class="nb-lab-stage h-full min-h-0 w-full overflow-auto">
        <!--
            盒子靠左上角摆，**不居中**。

            居中的话拖拽会不跟手：盒子居中时加宽 W，左右各外扩 W/2，于是右边的手柄只走
            光标位移的一半。要跟手就得让被拖的那条边之外的另一条边固定不动，也就是左上角。
        -->
        <div class="nb-lab-stage-inner flex min-h-full min-w-max flex-col items-start justify-start">
            <div
                v-if="props.showSize"
                class="nb-lab-stage-size shrink-0 tabular-nums"
            >
                {{ sizeLabel }}
            </div>

            <div
                ref="boxRef"
                class="nb-lab-stage-box relative shrink-0"
                :class="dragging ? 'select-none' : ''"
                :style="boxStyle"
            >
                <div class="nb-lab-stage-content h-full w-full overflow-auto">
                    <slot></slot>
                </div>

                <div
                    :class="handleClass"
                    class="-right-1 top-0 bottom-3 w-2 cursor-ew-resize"
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
                    :class="handleClass"
                    class="-bottom-1 left-0 right-3 h-2 cursor-ns-resize"
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
                    :class="handleClass"
                    class="-right-1 -bottom-1 h-3 w-3 cursor-nwse-resize"
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
    gap: var(--space-4);
    padding: var(--space-7);
}

.nb-lab-stage-size {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

/* 盒子是内容层：实心面板色，不透不糊，被测组件才有一个确定的底 */
.nb-lab-stage-box {
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-panel);
    background: var(--panel-surface, var(--bg-panel));
    box-shadow: var(--elevation-raised, none);
}

/* 内容层跟着裁圆角，但不能裁在盒子上——三个拖动手柄定位在盒子外侧，
   盒子一旦 overflow: hidden 手柄就消失了。 */
.nb-lab-stage-content {
    border-radius: inherit;
}
</style>
