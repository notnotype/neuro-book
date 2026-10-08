/**
 * 落位：由视图声明与用户定制求出每个视图的实际容器与顺序、每个容器的实际 Part 与顺序、每个 Part 的选中容器
 * （docs/specs/ui/workbench-shell.md 外壳二，外壳设计稿第 3 节）。纯函数，不碰组件与运行时。
 *
 * - 外壳二只有隐式容器 `view:<起源视图 id>`：每个视图默认在自己的隐式容器里；容器是否存在只看实际成员，容器本身
 *   不单独记“存在”，所以恢复默认不会制造空入口。
 * - 用户覆盖带它基于的默认指纹：默认位置变了，旧覆盖在呈现中失效、回到新默认并诊断；原件不删，下一次针对该项的
 *   意图才改写它。
 * - 起源视图的声明不在（插件暂时缺失或已被禁用）而容器仍有成员时，容器照常存在；没有容器覆盖时，位置回落到首个
 *   实际成员的默认位置（ui/workbench-shell.md 输出 26）。
 */

import type {DeepReadonly} from "@vue/reactivity";

import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {Customizations, ViewEntry} from "../state/records";

const IMPLICIT_PREFIX = "view:";

export function implicitContainerId(viewId: string): string {
    return `${IMPLICIT_PREFIX}${viewId}`;
}

/** 隐式容器的起源视图 id；不是隐式容器 id 时为 null（外壳二不认识别的容器种类）。 */
export function originViewOf(containerId: string): string | null {
    return containerId.startsWith(IMPLICIT_PREFIX) && containerId.length > IMPLICIT_PREFIX.length ? containerId.slice(IMPLICIT_PREFIX.length) : null;
}

/** 覆盖基于的默认位置：视图声明的位置与顺序。记录里存这个串，声明改了位置或顺序就对不上。 */
export function defaultFingerprint(declaration: Pick<ViewDeclaration, "location" | "order">): string {
    return `${declaration.location}#${declaration.order ?? 0}`;
}

export type ViewCatalog = ReadonlyMap<string, ViewDeclaration>;

export type LayoutCustomizations = DeepReadonly<Pick<Customizations, "containers" | "selected" | "views">>;

export interface ViewPlacement {
    readonly container: string;
    readonly order: number;
    readonly source: "default" | "record";
}

export interface ContainerPlacement {
    readonly id: string;
    readonly part: ViewLocation;
    readonly order: number;
    /** record：有效的容器覆盖；default：起源视图的声明；member：起源声明不在，按首个实际成员回落。 */
    readonly source: "record" | "default" | "member";
    /** 实际成员，按 (order, id) 排好。 */
    readonly members: ReadonlyArray<string>;
}

export interface Placement {
    readonly views: ReadonlyMap<string, ViewPlacement>;
    /** 至少有一个实际成员的容器。 */
    readonly containers: ReadonlyMap<string, ContainerPlacement>;
    /** 每个 Part 的容器，按 (order, id) 排好。 */
    readonly parts: Readonly<Record<ViewLocation, ReadonlyArray<string>>>;
    /** 每个 Part 生效的选中容器：记录里的选中项仍在该 Part 就用它，否则取第一个容器。 */
    readonly selected: Readonly<Record<ViewLocation, string | null>>;
    readonly diagnostics: ReadonlyArray<string>;
}

function byOrderThenId(left: {readonly order: number; readonly id: string}, right: {readonly order: number; readonly id: string}): number {
    if (left.order !== right.order) return left.order - right.order;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** 视图的实际容器：有效覆盖优先，否则自己的隐式容器。 */
function placeView(viewId: string, declaration: ViewDeclaration, entry: DeepReadonly<ViewEntry> | undefined, diagnostics: string[]): ViewPlacement {
    const fallback: ViewPlacement = {container: implicitContainerId(viewId), order: 0, source: "default"};
    if (entry === undefined || (entry.container === undefined && entry.order === undefined && entry.fingerprint === undefined)) return fallback;
    if (entry.container === undefined || entry.order === undefined || entry.fingerprint === undefined) {
        diagnostics.push(`视图 ${viewId} 的位置覆盖不完整（容器、顺序与默认指纹要一起出现），已忽略`);
        return fallback;
    }
    if (declaration.movable === false) {
        diagnostics.push(`视图 ${viewId} 声明不可移动，记录里的位置覆盖被忽略`);
        return fallback;
    }
    if (entry.fingerprint !== defaultFingerprint(declaration)) {
        diagnostics.push(`视图 ${viewId} 的默认位置已变（覆盖基于 ${entry.fingerprint}），覆盖失效并回到新默认位置`);
        return fallback;
    }
    if (originViewOf(entry.container) === null) {
        diagnostics.push(`视图 ${viewId} 的位置覆盖指向不认识的容器 ${entry.container}，已忽略`);
        return fallback;
    }
    return {container: entry.container, order: entry.order, source: "record"};
}

export function computePlacement(catalog: ViewCatalog, customizations: LayoutCustomizations): Placement {
    const diagnostics: string[] = [];
    const recordedViews = customizations.views ?? {};
    const views = new Map<string, ViewPlacement>();
    for (const [viewId, declaration] of catalog) views.set(viewId, placeView(viewId, declaration, recordedViews[viewId], diagnostics));
    for (const viewId of Object.keys(recordedViews)) {
        if (!catalog.has(viewId)) diagnostics.push(`记录里有未登记视图 ${viewId} 的布局项，已忽略（原件保留）`);
    }

    const membersOf = new Map<string, Array<{readonly id: string; readonly order: number}>>();
    for (const [viewId, placement] of views) {
        const members = membersOf.get(placement.container) ?? [];
        members.push({id: viewId, order: placement.order});
        membersOf.set(placement.container, members);
    }

    const recordedContainers = customizations.containers ?? {};
    const containers = new Map<string, ContainerPlacement>();
    for (const [containerId, unsorted] of membersOf) {
        const members = unsorted.sort(byOrderThenId).map((member) => member.id);
        const originId = originViewOf(containerId) as string;
        const origin = catalog.get(originId);
        const override = recordedContainers[containerId];
        let located: Pick<ContainerPlacement, "part" | "order" | "source">;
        if (origin !== undefined) {
            const fingerprint = defaultFingerprint(origin);
            if (override !== undefined && override.fingerprint === fingerprint) located = {part: override.location, order: override.order, source: "record"};
            else {
                if (override !== undefined) diagnostics.push(`容器 ${containerId} 的默认位置已变（覆盖基于 ${override.fingerprint}），覆盖失效并回到新默认位置`);
                located = {part: origin.location, order: origin.order ?? 0, source: "default"};
            }
        } else if (override !== undefined) {
            // 起源声明不在，指纹无从核对：覆盖是用户留下的唯一位置依据，照用。
            located = {part: override.location, order: override.order, source: "record"};
        } else {
            const first = catalog.get(members[0] as string) as ViewDeclaration;
            diagnostics.push(`容器 ${containerId} 的起源视图 ${originId} 的声明不在，按首个成员 ${members[0] as string} 的默认位置放置`);
            located = {part: first.location, order: first.order ?? 0, source: "member"};
        }
        containers.set(containerId, {id: containerId, ...located, members});
    }
    for (const containerId of Object.keys(recordedContainers)) {
        if (containers.has(containerId)) continue;
        const originId = originViewOf(containerId);
        // 起源视图仍登记、只是暂时没有成员（成员都被移走）的容器覆盖是正常的旧数据，不诊断。
        if (originId === null || !catalog.has(originId)) diagnostics.push(`记录里有不存在的容器 ${containerId} 的布局项，已忽略（原件保留）`);
    }

    const parts = Object.fromEntries(VIEW_LOCATIONS.map((part) => [part, [...containers.values()].filter((container) => container.part === part).sort(byOrderThenId).map((container) => container.id)])) as Record<ViewLocation, string[]>;
    const recordedSelected = customizations.selected ?? {};
    const selected = Object.fromEntries(VIEW_LOCATIONS.map((part) => {
        const recorded = recordedSelected[part];
        if (recorded !== undefined && parts[part].includes(recorded)) return [part, recorded];
        return [part, parts[part][0] ?? null];
    })) as Record<ViewLocation, string | null>;

    return {views, containers, parts, selected, diagnostics};
}
