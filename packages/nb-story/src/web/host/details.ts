/**
 * 右侧详情的状态（docs/specs/story/viewer.md 输出 66 到 69）：最多两张，按左右排。纯函数，每个返回新状态，不碰 DOM、不依赖会话，
 * 会话（`book.ts`）只经它们改。
 *
 * - `key` 是一张详情的身份（内容层的键、关闭与对调的参数）：只在换成别的内容时换新的，换页签不换，外壳与卡片不重挂。
 * - `open` 为假是“整块收起、记着这几张”（顶栏开关、拖到 0、关掉最后一张）：再展开时都回来。
 * - `active` 是最近点过的那张：主区里的链接换它，读 `drawer` 的页面看的是它。
 */

import type {DrawerContent} from "./book";

/** 人物卡的四个页签（`book.ts` 原样转出）。放在这里：地址参数的判断要用，`book.ts` 又从这里取状态函数。 */
export const TABS = ["summary", "relations", "records", "episodes"] as const;
export type Tab = (typeof TABS)[number];

export function isTab(value: unknown): value is Tab {
    return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

export interface DetailItem {
    readonly key: number;
    readonly content: DrawerContent;
}

export interface DetailsState {
    /** 按左右排，最多两张。 */
    readonly items: readonly DetailItem[];
    readonly active: number | null;
    readonly open: boolean;
    /** 下一张新详情的 `key`。 */
    readonly nextKey: number;
}

/** 要打开的内容：人物卡的页签可以不给（“没给”与给了 `summary` 不同，见 `openIn`）。 */
export type DetailRequest = Exclude<DrawerContent, {kind: "card"}> | {readonly kind: "card"; readonly entity: string; readonly tab?: Tab};

/** 打开到哪一张：卡片里的链接换它自己那张（`{key}`），主区里的换最近点过的那张。 */
export type DetailTarget = {readonly key: number} | "active";

export const EMPTY_DETAILS: DetailsState = {items: [], active: null, open: false, nextKey: 1};

const MAX_ITEMS = 2;

/** 同一内容：人物卡按对象（页签不同也算同一个）；原文按出处；段落按章与段；节点按 id。 */
export function sameContent(left: DrawerContent | DetailRequest, right: DrawerContent | DetailRequest): boolean {
    switch (left.kind) {
        case "card":
            return right.kind === "card" && right.entity === left.entity;
        case "source":
            return right.kind === "source" && right.ref === left.ref;
        case "para":
            return right.kind === "para" && right.chapter === left.chapter && right.paragraph === left.paragraph;
        case "node":
            return right.kind === "node" && right.id === left.id;
    }
}

/** 新开一张时的内容：人物卡没给页签就停在概况（输出 10）。 */
function contentOf(request: DetailRequest): DrawerContent {
    return request.kind === "card" ? {kind: "card", entity: request.entity, tab: request.tab ?? "summary"} : request;
}

/** 已开着的那张收到同一内容：给了页签就换页签，没给就不动。 */
function retab(item: DetailItem, request: DetailRequest): DetailItem {
    if (item.content.kind !== "card" || request.kind !== "card" || request.tab === undefined || request.tab === item.content.tab) return item;
    return {key: item.key, content: {...item.content, tab: request.tab}};
}

function replaceAt(items: readonly DetailItem[], index: number, item: DetailItem): DetailItem[] {
    return items.map((current, position) => (position === index ? item : current));
}

/** 看得见的几张：整块收起时一张也没有（地址、内容层、焦点的去处都用它）。 */
export function visibleDetails(state: DetailsState): readonly DetailItem[] {
    return state.open ? state.items : [];
}

/** 最近点过的那张；没有时为 null。 */
export function activeDetail(state: DetailsState): DetailItem | null {
    return state.items.find((item) => item.key === state.active) ?? null;
}

export function expand(state: DetailsState): DetailsState {
    return state.items.length === 0 || state.open ? state : {...state, open: true};
}

export function collapse(state: DetailsState): DetailsState {
    return state.open ? {...state, open: false} : state;
}

/**
 * 打开一样内容（输出 67）。整块收起时先展开，记着的一起回来；没有详情时开第一张。其余：
 * - 同一个人在目标那张里：给了页签就原位换页签，`key` 不变；
 * - 同一内容在另一张里：那张成为最近的，给了页签就换页签；
 * - 别的内容：换掉目标那张，新 `key`。
 */
export function openIn(state: DetailsState, request: DetailRequest, at: DetailTarget): DetailsState {
    const current = expand(state);
    if (current.items.length === 0) return {items: [{key: current.nextKey, content: contentOf(request)}], active: current.nextKey, open: true, nextKey: current.nextKey + 1};
    const existing = current.items.findIndex((item) => sameContent(item.content, request));
    if (existing >= 0) {
        const item = retab(current.items[existing]!, request);
        return {...current, items: replaceAt(current.items, existing, item), active: item.key};
    }
    const wanted = at === "active" ? current.active : at.key;
    const found = current.items.findIndex((item) => item.key === wanted);
    // 目标那张已经不在（关掉、换掉了，`open*` 是异步回来的）：按最近点过的那张。
    const index = found >= 0 ? found : Math.max(0, current.items.findIndex((item) => item.key === current.active));
    const item = {key: current.nextKey, content: contentOf(request)};
    return {...current, items: replaceAt(current.items, index, item), active: item.key, nextKey: current.nextKey + 1};
}

/**
 * 在旁边打开（Ctrl 点、“在旁边打开”，输出 67）：同一内容已开着时只让它成为最近的（不改它的页签）；整块收起时只开这一张新的，
 * 记着的不回来（关掉最后一张再 Ctrl 点别人，刚关掉的那张不该复活）；只有一张时加在右边；两张时换掉不是最近的那张。
 */
export function openBeside(state: DetailsState, request: DetailRequest): DetailsState {
    const item = {key: state.nextKey, content: contentOf(request)};
    const next = {nextKey: state.nextKey + 1, active: item.key, open: true};
    if (!state.open || state.items.length === 0) return {...next, items: [item]};
    const existing = state.items.find((current) => sameContent(current.content, request));
    if (existing !== undefined) return {...state, active: existing.key};
    if (state.items.length < MAX_ITEMS) return {...next, items: [...state.items, item]};
    const replaced = state.items.findIndex((current) => current.key !== state.active);
    return {...next, items: replaceAt(state.items, replaced, item)};
}

export function touch(state: DetailsState, key: number): DetailsState {
    return state.active === key || !state.items.some((item) => item.key === key) ? state : {...state, active: key};
}

/** 关掉一张：剩下的成为最近的；关的是最后一张时等于整块收起，记着它（顶栏开关还能展开）。`key` 已经不在时不动。 */
export function close(state: DetailsState, key: number): DetailsState {
    if (!state.items.some((item) => item.key === key)) return state;
    if (state.items.length === 1) return collapse(state);
    const items = state.items.filter((item) => item.key !== key);
    return {...state, items, active: items[0]!.key};
}

/** 左右对调（拖动换边、“与另一张对调”，输出 68）：被拖的那张成为最近的。只有一张或 `key` 不在时不动。 */
export function swap(state: DetailsState, movedKey: number): DetailsState {
    if (state.items.length !== MAX_ITEMS || !state.items.some((item) => item.key === movedKey)) return state;
    return {...state, items: [state.items[1]!, state.items[0]!], active: movedKey};
}

/** 进地址与存下的状态的人物卡（输出 69）：左边那张是 `entity`、`tab`，右边那张是 `entity2`、`tab2`；只有人物卡进去，整块收起时都没有。 */
export interface DetailsView {
    readonly entity: string | null;
    readonly tab: Tab | null;
    readonly entity2: string | null;
    readonly tab2: Tab | null;
}

export function toView(state: DetailsState): DetailsView {
    const cards = visibleDetails(state).flatMap((item) => (item.content.kind === "card" ? [item.content] : []));
    const [left, right] = cards;
    return {entity: left?.entity ?? null, tab: left?.tab ?? null, entity2: right?.entity ?? null, tab2: right?.tab ?? null};
}

/** 地址或存下的状态里人物卡的四个参数，原样（地址里是字符串、`null` 或数组，存下的是任意值）。 */
export interface CardParams {
    readonly entity?: unknown;
    readonly tab?: unknown;
    readonly entity2?: unknown;
    readonly tab2?: unknown;
}

export interface CardRequest {
    readonly entity: string;
    readonly tab: Tab;
}

const CARD_KEYS = ["entity", "tab", "entity2", "tab2"] as const;

/**
 * 打开书页时要哪几张人物卡（输出 4、69）：四个参数按组取。地址里写了任一个，四个都取地址（没写的当没有，页签不合法时按概况）；
 * 一个都没写才整组用存下的。空串与没有值的 `?entity` 当没写：`?entity=` 不该丢掉存下的两张。
 */
export function requestedCards(url: CardParams, saved: CardParams): CardRequest[] {
    const written = (value: unknown): value is string => typeof value === "string" && value !== "";
    const source = CARD_KEYS.some((name) => written(url[name])) ? url : saved;
    const cards: CardRequest[] = [];
    for (const [entityKey, tabKey] of [["entity", "tab"], ["entity2", "tab2"]] as const) {
        const entity = source[entityKey];
        const tab = source[tabKey];
        if (written(entity)) cards.push({entity, tab: isTab(tab) ? tab : "summary"});
    }
    return cards;
}

/**
 * 逐张核对（并行）：`check` 给出规范化之后的 id，这个阅读位置还没有这个对象时给 null。没出现的去掉，`missing` 按左右的次序列出
 * 原来的 id（提示按它写，不按请求完成的先后）。去重与“留下的放左边”由 `fromView` 做。
 */
export async function checkCards(cards: readonly CardRequest[], check: (entity: string) => Promise<string | null>): Promise<{view: DetailsView; missing: string[]}> {
    const ids = await Promise.all(cards.map((card) => check(card.entity)));
    const found = cards.flatMap((card, index) => (ids[index] === null ? [] : [{entity: ids[index]!, tab: card.tab}]));
    const [left, right] = found;
    return {
        view: {entity: left?.entity ?? null, tab: left?.tab ?? null, entity2: right?.entity ?? null, tab2: right?.tab ?? null},
        missing: cards.filter((_card, index) => ids[index] === null).map((card) => card.entity),
    };
}

/** 一张详情的显示名：分隔线（`paneLabel`）与外壳的读屏名称共用。一张时“详情”，两张时“左边的详情”“右边的详情”。 */
export function detailLabel(index: number, count: number): string {
    if (count < 2) return "详情";
    return index === 0 ? "左边的详情" : "右边的详情";
}

/** 从地址或存下的状态建：同一个人只留左边那张；右边那张成为最近的（与“最后打开”一致）。 */
export function fromView(view: DetailsView): DetailsState {
    let state = EMPTY_DETAILS;
    for (const [entity, tab] of [[view.entity, view.tab], [view.entity2, view.tab2]] as const) {
        if (entity === null || state.items.some((item) => item.content.kind === "card" && item.content.entity === entity)) continue;
        state = openBeside(state, {kind: "card", entity, tab: tab ?? "summary"});
    }
    return state;
}
