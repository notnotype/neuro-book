/**
 * 分界线命中热区的事实源。
 *
 * 「指针落在哪条分界线上」只能有一份口径，否则三处会各写一个数字、互相对不上：
 * 拖动起点（能否开始、拖哪一条）、悬停高亮与光标（resize / 十字）都必须调用同一份
 * `hitTestSashBand` / `collectSashHits`，不许各自再算一遍边距或依赖「事件目标恰好是 separator」。
 *
 * 交叉处指针已经是十字（两条线都在命中带内）却不亮、或者亮了却只拖得动一条，都是
 * 「命中事实」与「高亮事实」分成两份的结果：两条线段是否都在命中带内、哪一条更近、
 * 最多选一根 `width` 轴加一根 `height` 轴，这些判断只在这里做。
 */
export const SASH_HIT_MARGIN = {fine: 5, coarse: 15} as const;

/** 指针类型：粗指针（触摸）用更大的命中带。 */
export type SashPointerKind = "fine" | "coarse";

export type SashPoint = {readonly x: number; readonly y: number};

export type SashRect = {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
};

/** 一条可命中的分隔线：身份（分支 + 序号）、它所属主轴、当前盒与优先级。 */
export type SashHitTarget = {
    readonly branchId: string;
    readonly sashIndex: number;
    /** 被调整的主轴：`width` 是竖线（左右分配），`height` 是横线（上下分配）。 */
    readonly axis: "width" | "height";
    readonly rect: SashRect;
    /** 嵌套深度：同一位置重合时更内层的实例优先。 */
    readonly depth: number;
    /** 同层稳定顺序：前面的先画，命中优先级相同。 */
    readonly order: number;
    /** 不可交互（禁用、零占用、不可分配）时 false，不参与命中。 */
    readonly enabled: boolean;
};

export function sashHitMargin(pointerKind: SashPointerKind): number {
    return pointerKind === "coarse" ? SASH_HIT_MARGIN.coarse : SASH_HIT_MARGIN.fine;
}

/**
 * 指针是否落在这一条分隔线的命中带内。
 *
 * 几何判定用**逻辑盒**（`getBoundingClientRect` 的结果）而不是视觉装饰线：装饰线的设备像素
 * 对齐只改变画出来的线，不改变可拖动范围。
 */
export function hitTestSashBand(point: SashPoint, rect: SashRect, margin: number): boolean {
    const gap = Math.max(0, margin);
    return point.x >= rect.left - gap && point.x <= rect.right + gap
        && point.y >= rect.top - gap && point.y <= rect.bottom + gap;
}

/**
 * 一组候选里挑出这一帧真正可操作的分隔线：同一主轴最多一条，最多返回一条 `width` + 一条 `height`。
 *
 * 不需要额外判断「两根线段是否真的相交」：指针同时落在两条命中带内，就意味着两段线段在两根轴上都
 * 相距不超过 2 × margin——T/十字本来就是这个条件，而离开交汇处之后这个条件自然不成立。
 */
export function collectSashHits(
    point: SashPoint,
    targets: readonly SashHitTarget[],
    pointerKind: SashPointerKind,
): readonly SashHitTarget[] {
    const margin = sashHitMargin(pointerKind);
    const inBand = targets.filter((target) => target.enabled && hitTestSashBand(point, target.rect, margin));
    const vertical = nearest(point, inBand.filter((target) => target.axis === "width"));
    const horizontal = nearest(point, inBand.filter((target) => target.axis === "height"));
    return [vertical, horizontal].filter((target): target is SashHitTarget => target !== null);
}

/** 指针到分隔线中心的距离：竖线看 x、横线看 y。 */
export function sashDistance(point: SashPoint, target: SashHitTarget): number {
    return target.axis === "width"
        ? Math.abs(point.x - (target.rect.left + target.rect.right) / 2)
        : Math.abs(point.y - (target.rect.top + target.rect.bottom) / 2);
}

function nearest(point: SashPoint, candidates: readonly SashHitTarget[]): SashHitTarget | null {
    let best: SashHitTarget | null = null;
    for (const candidate of candidates) {
        if (best === null || compareHits(point, candidate, best) < 0) {
            best = candidate;
        }
    }
    return best;
}

function compareHits(point: SashPoint, left: SashHitTarget, right: SashHitTarget): number {
    const distanceDelta = sashDistance(point, left) - sashDistance(point, right);
    if (Math.abs(distanceDelta) > 0.5) {
        return distanceDelta;
    }
    if (left.depth !== right.depth) {
        return right.depth - left.depth;
    }
    return left.order - right.order;
}
