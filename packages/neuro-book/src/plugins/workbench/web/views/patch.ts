/**
 * 定制记录的补丁与唯一的应用边界（docs/specs/ui/workbench-shell.md“状态与转换”）。意图在发起时合成一份按字段的补丁
 * （`intents.ts`）；store 每次保存（含保存冲突后的重放）都把同一份补丁作用在当时的最新值上，所以补丁只写本次主动改的
 * 字段，另一个窗口改的别的字段、未知数据原样保留，同字段后保存的胜出。
 *
 * 有三件事发起时定不下来，在这里按最新值做：
 * - 自建容器的确保：本次的目标自建容器在最新值里没有了（另一个窗口刚把它搬空清掉），按补丁带的身份重建；
 * - 自建容器的收口：本次涉及的自建容器（补丁列出的，加上最新值里被本次移走的视图原来所在的）在最新值里真的没有
 *   成员了，才删它的记录项与指向它的选中项；不做全局清扫；
 * - 带半区的并入前提：目标容器仍在同一个 Part、命中视图仍是它的成员；不成立整条不写，返回原值与原因。
 */

import type {DeepReadonly} from "@vue/reactivity";

import type {ViewLocation} from "../../shared/views";
import type {ContainerEntry, Customizations} from "../state/records";
import {computePlacement, implicitContainerId, isCustomContainer} from "./placement";
import type {ViewCatalog} from "./placement";

export interface ViewPlacementPatch {
    readonly container: string;
    readonly order: number;
    readonly fingerprint: string;
}

/** 视图的字段补丁：`null` 删除该字段，缺省不动。 */
export interface ViewFieldPatch {
    readonly placement?: ViewPlacementPatch | null;
    /**
     * 只改顺序：重放时视图仍在 `container`（有覆盖指向它，或没有覆盖且这就是它的隐式容器）才写，否则不动。给插入时
     * 被动挪位的成员用：它们的归属不是本次意图，不能盖掉另一个窗口已保存的移动。
     */
    readonly reorder?: ViewPlacementPatch;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly collapsed?: boolean | null;
}

/**
 * 容器项的字段补丁：位置（`location`、`order`）与身份（隐式容器的 `fingerprint`、自建容器的 `origin`）分开写，缺省
 * 不动。记录里还没有这一项时，只有带上位置两个字段才建。
 */
export interface ContainerFieldPatch {
    readonly location?: ViewLocation;
    readonly order?: number;
    readonly fingerprint?: string;
    readonly origin?: string;
}

export interface CustomizationsPatch {
    readonly views?: Readonly<Record<string, ViewFieldPatch>>;
    readonly containers?: Readonly<Record<string, ContainerFieldPatch | null>>;
    readonly selected?: Readonly<Partial<Record<ViewLocation, string | null>>>;
    /** 本次目标自建容器的完整身份：最新值里没有就按它重建。 */
    readonly ensure?: Readonly<Record<string, ContainerEntry>>;
    /** 本次涉及的自建容器：保存时在最新值里没有成员了才删。 */
    readonly settle?: ReadonlyArray<string>;
    /** 带半区的并入前提：目标容器仍在 `part`、`memberId` 仍是它的成员。 */
    readonly requires?: {readonly containerId: string; readonly part: ViewLocation; readonly memberId: string};
}

export interface PatchOutcome {
    readonly value: Customizations;
    /** 前提不成立、整条没写时的原因；写了为 null。 */
    readonly problem: string | null;
}

function applyViews(next: Customizations, patch: CustomizationsPatch, left: Set<string>): void {
    if (patch.views === undefined) return;
    const views = {...next.views};
    for (const [viewId, fields] of Object.entries(patch.views)) {
        const entry = {...views[viewId]};
        const before = entry.container;
        if (fields.placement === null) {
            delete entry.container;
            delete entry.order;
            delete entry.fingerprint;
        } else if (fields.placement !== undefined) {
            entry.container = fields.placement.container;
            entry.order = fields.placement.order;
            entry.fingerprint = fields.placement.fingerprint;
        }
        if (fields.reorder !== undefined && (entry.container ?? implicitContainerId(viewId)) === fields.reorder.container) {
            entry.container = fields.reorder.container;
            entry.order = fields.reorder.order;
            entry.fingerprint = fields.reorder.fingerprint;
        }
        if (before !== undefined && before !== entry.container) left.add(before);
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

function applyContainers(next: Customizations, patch: CustomizationsPatch): void {
    if (patch.containers === undefined && patch.ensure === undefined) return;
    const containers = {...next.containers};
    for (const [containerId, fields] of Object.entries(patch.containers ?? {})) {
        if (fields === null) {
            delete containers[containerId];
            continue;
        }
        const current = containers[containerId];
        const location = fields.location ?? current?.location;
        const order = fields.order ?? current?.order;
        if (location === undefined || order === undefined) continue;
        const entry: ContainerEntry = {...current, location, order};
        if (fields.fingerprint !== undefined) entry.fingerprint = fields.fingerprint;
        if (fields.origin !== undefined) entry.origin = fields.origin;
        containers[containerId] = entry;
    }
    for (const [containerId, entry] of Object.entries(patch.ensure ?? {})) {
        containers[containerId] ??= {...entry};
    }
    if (Object.keys(containers).length === 0) delete next.containers;
    else next.containers = containers;
}

function applySelected(next: Customizations, patch: CustomizationsPatch): void {
    if (patch.selected === undefined) return;
    const selected: Partial<Record<ViewLocation, string>> = {...next.selected};
    for (const [part, containerId] of Object.entries(patch.selected) as Array<[ViewLocation, string | null | undefined]>) {
        if (containerId === null) delete selected[part];
        else if (containerId !== undefined) selected[part] = containerId;
    }
    if (Object.keys(selected).length === 0) delete next.selected;
    else next.selected = selected;
}

/** 收口：涉及的自建容器在最新值里一个成员都没有了，删记录项与指向它的选中项。 */
function settle(next: Customizations, candidates: ReadonlySet<string>): void {
    for (const containerId of candidates) {
        if (!isCustomContainer(containerId)) continue;
        const occupied = Object.values(next.views ?? {}).some((entry) => entry.container === containerId);
        if (occupied) continue;
        if (next.containers?.[containerId] !== undefined) {
            const containers = {...next.containers};
            delete containers[containerId];
            if (Object.keys(containers).length === 0) delete next.containers;
            else next.containers = containers;
        }
        if (next.selected !== undefined) {
            const selected = Object.fromEntries(Object.entries(next.selected).filter(([, id]) => id !== containerId));
            if (Object.keys(selected).length === 0) delete next.selected;
            else next.selected = selected;
        }
    }
}

/**
 * 把补丁作用在一份记录值上（保存冲突重放时是最新值）；补丁没提到的字段与键原样保留，空对象不留在记录里。`catalog`
 * 用来在最新值上求落位，核对半区并入的前提。
 */
export function applyPatch(value: DeepReadonly<Customizations>, patch: CustomizationsPatch, catalog: ViewCatalog): PatchOutcome {
    const next = structuredClone(value) as Customizations;
    if (patch.requires !== undefined) {
        const {containerId, part, memberId} = patch.requires;
        const placement = computePlacement(catalog, next);
        const target = placement.containers.get(containerId);
        if (target === undefined || target.part !== part || placement.views.get(memberId)?.container !== containerId) {
            return {value: next, problem: `目标容器 ${containerId} 已不在 ${part} 或 ${memberId} 已不是它的成员，这次并入没有保存`};
        }
    }
    const left = new Set<string>(patch.settle);
    applyViews(next, patch, left);
    applyContainers(next, patch);
    applySelected(next, patch);
    settle(next, left);
    return {value: next, problem: null};
}
