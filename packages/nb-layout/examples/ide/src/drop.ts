/**
 * 落点规则：指针此刻落在哪条按钮条上、拖着的按钮放下会插在哪。纯函数，输入是这一刻量到的矩形（视口坐标）。
 *
 * 库给的几何只有一块：`resolveListInsertion` 判一排东西里插在哪两个之间。左右两条是竖着排的，下条是横着排的，
 * 所以同一个函数用两个方向。哪里算落点、原位算不算落点，是宿主的规则，都在这个文件里。
 */
import {resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropMember, GridDropPoint, GridDropRect, GridOrientation} from "@notnotype/nb-layout";

import type {Zone} from "./model";

/** 一条按钮条此刻的几何：整条的矩形（空条也是落点）与每个按钮。 */
export type StripGeometry = {
    readonly strip: Zone;
    readonly rect: GridDropRect;
    readonly buttons: readonly GridDropMember[];
};

/** 按钮在条上沿哪个方向排：左右条竖着排，下条横着排。 */
export function listOrientation(strip: Zone): GridOrientation {
    return strip === "bottom" ? "horizontal" : "vertical";
}

/** 放进 `strip`，排在 `before` 前面；`null` 是最后。`indicator` 是插入线。 */
export type Drop = {readonly strip: Zone; readonly before: string | null; readonly indicator: GridDropRect};

/**
 * 判落点。`source` 是被拖的按钮此刻所在的条与那条上的次序。不是落点的地方交回 `null`：条的外面、分隔线、编辑区，
 * 以及放下了也没有变化的原位（插在自己前面，或插在自己后面那个按钮前面）。
 */
export function resolveDrop(tool: string, source: {readonly strip: Zone; readonly order: readonly string[]}, point: GridDropPoint, geometry: readonly StripGeometry[]): Drop | null {
    for (const each of geometry) {
        const insertion = resolveListInsertion({orientation: listOrientation(each.strip), point, containerRect: each.rect, members: each.buttons});
        if (insertion === null) continue;
        if (each.strip === source.strip && isOwnPosition(tool, source.order, insertion.beforeId)) return null;
        return {strip: each.strip, before: insertion.beforeId, indicator: insertion.indicator};
    }
    return null;
}

function isOwnPosition(tool: string, order: readonly string[], before: string | null): boolean {
    const index = order.indexOf(tool);
    return before === tool || before === (order[index + 1] ?? null);
}

/**
 * 落点的完整动作，拖动会话拿它比较“松手时的动作是不是最后显示过的那个”，界面也把它写在网格外框的 `data-drop` 上。
 * 只写条名不够：同一条上插在不同按钮前面是不同的动作，看起来一样、做出来不同。
 */
export function dropKey(drop: Drop): string {
    return `move:${drop.strip}:${drop.before ?? "end"}`;
}
