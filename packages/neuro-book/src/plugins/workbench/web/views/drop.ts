/**
 * 拖放落点判定（docs/specs/ui/workbench-shell.md 外壳三输出 19–22）：拖动源 + 命中目标 + 几何 + 呈现 → 一次可提交的
 * 意图（附预览）、无操作（可带预览）或拒绝。纯函数：不碰 DOM、拖动库与记录；坐标一律是 CSS client 像素。
 *
 * - 一份判定：预览与将要提交的意图同出一次求值，不会出现“高亮了这里、提交去了别处”。
 * - 保守：几何过期、锚点消失、目标量不出来时拒绝或无操作，不猜目标；非法方向、量不出来的目标只给不带预览的无操作。
 * - 内容区用 nb-ui `resolveGridInsertion`：每个可见叶沿目标轴前后各 50%，中点归后半，没有中央禁投区；命中边缘就是
 *   半区并入（`split`）。全部可见视图都收成细条时，落点是细条之后的剩余区（`expand`）。
 * - Switcher（标签带、ActivityBar 条目带）只有插入位：`resolveListInsertion({edgeGap: 4})`，预览只有那一条插入线。
 *   视图落 Switcher 是建新容器（`detach-view`），容器落 Switcher 是整容器换序或迁区（`move-container`）。
 * - 空 Part 整区一个落点；Part 一旦有了容器，这个落点就失效并拒绝。
 *
 * 由旧应用 `workbench-drop.ts`（已人工验证）改写：几何算法照搬，意图与容器身份换成 v2（位置就是 ToolPart id、
 * 三类容器、`intents.ts` 的意图），旧的静态容器抑制标记与工作面代际不搬，换成发起时冻结的布局代次 `layoutKey`。
 */

import {isGridDropRect, resolveGridInsertion, resolveListInsertion} from "@notnotype/nb-ui/layout";
import type {GridDropMember, GridDropPoint, GridDropRect, GridInsertion, GridOrientation} from "@notnotype/nb-ui/layout";

import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import {immovableMemberOf} from "./intents";
import type {ViewIntent} from "./intents";
import type {ViewCatalog} from "./placement";
import type {ContainerPresentation, Presentation} from "./presentation";

/** 内容区前后各占 50%，没有中央禁投区；中点归后半。 */
const CONTENT_EDGE_RATIO = 0.5;
/** 没记录过尺寸的视图的意图（与容器网格的默认一致），来源比例的最后一档。 */
const DEFAULT_SIZE = 240;

/** 拖动源：发起时冻结来源与布局代次；容器源另冻结全部实际成员（含隐藏与收起）。 */
export type DropSource =
    | {readonly kind: "view"; readonly viewId: string; readonly containerId: string; readonly part: ViewLocation; readonly layoutKey: string}
    | {readonly kind: "container"; readonly containerId: string; readonly part: ViewLocation; readonly viewIds: ReadonlyArray<string>; readonly layoutKey: string};

/**
 * 命中目标，与落点登记一一对应。`beforeContainerId` 是插入锚点的声明：锚点由列表几何求出，声明只核对，不一致就拒绝。
 */
export type DropTarget =
    | {readonly kind: "switcher"; readonly part: ViewLocation; readonly beforeContainerId?: string}
    | {readonly kind: "content"; readonly containerId: string; readonly part: ViewLocation}
    | {readonly kind: "empty"; readonly part: ViewLocation};

export interface ContentRects {
    readonly containerId: string;
    readonly rect: GridDropRect;
    /** 按呈现顺序的可见成员；被拖的视图不剔除（源保持原位，几何就是实际布局）。 */
    readonly members: ReadonlyArray<GridDropMember>;
}

export interface SwitcherRects {
    readonly orientation: GridOrientation;
    readonly rect: GridDropRect;
    /** 按 Switcher 顺序的条目。 */
    readonly entries: ReadonlyArray<GridDropMember>;
}

export interface DropRects {
    readonly content?: ContentRects | null;
    readonly switcher?: SwitcherRects | null;
    readonly empty?: GridDropRect | null;
    /** 来源容器的内容几何：来源比例优先从这里取；量不出来时退到尺寸意图。 */
    readonly sourceContent?: ContentRects | null;
}

export interface DropInput {
    readonly source: DropSource;
    readonly target: DropTarget;
    readonly point: GridDropPoint;
    readonly rects: DropRects;
    readonly presentation: Presentation;
    readonly catalog: ViewCatalog;
    /** 当前布局代次（呈现结构的指纹）：与拖动源冻结的不一致时整条拒绝。 */
    readonly layoutKey: string;
    /** 这次拖动建自建容器时用的 id：拖动开始时生成一次，整场拖动不变。 */
    readonly newContainerId: string;
}

export interface DropPreview {
    /** 插入线：只有 Switcher 的插入位画。 */
    readonly indicator: GridDropRect | null;
    /** 接收区域：边缘并入的命中半区、剩余区或空 Part 的整个内容区。 */
    readonly areaRect: GridDropRect | null;
    readonly orientation: GridOrientation;
    /** 拖动的视图数（容器源是全部实际成员数）。 */
    readonly count: number;
}

export type DropDecision =
    | {readonly kind: "commit"; readonly intent: ViewIntent; readonly preview: DropPreview}
    | {readonly kind: "noop"; readonly preview?: DropPreview}
    | {readonly kind: "rejected"; readonly reason: string};

function noop(preview?: DropPreview): DropDecision {
    return preview === undefined ? {kind: "noop"} : {kind: "noop", preview};
}

function rejection(reason: string): DropDecision {
    return {kind: "rejected", reason};
}

/** 松手时提交的是不是已经显示过的那一次：意图逐字段相同。 */
export function isSameDropAction(previous: DropDecision | null, next: DropDecision): boolean {
    return previous !== null && previous.kind === "commit" && next.kind === "commit" && JSON.stringify(previous.intent) === JSON.stringify(next.intent);
}

function validRect(rect: GridDropRect | null | undefined): GridDropRect | null {
    return rect !== null && rect !== undefined && isGridDropRect(rect) ? rect : null;
}

function orientationOf(container: ContainerPresentation): GridOrientation {
    return container.axis === "horizontal" ? "horizontal" : "vertical";
}

/** 内容几何的自检：必须来自命中的容器，成员是它的可见成员、不重复。 */
function checkedContent(container: ContainerPresentation, geometry: ContentRects): ContentRects | string {
    if (geometry.containerId !== container.id) return `内容几何来自容器 ${geometry.containerId}，与命中的 ${container.id} 不一致`;
    const visible = new Set(container.views.map((view) => view.id));
    const seen = new Set<string>();
    for (const member of geometry.members) {
        if (seen.has(member.id)) return `内容几何里出现重复成员 ${member.id}`;
        seen.add(member.id);
        if (!visible.has(member.id)) return `内容几何里的 ${member.id} 不是容器 ${container.id} 的可见成员，几何过期`;
    }
    return geometry;
}

/** 视图源：来源容器仍在原 Part、视图仍是它的可见成员。 */
function viewSourceOf(input: DropInput, source: Extract<DropSource, {kind: "view"}>): ContainerPresentation | string {
    const container = input.presentation.containers.get(source.containerId);
    if (container === undefined) return `来源容器 ${source.containerId} 已不存在`;
    if (container.part !== source.part) return `来源容器 ${source.containerId} 已从 ${source.part} 移到 ${container.part}`;
    if (!container.members.includes(source.viewId)) return `视图 ${source.viewId} 已不在来源容器 ${source.containerId}`;
    if (!container.views.some((view) => view.id === source.viewId)) return `视图 ${source.viewId} 当前不可见`;
    if (input.catalog.get(source.viewId)?.movable === false) return `视图 ${source.viewId} 声明不可移动`;
    return container;
}

/** 容器源：仍在原 Part，成员与冻结快照一致（含隐藏与收起）。 */
function containerSourceOf(input: DropInput, source: Extract<DropSource, {kind: "container"}>): ContainerPresentation | string {
    const container = input.presentation.containers.get(source.containerId);
    if (container === undefined) return `来源容器 ${source.containerId} 已不存在`;
    if (container.part !== source.part) return `来源容器 ${source.containerId} 已从 ${source.part} 移到 ${container.part}`;
    if (container.members.length !== source.viewIds.length || container.members.some((id, index) => source.viewIds[index] !== id)) {
        return `容器 ${source.containerId} 的成员在拖动期间变了，整组拒绝`;
    }
    return container;
}

/** 全部可见成员都收成细条时的落点：末条细条之后、内容盒之内的连续区域。 */
function remainderOf(container: ContainerPresentation, geometry: ContentRects): GridDropRect | null {
    const collapsed = new Set(container.views.filter((view) => view.collapsed).map((view) => view.id));
    if (geometry.members.length === 0 || !geometry.members.every((member) => collapsed.has(member.id))) return null;
    const horizontal = container.axis === "horizontal";
    const boundary = geometry.members.reduce((end, member) => Math.max(end, horizontal ? member.rect.right : member.rect.bottom), horizontal ? geometry.rect.left : geometry.rect.top);
    const area = horizontal ? {...geometry.rect, left: boundary} : {...geometry.rect, top: boundary};
    return isGridDropRect(area) ? area : null;
}

interface EdgeHit {
    readonly hitViewId: string;
    readonly side: "before" | "after";
    readonly halfRect: GridDropRect;
}

/** 命中叶与侧向：插入位就是命中叶自己是它的前半，否则是后半（含追加）。 */
function edgeHitOf(insertion: Extract<GridInsertion, {kind: "insert"}>): EdgeHit | null {
    if (insertion.targetId === null || insertion.halfRect === null) return null;
    return {hitViewId: insertion.targetId, side: insertion.beforeId === insertion.targetId ? "before" : "after", halfRect: insertion.halfRect};
}

function sizesAlong(orientation: GridOrientation, members: ReadonlyArray<GridDropMember>): Record<string, number> {
    const sizes: Record<string, number> = {};
    for (const member of members) {
        if (!isGridDropRect(member.rect)) continue;
        sizes[member.id] = orientation === "horizontal" ? member.rect.right - member.rect.left : member.rect.bottom - member.rect.top;
    }
    return sizes;
}

/**
 * 来源比例：先用来源容器的实测几何（覆盖全部要搬的可见成员时），量不出来（来源停在停放区）退到尺寸意图（没记录过
 * 取 240）。只当比例用。
 */
function sourceRatios(input: DropInput, source: ContainerPresentation, viewIds: ReadonlyArray<string>): Record<string, number> {
    const geometry = input.rects.sourceContent;
    if (geometry !== null && geometry !== undefined && geometry.containerId === source.id) {
        const measured = sizesAlong(orientationOf(source), geometry.members);
        if (viewIds.every((id) => (measured[id] ?? 0) > 0)) return Object.fromEntries(viewIds.map((id) => [id, measured[id]!]));
    }
    return Object.fromEntries(viewIds.map((id) => [id, source.views.find((view) => view.id === id)?.size ?? DEFAULT_SIZE]));
}

type ContentHit = {readonly kind: "remainder"; readonly area: GridDropRect} | ({readonly kind: "edge"} & EdgeHit);

function contentHitOf(input: DropInput, target: ContainerPresentation, geometry: ContentRects): ContentHit | null {
    const remainder = remainderOf(target, geometry);
    if (remainder !== null) return {kind: "remainder", area: remainder};
    const insertion = resolveGridInsertion({orientation: orientationOf(target), point: input.point, containerRect: geometry.rect, members: geometry.members, edgeRatio: CONTENT_EDGE_RATIO});
    if (insertion === null || insertion.kind === "keep") return null;
    const edge = edgeHitOf(insertion);
    return edge === null ? null : {kind: "edge", ...edge};
}

function resolveContent(input: DropInput, target: Extract<DropTarget, {kind: "content"}>): DropDecision {
    const raw = input.rects.content;
    if (raw === null || raw === undefined || validRect(raw.rect) === null) return noop();
    const container = input.presentation.containers.get(target.containerId);
    if (container === undefined) return rejection(`内容落点容器 ${target.containerId} 已不存在`);
    if (container.part !== target.part) return rejection(`容器 ${target.containerId} 已从 ${target.part} 移到 ${container.part}，内容落点过期`);
    const geometry = checkedContent(container, raw);
    if (typeof geometry === "string") return rejection(geometry);
    const orientation = orientationOf(container);
    const source = input.source;
    if (source.kind === "view") {
        const from = viewSourceOf(input, source);
        if (typeof from === "string") return rejection(from);
        const hit = contentHitOf(input, container, geometry);
        if (hit === null) return noop();
        if (hit.kind === "remainder") {
            return {kind: "commit", intent: {kind: "move-view", viewId: source.viewId, sourceContainerId: source.containerId, targetContainerId: container.id, expand: true}, preview: {indicator: null, areaRect: hit.area, orientation, count: 1}};
        }
        if (source.containerId === container.id && hit.hitViewId === source.viewId) return noop();
        const preview: DropPreview = {indicator: null, areaRect: hit.halfRect, orientation, count: 1};
        if (source.containerId === container.id) {
            // 同一容器内只改顺序：已经紧贴目标侧时原位不提交。
            const others = container.members.filter((id) => id !== source.viewId);
            const at = hit.side === "before" ? others.indexOf(hit.hitViewId) : others.indexOf(hit.hitViewId) + 1;
            if (container.members.indexOf(source.viewId) === at) return noop(preview);
        }
        return {kind: "commit", intent: {kind: "move-view", viewId: source.viewId, sourceContainerId: source.containerId, targetContainerId: container.id, split: {hitViewId: hit.hitViewId, side: hit.side, sourceSizes: {[source.viewId]: 1}}}, preview};
    }
    const from = containerSourceOf(input, source);
    if (typeof from === "string") return rejection(from);
    if (from.id === container.id) return noop();
    if (source.viewIds.length === 0) return noop();
    // 与意图合成同一条前提：整组里有不可移动的成员就不显示可接收的半区（预览与动作一致）。
    const immovable = immovableMemberOf(input.catalog, source.viewIds);
    if (immovable !== undefined) return rejection(`视图 ${immovable} 声明不可移动，整组不并入`);
    const hit = contentHitOf(input, container, geometry);
    if (hit === null) return noop();
    const count = source.viewIds.length;
    const base = {kind: "merge-container" as const, sourceContainerId: from.id, targetContainerId: container.id, sourceViewIds: [...source.viewIds]};
    if (hit.kind === "remainder") return {kind: "commit", intent: {...base, expand: true}, preview: {indicator: null, areaRect: hit.area, orientation, count}};
    // 只有展开的成员参与半区：收起成员的细条几何不是它的份额（intents.ts 的并入同此）。
    const expanded = from.views.filter((view) => !view.collapsed).map((view) => view.id);
    return {kind: "commit", intent: {...base, split: {hitViewId: hit.hitViewId, side: hit.side, sourceSizes: sourceRatios(input, from, expanded)}}, preview: {indicator: null, areaRect: hit.halfRect, orientation, count}};
}

function resolveEmpty(input: DropInput, target: Extract<DropTarget, {kind: "empty"}>): DropDecision {
    const rect = validRect(input.rects.empty);
    if (rect === null) return noop();
    const containers = input.presentation.parts[target.part].switcher.length;
    if (containers !== 0) return rejection(`${target.part} 已经有 ${String(containers)} 个容器，空落点已失效`);
    const orientation: GridOrientation = target.part === "panel" ? "horizontal" : "vertical";
    const source = input.source;
    if (source.kind === "view") {
        const from = viewSourceOf(input, source);
        if (typeof from === "string") return rejection(from);
        return {kind: "commit", intent: {kind: "detach-view", viewId: source.viewId, sourceContainerId: source.containerId, containerId: input.newContainerId, targetPart: target.part}, preview: {indicator: null, areaRect: rect, orientation, count: 1}};
    }
    const from = containerSourceOf(input, source);
    if (typeof from === "string") return rejection(from);
    return {kind: "commit", intent: {kind: "move-container", containerId: from.id, sourcePart: from.part, targetPart: target.part}, preview: {indicator: null, areaRect: rect, orientation, count: source.viewIds.length}};
}

function resolveSwitcher(input: DropInput, target: Extract<DropTarget, {kind: "switcher"}>): DropDecision {
    const rects = input.rects.switcher;
    if (rects === null || rects === undefined) return noop();
    const band = validRect(rects.rect);
    if (band === null) return noop();
    const insertion = resolveListInsertion({orientation: rects.orientation, point: input.point, containerRect: band, members: rects.entries, edgeGap: 4});
    if (insertion === null) return noop();
    const anchor = insertion.beforeId ?? undefined;
    if (target.beforeContainerId !== undefined && target.beforeContainerId !== anchor) {
        return rejection(`声明的锚点 ${target.beforeContainerId} 与几何求出的 ${anchor ?? "末尾"} 不一致`);
    }
    const order = input.presentation.parts[target.part].switcher.map((item) => item.containerId);
    if (anchor !== undefined && !order.includes(anchor)) return rejection(`锚点容器 ${anchor} 不在 ${target.part}`);
    const source = input.source;
    const preview: DropPreview = {indicator: insertion.indicator, areaRect: null, orientation: rects.orientation, count: source.kind === "view" ? 1 : source.viewIds.length};
    if (source.kind === "view") {
        const from = viewSourceOf(input, source);
        if (typeof from === "string") return rejection(from);
        return {kind: "commit", intent: {kind: "detach-view", viewId: source.viewId, sourceContainerId: source.containerId, containerId: input.newContainerId, targetPart: target.part, ...(anchor === undefined ? {} : {beforeContainerId: anchor})}, preview};
    }
    const from = containerSourceOf(input, source);
    if (typeof from === "string") return rejection(from);
    if (anchor === from.id) return noop(preview);
    if (from.part === target.part) {
        const others = order.filter((id) => id !== from.id);
        const at = anchor === undefined ? others.length : others.indexOf(anchor);
        if (order.indexOf(from.id) === at) return noop(preview);
    }
    return {kind: "commit", intent: {kind: "move-container", containerId: from.id, sourcePart: from.part, targetPart: target.part, ...(anchor === undefined ? {} : {beforeContainerId: anchor})}, preview};
}

/**
 * 布局代次：各 Part 的容器顺序与选中项，每个容器的实际成员、可见成员与轴（外壳三输出 23：成员、轴、活动内容变化时
 * 取消）。拖动开始时冻结，求值时不一致就整条拒绝：结构或看到的内容变了，冻结的来源与锚点不再可信。
 */
export function layoutKeyOf(presentation: Presentation): string {
    return VIEW_LOCATIONS.map((part) => {
        const slice = presentation.parts[part];
        const containers = slice.switcher.map((item) => {
            const container = presentation.containers.get(item.containerId);
            return `${item.containerId}(${(container?.members ?? []).join(",")}/${(container?.views ?? []).map((view) => view.id).join(",")}/${container?.axis ?? ""})`;
        });
        return `${part}[${slice.selected ?? ""}]:${containers.join("|")}`;
    }).join(";");
}

export function resolveDrop(input: DropInput): DropDecision {
    if (input.source.layoutKey !== input.layoutKey) return rejection("布局在拖动期间变了，这次拖放不再有效");
    switch (input.target.kind) {
        case "content":
            return resolveContent(input, input.target);
        case "empty":
            return resolveEmpty(input, input.target);
        case "switcher":
            return resolveSwitcher(input, input.target);
    }
}
