/**
 * 内容层（docs/specs/ui/nested-grid.md 的“内容层”）：内容项的矩形、停放与尺寸。每项是外层（按矩形摆放、裁切）加内层（尺寸规则同叶的内容），`NestedGrid` 只管把它们画出来。
 *
 * 停放的判定和 `useLeafParking` 是一件事的两层：叶降到零由它判，这里只加内容自己的情况（不活动、叶找不到、面板收成标题行时叶还有高度而内容是零）。
 */

import {computed, shallowRef} from "vue";
import type {Ref} from "vue";

import {placeContents} from "../grid-rects";
import type {GridContentInput, GridContentPlacement, GridLeafShape, GridPlacementItem, GridRect} from "../grid-rects";
import type {GridExtent} from "../grid-types";

/**
 * 网格里的项（外框、分隔线、内容、浮动窗手柄）按矩形摆放：位置用 `left`/`top`，不用 `transform`。过渡时 `transform` 在合成线程上走，宽高在主线程上走，
 * 主线程一忙两者就不同步，不动的那条边会跳（右边是左边加宽度）；位置和宽高都在主线程上，每一帧两条边一起算。
 */
export function gridRectStyle(rect: GridRect): Record<string, string> {
    return {left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`};
}

/** 拿起的内容跟手：位置用 `transform`，指针一动只合成、不排版。它不带过渡，所以没有上面那种不同步；落地的第一帧换回 `left`/`top`（见 `NestedGrid` 的落地）。 */
export function liftedRectStyle(rect: GridRect): Record<string, string> {
    return {left: "0px", top: "0px", transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.width}px`, height: `${rect.height}px`};
}

/**
 * 过渡中外框露出、盖住保持尺寸的内层时（`keptSizeStarts` 的叶），外框按宿主画的卡片裁：露出来的一截始终是一张完整的卡片，不动的那边也留着缝、
 * 角也是圆的。按外框自己的直角矩形裁时，卡片在那边被直着切掉，缝没了、角是尖的。裁切是外框自身的，每一帧按外框此刻的盒算，不另带过渡。
 */
export function leafShapeClip(shape: GridLeafShape): string {
    return `inset(${shape.inset.join(" ")} round ${shape.radius.join(" ")})`;
}

const hasSize = (rect: GridRect): boolean => rect.width > 0 && rect.height > 0;

export function useContentLayer(options: {
    readonly contents: () => ReadonlyArray<GridContentInput>;
    readonly items: () => ReadonlyArray<GridPlacementItem<unknown>>;
    readonly dpr: Readonly<Ref<number>>;
    readonly parkedLeaves: Readonly<Ref<ReadonlySet<string>>>;
    readonly growing: Readonly<Ref<ReadonlyMap<string, GridRect>>>;
    readonly following: Readonly<Ref<ReadonlySet<string>>>;
    /** 正飞过别的面板的内容项。 */
    readonly flying: Readonly<Ref<ReadonlySet<string>>>;
    /** 这一轮内容不跟外框的叶（`keptSizeStarts`）：它们的内容按叶的矩形摆。 */
    readonly keptSize: Readonly<Ref<ReadonlySet<string>>>;
    /** 叶在外框里画成的卡片（`GridLeafShape`）；没有时按叶的矩形裁。 */
    readonly shape: (leaf: string) => GridLeafShape | undefined;
    /** 手势预览进行中：预览不会把内容停放，往零拖时要等落账。 */
    readonly previewing: () => boolean;
    /** 量到容器了吗。第一帧还没量到时矩形都是零，这不算停放：那时加 `inert` 会让 `onMounted` 里的 `focus()` 静默失败。 */
    readonly measured: () => boolean;
    /** 被最大化的面板盖住的叶。 */
    readonly obscuredLeaves: () => ReadonlySet<string>;
    /** 缩回去的叶（离开了留在过渡里的、这一轮降到零的）：它的内容停放着，但过渡结束前还看得见。 */
    readonly outgoingLeaves: () => ReadonlySet<string>;
    /** 过渡进行中。 */
    readonly moving: () => boolean;
    /** 落地的卡片下面还画着的内容项：停放着，过渡结束前还看得见。 */
    readonly held: () => ReadonlySet<string>;
    /** 这个内容项此刻含焦点吗。 */
    readonly holdsFocus: (key: string) => boolean;
    readonly onParked: (contentKey: string) => void;
    /** 拿起的内容项（实时布局）：不按叶摆放，内容体占满卡片头下面的部分，卡片尺寸一变就重排（宿主决定多久写一次尺寸）。 */
    readonly lifted: () => {readonly key: string} | null;
    /** 拿起的内容项此刻的矩形（相对网格根）。跟手，每帧变：是普通值，不进响应式。 */
    readonly liftedRect: () => GridRect;
}) {
    const placements = computed(() => placeContents(options.items(), options.contents(), options.dpr.value));
    /** 最后的矩形与非零尺寸：停放时保持，重新有尺寸时不用重排；叶暂时找不到时外层也留在原处。 */
    const memory = new Map<string, {rect: GridRect; size: GridExtent}>();
    const zero = shallowRef<ReadonlySet<string>>(new Set());
    const parkedBefore = new Set<string>();

    const isLifted = (item: GridContentPlacement): boolean => options.lifted()?.key === item.contentKey;

    function isParked(item: GridContentPlacement): boolean {
        if (isLifted(item)) return false;
        return !item.active || item.rect === null || options.parkedLeaves.value.has(item.leaf) || zero.value.has(item.key) || options.obscuredLeaves().has(item.leaf);
    }

    /** 布局变了（渲染之前调，DOM 还没变，焦点还在里面）。 */
    function update(): void {
        const isZero = (item: GridContentPlacement): boolean => item.rect !== null && !hasSize(item.rect) && (memory.has(item.key) || options.measured());
        // 从零往外拉时内容在拖动中就要出现，所以预览里只会变少。
        zero.value = new Set(placements.value.filter((item) => isZero(item) && (!options.previewing() || zero.value.has(item.key))).map((item) => item.key));
        const alive = new Set<string>();
        for (const item of placements.value) {
            alive.add(item.key);
            const parked = isParked(item);
            if (parked && !parkedBefore.has(item.key)) {
                parkedBefore.add(item.key);
                if (options.holdsFocus(item.key)) options.onParked(item.contentKey);
            } else if (!parked) {
                parkedBefore.delete(item.key);
            }
            // 没活动过的标签也记一次：它藏着的时候不跟着实时尺寸重排。
            if (!isLifted(item) && item.rect !== null && hasSize(item.rect) && (!parked || !memory.has(item.key))) memory.set(item.key, {rect: item.rect, size: {width: item.rect.width, height: item.rect.height}});
        }
        for (const key of memory.keys()) {
            if (!alive.has(key)) memory.delete(key);
        }
        for (const key of parkedBefore) {
            if (!alive.has(key)) parkedBefore.delete(key);
        }
    }

    /**
     * 过渡中按叶的矩形摆（内容体往下挪一个面板头，`--nb-grid-inset`）：它的叶这一轮内容不跟外框，叶从零长出来、缩到零时外层的上边就是外框的上边，
     * 内容一直紧贴面板头下面（为什么不按内容自己的矩形见 `keptSizeStarts`）。正飞过去的、拿起的、自己跟外框的不算。
     */
    function byLeafRect(item: GridContentPlacement): boolean {
        return item.leafRect !== null && options.keptSize.value.has(`leaf:${item.leaf}`) && !isLifted(item) && !options.following.value.has(item.key) && !options.flying.value.has(item.key);
    }

    /**
     * 按叶摆的外层裁掉面板头那一条：外层盖在面板头上面，不裁的话面板头点不到（`clip-path` 也挡命中）。另外三边按卡片裁（`leafShapeClip`），
     * 只圆下面两个角：上边接着面板头。
     */
    function byLeafClip(item: GridContentPlacement): string {
        const shape = options.shape(item.leaf);
        if (shape === undefined) return `inset(${item.insetTop}px 0 0 0)`;
        const [, right, bottom, left] = shape.inset;
        const [, , bottomRight, bottomLeft] = shape.radius;
        return `inset(${item.insetTop}px ${right} ${bottom} ${left} round 0 0 ${bottomRight} ${bottomLeft})`;
    }

    /** 这个内容项的第一帧矩形记在 `growing` 的哪个键下：按叶的矩形摆的用它的叶的，其余（落地的卡片）用自己的。 */
    function startKey(item: GridContentPlacement): string {
        return byLeafRect(item) ? `leaf:${item.leaf}` : item.key;
    }

    function frameStyle(item: GridContentPlacement): Record<string, string> {
        // 矩形平时由 `placeLifted` 直接写在元素上；Vue 的样式补丁会写回这里的每个键，所以这里给的要是最新的。
        if (isLifted(item)) return liftedRectStyle(options.liftedRect());
        // 被盖住的内容马上不可交互，但过渡结束才隐藏：最大化的面板还没长过来时它们要还在。缩回去的叶（离开的、降到零的）里的内容同样，外框裁着它缩到零。
        // 落地的卡片下面原来显示着的内容也一样，卡片长满它的叶之前还在。
        const showing = options.moving() && ((item.active && (options.obscuredLeaves().has(item.leaf) || options.outgoingLeaves().has(item.leaf))) || options.held().has(item.key));
        const hidden: Record<string, string> = isParked(item) && !showing ? {visibility: "hidden"} : {};
        if (byLeafRect(item)) {
            const rect = options.growing.value.get(startKey(item)) ?? (item.leafRect as GridRect);
            return {...gridRectStyle(rect), "--nb-grid-inset": `${item.insetTop}px`, clipPath: byLeafClip(item), ...hidden};
        }
        const rect = options.growing.value.get(item.key) ?? item.rect ?? memory.get(item.key)?.rect ?? {x: 0, y: 0, width: 0, height: 0};
        return {...gridRectStyle(rect), ...hidden};
    }

    /** 拿起的不写尺寸，由样式撑满卡片；跟外框的是 100%；否则是最终尺寸，停放时是最后的非零尺寸。 */
    function bodyStyle(item: GridContentPlacement): Record<string, string> {
        if (isLifted(item)) return {};
        if (options.following.value.has(item.key)) return {width: "100%", height: "100%"};
        const rect = item.rect;
        const size = !isParked(item) && rect !== null && hasSize(rect) ? rect : (memory.get(item.key)?.size ?? rect ?? {width: 0, height: 0});
        return {width: `${size.width}px`, height: `${size.height}px`};
    }

    return {placements, isParked, isLifted, byLeafRect, startKey, update, frameStyle, bodyStyle};
}
