/**
 * 落点规则：指针此刻落在哪，拖着的标签放下会怎样。纯函数，输入是这一刻量到的矩形（视口坐标）。
 *
 * 库给的是两块几何：`resolveListInsertion` 判一排东西里插在哪两个之间，`resolveGridEdgeDrop` 判一块矩形的四边与中央。
 * 哪里算落点、算什么落点，是宿主的规则，都在这个文件里。
 */
import {resolveGridEdgeDrop, resolveListInsertion} from "@notnotype/nb-layout";
import type {GridDropMember, GridDropPoint, GridDropRect} from "@notnotype/nb-layout";

import type {Group, Side} from "./model";

/** 一个编组此刻的几何：标签条（和里面每个标签）、正文。 */
export type GroupGeometry = {
    readonly group: string;
    readonly strip: GridDropRect;
    readonly tabs: readonly GridDropMember[];
    readonly body: GridDropRect;
};

export type Drop =
    /** 插进标签条，排在 `before` 前面；`null` 是最后。`indicator` 是插入线。 */
    | {readonly kind: "insert"; readonly group: string; readonly before: string | null; readonly indicator: GridDropRect}
    /** 移进编组，排在最后。 */
    | {readonly kind: "into"; readonly group: string; readonly area: GridDropRect}
    /** 在编组的一边拆出新编组。`blocked` 是做不成的原因（放不下、太深），由界面试拆之后填上；做不成的只显示、不提交。 */
    | {readonly kind: "split"; readonly group: string; readonly side: Side; readonly area: GridDropRect; readonly blocked: string | null};

/**
 * 判落点。`source` 是被拖的标签所在的编组。不是落点的地方交回 `null`：侧栏、分隔线、网格外面，
 * 以及几种放下了也没有变化的：拖回自己原来的位置、移进自己所在的编组、单标签编组拆自己。
 */
export function resolveDrop(tab: string, source: {readonly id: string; readonly group: Group}, point: GridDropPoint, geometry: readonly GroupGeometry[]): Drop | null {
    for (const each of geometry) {
        const insertion = resolveListInsertion({orientation: "horizontal", point, containerRect: each.strip, members: each.tabs});
        if (insertion !== null) {
            if (each.group === source.id && isOwnPosition(tab, source.group.tabs, insertion.beforeId)) return null;
            return {kind: "insert", group: each.group, before: insertion.beforeId, indicator: insertion.indicator};
        }
        const edge = resolveGridEdgeDrop({point, rect: each.body});
        if (edge === null) continue;
        if (edge === "center") return each.group === source.id ? null : {kind: "into", group: each.group, area: each.body};
        if (each.group === source.id && source.group.tabs.length === 1) return null;
        return {kind: "split", group: each.group, side: edge, area: half(each.body, edge), blocked: null};
    }
    return null;
}

/** 插在自己前面，或插在自己后面那个标签前面：都是原位。 */
function isOwnPosition(tab: string, tabs: readonly string[], before: string | null): boolean {
    const index = tabs.indexOf(tab);
    return before === tab || before === (tabs[index + 1] ?? null);
}

function half(rect: GridDropRect, side: Side): GridDropRect {
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    if (side === "left") return {...rect, right: midX};
    if (side === "right") return {...rect, left: midX};
    if (side === "top") return {...rect, bottom: midY};
    return {...rect, top: midY};
}

/**
 * 落点的完整动作，拖动会话拿它比较“松手时的动作是不是最后显示过的那个”，界面也把它写在网格外框的 `data-drop` 上。
 * 只写种类不够：路径上经过同种类的别的落点时，看起来一样、动作却不同。
 */
export function dropKey(drop: Drop): string {
    if (drop.kind === "insert") return `insert:${drop.group}:${drop.before ?? "end"}`;
    if (drop.kind === "into") return `into:${drop.group}`;
    return `${drop.blocked === null ? "split" : "blocked"}:${drop.group}:${drop.side}`;
}

/** 会话用的比较键：做不成的拆分是 `null`，只显示、松手不提交。 */
export function actionKey(drop: Drop): string | null {
    return drop.kind === "split" && drop.blocked !== null ? null : dropKey(drop);
}
