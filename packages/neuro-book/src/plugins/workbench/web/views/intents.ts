/**
 * 意图合成（外壳设计稿第 8 节，docs/specs/ui/workbench-shell.md“状态与转换”）：一次用户意图 → 拒绝、无变化或一份
 * 按字段的补丁。整批拒绝：任一条件不成立就什么都不写。补丁只含本次主动改的字段；store 在保存冲突重放时把同一份补丁
 * 作用在最新值上（`applyPatch`），另一个窗口改的别的字段、未知数据因此保留。
 *
 * 合成时的判断基于发起时的呈现（例如目标容器存在、来源未变）；重放时不再判断，同字段后保存的胜出。
 */

import type {DeepReadonly} from "@vue/reactivity";

import type {ViewLocation} from "../../shared/views";
import type {ContainerEntry, Customizations} from "../state/records";
import {computePlacement, defaultFingerprint, implicitContainerId} from "./placement";
import type {LayoutCustomizations, Placement, ViewCatalog} from "./placement";
import {sizeFieldOf} from "./presentation";
import type {ContainerAxis, Presentation} from "./presentation";

/** 顺序的取值上限，与记录 schema 一致；追加越界时把目标容器的成员重排为 1、2、3…。 */
const ORDER_MAX = 1_000_000;
const SIZE_MAX = 1_000_000;

export type ViewIntent =
    | {readonly kind: "select-container"; readonly part: ViewLocation; readonly containerId: string}
    | {readonly kind: "move-view"; readonly viewId: string; readonly sourceContainerId: string; readonly targetContainerId: string}
    /** 一次容器内手势的结果：只含主动变化的叶，`axis` 是手势开始时容器的轴。 */
    | {readonly kind: "set-view-sizes"; readonly containerId: string; readonly axis: ContainerAxis; readonly sizes: Readonly<Record<string, number>>}
    | {readonly kind: "set-view-collapsed"; readonly viewId: string; readonly collapsed: boolean}
    /** 清除视图的位置覆盖，回到自己的隐式容器（“重置位置”）。 */
    | {readonly kind: "reset-view"; readonly viewId: string}
    | {readonly kind: "reset-container"; readonly containerId: string};

export interface ViewPlacementPatch {
    readonly container: string;
    readonly order: number;
    readonly fingerprint: string;
}

/** 视图的字段补丁：`null` 删除该字段，缺省不动。 */
export interface ViewFieldPatch {
    readonly placement?: ViewPlacementPatch | null;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly collapsed?: boolean | null;
}

export interface CustomizationsPatch {
    readonly views?: Readonly<Record<string, ViewFieldPatch>>;
    readonly containers?: Readonly<Record<string, ContainerEntry | null>>;
    readonly selected?: Readonly<Partial<Record<ViewLocation, string | null>>>;
}

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
    if (current.container === intent.targetContainerId) return {kind: "unchanged"};

    const views: Record<string, ViewFieldPatch> = {};
    if (intent.targetContainerId === implicitContainerId(intent.viewId)) {
        // 回到自己的隐式容器就是默认位置：删掉覆盖而不是写一条等于默认的覆盖。
        views[intent.viewId] = {placement: null};
    } else {
        const others = target.members.map((id) => ({id, order: placement.views.get(id)!.order}));
        const last = others.reduce((max, member) => Math.max(max, member.order), Number.NEGATIVE_INFINITY);
        let order = others.length === 0 ? 0 : last + 1;
        if (order > ORDER_MAX) {
            others.forEach((member, index) => {
                const memberDeclaration = catalog.get(member.id)!;
                views[member.id] = {placement: {container: intent.targetContainerId, order: index + 1, fingerprint: defaultFingerprint(memberDeclaration)}};
            });
            order = others.length + 1;
        }
        views[intent.viewId] = {placement: {container: intent.targetContainerId, order, fingerprint: defaultFingerprint(declaration)}};
    }
    return {kind: "patch", patch: {views, selected: {[target.part]: intent.targetContainerId}}};
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
        case "set-view-sizes":
            return setViewSizes(state, intent);
        case "set-view-collapsed":
            return setViewCollapsed(state, intent);
        case "reset-view": {
            if (!state.catalog.has(intent.viewId)) return rejected("unknown-view", `未登记的视图 ${intent.viewId}`);
            const entry = state.customizations.views?.[intent.viewId];
            if (entry?.container === undefined && entry?.order === undefined && entry?.fingerprint === undefined) return {kind: "unchanged"};
            // 隐式容器可能有自己的位置覆盖：按清除后的落位找它所在的 Part，再选中它。
            const views = {[intent.viewId]: {placement: null}};
            const after = computePlacement(state.catalog, applyPatch(state.customizations, {views}));
            const home = after.containers.get(implicitContainerId(intent.viewId))!;
            return {kind: "patch", patch: {views, selected: {[home.part]: home.id}}};
        }
        case "reset-container":
            if (state.customizations.containers?.[intent.containerId] === undefined) return {kind: "unchanged"};
            return {kind: "patch", patch: {containers: {[intent.containerId]: null}}};
    }
}

/** 把补丁作用在一份记录值上（保存冲突重放时是最新值）；补丁没提到的字段与键原样保留，空对象不留在记录里。 */
export function applyPatch(value: DeepReadonly<Customizations>, patch: CustomizationsPatch): Customizations {
    const next = structuredClone(value) as Customizations;
    if (patch.views !== undefined) {
        const views = {...next.views};
        for (const [viewId, fields] of Object.entries(patch.views)) {
            const entry = {...views[viewId]};
            if (fields.placement === null) {
                delete entry.container;
                delete entry.order;
                delete entry.fingerprint;
            } else if (fields.placement !== undefined) {
                entry.container = fields.placement.container;
                entry.order = fields.placement.order;
                entry.fingerprint = fields.placement.fingerprint;
            }
            for (const name of ["width", "height", "collapsed"] as const) {
                const field = fields[name];
                if (field === null) delete entry[name];
                else if (field !== undefined) (entry as Record<string, unknown>)[name] = field;
            }
            if (Object.keys(entry).length === 0) delete views[viewId];
            else views[viewId] = entry;
        }
        if (Object.keys(views).length === 0) delete next.views;
        else next.views = views;
    }
    if (patch.containers !== undefined) {
        const containers = {...next.containers};
        for (const [containerId, entry] of Object.entries(patch.containers)) {
            if (entry === null) delete containers[containerId];
            else containers[containerId] = {...entry};
        }
        if (Object.keys(containers).length === 0) delete next.containers;
        else next.containers = containers;
    }
    if (patch.selected !== undefined) {
        const selected: Partial<Record<ViewLocation, string>> = {...next.selected};
        for (const [part, containerId] of Object.entries(patch.selected) as Array<[ViewLocation, string | null | undefined]>) {
            if (containerId === null) delete selected[part];
            else if (containerId !== undefined) selected[part] = containerId;
        }
        if (Object.keys(selected).length === 0) delete next.selected;
        else next.selected = selected;
    }
    return next;
}
