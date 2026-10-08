/**
 * 意图合成（外壳设计稿第 8 节，docs/specs/ui/workbench-shell.md“状态与转换”“副作用与数据”）：一次用户意图 → 拒绝、
 * 无变化或一份按字段的补丁（`patch.ts`）。整批拒绝：任一条件不成立就什么都不写。合成时的判断基于发起时的呈现（例如
 * 目标容器存在、来源未变）；保存时的重放规则在 `patch.ts`。
 *
 * 插入位：同一集合（容器的成员、Part 的容器）按 (order, id) 排，插入取前后两项序号的中点；精度用尽或越界时只把这个
 * 集合重排为 10、20、30…（只改顺序，不动归属）。
 *
 * 半区（外壳三）写在尺寸意图里：命中视图的意图 S（没记录过取 240）保留 S/2，拖入的可见成员合计 S/2 按来源相对比例分；
 * 只写命中视图与拖入成员的当前轴。
 */

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import {computePlacement, defaultFingerprint, implicitContainerId, isCustomContainer, originViewOf} from "./placement";
import type {LayoutCustomizations, Placement, ViewCatalog} from "./placement";
import {applyPatch} from "./patch";
import type {ContainerFieldPatch, CustomizationsPatch, ViewFieldPatch} from "./patch";
import {axisOf, sizeFieldOf} from "./presentation";
import type {ContainerAxis, Presentation} from "./presentation";

export {applyPatch} from "./patch";
export type {ContainerFieldPatch, CustomizationsPatch, PatchOutcome, ViewFieldPatch, ViewPlacementPatch} from "./patch";

const ORDER_STEP = 10;
const ORDER_MAX = 1_000_000;
const ORDER_MIN = -1_000_000;
const SIZE_MAX = 1_000_000;
/** 没记录过尺寸的视图的意图（与容器网格的默认一致）。 */
const DEFAULT_SIZE = 240;

/** 边缘并入：命中的视图与落在它的哪一侧；`sourceSizes` 是拖入可见成员的相对比例（只当比例用，单位不要求）。 */
export interface SplitPlacement {
    readonly hitViewId: string;
    readonly side: "before" | "after";
    readonly sourceSizes: Readonly<Record<string, number>>;
}

export type ViewIntent =
    | {readonly kind: "select-container"; readonly part: ViewLocation; readonly containerId: string}
    | {
        readonly kind: "move-view";
        readonly viewId: string;
        readonly sourceContainerId: string;
        readonly targetContainerId: string;
        /** 插在这个成员之前；缺省追加。带 `split` 时插入位由命中视图与侧向决定。 */
        readonly beforeViewId?: string;
        readonly split?: SplitPlacement;
        /** 落在全收起容器的剩余区：同次清掉拖入视图的收起。 */
        readonly expand?: boolean;
    }
    /** 一次容器内手势的结果：只含主动变化的叶，`axis` 是手势开始时容器的轴。 */
    | {readonly kind: "set-view-sizes"; readonly containerId: string; readonly axis: ContainerAxis; readonly sizes: Readonly<Record<string, number>>}
    | {readonly kind: "set-view-collapsed"; readonly viewId: string; readonly collapsed: boolean}
    /** 清除视图的位置覆盖，回到自己的隐式容器（“重置位置”）。 */
    | {readonly kind: "reset-view"; readonly viewId: string}
    | {readonly kind: "reset-container"; readonly containerId: string}
    /** 把视图拖出成一个自建容器：`containerId` 是发起时生成一次的 `custom:<UUID>`。 */
    | {readonly kind: "detach-view"; readonly viewId: string; readonly sourceContainerId: string; readonly containerId: string; readonly targetPart: ViewLocation; readonly beforeContainerId?: string}
    /** 整个容器换序或迁到另一个 Part。 */
    | {readonly kind: "move-container"; readonly containerId: string; readonly sourcePart: ViewLocation; readonly targetPart: ViewLocation; readonly beforeContainerId?: string}
    /** 整组并入：`sourceViewIds` 是发起时来源的全部实际成员（含隐藏与收起）。 */
    | {
        readonly kind: "merge-container";
        readonly sourceContainerId: string;
        readonly targetContainerId: string;
        readonly sourceViewIds: ReadonlyArray<string>;
        readonly beforeViewId?: string;
        readonly split?: SplitPlacement;
        readonly expand?: boolean;
    };

export type IntentRejection = "unknown-view" | "not-movable" | "unknown-container" | "stale-source" | "axis-changed" | "invalid";

export type IntentResult =
    | {readonly kind: "rejected"; readonly code: IntentRejection; readonly reason: string}
    | {readonly kind: "unchanged"}
    | {readonly kind: "patch"; readonly patch: CustomizationsPatch};

export interface IntentState {
    readonly catalog: ViewCatalog;
    readonly placement: Placement;
    readonly presentation: Presentation;
    readonly customizations: LayoutCustomizations;
}

function rejected(code: IntentRejection, reason: string): IntentResult {
    return {kind: "rejected", code, reason};
}

interface Ordered {
    readonly id: string;
    readonly order: number;
}

/**
 * 在已排好、且不含被插入项的集合里求插入序号：插在 `beforeId` 之前（缺省追加）。`rerank` 非空时这个集合要整体重排。
 * 锚点不在集合里返回 null。
 */
function insertionOrder(members: ReadonlyArray<Ordered>, beforeId: string | undefined): {readonly order: number; readonly rerank: ReadonlyMap<string, number>} | null {
    const at = beforeId === undefined ? members.length : members.findIndex((member) => member.id === beforeId);
    if (at === -1) return null;
    const lower = members[at - 1];
    const upper = members[at];
    let order: number | null;
    if (lower === undefined && upper === undefined) order = 0;
    else if (upper === undefined) order = lower!.order + 1 <= ORDER_MAX ? lower!.order + 1 : null;
    else if (lower === undefined) order = upper.order - 1 >= ORDER_MIN ? upper.order - 1 : null;
    else {
        const middle = (lower.order + upper.order) / 2;
        order = middle > lower.order && middle < upper.order ? middle : null;
    }
    if (order !== null) return {order, rerank: new Map()};
    // 精度用尽或越界：只把这个集合重排为 10、20、30…，插入项取对应空位的中点。
    const rerank = new Map(members.map((member, index) => [member.id, (index + 1) * ORDER_STEP] as const));
    return {order: at * ORDER_STEP + ORDER_STEP / 2, rerank};
}

function membersOf(placement: Placement, containerId: string, excluded: ReadonlySet<string>): Ordered[] {
    return (placement.containers.get(containerId)?.members ?? []).filter((id) => !excluded.has(id)).map((id) => ({id, order: placement.views.get(id)!.order}));
}

function containersOf(placement: Placement, part: ViewLocation, excluded: string | null): Ordered[] {
    return placement.parts[part].filter((id) => id !== excluded).map((id) => ({id, order: placement.containers.get(id)!.order}));
}

/** 隐式容器的项要带指纹（起源声明在时）；自建容器的身份已经在记录里。 */
function containerIdentity(catalog: ViewCatalog, containerId: string): Pick<ContainerFieldPatch, "fingerprint"> {
    const origin = originViewOf(containerId);
    const declaration = origin === null ? undefined : catalog.get(origin);
    return declaration === undefined ? {} : {fingerprint: defaultFingerprint(declaration)};
}

/** 被动挪位的视图只改顺序。 */
function reorderViews(catalog: ViewCatalog, containerId: string, rerank: ReadonlyMap<string, number>, views: Record<string, ViewFieldPatch>): void {
    for (const [id, order] of rerank) views[id] = {...views[id], reorder: {container: containerId, order, fingerprint: defaultFingerprint(catalog.get(id)!)}};
}

/** 被动挪位的容器只改顺序（位置不变）。 */
function reorderContainers(catalog: ViewCatalog, part: ViewLocation, rerank: ReadonlyMap<string, number>, containers: Record<string, ContainerFieldPatch | null>): void {
    for (const [id, order] of rerank) containers[id] = {location: part, order, ...containerIdentity(catalog, id)};
}

/** 插在命中视图的哪一侧，换成“插在谁之前”。 */
function anchorOfSplit(placement: Placement, targetId: string, split: SplitPlacement, excluded: ReadonlySet<string>): string | undefined | null {
    const members = (placement.containers.get(targetId)?.members ?? []).filter((id) => !excluded.has(id));
    const at = members.indexOf(split.hitViewId);
    if (at === -1) return null;
    return split.side === "before" ? split.hitViewId : members[at + 1];
}

/**
 * 半区：命中视图保留原意图的一半，拖入的可见成员按比例分另一半。只写命中视图与拖入成员的当前轴。量不出比例（没有
 * 正的比例）时返回 null，整条拒绝。
 */
function splitSizes(state: IntentState, targetPart: ViewLocation, split: SplitPlacement, movers: ReadonlyArray<string>, views: Record<string, ViewFieldPatch>): boolean {
    const field = sizeFieldOf(axisOf(targetPart));
    const recorded = state.customizations.views?.[split.hitViewId]?.[field];
    const share = (recorded ?? DEFAULT_SIZE) / 2;
    const ratios = movers.map((id) => split.sourceSizes[id] ?? 0);
    const total = ratios.reduce((sum, ratio) => sum + (Number.isFinite(ratio) && ratio > 0 ? ratio : 0), 0);
    if (!(total > 0)) return false;
    views[split.hitViewId] = {...views[split.hitViewId], [field]: share};
    movers.forEach((id, index) => {
        const ratio = ratios[index]!;
        if (Number.isFinite(ratio) && ratio > 0) views[id] = {...views[id], [field]: (share * ratio) / total};
    });
    return true;
}

/** 目标是自建容器时带上它此刻的身份：保存时最新值里它已被清掉，就按这份重建（patch.ts）。 */
function ensureOf(state: IntentState, containerId: string): Pick<CustomizationsPatch, "ensure"> {
    const entry = isCustomContainer(containerId) ? state.customizations.containers?.[containerId] : undefined;
    return entry === undefined ? {} : {ensure: {[containerId]: {...entry}}};
}

/** 视图归属的覆盖：`defaultSpot` 且目标是自己的隐式容器时删掉覆盖（回到默认位置），其它写一条。 */
function placeInto(viewId: string, declaration: ViewDeclaration, containerId: string, order: number, defaultSpot: boolean): ViewFieldPatch {
    if (defaultSpot && containerId === implicitContainerId(viewId)) return {placement: null};
    return {placement: {container: containerId, order, fingerprint: defaultFingerprint(declaration)}};
}

function moveView(state: IntentState, intent: Extract<ViewIntent, {kind: "move-view"}>): IntentResult {
    const {catalog, placement} = state;
    const declaration = catalog.get(intent.viewId);
    const current = placement.views.get(intent.viewId);
    if (declaration === undefined || current === undefined) return rejected("unknown-view", `未登记的视图 ${intent.viewId}`);
    if (declaration.movable === false) return rejected("not-movable", `视图 ${intent.viewId} 声明不可移动`);
    const target = placement.containers.get(intent.targetContainerId);
    if (target === undefined) return rejected("unknown-container", `目标容器 ${intent.targetContainerId} 不存在`);
    if (current.container !== intent.sourceContainerId) {
        return rejected("stale-source", `视图 ${intent.viewId} 已不在 ${intent.sourceContainerId}（现在在 ${current.container}）`);
    }
    const sameContainer = current.container === intent.targetContainerId;
    const excluded = new Set([intent.viewId]);
    // 同一容器内的边缘落点只改顺序（Spec 输出 21），换成插入位。
    const split = sameContainer ? undefined : intent.split;
    const anchor = intent.split === undefined ? intent.beforeViewId : anchorOfSplit(placement, intent.targetContainerId, intent.split, excluded);
    if (anchor === null) return rejected("invalid", `命中视图 ${intent.split?.hitViewId ?? ""} 不是容器 ${intent.targetContainerId} 的成员`);
    if (anchor === intent.viewId) return rejected("invalid", `视图 ${intent.viewId} 不能插到自己之前`);
    const others = membersOf(placement, intent.targetContainerId, excluded);
    // 不带插入位地“移到当前容器”（菜单、命令）就是原地。
    if (sameContainer && intent.beforeViewId === undefined && intent.split === undefined && intent.expand !== true) return {kind: "unchanged"};
    if (sameContainer) {
        const now = target.members.indexOf(intent.viewId);
        const at = anchor === undefined ? others.length : others.findIndex((member) => member.id === anchor);
        if (at === -1) return rejected("invalid", `锚点 ${anchor ?? ""} 不在容器 ${intent.targetContainerId} 里`);
        if (at === now && intent.expand !== true) return {kind: "unchanged"};
    }
    const slot = insertionOrder(others, anchor);
    if (slot === null) return rejected("invalid", `锚点 ${anchor ?? ""} 不在容器 ${intent.targetContainerId} 里`);

    const views: Record<string, ViewFieldPatch> = {};
    reorderViews(catalog, intent.targetContainerId, slot.rerank, views);
    // 不指定插入位地回到自己的隐式容器就是默认位置（起源排第一）。
    views[intent.viewId] = placeInto(intent.viewId, declaration, intent.targetContainerId, slot.order, anchor === undefined && !sameContainer);
    if (intent.expand === true) views[intent.viewId] = {...views[intent.viewId], collapsed: null};
    if (split !== undefined && !splitSizes(state, target.part, {...split, sourceSizes: {[intent.viewId]: split.sourceSizes[intent.viewId] ?? 1}}, [intent.viewId], views)) {
        return rejected("invalid", "量不出半区的来源比例");
    }
    return {kind: "patch", patch: {
        views,
        ...(sameContainer ? {} : {selected: {[target.part]: intent.targetContainerId}, ...ensureOf(state, intent.targetContainerId)}),
        ...(isCustomContainer(current.container) && !sameContainer ? {settle: [current.container]} : {}),
        ...(split === undefined ? {} : {requires: {containerId: intent.targetContainerId, part: target.part, memberId: split.hitViewId}}),
    }};
}

function detachView(state: IntentState, intent: Extract<ViewIntent, {kind: "detach-view"}>): IntentResult {
    const {catalog, placement} = state;
    const declaration = catalog.get(intent.viewId);
    const current = placement.views.get(intent.viewId);
    if (declaration === undefined || current === undefined) return rejected("unknown-view", `未登记的视图 ${intent.viewId}`);
    if (declaration.movable === false) return rejected("not-movable", `视图 ${intent.viewId} 声明不可移动`);
    if (current.container !== intent.sourceContainerId) {
        return rejected("stale-source", `视图 ${intent.viewId} 已不在 ${intent.sourceContainerId}（现在在 ${current.container}）`);
    }
    if (!isCustomContainer(intent.containerId) || placement.containers.has(intent.containerId) || state.customizations.containers?.[intent.containerId] !== undefined) {
        return rejected("invalid", `${intent.containerId} 不是一个新的自建容器 id`);
    }
    const slot = insertionOrder(containersOf(placement, intent.targetPart, null), intent.beforeContainerId);
    if (slot === null) return rejected("invalid", `锚点容器 ${intent.beforeContainerId ?? ""} 不在 ${intent.targetPart}`);
    const containers: Record<string, ContainerFieldPatch | null> = {};
    reorderContainers(catalog, intent.targetPart, slot.rerank, containers);
    const entry = {location: intent.targetPart, order: slot.order, origin: intent.viewId};
    containers[intent.containerId] = entry;
    return {kind: "patch", patch: {
        views: {[intent.viewId]: {placement: {container: intent.containerId, order: 0, fingerprint: defaultFingerprint(declaration)}}},
        containers,
        ensure: {[intent.containerId]: entry},
        selected: {[intent.targetPart]: intent.containerId},
        ...(isCustomContainer(current.container) ? {settle: [current.container]} : {}),
    }};
}

function moveContainer(state: IntentState, intent: Extract<ViewIntent, {kind: "move-container"}>): IntentResult {
    const {catalog, placement} = state;
    const container = placement.containers.get(intent.containerId);
    if (container === undefined) return rejected("unknown-container", `容器 ${intent.containerId} 不存在`);
    if (container.part !== intent.sourcePart) return rejected("stale-source", `容器 ${intent.containerId} 已不在 ${intent.sourcePart}（现在在 ${container.part}）`);
    if (intent.beforeContainerId === intent.containerId) return {kind: "unchanged"};
    const others = containersOf(placement, intent.targetPart, intent.containerId);
    if (intent.targetPart === container.part) {
        const now = placement.parts[container.part].indexOf(intent.containerId);
        const at = intent.beforeContainerId === undefined ? others.length : others.findIndex((member) => member.id === intent.beforeContainerId);
        if (at === now) return {kind: "unchanged"};
    }
    const slot = insertionOrder(others, intent.beforeContainerId);
    if (slot === null) return rejected("invalid", `锚点容器 ${intent.beforeContainerId ?? ""} 不在 ${intent.targetPart}`);
    const containers: Record<string, ContainerFieldPatch | null> = {};
    reorderContainers(catalog, intent.targetPart, slot.rerank, containers);
    containers[intent.containerId] = {location: intent.targetPart, order: slot.order, ...containerIdentity(catalog, intent.containerId)};
    return {kind: "patch", patch: {containers, ...(intent.targetPart === container.part ? {} : {selected: {[intent.targetPart]: intent.containerId}})}};
}

function mergeContainer(state: IntentState, intent: Extract<ViewIntent, {kind: "merge-container"}>): IntentResult {
    const {catalog, placement} = state;
    const source = placement.containers.get(intent.sourceContainerId);
    const target = placement.containers.get(intent.targetContainerId);
    if (source === undefined || target === undefined) return rejected("unknown-container", `容器 ${source === undefined ? intent.sourceContainerId : intent.targetContainerId} 不存在`);
    if (source.id === target.id) return {kind: "unchanged"};
    // 冻结的成员快照与现在的实际成员对不上：隐藏成员会漏搬，整组拒绝。
    if (source.members.length !== intent.sourceViewIds.length || source.members.some((id, index) => intent.sourceViewIds[index] !== id)) {
        return rejected("stale-source", `容器 ${source.id} 的成员已变化`);
    }
    for (const id of source.members) {
        if (catalog.get(id)?.movable === false) return rejected("not-movable", `视图 ${id} 声明不可移动，整组不并入`);
    }
    const movers = new Set(source.members);
    const anchor = intent.split === undefined ? intent.beforeViewId : anchorOfSplit(placement, target.id, intent.split, movers);
    if (anchor === null) return rejected("invalid", `命中视图 ${intent.split?.hitViewId ?? ""} 不是容器 ${target.id} 的成员`);
    // 多项插入：把目标集合连同插入的成员重排成 10、20、30…；目标原有成员只改顺序。
    const others = target.members;
    const at = anchor === undefined ? others.length : others.indexOf(anchor);
    if (at === -1) return rejected("invalid", `锚点 ${anchor ?? ""} 不在容器 ${target.id} 里`);
    const sequence = [...others.slice(0, at), ...source.members, ...others.slice(at)];
    const views: Record<string, ViewFieldPatch> = {};
    sequence.forEach((id, index) => {
        const order = (index + 1) * ORDER_STEP;
        if (movers.has(id)) views[id] = placeInto(id, catalog.get(id)!, target.id, order, false);
        else if (placement.views.get(id)!.order !== order) views[id] = {reorder: {container: target.id, order, fingerprint: defaultFingerprint(catalog.get(id)!)}};
    });
    const sourceSlice = state.presentation.containers.get(source.id);
    const visibleMovers = source.members.filter((id) => sourceSlice?.views.some((view) => view.id === id) === true);
    if (intent.expand === true) for (const id of visibleMovers) views[id] = {...views[id], collapsed: null};
    if (intent.split !== undefined && !splitSizes(state, target.part, intent.split, visibleMovers, views)) {
        return rejected("invalid", "量不出半区的来源比例");
    }
    return {kind: "patch", patch: {
        views,
        selected: {[target.part]: target.id},
        ...ensureOf(state, target.id),
        ...(isCustomContainer(source.id) ? {settle: [source.id]} : {}),
        ...(intent.split === undefined ? {} : {requires: {containerId: target.id, part: target.part, memberId: intent.split.hitViewId}}),
    }};
}

function setViewSizes(state: IntentState, intent: Extract<ViewIntent, {kind: "set-view-sizes"}>): IntentResult {
    const container = state.presentation.containers.get(intent.containerId);
    if (container === undefined) return rejected("unknown-container", `容器 ${intent.containerId} 不存在`);
    // 手势进行中容器换了轴（被移到另一个 Part）：旧轴的像素不能当作新轴的尺寸。
    if (container.axis !== intent.axis) return rejected("axis-changed", `容器 ${intent.containerId} 已换轴，丢弃旧手势的尺寸`);
    const field = sizeFieldOf(container.axis);
    const views: Record<string, ViewFieldPatch> = {};
    for (const [viewId, size] of Object.entries(intent.sizes)) {
        const slot = container.views.find((view) => view.id === viewId);
        if (slot === undefined) return rejected("invalid", `视图 ${viewId} 不是容器 ${intent.containerId} 的可见成员`);
        if (!Number.isFinite(size) || size <= 0 || size > SIZE_MAX) return rejected("invalid", `视图 ${viewId} 的尺寸 ${String(size)} 不是正有限的 CSS px`);
        const next = Math.min(slot.maxSize, Math.max(slot.minSize, size));
        if (next !== slot.size) views[viewId] = {[field]: next};
    }
    return Object.keys(views).length === 0 ? {kind: "unchanged"} : {kind: "patch", patch: {views}};
}

function setViewCollapsed(state: IntentState, intent: Extract<ViewIntent, {kind: "set-view-collapsed"}>): IntentResult {
    const current = state.placement.views.get(intent.viewId);
    if (current === undefined) return rejected("unknown-view", `未登记的视图 ${intent.viewId}`);
    const container = state.presentation.containers.get(current.container)!;
    // single 不单独收起视图（ui/workbench-shell.md 输出 16）；隐藏的视图没有收起控件。
    if (container.mode !== "multiple" || !container.views.some((view) => view.id === intent.viewId)) {
        return rejected("invalid", `视图 ${intent.viewId} 现在不能单独收起`);
    }
    const recorded = state.customizations.views?.[intent.viewId]?.collapsed === true;
    if (recorded === intent.collapsed) return {kind: "unchanged"};
    return {kind: "patch", patch: {views: {[intent.viewId]: {collapsed: intent.collapsed ? true : null}}}};
}

export function applyIntent(state: IntentState, intent: ViewIntent): IntentResult {
    switch (intent.kind) {
        case "select-container": {
            if (!state.placement.parts[intent.part].includes(intent.containerId)) return rejected("unknown-container", `容器 ${intent.containerId} 不在 ${intent.part}`);
            if (state.placement.selected[intent.part] === intent.containerId && state.customizations.selected?.[intent.part] === intent.containerId) return {kind: "unchanged"};
            return {kind: "patch", patch: {selected: {[intent.part]: intent.containerId}}};
        }
        case "move-view":
            return moveView(state, intent);
        case "detach-view":
            return detachView(state, intent);
        case "move-container":
            return moveContainer(state, intent);
        case "merge-container":
            return mergeContainer(state, intent);
        case "set-view-sizes":
            return setViewSizes(state, intent);
        case "set-view-collapsed":
            return setViewCollapsed(state, intent);
        case "reset-view": {
            if (!state.catalog.has(intent.viewId)) return rejected("unknown-view", `未登记的视图 ${intent.viewId}`);
            const current = state.placement.views.get(intent.viewId);
            const entry = state.customizations.views?.[intent.viewId];
            if (entry?.container === undefined && entry?.order === undefined && entry?.fingerprint === undefined) return {kind: "unchanged"};
            // 隐式容器可能有自己的位置覆盖：按清除后的落位找它所在的 Part，再选中它。
            const views = {[intent.viewId]: {placement: null}};
            const settle = current !== undefined && isCustomContainer(current.container) ? [current.container] : [];
            const after = computePlacement(state.catalog, applyPatch(state.customizations, {views, settle}, state.catalog).value);
            const home = after.containers.get(implicitContainerId(intent.viewId))!;
            return {kind: "patch", patch: {views, selected: {[home.part]: home.id}, ...(settle.length > 0 ? {settle} : {})}};
        }
        case "reset-container":
            if (state.customizations.containers?.[intent.containerId] === undefined || isCustomContainer(intent.containerId)) return {kind: "unchanged"};
            return {kind: "patch", patch: {containers: {[intent.containerId]: null}}};
    }
}
