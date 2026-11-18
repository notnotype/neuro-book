/**
 * 状态栏的目录与解算（docs/specs/ui/agent-conversation-view.md 的“状态栏”、docs/specs/agent/conversation.md 输出 45）：哪些数据项可选、
 * 在哪一侧、用户设置怎样定它们的显隐、次序与边，窄时收哪几项。纯函数，视图、设置页与宿主共用同一份算法，免得各写一遍。
 *
 * 设置只记用户改过的：`order` 是排过的 id 次序（可以不全），`visible` 是改过的显隐，`side` 是换过的边。空设置解出的就是没有这项
 * 功能之前的状态栏。
 * 提醒类（运行阶段、等你处理、费用超过告警线……）不在目录里，总显示。
 */

import type {Text} from "@notnotype/nb-ui/text";

import {agentRef} from "./text";

export type StatusLineSide = "left" | "right";

/** 目录里的一项。 */
export type StatusLineItem = {
    readonly id: string;
    readonly side: StatusLineSide;
    readonly title: Text;
    readonly description?: Text;
    readonly defaultVisible: boolean;
    /** 来源的插件名；内置项没有。设置页与菜单据此标“插件”。 */
    readonly source?: string;
};

export type StatusLineSetting = {
    readonly order?: readonly string[];
    readonly visible?: Readonly<Record<string, boolean>>;
    /** 换过边的项在哪一边；只记与目录不同的。 */
    readonly side?: Readonly<Record<string, StatusLineSide>>;
};

/** 解算后的一项：`side` 是生效的一边（设置换过的，否则目录的）。 */
export type ResolvedStatusItem = StatusLineItem & {readonly visible: boolean};

/** 移动的目标：哪一边的第几位（按移走这一项之后的次序数）。 */
export type StatusLineSlot = {readonly side: StatusLineSide; readonly index: number};

/** 内置四项，次序就是缺省的次序。 */
export const BUILTIN_STATUS_ITEMS: readonly StatusLineItem[] = [
    {id: "context", side: "left", title: agentRef("status.line.context.title"), description: agentRef("status.line.context.description"), defaultVisible: true},
    {id: "usage", side: "right", title: agentRef("status.line.usage.title"), description: agentRef("status.line.usage.description"), defaultVisible: true},
    {id: "cost", side: "right", title: agentRef("status.line.cost.title"), description: agentRef("status.line.cost.description"), defaultVisible: true},
    {id: "model", side: "right", title: agentRef("status.line.model.title"), description: agentRef("status.line.model.description"), defaultVisible: false},
];

/** 内置项加宿主的项；宿主的项与内置项或彼此同 id 时，先到的算。 */
export function statusLineCatalog(extra: readonly StatusLineItem[] = []): StatusLineItem[] {
    const seen = new Set<string>();
    const catalog: StatusLineItem[] = [];
    for (const item of [...BUILTIN_STATUS_ITEMS, ...extra]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        catalog.push(item);
    }
    return catalog;
}

/**
 * 每一项在 `side[id] ?? 目录的一边`；每一侧先放 `order` 里出现的（按它的先后），再放没出现的（按目录顺序）；显隐取
 * `visible[id] ?? defaultVisible`；目录里没有的 id 忽略。插件声明的一边因此只是缺省：用户没换过的项随声明走。
 */
export function resolveStatusLine(catalog: readonly StatusLineItem[], setting: StatusLineSetting = {}): {readonly left: ResolvedStatusItem[]; readonly right: ResolvedStatusItem[]} {
    const rank = new Map((setting.order ?? []).map((id, index) => [id, index] as const));
    const side = (which: StatusLineSide): ResolvedStatusItem[] => catalog
        .map((item, index) => ({item: {...item, side: setting.side?.[item.id] ?? item.side}, index}))
        .filter(({item}) => item.side === which)
        .sort((a, b) => (rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity) || a.index - b.index)
        .map(({item}) => ({...item, visible: setting.visible?.[item.id] ?? item.defaultVisible}));
    return {left: side("left"), right: side("right")};
}

type SettingParts = {readonly order: readonly string[]; readonly visible: Readonly<Record<string, boolean>>; readonly side: Readonly<Record<string, StatusLineSide>>};

/**
 * 写回时用：去掉与缺省相同的显隐与边，去掉与缺省次序相同的 `order`，空了就交回空对象。缺省次序与当前次序都按同一份 `side`
 * 解算再比：不带 `side` 比的话，换到另一边第 0 位的次序会被当成缺省去掉。目录里没有的 id（停用了的插件）原样留着。
 */
function normalized(catalog: readonly StatusLineItem[], {order, visible, side}: SettingParts): StatusLineSetting {
    const known = new Map(catalog.map((item) => [item.id, item] as const));
    const keptVisible = Object.fromEntries(Object.entries(visible).filter(([id, value]) => known.get(id) === undefined || known.get(id)!.defaultVisible !== value));
    const keptSide = Object.fromEntries(Object.entries(side).filter(([id, value]) => known.get(id) === undefined || known.get(id)!.side !== value));
    const defaults = resolveStatusLine(catalog, {side: keptSide});
    const current = resolveStatusLine(catalog, {order, side: keptSide});
    const sameOrder = (["left", "right"] as const).every((s) => defaults[s].map((item) => item.id).join() === current[s].map((item) => item.id).join());
    // 目录里没有的 id 带着它的次序留在 `order` 里：只有全是已知项、又与缺省次序相同时才去掉。
    const onlyKnown = order.every((id) => known.has(id));
    return {
        ...(sameOrder && onlyKnown ? {} : {order}),
        ...(Object.keys(keptVisible).length === 0 ? {} : {visible: keptVisible}),
        ...(Object.keys(keptSide).length === 0 ? {} : {side: keptSide}),
    };
}

const partsOf = (setting: StatusLineSetting): SettingParts => ({order: setting.order ?? [], visible: setting.visible ?? {}, side: setting.side ?? {}});

/** 勾选或取消一项：只改它的显隐（等于缺省就去掉这个键），次序与边原样。 */
export function toggleStatusItem(catalog: readonly StatusLineItem[], setting: StatusLineSetting, id: string): StatusLineSetting {
    const resolved = resolveStatusLine(catalog, setting);
    const item = [...resolved.left, ...resolved.right].find((entry) => entry.id === id);
    if (item === undefined) return setting;
    const parts = partsOf(setting);
    return normalized(catalog, {...parts, visible: {...parts.visible, [id]: !item.visible}});
}

/**
 * 把一项移到 `to`：哪一边的第几位，按移走它之后那一边的次序数，夹在范围里（拖动与上移下移共用）。两边的全部项（含隐藏的）
 * 写成完整次序，目录里没有的 id 排在前面原样留着。位置不变时交回原设置。
 */
export function moveStatusItem(catalog: readonly StatusLineItem[], setting: StatusLineSetting, id: string, to: StatusLineSlot): StatusLineSetting {
    if (!catalog.some((entry) => entry.id === id)) return setting;
    const resolved = resolveStatusLine(catalog, setting);
    const sides = {left: resolved.left.map((entry) => entry.id), right: resolved.right.map((entry) => entry.id)};
    const from: StatusLineSlot = sides.left.includes(id) ? {side: "left", index: sides.left.indexOf(id)} : {side: "right", index: sides.right.indexOf(id)};
    sides[from.side].splice(from.index, 1);
    const index = Math.max(0, Math.min(sides[to.side].length, to.index));
    if (from.side === to.side && from.index === index) return setting;
    sides[to.side].splice(index, 0, id);
    const known = new Set(catalog.map((entry) => entry.id));
    const parts = partsOf(setting);
    return normalized(catalog, {
        ...parts,
        order: [...parts.order.filter((entry) => !known.has(entry)), ...sides.left, ...sides.right],
        side: {...parts.side, [id]: to.side},
    });
}

/**
 * 上移（-1）、下移（+1）：在“左边接右边”这一串里挪一位。右边第一项上移到左边最后（左边空着也一样），左边最后一项下移到右边
 * 第一；只有左边第一项不能上移、右边最后一项不能下移，那时交回原设置。
 */
export function shiftStatusItem(catalog: readonly StatusLineItem[], setting: StatusLineSetting, id: string, delta: -1 | 1): StatusLineSetting {
    const {left, right} = resolveStatusLine(catalog, setting);
    const inLeft = left.findIndex((entry) => entry.id === id);
    const inRight = right.findIndex((entry) => entry.id === id);
    if (inLeft >= 0) {
        if (delta < 0) return inLeft === 0 ? setting : moveStatusItem(catalog, setting, id, {side: "left", index: inLeft - 1});
        return inLeft === left.length - 1 ? moveStatusItem(catalog, setting, id, {side: "right", index: 0}) : moveStatusItem(catalog, setting, id, {side: "left", index: inLeft + 1});
    }
    if (inRight < 0) return setting;
    if (delta < 0) return inRight === 0 ? moveStatusItem(catalog, setting, id, {side: "left", index: left.length}) : moveStatusItem(catalog, setting, id, {side: "right", index: inRight - 1});
    return inRight === right.length - 1 ? setting : moveStatusItem(catalog, setting, id, {side: "right", index: inRight + 1});
}

/** 窄时要排的一项：id 与量到的自然宽度。 */
export type StatusLineWidth = {readonly id: string; readonly width: number};

/**
 * 窄时收哪几项（docs/specs/ui/agent-conversation-view.md 的“状态栏”）：`left`、`right` 是两边可见项的自然宽度（按呈现顺序），
 * `reserved` 是提醒的宽（排在左边的项后面，不收；没有提醒为 0，不占间距），`available` 是整行去掉内边距后的宽度。先收右边、从前往后，
 * 再收左边、从后往前；收起任何一项后右边最前面多一个“…”（`moreWidth`）。都放不下时全收。交回收起的 id，按收的先后。
 *
 * 宽度按状态栏的版式算：左右两块之间一个间距（右边一块空着、不画时没有），块内相邻的东西之间各一个间距；左边一块总在。
 */
export function collapsedItems(input: {
    readonly left: readonly StatusLineWidth[];
    readonly right: readonly StatusLineWidth[];
    readonly reserved: number;
    readonly available: number;
    readonly gap: number;
    readonly moreWidth: number;
}): string[] {
    const {left, right, reserved, available, gap, moreWidth} = input;
    const order = [...right, ...[...left].reverse()];
    const span = (widths: readonly number[]): number => widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
    for (let count = 0; count <= order.length; count += 1) {
        const collapsed = new Set(order.slice(0, count).map((item) => item.id));
        const leftWidths = [...left.filter((item) => !collapsed.has(item.id)).map((item) => item.width), ...(reserved > 0 ? [reserved] : [])];
        const rightWidths = [...(count > 0 ? [moreWidth] : []), ...right.filter((item) => !collapsed.has(item.id)).map((item) => item.width)];
        const total = span(leftWidths) + span(rightWidths) + (rightWidths.length > 0 ? gap : 0);
        if (total <= available) return [...collapsed];
    }
    return order.map((item) => item.id);
}
