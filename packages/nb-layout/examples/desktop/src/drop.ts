/**
 * 拖动标题栏时的落点规则：指针此刻在哪，放下会怎样。纯函数，输入是这一刻的指针与桌面叶的矩形（视口坐标）。
 *
 * 库在这里只给了会话（按下、过门槛、取消）与反馈层；整窗移动没有现成的落点几何，指针靠近桌面左右边缘算平铺，
 * 是这个示例自己的规则。
 */
import {clampFloatRect} from "@notnotype/nb-layout";
import type {GridDropPoint, GridDropRect, GridRect} from "@notnotype/nb-layout";

import {roundRect, type Side} from "./model";

/** 离桌面叶左右缘多近算贴边（CSS px）。越过边缘也算：指针被甩出桌面时不该失去落点。 */
export const EDGE_BAND = 20;

export type Drop =
    /** 窗停在 `rect`（相对网格根，已夹进桌面、已取整）；只有 `x`、`y` 会写回。 */
    | {readonly kind: "move"; readonly rect: GridRect}
    /**
     * 贴到桌面的一侧。`area` 是试平铺后新叶的区域（视口坐标，反馈画它）；`blocked` 是平铺不下的原因，
     * 有原因时放下按 `move` 处理：窗停在松手处，不平铺。
     */
    | {readonly kind: "tile"; readonly side: Side; readonly rect: GridRect; readonly area: GridDropRect | null; readonly blocked: string | null};

/** 窗被拖到哪：起点矩形加上指针从按下处走过的偏移，夹进桌面、取整。只返回 `x`、`y`：宽高不跟着改。 */
export function moveTarget(start: GridRect, pressed: GridDropPoint, point: GridDropPoint, desk: GridRect): {readonly x: number; readonly y: number} {
    const {x, y} = roundRect(clampFloatRect({...start, x: start.x + point.x - pressed.x, y: start.y + point.y - pressed.y}, desk));
    return {x, y};
}

/** 指针在左右边缘带里算那一侧；`desk` 是桌面叶的视口矩形。左边已有平铺窗时桌面叶的左缘不在 0。 */
export function tileSide(point: GridDropPoint, desk: GridDropRect): Side | null {
    if (point.x <= desk.left + EDGE_BAND) return "left";
    if (point.x >= desk.right - EDGE_BAND) return "right";
    return null;
}

/**
 * 落点的完整动作，写在承载盒的 `data-drop` 上，e2e 按它等。
 * 只写种类不够：平铺与平铺不下看起来都是“贴边”，动作却不同。
 */
export function dropKey(drop: Drop): string {
    if (drop.kind === "move") return "move";
    return `${drop.blocked === null ? "tile" : "blocked"}:${drop.side}`;
}

/**
 * 会话用的比较键。平铺不下的落点交回 `move` 的键，不是 `null`：`null` 的落点放下走“没有动作”，窗会弹回按下前的位置；
 * 交回 `move` 的键，放下时提交的是这个落点，界面再按 `blocked` 当作移动处理。
 */
export function actionKey(drop: Drop): string | null {
    return drop.kind === "tile" && drop.blocked !== null ? "move" : dropKey(drop);
}
