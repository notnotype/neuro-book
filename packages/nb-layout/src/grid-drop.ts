/**
 * 落点几何（纯函数）：把指针位置换算成列表里的插入位，或叶的四边落点。
 *
 * 与拖动通道无关：指针、键盘、业务拖动库都可以消费同一份结果，因此预览与最终动作不会
 * 各算一遍而分叉。坐标是**视口 client 坐标**（与命中判定同一空间），不接受 `DOMRect`
 * 或任何拖动库类型——宿主负责把元素矩形与指针位置折算进来。
 *
 * 顺序权威是调用方给的 `members` 顺序（呈现顺序），不按 DOM 遍历重排：Layout 顺序与
 * DOM 顺序在 Teleport / parking 之后本来就可能不一致。
 */
import type {GridOrientation} from "./grid-types";

/** @experimental */
export type GridDropPoint = Readonly<{x: number; y: number}>;

/** @experimental */
export type GridDropRect = Readonly<{left: number; top: number; right: number; bottom: number}>;

/** @experimental */
export type GridDropMember = Readonly<{id: string; rect: GridDropRect}>;

/**
 * 列表插入锚点：`beforeId` 为 `null` 表示追加到末尾，`indicator` 是这个插入位**唯一**的插入线。
 *
 * 列表的条目高亮由调用方按 `beforeId` 自己画，这里只承诺「插到谁前面」和那条线画在哪。
 * @experimental
 */
export type GridListInsertion = Readonly<{beforeId: string | null; indicator: GridDropRect}>;

/** @experimental */
export type GridEdgeDrop = "left" | "right" | "top" | "bottom" | "center";

/** 指示线厚度（CSS px）：视觉常量，不参与任何尺寸计算。 */
export const GRID_DROP_INDICATOR_PX = 2;

/** 边缘落点的默认边缘带比例：与编辑器现有 20% 语义一致。 */
const GRID_EDGE_RATIO_DEFAULT = 0.2;

function finitePoint(point: GridDropPoint): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** 有效矩形：四项有限且两轴都为正（零尺寸的叶/容器不参与落点）。 */
export function isGridDropRect(rect: GridDropRect): boolean {
    return Number.isFinite(rect.left) && Number.isFinite(rect.top) && Number.isFinite(rect.right) && Number.isFinite(rect.bottom)
        && rect.right - rect.left > 0 && rect.bottom - rect.top > 0;
}

/** 点在矩形里（含四条边）；`margin` 把矩形向四周撑开，不夹成非负：要夹的调用方自己夹。 */
export function containsPoint(rect: GridDropRect, point: GridDropPoint, margin = 0): boolean {
    return point.x >= rect.left - margin && point.x <= rect.right + margin && point.y >= rect.top - margin && point.y <= rect.bottom + margin;
}

/**
 * 插入线：主轴上一段固定厚度的带，起点夹进 `[内容起点, 内容终点 - 厚度]`——首尾都不跨出内容盒，
 * 内容盒不足一个厚度时厚度退化成主轴长度。交叉轴铺满 `span`：有目标成员时是它夹进容器后的可见跨度，
 * 空容器时传内容盒本身。
 */
function indicatorAt(orientation: GridOrientation, boundary: number, container: GridDropRect, span: GridDropRect): GridDropRect {
    if (orientation === "horizontal") {
        const thickness = Math.min(GRID_DROP_INDICATOR_PX, container.right - container.left);
        const left = Math.min(Math.max(boundary, container.left), container.right - thickness);
        return {left, top: span.top, right: left + thickness, bottom: span.bottom};
    }
    const thickness = Math.min(GRID_DROP_INDICATOR_PX, container.bottom - container.top);
    const top = Math.min(Math.max(boundary, container.top), container.bottom - thickness);
    return {left: span.left, top, right: span.right, bottom: top + thickness};
}

/**
 * 末个可用成员（下标 `lastIndex`）之后的插入位插到谁前面：紧跟它的有效成员整个落在内容盒沿主轴的终点之外
 * 时是它，否则 `null`（追加）。只看紧跟的那一个，不往后找：紧跟的若是换行到下一行的成员，它才是真正的后继，
 * 跳过它去认更后面滚出去的，放下的位置又会和线对不上。
 */
function trailingSuccessor(orientation: GridOrientation, members: readonly GridDropMember[], lastIndex: number, container: GridDropRect): string | null {
    for (let index = lastIndex + 1; index < members.length; index += 1) {
        const member = members[index] as GridDropMember;
        if (!isGridDropRect(member.rect)) {
            continue;
        }
        const beyondEnd = orientation === "horizontal" ? member.rect.left >= container.right : member.rect.top >= container.bottom;
        return beyondEnd ? member.id : null;
    }
    return null;
}

/**
 * 列表插入锚点：只承诺「插到谁前面」和**一个插入位一条线**。
 *
 * 列表没有边缘带（条目高亮由调用方按 `beforeId` 自己画），只有插入位，所以三处指针区间归一到同一条线：
 * 前一成员的后半、成员之间的间隙、后一成员的前半都插到后一成员之前；间隙能容纳线时，线居中放在
 * 两成员之间，两侧等距留白；没有足够间隙或没有前一可见成员时贴后一成员前缘。跨度取后者的可见矩形。
 *
 * 尾缘同理只有一种画法：越过最后一个可用成员，线贴**末个可用成员的后缘**（它被容器裁掉的部分
 * 不参与画线，夹紧后不会跳到容器尽头的空白），跨度取该成员的可见矩形。插到谁前面看 `members` 里紧跟它的
 * 那个有效成员：它整个落在内容盒**沿主轴的终点之外**（滚出去了）时插到它前面，线画在哪它就落在哪；否则
 * （后面没有成员、后面的矩形都无效，或紧跟的那个只在交叉轴上被裁掉、在前端之外）是追加，`beforeId` 为
 * `null`。交叉轴上被裁掉的不算后继：那是换行到下一行之类的布局，哪一行接哪一行由调用方的行模型定。
 * 前端滚出去的成员不用另管：指针在首个可见成员前半时插到它前面，它们本来就都在前面。
 * 只有**真正没有成员**（`members` 为空）时没有可贴的成员，线才落到**内容盒前缘**、跨度取内容盒本身
 * （空列表只剩一个插入位，线标在列表起点）。
 *
 * `edgeGap`（默认 0）只退让**首尾两条外侧线**：首个可用成员之前，线起点取「可见前缘 − edgeGap − 线厚」，
 * 线尾因此离成员前缘正好 `edgeGap`；末个可用成员之后，线起点取「可见后缘 + edgeGap」。成员之间的间隙仍
 * 按上面的规则居中，不看这个值；空列表没有可贴的成员，也不吃它。空间不够时照旧由 `indicatorAt` 夹紧：起点
 * 先被夹回内容盒（退让量随之被吃小甚至吃光，线可以压到成员上），内容盒比线还薄时线再退化成盒子本身。
 * `edgeGap = 0` 就是既有行为：线贴成员前缘/后缘，不额外退让。
 *
 * 负数与非有限 `edgeGap` 一律按 0 处理，而不是像 `resolveGridEdgeDrop` 的 `edgeRatio` 那样拒绝：它只决定线离成员边缘多远，是纯视觉
 * 退让，不参与锚点、跨度与接受/拒绝判定；为一个坏数字作废整个落点，等于让那个列表上的拖放反馈失灵。真正的
 * 几何输入（指针、内容盒、成员矩形）仍旧严格，见下。
 *
 * 容器外、非有限坐标、零尺寸容器一律返回 `null`；声明了成员却一个可用几何都量不出来时同样返回
 * `null`——那种情况不能冒充空列表。
 * @experimental
 */
export function resolveListInsertion(input: {
    readonly orientation: GridOrientation;
    readonly point: GridDropPoint;
    readonly containerRect: GridDropRect;
    readonly members: readonly GridDropMember[];
    /** 首尾外侧线相对成员边缘的退让量（CSS px）：非负有限值才生效，其余按 0；0 即贴边，保持既有行为。 */
    readonly edgeGap?: number;
}): GridListInsertion | null {
    const {orientation, point, containerRect, members} = input;
    if (!finitePoint(point) || !isGridDropRect(containerRect) || !containsPoint(containerRect, point)) {
        return null;
    }
    // 只认非负有限值：`edgeGap` 是视觉退让，不参与锚点与拒绝规则，坏数字退化成 0 而不是作废落点。
    const requested = input.edgeGap ?? 0;
    const edgeGap = Number.isFinite(requested) && requested > 0 ? requested : 0;
    const horizontal = orientation === "horizontal";
    const along = horizontal ? point.x : point.y;

    if (members.length === 0) {
        // 真正没有成员：整盒只有一个插入位，线贴内容盒前缘、跨度取整盒。
        return {
            beforeId: null,
            indicator: indicatorAt(orientation, horizontal ? containerRect.left : containerRect.top, containerRect, containerRect),
        };
    }

    // 成员过滤：无效矩形与和内容盒没有交集的成员直接跳过，
    // 可见矩形夹进内容盒。末个可用成员只留四个标量，不为落在间隙里的成员分配落点几何。
    let lastLeft = 0;
    let lastTop = 0;
    let lastRight = 0;
    let lastBottom = 0;
    let hasLast = false;
    let lastIndex = -1;

    for (const [index, member] of members.entries()) {
        if (!isGridDropRect(member.rect)) {
            continue;
        }
        const left = Math.max(member.rect.left, containerRect.left);
        const top = Math.max(member.rect.top, containerRect.top);
        const right = Math.min(member.rect.right, containerRect.right);
        const bottom = Math.min(member.rect.bottom, containerRect.bottom);
        if (right <= left || bottom <= top) {
            continue;
        }
        const center = horizontal ? (left + right) / 2 : (top + bottom) / 2;
        if (along < center) {
            const visible = {left, top, right, bottom};
            const start = horizontal ? left : top;
            const previousEnd = horizontal ? lastRight : lastBottom;
            // 首个可用成员（没有前一可见成员）才吃 `edgeGap`：整条线外移，让线尾离成员前缘正好一个退让量。
            // 没有前一成员又没有 `edgeGap` 时仍旧贴成员前缘；相邻成员之间的插入位由居中分支负责，不看它。
            const leadingBoundary = edgeGap > 0 && !hasLast ? start - edgeGap - GRID_DROP_INDICATOR_PX : start;
            const boundary = hasLast && start - previousEnd > GRID_DROP_INDICATOR_PX
                ? (previousEnd + start - GRID_DROP_INDICATOR_PX) / 2
                : leadingBoundary;
            return {
                beforeId: member.id,
                indicator: indicatorAt(orientation, boundary, containerRect, visible),
            };
        }
        lastLeft = left;
        lastTop = top;
        lastRight = right;
        lastBottom = bottom;
        hasLast = true;
        lastIndex = index;
    }

    if (!hasLast) {
        // 声明了成员却一个可用几何都量不出来：不能冒充空列表，宁可整个落点作废。
        return null;
    }
    const last = {left: lastLeft, top: lastTop, right: lastRight, bottom: lastBottom};
    return {
        beforeId: trailingSuccessor(orientation, members, lastIndex, containerRect),
        // 末个可用成员之后：线起点在可见后缘之外再退一个 `edgeGap`（0 时就是后缘本身，既有行为），
        // 后缘离内容盒终点不够时和其它插入位一样由 `indicatorAt` 夹紧。
        indicator: indicatorAt(orientation, (horizontal ? last.right : last.bottom) + edgeGap, containerRect, last),
    };
}

/**
 * 四边 + 中心落点：左右优先于上下（与编辑器现有分组语义一致），先到者胜。
 * `edgeRatio` 非法、矩形无效、指针在矩形外都返回 `null`。
 * @experimental
 */
export function resolveGridEdgeDrop(input: {
    readonly point: GridDropPoint;
    readonly rect: GridDropRect;
    readonly edgeRatio?: number;
}): GridEdgeDrop | null {
    const ratio = input.edgeRatio ?? GRID_EDGE_RATIO_DEFAULT;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 0.5) {
        return null;
    }
    if (!finitePoint(input.point) || !isGridDropRect(input.rect) || !containsPoint(input.rect, input.point)) {
        return null;
    }
    const relativeX = (input.point.x - input.rect.left) / (input.rect.right - input.rect.left);
    const relativeY = (input.point.y - input.rect.top) / (input.rect.bottom - input.rect.top);
    if (relativeX < ratio) {
        return "left";
    }
    if (relativeX > 1 - ratio) {
        return "right";
    }
    if (relativeY < ratio) {
        return "top";
    }
    if (relativeY > 1 - ratio) {
        return "bottom";
    }
    return "center";
}
