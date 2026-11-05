/**
 * 拖放落点判定（docs/specs/ui/workbench-shell.md 外壳三输出 19–22）：拖动源 + 命中目标 + 几何 + 呈现 → 一次可提交的
 * 意图（附预览）、无操作（可带预览）或拒绝。纯函数：不碰 DOM、拖动库与记录；坐标一律是 CSS client 像素。
 *
 * - 一份判定：预览与将要提交的意图同出一次求值，不会出现“高亮了这里、提交去了别处”。
 * - 保守：几何过期、锚点消失、目标量不出来时拒绝或无操作，不猜目标；非法方向、量不出来的目标只给不带预览的无操作。
 * - 内容区用 nb-layout `resolveGridInsertion`：每个可见叶沿目标轴前后各 50%，中点归后半，没有中央禁投区；命中展开的
 *   叶就是半区并入（`split`）。命中收起的细条、或全部可见视图都收起时，按列表插入位（`resolveListInsertion`）插在
 *   前后，预览是一条插入线，剩余区等于插在最后；拖入的视图在插入位展开（`expand`），插入位挨着展开的叶时与它平分。
 * - Switcher（标签带、ActivityBar 条目带）只有插入位：`resolveListInsertion({edgeGap: 4})`，预览只有那一条插入线。
 *   视图落 Switcher 是建新容器（`detach-view`），容器落 Switcher 是整容器换序或迁区（`move-container`）。
 * - 空 Part 整区一个落点；Part 一旦有了容器，这个落点就失效并拒绝。
 * - 预备区（拖动时浮出的、此刻没显示的 Part）整区一个落点，语义同空 Part；提交带上要显示的 Part，同次显示出来。
 *
 * 由旧应用 `workbench-drop.ts`（已人工验证）改写：几何算法照搬，意图与容器身份换成 v2（位置就是 ToolPart id、
 * 三类容器、`intents.ts` 的意图），旧的静态容器抑制标记与工作面代际不搬，换成发起时冻结的布局代次 `layoutKey`。
 */

import {isGridDropRect, resolveGridInsertion, resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropMember, GridDropPoint, GridDropRect, GridInsertion, GridOrientation} from "@notnotype/nb-layout";

import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import {immovableMemberOf} from "./intents";
import type {SplitPlacement, ViewIntent} from "./intents";
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
    | {readonly kind: "empty"; readonly part: ViewLocation}
    /** 拖动时浮出的预备区：这个 Part 此刻没显示。 */
    | {readonly kind: "reveal"; readonly part: ViewLocation};

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
    /** 预备区的矩形。 */
    readonly reveal?: GridDropRect | null;
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
    /** 插入线：Switcher 的插入位与内容区收起分栏的前后插入位画。 */
    readonly indicator: GridDropRect | null;
    /** 接收区域：边缘并入的命中半区、剩余区或空 Part 的整个内容区。 */
    readonly areaRect: GridDropRect | null;
    readonly orientation: GridOrientation;
    /** 拖动的视图数（容器源是全部实际成员数）。 */
    readonly count: number;
    /** 内容区的插入位挨着谁：提示写“放在 X 前／后”。 */
    readonly insertion?: {readonly viewId: string; readonly side: "before" | "after"};
}

export type DropDecision =
    /** `reveal`：落在预备区，提交时同次把这个 Part 显示出来。 */
    | {readonly kind: "commit"; readonly intent: ViewIntent; readonly preview: DropPreview; readonly reveal?: ViewLocation}
    | {readonly kind: "noop"; readonly preview?: DropPreview}
    | {readonly kind: "rejected"; readonly reason: string};

function noop(preview?: DropPreview): DropDecision {
    return preview === undefined ? {kind: "noop"} : {kind: "noop", preview};
}

function rejection(reason: string): DropDecision {
    return {kind: "rejected", reason};
}

/** 放下时比较的键：松手时提交的要是已经显示过的那一次，意图与要同次显示的 Part 都相同才算；只显示、不提交的判定为 null。 */
export function dropActionKey(decision: DropDecision): string | null {
    return decision.kind === "commit" ? JSON.stringify([decision.intent, decision.reveal ?? null]) : null;
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
 * 取 240）。只当比例用。收起的成员量到的是 32px 细条，不是它的份额：它要在落点展开时（插到收起栏旁）按尺寸意图算。
 */
function sourceRatios(input: DropInput, source: ContainerPresentation, viewIds: ReadonlyArray<string>): Record<string, number> {
    const intent = (id: string): number => source.views.find((view) => view.id === id)?.size ?? DEFAULT_SIZE;
    const collapsed = new Set(source.views.filter((view) => view.collapsed).map((view) => view.id));
    const geometry = input.rects.sourceContent;
    if (geometry !== null && geometry !== undefined && geometry.containerId === source.id) {
        const measured = sizesAlong(orientationOf(source), geometry.members);
        if (viewIds.every((id) => collapsed.has(id) || (measured[id] ?? 0) > 0)) return Object.fromEntries(viewIds.map((id) => [id, collapsed.has(id) ? intent(id) : measured[id]!]));
    }
    return Object.fromEntries(viewIds.map((id) => [id, intent(id)]));
}

/** 收起分栏前后的插入位：插在 `beforeViewId` 之前（缺省插在最后），预览是那条插入线。 */
interface InsertHit {
    readonly beforeViewId: string | undefined;
    readonly indicator: GridDropRect;
    readonly near: NonNullable<DropPreview["insertion"]>;
}

type ContentHit = ({readonly kind: "edge"} & EdgeHit) | ({readonly kind: "insert"} & InsertHit);

/**
 * 收起的细条只有 32px，拆半区会只亮 16px、份额也说不通，所以命中它（或全部收起）时改按列表插入位：细条的前半、
 * 间隙与后一条的前半归同一个插入位，剩余区归“插在最后”。
 */
function contentHitOf(input: DropInput, target: ContainerPresentation, geometry: ContentRects): ContentHit | null {
    const collapsed = new Set(target.views.filter((view) => view.collapsed).map((view) => view.id));
    const orientation = orientationOf(target);
    const allCollapsed = geometry.members.length > 0 && geometry.members.every((member) => collapsed.has(member.id));
    if (!allCollapsed) {
        const insertion = resolveGridInsertion({orientation, point: input.point, containerRect: geometry.rect, members: geometry.members, edgeRatio: CONTENT_EDGE_RATIO});
        if (insertion === null || insertion.kind === "keep") return null;
        const edge = edgeHitOf(insertion);
        if (edge === null) return null;
        if (!collapsed.has(edge.hitViewId)) return {kind: "edge", ...edge};
    }
    const list = resolveListInsertion({orientation, point: input.point, containerRect: geometry.rect, members: geometry.members});
    const last = geometry.members.at(-1);
    if (list === null || last === undefined) return null;
    const beforeViewId = list.beforeId ?? undefined;
    return {kind: "insert", beforeViewId, indicator: list.indicator, near: beforeViewId === undefined ? {viewId: last.id, side: "after"} : {viewId: beforeViewId, side: "before"}};
}

/**
 * 插入位挨着的展开分栏（被拖的视图自己不算）：拖入的视图与它平分，同半区的规则；两边都收起或在头尾时只插入，
 * 份额由网格按意图分，全部收起时就是剩余区。
 */
function expandedNeighbourOf(container: ContainerPresentation, beforeViewId: string | undefined, excluded: string | null): Pick<SplitPlacement, "hitViewId" | "side"> | null {
    const visible = container.views.filter((view) => view.id !== excluded);
    const at = beforeViewId === undefined ? visible.length : visible.findIndex((view) => view.id === beforeViewId);
    if (at === -1) return null;
    const previous = visible[at - 1];
    const next = visible[at];
    if (previous !== undefined && !previous.collapsed) return {hitViewId: previous.id, side: "after"};
    if (next !== undefined && !next.collapsed) return {hitViewId: next.id, side: "before"};
    return null;
}

function insertPreview(hit: InsertHit, orientation: GridOrientation, count: number): DropPreview {
    return {indicator: hit.indicator, areaRect: null, orientation, count, insertion: hit.near};
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
        const move = {kind: "move-view" as const, viewId: source.viewId, sourceContainerId: source.containerId, targetContainerId: container.id};
        if (hit.kind === "insert") {
            const preview = insertPreview(hit, orientation, 1);
            if (source.containerId === container.id) {
                // 插入位就在它自己前后：原位不提交。
                const others = container.members.filter((id) => id !== source.viewId);
                const at = hit.beforeViewId === undefined ? others.length : others.indexOf(hit.beforeViewId);
                if (hit.beforeViewId === source.viewId || container.members.indexOf(source.viewId) === at) return noop(preview);
            }
            const neighbour = expandedNeighbourOf(container, hit.beforeViewId, source.viewId);
            const placement = neighbour !== null ? {split: {...neighbour, sourceSizes: {[source.viewId]: 1}}} : hit.beforeViewId === undefined ? {} : {beforeViewId: hit.beforeViewId};
            return {kind: "commit", intent: {...move, ...placement, expand: true}, preview};
        }
        if (source.containerId === container.id && hit.hitViewId === source.viewId) return noop();
        const preview: DropPreview = {indicator: null, areaRect: hit.halfRect, orientation, count: 1};
        if (source.containerId === container.id) {
            // 同一容器内只改顺序：已经紧贴目标侧时原位不提交。
            const others = container.members.filter((id) => id !== source.viewId);
            const at = hit.side === "before" ? others.indexOf(hit.hitViewId) : others.indexOf(hit.hitViewId) + 1;
            if (container.members.indexOf(source.viewId) === at) return noop(preview);
        }
        return {kind: "commit", intent: {...move, split: {hitViewId: hit.hitViewId, side: hit.side, sourceSizes: {[source.viewId]: 1}}}, preview};
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
    // 只有展开的成员参与半区：收起成员的细条几何不是它的份额（intents.ts 的并入同此）。
    const expanded = from.views.filter((view) => !view.collapsed).map((view) => view.id);
    if (hit.kind === "insert") {
        // 插到收起栏旁时拖入的可见成员都会展开，都参与平分
        const neighbour = expandedNeighbourOf(container, hit.beforeViewId, null);
        const placement = neighbour !== null ? {split: {...neighbour, sourceSizes: sourceRatios(input, from, from.views.map((view) => view.id))}} : hit.beforeViewId === undefined ? {} : {beforeViewId: hit.beforeViewId};
        return {kind: "commit", intent: {...base, ...placement, expand: true}, preview: insertPreview(hit, orientation, count)};
    }
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

/**
 * 预备区：没显示的 Part 整区一个落点，视图建新容器、容器整个迁过来（Part 里已有容器时排在最后）。容器本来就在这个
 * Part（侧栏拖到零时活动栏里的条目）：只选中它。都同次显示这个 Part。
 */
function resolveReveal(input: DropInput, target: Extract<DropTarget, {kind: "reveal"}>): DropDecision {
    const rect = validRect(input.rects.reveal);
    if (rect === null) return noop();
    const orientation: GridOrientation = target.part === "panel" ? "horizontal" : "vertical";
    const source = input.source;
    if (source.kind === "view") {
        const from = viewSourceOf(input, source);
        if (typeof from === "string") return rejection(from);
        const intent: ViewIntent = {kind: "detach-view", viewId: source.viewId, sourceContainerId: source.containerId, containerId: input.newContainerId, targetPart: target.part};
        return {kind: "commit", intent, preview: {indicator: null, areaRect: rect, orientation, count: 1}, reveal: target.part};
    }
    const from = containerSourceOf(input, source);
    if (typeof from === "string") return rejection(from);
    const intent: ViewIntent = from.part === target.part
        ? {kind: "select-container", part: target.part, containerId: from.id}
        : {kind: "move-container", containerId: from.id, sourcePart: from.part, targetPart: target.part};
    return {kind: "commit", intent, preview: {indicator: null, areaRect: rect, orientation, count: source.viewIds.length}, reveal: target.part};
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
        case "reveal":
            return resolveReveal(input, input.target);
    }
}
