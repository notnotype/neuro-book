/**
 * 落点几何（纯函数）：把指针位置换算成「插入边缘带」或「保持布局区域」。
 *
 * 与拖动通道无关：指针、键盘、业务拖动库都可以消费同一份结果，因此预览与最终动作不会
 * 各算一遍而分叉。坐标是**视口 client 坐标**（与命中判定同一空间），不接受 `DOMRect`
 * 或任何拖动库类型——宿主负责把元素矩形与指针位置折算进来。
 *
 * 顺序权威是调用方给的 `members` 顺序（呈现顺序），不按 DOM 遍历重排：Layout 顺序与
 * DOM 顺序在 Teleport / parking 之后本来就可能不一致。
 */
import type {GridOrientation} from "./grid-types";

export type GridDropPoint = Readonly<{x: number; y: number}>;

export type GridDropRect = Readonly<{left: number; top: number; right: number; bottom: number}>;

export type GridDropMember = Readonly<{id: string; rect: GridDropRect}>;

/**
 * 内容区落点：`insert` 只在叶片前/后 20% 或叶间空隙给出插入位；`keep` 表示中央整片区域，不能提交。
 *
 * `areaRect` 与动作出自同一次求值。`keep` 没有锚点和插入线，调用方据此只画保持布局反馈。
 *
 * `insert` 另外给出**命中叶**与它沿轴对应的一半，供需要"半区"语义的落点（如工作台边缘并入）使用：
 * `targetId` 是指针真正落在的那一片——`beforeId` 与 `areaRect` 都由它推出来；`halfRect` 是这一半的可见
 * 几何（前缘带取前一半、后缘带与追加取后一半）。命中带仍是 20%，半区是承诺的落点范围，两件事不互相
 * 影响：`keep` 与 `areaRect` 的既有口径一个字节都不变。成员表为空（整盒接收、没有候选叶）时两者都是 `null`。
 */
export type GridInsertion =
    | Readonly<{
        kind: "insert";
        beforeId: string | null;
        indicator: GridDropRect;
        areaRect: GridDropRect;
        /** 命中叶：指针落在的那一片（`beforeId` 是它自己或它的下一片）；没有候选叶时为 `null`。 */
        targetId: string | null;
        /** 命中叶沿主轴对应的一半：插到它之前取前一半，插到它之后取后一半；没有命中叶时为 `null`。 */
        halfRect: GridDropRect | null;
    }>
    | Readonly<{kind: "keep"; areaRect: GridDropRect}>;

/**
 * 列表插入锚点：`beforeId` 为 `null` 表示追加到末尾，`indicator` 是这个插入位**唯一**的插入线。
 *
 * 与 `GridInsertion` 的差别是没有区域：列表的条目高亮由调用方按 `beforeId` 自己画，这里只承诺
 * 「插到谁前面」和那条线画在哪。
 */
export type GridListInsertion = Readonly<{beforeId: string | null; indicator: GridDropRect}>;

export type GridEdgeDrop = "left" | "right" | "top" | "bottom" | "center";

/** 指示线厚度（CSS px）：视觉常量，不参与任何尺寸计算。 */
export const GRID_DROP_INDICATOR_PX = 2;

/** 边缘落点的默认边缘带比例：与编辑器现有 20% 语义一致。 */
export const GRID_EDGE_RATIO_DEFAULT = 0.2;

function finitePoint(point: GridDropPoint): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** 有效矩形：四项有限且两轴都为正（零尺寸的叶/容器不参与落点）。 */
export function isGridDropRect(rect: GridDropRect): boolean {
    return Number.isFinite(rect.left) && Number.isFinite(rect.top) && Number.isFinite(rect.right) && Number.isFinite(rect.bottom)
        && rect.right - rect.left > 0 && rect.bottom - rect.top > 0;
}

function containsPoint(rect: GridDropRect, point: GridDropPoint): boolean {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** 成员沿主轴的边缘带：`leading` 为真取靠近内容盒起点的一侧，否则取末端。 */
function edgeArea(orientation: GridOrientation, member: GridDropRect, leading: boolean, ratio: number): GridDropRect {
    if (orientation === "horizontal") {
        const span = (member.right - member.left) * ratio;
        return leading
            ? {left: member.left, top: member.top, right: member.left + span, bottom: member.bottom}
            : {left: member.right - span, top: member.top, right: member.right, bottom: member.bottom};
    }
    const span = (member.bottom - member.top) * ratio;
    return leading
        ? {left: member.left, top: member.top, right: member.right, bottom: member.top + span}
        : {left: member.left, top: member.bottom - span, right: member.right, bottom: member.bottom};
}

/**
 * 命中叶沿主轴对应的一半：`leading` 取前一半，否则取后一半。半区是**承诺的落点范围**（语义上的 50%），
 * 与 20% 命中带是两件事；几何取可见裁剪后的成员矩形，交叉轴保持它的可见跨度。
 */
function halfArea(orientation: GridOrientation, member: GridDropRect, leading: boolean): GridDropRect {
    if (orientation === "horizontal") {
        const mid = (member.left + member.right) / 2;
        return leading
            ? {left: member.left, top: member.top, right: mid, bottom: member.bottom}
            : {left: mid, top: member.top, right: member.right, bottom: member.bottom};
    }
    const mid = (member.top + member.bottom) / 2;
    return leading
        ? {left: member.left, top: member.top, right: member.right, bottom: mid}
        : {left: member.left, top: mid, right: member.right, bottom: member.bottom};
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

type VisibleGridDropMember = Readonly<{id: string; rect: GridDropRect}>;

/**
 * 沿容器主轴求边缘插入位或中央保持区。
 *
 * 每个可见成员沿主轴的前/后边缘是插入带，中间返回 `keep`；默认边缘比例是 20%，调用方可传 `edgeRatio`
 * （必须大于 0 且不超过 0.5）。0.5 表示前后各一半、没有中央禁投区，中点归后半。叶间隙继续沿旧规则归下一叶，因而不会凭空产生一个新的插入位。竖直容器只看 y，
 * 水平容器只看 x，交叉轴位置不参与判定。成员按调用方给的呈现顺序消费，无效矩形与和内容盒没有交集的成员
 * 直接跳过并夹进内容盒。真正没有成员时整盒都是接收区；声明了成员却一个可用几何都量不出来时返回 `null`。
 *
 * 候选叶由**真实叶末端**选出——第一个「末端不早于指针」的可见成员，也就是指针真正落在的那一叶；
 * 叶间隙因此归后一叶（它的末端是第一个越过指针的）。不要按中点找候选：那会把非末叶的后半判成下一叶，
 * 反馈带跳到下一叶前缘，中央区的后半甚至会被算成一次插入。
 */
export function resolveGridInsertion(input: {
    readonly orientation: GridOrientation;
    readonly point: GridDropPoint;
    readonly containerRect: GridDropRect;
    readonly members: readonly GridDropMember[];
    readonly edgeRatio?: number;
}): GridInsertion | null {
    const {orientation, point, containerRect, members} = input;
    const ratio = input.edgeRatio ?? GRID_EDGE_RATIO_DEFAULT;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 0.5) {
        return null;
    }
    if (!finitePoint(point) || !isGridDropRect(containerRect) || !containsPoint(containerRect, point)) {
        return null;
    }
    const horizontal = orientation === "horizontal";
    const along = horizontal ? point.x : point.y;

    if (members.length === 0) {
        // 没有候选叶：整盒只剩一个接收区，命中叶与半区都不存在（调用方不宜据此承诺半区并入）。
        return {
            kind: "insert",
            beforeId: null,
            areaRect: containerRect,
            indicator: indicatorAt(orientation, horizontal ? containerRect.left : containerRect.top, containerRect, containerRect),
            targetId: null,
            halfRect: null,
        };
    }

    const visible: VisibleGridDropMember[] = [];
    for (const member of members) {
        if (!isGridDropRect(member.rect)) continue;
        const left = Math.max(member.rect.left, containerRect.left);
        const top = Math.max(member.rect.top, containerRect.top);
        const right = Math.min(member.rect.right, containerRect.right);
        const bottom = Math.min(member.rect.bottom, containerRect.bottom);
        if (right <= left || bottom <= top) continue;
        visible.push({id: member.id, rect: {left, top, right, bottom}});
    }
    if (visible.length === 0) return null;

    // 候选叶＝指针真正落在的那一叶：首个「末端 ≥ 指针」的可见成员。用中点找候选，位于非末叶后缘带的
    // 指针会被判成下一叶（inside 为假），反馈带就跳到下一叶的前缘带去了。
    const candidateIndex = visible.findIndex(({rect}) => along <= (horizontal ? rect.right : rect.bottom));
    if (candidateIndex < 0) {
        // 越过所有可见成员的末端：追加，反馈带与插入线都贴着末叶的后缘 20%。
        const last = visible[visible.length - 1]!;
        const rect = last.rect;
        return {
            kind: "insert",
            beforeId: null,
            areaRect: edgeArea(orientation, rect, false, ratio),
            indicator: indicatorAt(orientation, horizontal ? rect.right : rect.bottom, containerRect, rect),
            targetId: last.id,
            halfRect: halfArea(orientation, rect, false),
        };
    }

    const candidate = visible[candidateIndex]!;
    const rect = candidate.rect;
    const start = horizontal ? rect.left : rect.top;
    const end = horizontal ? rect.right : rect.bottom;
    if (along < start) {
        // 叶间空隙或首叶之前：归后一叶的前缘带（插入位就是它的前缘）。
        return {
            kind: "insert",
            beforeId: candidate.id,
            areaRect: edgeArea(orientation, rect, true, ratio),
            indicator: indicatorAt(orientation, start, containerRect, rect),
            targetId: candidate.id,
            halfRect: halfArea(orientation, rect, true),
        };
    }

    const edgeSpan = (end - start) * ratio;
    if (along > start + edgeSpan && along < end - edgeSpan) {
        return {kind: "keep", areaRect: rect};
    }

    const trailing = along >= end - edgeSpan;
    return {
        kind: "insert",
        beforeId: trailing ? visible[candidateIndex + 1]?.id ?? null : candidate.id,
        areaRect: edgeArea(orientation, rect, !trailing, ratio),
        indicator: indicatorAt(orientation, trailing ? end : start, containerRect, rect),
        targetId: candidate.id,
        halfRect: halfArea(orientation, rect, !trailing),
    };
}


/**
 * 列表插入锚点：与 `resolveGridInsertion` 吃同一份输入，但只承诺「插到谁前面」和**一个插入位一条线**。
 *
 * 内容区的边缘带语义回答的是「落在哪个成员的前/后 20% 带里」，所以 `resolveGridInsertion` 的线会贴着接住指针的
 * 那个成员的边缘——同一个插入位（下一成员之前）可能画出前一成员后缘或后一成员前缘两种位置。列表没有边缘带
 * （条目高亮由调用方按 `beforeId` 自己画），只有插入位，所以这里把三处指针区间归一到同一条线：
 * 前一成员的后半、成员之间的间隙、后一成员的前半都插到后一成员之前；间隙能容纳线时，线居中放在
 * 两成员之间，两侧等距留白；没有足够间隙或没有前一可见成员时贴后一成员前缘。跨度取后者的可见矩形。
 *
 * 尾缘同理只有一种画法：越过最后一个可用成员就是追加，线贴**末个可用成员的后缘**（它被容器裁掉的部分
 * 不参与画线，夹紧后不会跳到容器尽头的空白），跨度取该成员的可见矩形。只有**真正没有成员**（`members`
 * 为空）时没有可贴的成员，线才落到**内容盒前缘**、跨度取内容盒本身（空列表只剩一个插入位，线标在列表起点）。
 *
 * `edgeGap`（默认 0）只退让**首尾两条外侧线**：首个可用成员之前，线起点取「可见前缘 − edgeGap − 线厚」，
 * 线尾因此离成员前缘正好 `edgeGap`；末个可用成员之后，线起点取「可见后缘 + edgeGap」。成员之间的间隙仍
 * 按上面的规则居中，不看这个值；空列表没有可贴的成员，也不吃它。空间不够时照旧由 `indicatorAt` 夹紧：起点
 * 先被夹回内容盒（退让量随之被吃小甚至吃光，线可以压到成员上），内容盒比线还薄时线再退化成盒子本身。
 * `edgeGap = 0` 就是既有行为：线贴成员前缘/后缘，不额外退让。
 *
 * 负数与非有限 `edgeGap` 一律按 0 处理，而不是像 `edgeRatio` 那样拒绝：它只决定线离成员边缘多远，是纯视觉
 * 退让，不参与锚点、跨度与接受/拒绝判定；为一个坏数字作废整个落点，等于让那个列表上的拖放反馈失灵。真正的
 * 几何输入（指针、内容盒、成员矩形）仍旧严格，见下。
 *
 * 容器外、非有限坐标、零尺寸容器一律返回 `null`；声明了成员却一个可用几何都量不出来时同样返回
 * `null`——那种情况不能冒充空列表。`resolveGridInsertion` 的边缘带合同不受本函数影响。
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

    // 与 `resolveGridInsertion` 同一份成员过滤：无效矩形与和内容盒没有交集的成员直接跳过，
    // 可见矩形夹进内容盒。末个可用成员只留四个标量，不为落在间隙里的成员分配落点几何。
    let lastLeft = 0;
    let lastTop = 0;
    let lastRight = 0;
    let lastBottom = 0;
    let hasLast = false;

    for (const member of members) {
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
    }

    if (!hasLast) {
        // 声明了成员却一个可用几何都量不出来：不能冒充空列表，宁可整个落点作废。
        return null;
    }
    const last = {left: lastLeft, top: lastTop, right: lastRight, bottom: lastBottom};
    return {
        beforeId: null,
        // 末个可用成员之后：线起点在可见后缘之外再退一个 `edgeGap`（0 时就是后缘本身，既有行为），
        // 后缘离内容盒终点不够时和其它插入位一样由 `indicatorAt` 夹紧。
        indicator: indicatorAt(orientation, (horizontal ? last.right : last.bottom) + edgeGap, containerRect, last),
    };
}

/**
 * 四边 + 中心落点：左右优先于上下（与编辑器现有分组语义一致），先到者胜。
 * `edgeRatio` 非法、矩形无效、指针在矩形外都返回 `null`。
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
