<script lang="ts">
import type {GridDropRect} from "./grid-drop";
import type {GridOrientation} from "./grid-types";

/**
 * 拖放反馈覆盖层的预览几何：三份矩形都是宿主的**语义命中几何**（viewport client 坐标），不是内缩后的
 * 绘制盒。落点解析归宿主，本类型只是搬运。
 *
 * - `areaRect`：内容落点接住的半区 / 空容器整个内容盒；
 * - `entryRect`：要高亮的切换器条目；
 * - `indicator`：插入线，只在没有有效半区的落点画；
 * - `orientation`：目标容器主轴，决定插入线的长轴与短轴。
 *
 * 业务语义（落点种类、并入数量、文案与播报）全部由宿主决定：种类/数量走调用方的 `data-*` 属性，
 * 图标走 `iconClass`，文案走 `label`。
 */
export type DropFeedbackPreview = Readonly<{
    readonly areaRect: GridDropRect | null;
    readonly entryRect: GridDropRect | null;
    readonly indicator: GridDropRect | null;
    readonly orientation: GridOrientation;
    /** false 表示保留上一份半区但当前不可提交；缺省按可提交绘制。 */
    readonly armed?: boolean;
}>;
</script>

<script setup lang="ts">
/**
 * 共享拖放反馈覆盖层：把宿主给出的 `preview` 画出来。Editor 与 Workbench 共用这一份渲染与测量。
 *
 * 结构：
 * - 区域（`[data-drop-feedback-area]`）：内容落点的半区 / 空容器整个内容盒，四边内缩 `min(6, 尺寸/4)`；
 * - 插线（`[data-drop-feedback-line]`）：沿目标轴的实色插入线，只在长轴两端内缩 `min(2, 长轴/4)`；只在没有
 *   有效半区的落点画——内容落点的 `preview` 同时给半区与插线，两个形状会叠成两个落点；
 * - 条目（`[data-drop-feedback-entry]`）：切换器上接收条目 / 锚点条目，不内缩；
 * - 标签（`[data-drop-feedback-label]`）：独立 fixed 包装的提示药丸，图标随 `iconClass`；只要还有有效形状
 *   和非空文案就显示；
 * - 无障碍（`[data-drop-feedback-live]`）：独立 aria-live 播报，仅在语义标签变化时更新，不逐像素播报。
 * - 动效：区域首次出现淡入；连续换区复用同一节点，对绘制位置/尺寸做过渡，提示随行但文案立即更新。
 *   插线即时定位；取消即卸载、没有离场帧；减少动效时直接呈现目标几何。
 *
 * 皮肤在 `DropIndicator` / `DropIndicatorLabel` 上，本组件只提供 Teleport、定位、内缩、标签测量与动效。
 * 命中与提交始终用 `preview` 的原始矩形；内缩只改绘制盒，不回写 `preview`。
 * 非正面积几何先过 `isGridDropRect`，全部无效时整层不渲染。
 * 覆盖层挂在 body、fixed viewport、`pointer-events: none`，不拦截指针事件；attrs 透传到覆盖层根
 * （`<Teleport>` 不会自动继承，见 `useAttrs`），宿主据此挂 `data-drop-*` 一类语义标记。
 */
import {computed, onBeforeUnmount, ref, useAttrs, watch} from "vue";
import DropIndicator from "./DropIndicator.vue";
import DropIndicatorLabel from "./DropIndicatorLabel.vue";
import {isGridDropRect} from "./grid-drop";

defineOptions({inheritAttrs: false});

const props = defineProps<{
    /** 当前预览；没有有效目标时 `null`（此时整层不渲染）。 */
    preview: DropFeedbackPreview | null;
    /** 语义文案（i18n 归调用方）。 */
    label: string;
    /** 提示图标 class；业务种类 → 图标的映射归调用方。 */
    iconClass?: string;
}>();

const attrs = useAttrs();

/**
 * 内联盒样式只写 viewport 坐标。
 *
 * 必须是 `type` 别名而非 `interface`：`CSSProperties` 的 `` `--${string}` `` 索引签名
 * 只对匿名 / 别名对象类型合成隐式索引签名，`interface` 会被 `StyleValue` 判为不兼容。
 */
type BoxStyle = {
    left: string;
    top: string;
    width: string;
    height: string;
};

type LabelStyle = {
    left: string;
    top: string;
    visibility: "hidden" | "visible";
};

/** 绘制留白：窄/折叠目标也要保住正面积，所以内缩按尺寸比例封顶。 */
const AREA_INSET_PX = 6;
const LINE_INSET_PX = 2;
/** 标签与锚点的间隙、半区容得下标签的余量、viewport 夹紧上限。 */
const LABEL_GAP_PX = 6;
const LABEL_FIT_PADDING_PX = 16;
const VIEWPORT_MARGIN_PX = 8;

function boxStyle(left: number, top: number, width: number, height: number): BoxStyle {
    return {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`};
}

/** 零尺寸 / NaN 矩形一律拒绝，不伪造几何。 */
function validRect(rect: GridDropRect | null | undefined): GridDropRect | null {
    return rect !== null && rect !== undefined && isGridDropRect(rect) ? rect : null;
}

function areaBox(rect: GridDropRect): BoxStyle {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const insetX = Math.min(AREA_INSET_PX, width / 4);
    const insetY = Math.min(AREA_INSET_PX, height / 4);
    return boxStyle(rect.left + insetX, rect.top + insetY, width - insetX * 2, height - insetY * 2);
}

/**
 * 插入线垂直于容器主轴：主轴竖直时线是横线（长轴在 x），主轴水平时线是竖线（长轴在 y）。
 * 只缩长轴两端，2px 短轴厚度与插入边界保持 `preview` 原值。
 */
function lineBox(rect: GridDropRect, orientation: GridOrientation): BoxStyle {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (orientation === "horizontal") {
        const inset = Math.min(LINE_INSET_PX, height / 4);
        return boxStyle(rect.left, rect.top + inset, width, height - inset * 2);
    }
    const inset = Math.min(LINE_INSET_PX, width / 4);
    return boxStyle(rect.left + inset, rect.top, width - inset * 2, height);
}

const areaRect = computed(() => validRect(props.preview?.areaRect));
const entryRect = computed(() => validRect(props.preview?.entryRect));
const lineRect = computed(() => validRect(props.preview?.indicator));
const orientation = computed<GridOrientation>(() => props.preview?.orientation ?? "vertical");

const areaBoxStyle = computed(() => (areaRect.value === null ? null : areaBox(areaRect.value)));

/**
 * 插线只在没有有效半区的落点画：内容落点的 `preview` 同时给出半区与插入线，两者叠在同一条边缘上会被读成
 * 两个落点，而内缩后的半区已经完整承诺了插入位。半区非法（零尺寸 / NaN）时不吞插线，仍按原几何画线。
 */
const lineBoxStyle = computed(() => {
    return areaBoxStyle.value !== null || lineRect.value === null ? null : lineBox(lineRect.value, orientation.value);
});

const entryBoxStyle = computed(() => {
    const rect = entryRect.value;
    return rect === null ? null : boxStyle(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
});

const hasVisibleFeedback = computed(() => {
    return areaBoxStyle.value !== null || lineBoxStyle.value !== null || entryBoxStyle.value !== null;
});

/** 标签锚点：依序取有效半区、条目、插线；锚点始终是 `preview` 的语义矩形，不是内缩后的绘制盒。 */
const anchor = computed<{rect: GridDropRect; area: boolean} | null>(() => {
    if (areaRect.value !== null) {
        return {rect: areaRect.value, area: true};
    }
    if (entryRect.value !== null) {
        return {rect: entryRect.value, area: false};
    }
    if (lineRect.value !== null) {
        return {rect: lineRect.value, area: false};
    }
    return null;
});

const labelText = computed(() => props.label.trim());


// ── 标签测量与排布 ───────────────────────────────────────────────────────────

const overlayRef = ref<HTMLElement | null>(null);
const labelRef = ref<HTMLElement | null>(null);
/** 真实测量缓存：元素 + 签名（文案 / 图标）+ 尺寸；坐标变化只用缓存重排，不重读布局。 */
let measured: {element: HTMLElement; signature: string; size: {width: number; height: number}} | null = null;
const labelSize = ref<{width: number; height: number} | null>(null);
const viewport = ref({width: 0, height: 0});
const announcedText = ref("");

/**
 * 补一次真实测量：viewport 每次都同步（纯读 window，不触发布局），
 * 元素没换、签名没变且已有尺寸时直接返回，避免 pointer 帧强制读布局。
 */
function refreshGeometry(force: boolean): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width !== viewport.value.width || height !== viewport.value.height) {
        viewport.value = {width, height};
    }
    const element = labelRef.value;
    if (element === null) {
        measured = null;
        if (labelSize.value !== null) {
            labelSize.value = null;
        }
        return;
    }
    const signature = `${props.label}\u0000${props.iconClass ?? ""}`;
    if (!force && measured !== null && measured.element === element && measured.signature === signature) {
        return;
    }
    const size = {width: element.offsetWidth, height: element.offsetHeight};
    measured = {element, signature, size};
    const current = labelSize.value;
    if (current === null || current.width !== size.width || current.height !== size.height) {
        labelSize.value = size;
    }
}

let observer: ResizeObserver | null = null;

/** 一个 observer 同时盯住 overlay 根与标签包装：尺寸（含字体/视口）变化都回到同一次测量。 */
function syncObservedTargets(): void {
    observer ??= typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
        refreshGeometry(true);
    });
    const active = observer;
    if (active === null) {
        return;
    }
    active.disconnect();
    if (overlayRef.value !== null) {
        active.observe(overlayRef.value);
    }
    if (labelRef.value !== null) {
        active.observe(labelRef.value);
    }
}

onBeforeUnmount(() => {
    observer?.disconnect();
});

// 元素挂载/替换：重新观察并强制补测（首帧只把待测标签设成 hidden，形状即时显示）。
watch([overlayRef, labelRef], () => {
    syncObservedTargets();
    refreshGeometry(true);
}, {flush: "post"});

// 文案 / 图标变化后补测；纯坐标变化只按缓存重排。
watch([() => props.preview, () => props.label, () => props.iconClass], () => {
    refreshGeometry(false);
}, {flush: "post"});

const labelLayout = computed<{left: string; top: string} | null>(() => {
    const target = anchor.value;
    const size = labelSize.value;
    const {width: viewportWidth, height: viewportHeight} = viewport.value;
    if (target === null || size === null || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
    }
    const anchorWidth = target.rect.right - target.rect.left;
    const anchorHeight = target.rect.bottom - target.rect.top;
    const marginX = Math.min(VIEWPORT_MARGIN_PX, Math.max(0, (viewportWidth - size.width) / 2));
    const marginY = Math.min(VIEWPORT_MARGIN_PX, Math.max(0, (viewportHeight - size.height) / 2));
    const left = target.rect.left + (anchorWidth - size.width) / 2;
    let top: number;
    if (target.area && anchorWidth >= size.width + LABEL_FIT_PADDING_PX && anchorHeight >= size.height + LABEL_FIT_PADDING_PX) {
        // 半区容得下「标签 + 16px」：贴正中最贴近指针所指的区域
        top = target.rect.top + (anchorHeight - size.height) / 2;
    } else {
        // 否则锚点下缘 6px；下方放不下改上缘 6px
        top = target.rect.bottom + LABEL_GAP_PX;
        if (top > viewportHeight - marginY - size.height) {
            top = target.rect.top - LABEL_GAP_PX - size.height;
        }
    }
    return {
        left: `${Math.max(marginX, Math.min(left, viewportWidth - marginX - size.width))}px`,
        top: `${Math.max(marginY, Math.min(top, viewportHeight - marginY - size.height))}px`,
    };
});

/** 视图为 0（量不出可用区域）时不渲染药丸，形状与播报照常。 */
const labelVisible = computed(() => {
    return labelText.value !== "" && anchor.value !== null && viewport.value.width > 0 && viewport.value.height > 0;
});

/** 首帧只把待测标签设成 hidden，等真实测量回填坐标后才可见。 */
const labelStyle = computed<LabelStyle>(() => {
    const layout = labelLayout.value;
    return layout === null
        ? {left: "auto", top: "auto", visibility: "hidden"}
        : {left: layout.left, top: layout.top, visibility: "visible"};
});

watch(
    () => props.label,
    (next) => {
        announcedText.value = next.trim();
    },
    {immediate: true},
);
</script>

<template>
    <!-- 预览几何全是 getBoundingClientRect 的 viewport 坐标，必须挂在 body 下避免祖先
         backdrop-filter / transform / contain 改变包含块；pointer-events: none 不拦截指针。 -->
    <Teleport to="body">
        <div
            v-if="hasVisibleFeedback"
            ref="overlayRef"
            class="nb-ui-drop-feedback"
            data-drop-feedback
            v-bind="attrs"
        >
            <!-- 连续换区保留同一节点，CSS 从当前绘制盒过渡到新落点。 -->
            <DropIndicator
                v-if="areaBoxStyle !== null"
                variant="area"
                class="nb-ui-drop-feedback__area"
                :class="{'nb-ui-drop-feedback__area--standby': props.preview?.armed === false}"
                data-drop-feedback-area
                :data-drop-armed="props.preview?.armed === false ? 'false' : 'true'"
                :style="areaBoxStyle"
            />

            <!-- 插入线：只在没有有效半区的落点（切换器换序 / 空头部）显示 -->
            <DropIndicator
                v-if="lineBoxStyle !== null"
                variant="line"
                class="nb-ui-drop-feedback__line"
                data-drop-feedback-line
                :style="lineBoxStyle"
            />

            <!-- 切换器条目高亮：接收条目或锚点条目 -->
            <DropIndicator
                v-if="entryBoxStyle !== null"
                variant="entry"
                class="nb-ui-drop-feedback__entry"
                data-drop-feedback-entry
                :style="entryBoxStyle"
            />

            <!-- 区域提示随矩形连续移动；进出区域模式时重建，避免从插线位置飞入。 -->
            <div
                v-if="labelVisible"
                :key="areaBoxStyle !== null ? 'area' : 'anchor'"
                ref="labelRef"
                class="nb-ui-drop-feedback__label"
                :class="{'nb-ui-drop-feedback__label--area': areaBoxStyle !== null}"
                data-drop-feedback-label
                :style="labelStyle"
            >
                <DropIndicatorLabel :label="label" :icon-class="iconClass" />
            </div>

            <!-- 独立无障碍播报：仅随传入 label 语义变化更新，不逐像素播报 -->
            <div
                class="nb-ui-drop-feedback__live"
                data-drop-feedback-live
                aria-live="polite"
                aria-atomic="true"
            >
                {{ announcedText }}
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.nb-ui-drop-feedback {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: none;
}

/* 皮肤在公共 DropIndicator 上，这里只给三个形状做 fixed 定位 */
.nb-ui-drop-feedback__area,
.nb-ui-drop-feedback__line,
.nb-ui-drop-feedback__entry {
    position: fixed;
}

/* fixed 装饰盒的几何过渡不改变业务命中或正文布局；不用 scale，避免边框与圆角被拉伸。 */
@keyframes nb-drop-feedback-fade-in {
    from {
        opacity: 0;
    }
}

.nb-ui-drop-feedback__area,
.nb-ui-drop-feedback__label--area {
    animation: nb-drop-feedback-fade-in var(--motion-fast) var(--ease-standard);
}

.nb-ui-drop-feedback__area {
    opacity: 1;
    transition: left var(--motion-base) var(--ease-standard),
        top var(--motion-base) var(--ease-standard),
        width var(--motion-base) var(--ease-standard),
        height var(--motion-base) var(--ease-standard),
        opacity var(--motion-fast) var(--ease-standard);
}

.nb-ui-drop-feedback__area--standby {
    opacity: 0.35;
}

.nb-ui-drop-feedback__label--area {
    transition: left var(--motion-base) var(--ease-standard), top var(--motion-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
    .nb-ui-drop-feedback__area,
    .nb-ui-drop-feedback__label--area {
        animation: none;
        transition: none;
    }
}

/* 标签：独立 fixed 包装，宽度上限给视口 8px 夹紧留余量；药丸自身由 DropIndicatorLabel 负责 */
.nb-ui-drop-feedback__label {
    position: fixed;
    max-width: max(0px, calc(100vw - 16px));
}

/* 独立 live region：屏幕阅读器专用 */
.nb-ui-drop-feedback__live {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
}
</style>
