/**
 * 键盘拖动的停靠点（docs/specs/ui/workbench-layout.md 输出 31）：每个落点放回 `layout-drag` 的判定能算出它的那个点。纯计算，标签条的停靠点由调用方量了给进来。
 */

import {layoutSeamsOf} from "@notnotype/nb-workbench-layout";
import type {GridDropPoint} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropCandidate, LayoutDropPanelGeometry} from "@notnotype/nb-workbench-layout";

import {barStopsOf} from "./entry-drop";
import {centerOf} from "./drag-geometry";
import type {EntryBand} from "./drag-geometry";

/** 一块标签条上键盘能停的位置：看得见的标签之间，各对应文档里的下标。 */
export type StripStops = (panel: string) => ReadonlyArray<{readonly point: GridDropPoint; readonly index: number}>;

/** 这个落点放回判定能算出它的那个点；算不出（浮动、缝或面板不在、标签条上没有这个下标）是 null。 */
export function pointOfCandidate(candidate: LayoutDropCandidate, doc: LayoutDoc, panels: ReadonlyArray<LayoutDropPanelGeometry>, stripStops: StripStops): GridDropPoint | null {
    const {action} = candidate;
    if (action.kind === "float") return null;
    if (action.kind === "edge" && action.target.kind === "between") {
        const {before, after} = action.target;
        const seam = layoutSeamsOf(doc, panels).find((item) => item.before === before && item.after === after);
        if (seam === undefined) return null;
        const across = (seam.from + seam.to) / 2;
        return seam.orientation === "horizontal" ? {x: seam.at, y: across} : {x: across, y: seam.at};
    }
    const panelId = action.kind !== "edge" ? action.panel : (action.target.kind === "between" ? null : action.target.panel);
    if (panelId === null) return null;
    const geometry = panels.find((item) => item.id === panelId);
    if (geometry === undefined) return null;
    // 同一个下标可能有两个位置（固定行的行尾、普通行的行首）：取后一个，放下去是普通标签。
    if (action.kind === "strip") return stripStops(panelId).findLast((stop) => stop.index === action.index)?.point ?? null;
    const {body} = geometry;
    const center = centerOf(body);
    if (action.kind === "center") return center;
    const {target} = action;
    if (target.kind === "between") return null;
    const {edge} = target;
    // 收成标题行的分节正文是零高，正文上沿往里 2px 已经落到下一节：它的前半就是标题行（nb-layout 的 `sectionHalf`），停靠点取标题行中心。
    if (edge === "top" && body.bottom <= body.top && geometry.strip !== null) return centerOf(geometry.strip);
    const inset = 2;
    if (edge === "left") return {x: body.left + inset, y: center.y};
    if (edge === "right") return {x: body.right - inset, y: center.y};
    if (edge === "top") return {x: center.x, y: body.top + inset};
    return {x: center.x, y: body.bottom - inset};
}

/** 键盘在入口条上的停靠点：每个空位，和视图能并入的每个入口（`entries`）。点在入口条的中线上。 */
export function barStops(band: EntryBand, entries: boolean): ReadonlyArray<GridDropPoint> {
    const {rect, axis} = band;
    const middle = axis === "y" ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
    return barStopsOf(band.entries, axis === "y" ? rect.bottom : rect.right, {entries}).map((along) => (axis === "y" ? {x: middle, y: along} : {x: along, y: middle}));
}
