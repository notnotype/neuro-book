/**
 * 状态栏的目录与解算（docs/specs/ui/agent-conversation-view.md 的“状态栏”、docs/specs/agent/conversation.md 输出 45）：哪些数据项可选、
 * 在哪一侧、用户设置怎样定它们的显隐与次序。纯函数，视图、设置页与宿主共用同一份算法，免得各写一遍。
 *
 * 设置只记用户改过的：`order` 是排过的 id 次序（可以不全），`visible` 是改过的显隐。空设置解出的就是没有这项功能之前的状态栏。
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
};

export type ResolvedStatusItem = StatusLineItem & {readonly visible: boolean};

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

/** 每一侧先放 `order` 里出现的（按它的先后），再放没出现的（按目录顺序）；显隐取 `visible[id] ?? defaultVisible`；目录里没有的 id 忽略。 */
export function resolveStatusLine(catalog: readonly StatusLineItem[], setting: StatusLineSetting = {}): {readonly left: ResolvedStatusItem[]; readonly right: ResolvedStatusItem[]} {
    const rank = new Map((setting.order ?? []).map((id, index) => [id, index] as const));
    const side = (which: StatusLineSide): ResolvedStatusItem[] => catalog
        .map((item, index) => ({item, index}))
        .filter(({item}) => item.side === which)
        .sort((a, b) => (rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity) || a.index - b.index)
        .map(({item}) => ({...item, visible: setting.visible?.[item.id] ?? item.defaultVisible}));
    return {left: side("left"), right: side("right")};
}

/** 设置页与菜单写回时用：去掉与缺省相同的显隐，去掉与缺省次序相同的 `order`，空了就交回空对象。 */
function normalized(catalog: readonly StatusLineItem[], order: readonly string[], visible: Readonly<Record<string, boolean>>): StatusLineSetting {
    const known = new Map(catalog.map((item) => [item.id, item] as const));
    const keptVisible = Object.fromEntries(Object.entries(visible).filter(([id, value]) => known.get(id) === undefined || known.get(id)!.defaultVisible !== value));
    const defaults = resolveStatusLine(catalog, {});
    const current = resolveStatusLine(catalog, {order});
    const sameOrder = (["left", "right"] as const).every((s) => defaults[s].map((item) => item.id).join() === current[s].map((item) => item.id).join());
    // 目录里没有的 id（停用了的插件）带着它的次序留在 `order` 里：只有全是已知项、又与缺省次序相同时才去掉。
    const onlyKnown = order.every((id) => known.has(id));
    return {
        ...(sameOrder && onlyKnown ? {} : {order}),
        ...(Object.keys(keptVisible).length === 0 ? {} : {visible: keptVisible}),
    };
}

/** 勾选或取消一项：只改它的显隐（等于缺省就去掉这个键）。 */
export function toggleStatusItem(catalog: readonly StatusLineItem[], setting: StatusLineSetting, id: string): StatusLineSetting {
    const resolved = resolveStatusLine(catalog, setting);
    const item = [...resolved.left, ...resolved.right].find((entry) => entry.id === id);
    if (item === undefined) return setting;
    return normalized(catalog, setting.order ?? [], {...setting.visible, [id]: !item.visible});
}

/**
 * 把一项在它那一侧里移到第 `to` 位（拖动与上移下移共用）。这一侧的全部项（含隐藏的）写成完整次序；目录里没有的 id
 * （停用了的插件）在 `order` 里原样留着。`to` 夹在这一侧的范围内；位置不变时交回原设置。
 */
export function moveStatusItem(catalog: readonly StatusLineItem[], setting: StatusLineSetting, id: string, to: number): StatusLineSetting {
    const resolved = resolveStatusLine(catalog, setting);
    const item = catalog.find((entry) => entry.id === id);
    if (item === undefined) return setting;
    const ids = resolved[item.side].map((entry) => entry.id);
    const from = ids.indexOf(id);
    const target = Math.max(0, Math.min(ids.length - 1, to));
    if (from === target) return setting;
    ids.splice(target, 0, ...ids.splice(from, 1));
    const sideIds = new Set(catalog.filter((entry) => entry.side === item.side).map((entry) => entry.id));
    const rest = (setting.order ?? []).filter((entry) => !sideIds.has(entry));
    return normalized(catalog, [...rest, ...ids], setting.visible ?? {});
}
