/**
 * 拖放的 DOM 适配：按组件写在元素上的标记找拖动源与落点、读几何（docs/specs/ui/workbench-shell.md 外壳三输出 19–22）。
 * 只有 DOM 与几何，不产生意图、不写状态；坐标一律是视口 client 像素，与 `drop.ts` 一致。
 *
 * 标记（组件负责写，会话只读）：
 * - 拖动源：`data-drag-view="<viewId>"`（multiple 的视图标题）、`data-drag-container="<containerId>"`（标签、活动条目、
 *   Sidebar single 的容器标题行）；源里 `data-no-drag` 的区域（动作区、菜单）不起拖。
 * - 落点：`data-switcher-band="<part>"`（标签带、ActivityBar 条目带）与其中的 `data-switcher-entry="<containerId>"`；
 *   `data-container-host="<containerId>"`（容器内容）与其中的 `data-view-section="<viewId>"`；`data-empty-part="<part>"`。
 * - 拖动反馈（拖影、落点覆盖层）带 `data-drag-feedback`，不算业务元素，也不挡命中。
 *
 * 由旧应用 `workbench-drop-dom.ts`（已人工验证）改写：可见矩形的读法照搬；命中不再经拖动库的碰撞检测，直接按
 * `elementsFromPoint` 的最上层业务元素认落点，被菜单、对话框挡住的位置因此不接收。
 */

import type {GridDropMember, GridDropPoint, GridDropRect} from "@notnotype/nb-ui/layout";

import {VIEW_LOCATIONS} from "../../shared/views";
import type {ViewLocation} from "../../shared/views";
import type {ContentRects, DropTarget, SwitcherRects} from "./drop";

const FEEDBACK_SELECTOR = "[data-drag-feedback]";
const TARGET_SELECTOR = "[data-switcher-band], [data-container-host], [data-empty-part]";
const SOURCE_SELECTOR = "[data-drag-view], [data-drag-container]";
/** 拖动源里不起拖的部分：显式标记的动作区与菜单，以及表单控件、链接与可编辑区域。 */
const BLOCKING_SELECTOR = "[data-no-drag], input, textarea, select, a[href], [contenteditable='true'], [contenteditable='']";
/** 声明隐藏或惰性化的子树（`hidden="until-found"` 仍占位）：不当落点。 */
const HIDDEN_SELECTOR = "[hidden], [inert]";
/** 会裁剪后代的 overflow 计算值。 */
const CLIPPING_OVERFLOW = /(auto|scroll|hidden|clip)/u;

function intersect(a: GridDropRect, b: GridDropRect): GridDropRect | null {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right > left && bottom > top ? {left, top, right, bottom} : null;
}

function finiteRect(rect: DOMRect): GridDropRect | null {
    const box: GridDropRect = {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
    const finite = Number.isFinite(box.left) && Number.isFinite(box.top) && Number.isFinite(box.right) && Number.isFinite(box.bottom);
    return finite && box.right > box.left && box.bottom > box.top ? box : null;
}

/**
 * 祖先的 client 内容盒：扣掉边框与滚动条，被它们挡住的部分不算可见。有 `transform` 时按 rect 与 offset 的比例折回
 * 视口单位；没有时两者的差只是取整误差，不当比例用。
 */
function clientRect(element: Element, style: CSSStyleDeclaration): GridDropRect {
    const rect = element.getBoundingClientRect();
    const transformed = style.transform !== "none" && style.transform !== "";
    const layout = transformed && element instanceof HTMLElement ? element : null;
    const scaleX = layout !== null && layout.offsetWidth > 0 ? rect.width / layout.offsetWidth : 1;
    const scaleY = layout !== null && layout.offsetHeight > 0 ? rect.height / layout.offsetHeight : 1;
    const left = rect.left + element.clientLeft * scaleX;
    const top = rect.top + element.clientTop * scaleY;
    return {left, top, right: left + element.clientWidth * scaleX, bottom: top + element.clientHeight * scaleY};
}

/**
 * 元素此刻真正可见的矩形：与视口及每个会裁剪的祖先相交，停放区（`display: none`）、滚出可见范围、零尺寸都为 null。
 * 不缓存：每帧重新量，滚动与尺寸变化在同一帧生效。
 */
export function readDropRect(element: Element | null | undefined): GridDropRect | null {
    if (element === null || element === undefined || !element.isConnected || element.closest(HIDDEN_SELECTOR) !== null) return null;
    const view = element.ownerDocument.defaultView;
    if (view === null) return null;
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return null;
    let box = finiteRect(element.getBoundingClientRect());
    if (box === null) return null;
    const root = element.ownerDocument.documentElement;
    box = intersect(box, {left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight});
    for (let ancestor = element.parentElement; box !== null && ancestor !== null && ancestor !== root; ancestor = ancestor.parentElement) {
        const ancestorStyle = view.getComputedStyle(ancestor);
        // `display: contents` 没有盒子，它的 overflow 裁不到任何东西。
        if (ancestorStyle.display === "contents" || !CLIPPING_OVERFLOW.test(`${ancestorStyle.overflow} ${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`)) continue;
        box = intersect(box, clientRect(ancestor, ancestorStyle));
    }
    return box;
}

function locationOf(value: string | undefined): ViewLocation | null {
    return VIEW_LOCATIONS.find((part) => part === value) ?? null;
}

/** 按下处的拖动源：在 `root` 里、不在源的不起拖区域里。 */
export function dragSourceAt(root: Element, target: EventTarget | null): {readonly element: HTMLElement; readonly viewId: string | null; readonly containerId: string | null} | null {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>(SOURCE_SELECTOR);
    if (element === null || !root.contains(element)) return null;
    const blocker = target.closest(BLOCKING_SELECTOR);
    if (blocker !== null && element.contains(blocker)) return null;
    return {element, viewId: element.dataset.dragView ?? null, containerId: element.dataset.dragContainer ?? null};
}

/** 命中的落点：元素与它声明的目标。 */
export interface DropHit {
    readonly element: HTMLElement;
    readonly target: DropTarget;
}

/**
 * 指针处的落点：`elementsFromPoint` 从最上层往下，跳过拖动反馈，第一个业务元素所在的最近落点就是命中；第一个业务
 * 元素不在任何落点里（框架按钮、Part 之间的缝、浮层）就没有命中。落点必须在 `root` 里。
 */
export function dropHitAt(root: Element, point: GridDropPoint, partOf: (containerId: string) => ViewLocation | null): DropHit | null {
    for (const element of root.ownerDocument.elementsFromPoint(point.x, point.y)) {
        if (element.closest(FEEDBACK_SELECTOR) !== null) continue;
        const hit = element.closest<HTMLElement>(TARGET_SELECTOR);
        if (hit === null || !root.contains(hit)) return null;
        const band = locationOf(hit.dataset.switcherBand);
        if (band !== null) return {element: hit, target: {kind: "switcher", part: band}};
        const empty = locationOf(hit.dataset.emptyPart);
        if (empty !== null) return {element: hit, target: {kind: "empty", part: empty}};
        const containerId = hit.dataset.containerHost;
        const part = containerId === undefined ? null : partOf(containerId);
        return containerId === undefined || part === null ? null : {element: hit, target: {kind: "content", containerId, part}};
    }
    return null;
}

/**
 * Switcher 几何：条目带的可见矩形，与按显示顺序的条目。条目用未裁剪的外框：滚出标签带的条目仍要参与排序，
 * `resolveListInsertion` 自己把它们夹进条目带。
 */
export function readSwitcherRects(band: HTMLElement, part: ViewLocation): SwitcherRects | null {
    const rect = readDropRect(band);
    if (rect === null) return null;
    const entries: GridDropMember[] = [];
    for (const entry of band.querySelectorAll<HTMLElement>("[data-switcher-entry]")) {
        const box = finiteRect(entry.getBoundingClientRect());
        if (box !== null && entry.dataset.switcherEntry !== undefined) entries.push({id: entry.dataset.switcherEntry, rect: box});
    }
    return {orientation: part === "sidebar" ? "vertical" : "horizontal", rect, entries};
}

/** 容器内容几何：宿主的可见矩形与它自己的分节（不含嵌在别的宿主里的），按文档顺序即网格顺序。 */
export function readContentRects(host: HTMLElement): ContentRects | null {
    const containerId = host.dataset.containerHost;
    const rect = readDropRect(host);
    if (containerId === undefined || rect === null) return null;
    const members: GridDropMember[] = [];
    for (const section of host.querySelectorAll<HTMLElement>("[data-view-section]")) {
        if (section.closest("[data-container-host]") !== host || section.dataset.viewSection === undefined) continue;
        const box = readDropRect(section);
        if (box !== null) members.push({id: section.dataset.viewSection, rect: box});
    }
    return {containerId, rect, members};
}

/** 容器宿主元素（来源比例要读来源容器的几何）。 */
export function containerHostIn(root: Element, containerId: string): HTMLElement | null {
    for (const host of root.querySelectorAll<HTMLElement>("[data-container-host]")) if (host.dataset.containerHost === containerId) return host;
    return null;
}

/**
 * 键盘拖放能去的落点区域（Tab 依次经过）：`root` 里此刻可见的落点，按 Part 的固定顺序（侧栏、右栏、面板），每个 Part
 * 里先条目带、再内容。不按文档顺序：外壳的 DOM 里面板排在右栏之前，与看到的不一致。
 */
export function keyboardRegions(root: Element, partOf: (containerId: string) => ViewLocation | null): HTMLElement[] {
    const rank = (element: HTMLElement): number => {
        const part = locationOf(element.dataset.switcherBand ?? element.dataset.emptyPart) ?? (element.dataset.containerHost === undefined ? null : partOf(element.dataset.containerHost));
        return (part === null ? VIEW_LOCATIONS.length : VIEW_LOCATIONS.indexOf(part)) * 2 + (element.dataset.switcherBand === undefined ? 1 : 0);
    };
    // 排序是稳定的：同一个 Part 的多个内容区（不会出现，选中的只有一个）保持文档顺序。
    return [...root.querySelectorAll<HTMLElement>(TARGET_SELECTOR)].filter((element) => readDropRect(element) !== null).sort((a, b) => rank(a) - rank(b));
}

/** 区域里键盘能停的位置：方向键沿 `axis` 逐个经过；`axis` 为 null 的区域只有一个位置。 */
export interface KeyboardStops {
    readonly axis: "horizontal" | "vertical" | null;
    readonly points: ReadonlyArray<GridDropPoint>;
}

const inside = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

/**
 * 每个位置是一个落在区域里的坐标，交给与指针同一份命中与判定：Switcher 是每个条目的前缘（插到它之前）与末个条目
 * 之后；内容区是每个可见分节的前半与后半（插到它之前、之后）；全部收成细条时与空 Part 一样只有中心一个位置。
 */
export function keyboardStops(region: HTMLElement): KeyboardStops {
    const rect = readDropRect(region);
    if (rect === null) return {axis: null, points: []};
    const center = {x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2};
    const band = locationOf(region.dataset.switcherBand);
    if (band !== null) {
        const rects = readSwitcherRects(region, band);
        const horizontal = rects?.orientation === "horizontal";
        const along = (offset: number): GridDropPoint => (horizontal ? {x: offset, y: center.y} : {x: center.x, y: offset});
        const entries = rects?.entries ?? [];
        const points = entries.map((entry) => along((horizontal ? entry.rect.left : entry.rect.top) + 1));
        const last = entries.at(-1);
        if (last !== undefined) points.push(along(Math.min((horizontal ? last.rect.right : last.rect.bottom) + 1, (horizontal ? rect.right : rect.bottom) - 1)));
        else points.push(center);
        return {axis: horizontal ? "horizontal" : "vertical", points: points.filter((point) => inside(rect, point))};
    }
    if (region.dataset.containerHost !== undefined) {
        const axis = region.dataset.containerAxis === "horizontal" ? "horizontal" : "vertical";
        const content = readContentRects(region);
        const sections = [...region.querySelectorAll<HTMLElement>("[data-view-section]")].filter((section) => section.closest("[data-container-host]") === region);
        if (content === null || sections.every((section) => section.dataset.viewCollapsed === "true")) return {axis: null, points: [center]};
        const points = content.members.flatMap((member) => {
            const start = axis === "horizontal" ? member.rect.left : member.rect.top;
            const size = axis === "horizontal" ? member.rect.right - member.rect.left : member.rect.bottom - member.rect.top;
            return [0.25, 0.75].map((ratio) => (axis === "horizontal" ? {x: start + size * ratio, y: (member.rect.top + member.rect.bottom) / 2} : {x: (member.rect.left + member.rect.right) / 2, y: start + size * ratio}));
        });
        return {axis, points: points.filter((point) => inside(rect, point))};
    }
    return {axis: null, points: [center]};
}
