/**
 * 状态栏的目录与解算（docs/specs/agent/conversation.md 输出 45、ui/agent-conversation-view.md 的“状态栏”）：空设置就是此前的状态栏，
 * 次序与显隐只记改过的，写回时去掉与缺省相同的，插件的项停用后设置还在。
 */

import {describe, expect, it} from "bun:test";

import {collapsedItems, moveStatusItem, resolveStatusLine, shiftStatusItem, statusLineCatalog, toggleStatusItem} from "./status-line";
import type {StatusLineItem, StatusLineSetting} from "./status-line";

const plugin = (id: string, side: "left" | "right", defaultVisible = false): StatusLineItem => ({id, side, title: id, defaultVisible, source: "x.words"});
const ids = (items: readonly {readonly id: string}[]) => items.map((item) => item.id);
const shown = (items: readonly {readonly id: string; readonly visible: boolean}[]) => items.filter((item) => item.visible).map((item) => item.id);

describe("解算", () => {
    it("空设置解出此前的状态栏：左边上下文，右边用量与费用；模型默认不显示、排在费用后", () => {
        const catalog = statusLineCatalog();
        const {left, right} = resolveStatusLine(catalog, {});
        expect(shown(left)).toEqual(["context"]);
        expect(shown(right)).toEqual(["usage", "cost"]);
        expect(ids(right)).toEqual(["usage", "cost", "model"]);
    });

    it("order 只管出现的，没出现的按目录顺序排在后面；visible 覆盖缺省；每一侧各排各的", () => {
        const catalog = statusLineCatalog([plugin("x.words", "left", true), plugin("x.clock", "right")]);
        const {left, right} = resolveStatusLine(catalog, {order: ["cost", "x.words"], visible: {model: true, usage: false}});
        expect(ids(left)).toEqual(["x.words", "context"]);
        expect(shown(left)).toEqual(["x.words", "context"]);
        expect(ids(right)).toEqual(["cost", "usage", "model", "x.clock"]);
        expect(shown(right)).toEqual(["cost", "model"]);
    });

    it("目录里没有的 id 忽略；宿主的项与内置同 id 时内置的算", () => {
        const catalog = statusLineCatalog([{...plugin("cost", "left", true), title: "冒充"}]);
        expect(ids(resolveStatusLine(catalog, {order: ["gone", "model"], visible: {gone: true}}).right)).toEqual(["model", "usage", "cost"]);
        expect(resolveStatusLine(catalog, {}).left.map((item) => item.id)).toEqual(["context"]);
    });
});

describe("换边", () => {
    const catalog = statusLineCatalog([plugin("x.words", "left")]);

    it("side 改一项在哪边；目录里没有的 id 忽略；解出来的项带的是生效的一边", () => {
        const {left, right} = resolveStatusLine(catalog, {side: {usage: "left", gone: "left"}});
        expect(ids(left)).toEqual(["context", "usage", "x.words"]);
        expect(ids(right)).toEqual(["cost", "model"]);
        expect(left.find((item) => item.id === "usage")?.side).toBe("left");
    });
});

describe("写回", () => {
    const catalog = statusLineCatalog([plugin("x.words", "left")]);

    it("勾选只改被点的一项；改回缺省时去掉这个键，设置空了交回空对象", () => {
        const on = toggleStatusItem(catalog, {}, "model");
        expect(on).toEqual({visible: {model: true}});
        expect(toggleStatusItem(catalog, on, "model")).toEqual({});
        expect(toggleStatusItem(catalog, {}, "cost")).toEqual({visible: {cost: false}});
        expect(toggleStatusItem(catalog, {}, "没有这项")).toEqual({});
    });

    it("同一边里移动：写成完整次序，目录里没有的 id 原样留着；移回缺省次序时 order 去掉；位置夹在这一边的范围里", () => {
        const moved = moveStatusItem(catalog, {order: ["gone"]}, "cost", {side: "right", index: 0});
        expect(moved.order?.[0]).toBe("gone");
        expect(ids(resolveStatusLine(catalog, moved).right)).toEqual(["cost", "usage", "model"]);
        expect(moveStatusItem(catalog, {order: ["cost", "usage", "model"]}, "usage", {side: "right", index: 0})).toEqual({});
        expect(moveStatusItem(catalog, {}, "usage", {side: "right", index: 0})).toEqual({});
        expect(moveStatusItem(catalog, {}, "usage", {side: "right", index: -5})).toEqual({});
        expect(ids(resolveStatusLine(catalog, moveStatusItem(catalog, {}, "usage", {side: "right", index: 99})).right)).toEqual(["cost", "model", "usage"]);
        expect(moveStatusItem(catalog, {}, "没有这项", {side: "left", index: 0})).toEqual({});
    });

    it("换边：记下 side 与次序；换到另一边第 0 位时 order 不被当成缺省去掉；换回原处设置回到空对象", () => {
        const moved = moveStatusItem(catalog, {}, "usage", {side: "left", index: 0});
        expect(moved.side).toEqual({usage: "left"});
        expect(ids(resolveStatusLine(catalog, moved).left)).toEqual(["usage", "context", "x.words"]);
        expect(ids(resolveStatusLine(catalog, moved).right)).toEqual(["cost", "model"]);
        // 换到另一边、恰好排在目录次序的位置上：只记 side，不记 order。
        expect(moveStatusItem(catalog, {}, "usage", {side: "left", index: 1})).toEqual({side: {usage: "left"}});
        expect(moveStatusItem(catalog, moved, "usage", {side: "right", index: 0})).toEqual({});
    });

    it("移动不丢显隐，显隐不丢次序与边", () => {
        const first = moveStatusItem(catalog, {visible: {model: true}}, "model", {side: "right", index: 0});
        expect(ids(resolveStatusLine(catalog, first).right)).toEqual(["model", "usage", "cost"]);
        expect(first.visible).toEqual({model: true});
        const crossed = moveStatusItem(catalog, first, "cost", {side: "left", index: 0});
        const toggled = toggleStatusItem(catalog, crossed, "usage");
        expect(toggled.visible).toEqual({model: true, usage: false});
        expect(toggled.side).toEqual(crossed.side);
        expect(toggled.order).toEqual(crossed.order);
    });

    it("停用插件留下的 side 原样留着，插件回来时生效", () => {
        const moved = moveStatusItem(catalog, {side: {"x.gone": "right"}}, "usage", {side: "left", index: 0});
        expect(moved.side).toEqual({"x.gone": "right", usage: "left"});
    });
});

describe("上移下移", () => {
    const catalog = statusLineCatalog([plugin("x.words", "left")]);
    const line = (setting: StatusLineSetting) => {
        const {left, right} = resolveStatusLine(catalog, setting);
        return [ids(left).join(" "), ids(right).join(" ")];
    };

    it("在“左边接右边”这一串里挪一位：右边第一项上移到左边最后，左边最后一项下移到右边第一", () => {
        expect(line(shiftStatusItem(catalog, {}, "usage", -1))).toEqual(["context x.words usage", "cost model"]);
        expect(line(shiftStatusItem(catalog, {}, "x.words", 1))).toEqual(["context", "x.words usage cost model"]);
        expect(line(shiftStatusItem(catalog, {}, "cost", -1))).toEqual(["context x.words", "cost usage model"]);
        expect(line(shiftStatusItem(catalog, {}, "context", 1))).toEqual(["x.words context", "usage cost model"]);
    });

    it("只有左边第一项不能上移、右边最后一项不能下移；左边空了右边第一项照样能上移", () => {
        expect(shiftStatusItem(catalog, {}, "context", -1)).toEqual({});
        expect(shiftStatusItem(catalog, {}, "model", 1)).toEqual({});
        const emptyLeft = {side: {context: "right", "x.words": "right"}} as const;
        expect(line(emptyLeft)).toEqual(["", "context usage cost model x.words"]);
        expect(line(shiftStatusItem(catalog, emptyLeft, "context", -1))).toEqual(["context", "usage cost model x.words"]);
    });
});

describe("窄时收项", () => {
    const items = (pairs: Record<string, number>) => Object.entries(pairs).map(([id, width]) => ({id, width}));
    const collapse = (left: Record<string, number>, right: Record<string, number>, available: number, reserved = 0) =>
        collapsedItems({left: items(left), right: items(right), reserved, available, gap: 8, moreWidth: 16});

    it("放得下不收；先收右边，从前往后，收了就多一个“…”的位置", () => {
        // 全放下：40 + 80 + 50 + 2 个间距 16 = 186
        expect(collapse({context: 40}, {usage: 80, cost: 50}, 186)).toEqual([]);
        // 收 usage：40 + “…”16 + 50 + 2 个间距 16 = 122
        expect(collapse({context: 40}, {usage: 80, cost: 50}, 185)).toEqual(["usage"]);
        expect(collapse({context: 40}, {usage: 80, cost: 50}, 122)).toEqual(["usage"]);
        expect(collapse({context: 40}, {usage: 80, cost: 50}, 121)).toEqual(["usage", "cost"]);
    });

    it("右边收完再收左边的数据项，从后往前；全都放不下时全收", () => {
        // 右边全收：40 + 60 + 16 + 2 个间距 16 = 132
        expect(collapse({context: 40, usage: 60}, {cost: 50}, 132)).toEqual(["cost"]);
        expect(collapse({context: 40, usage: 60}, {cost: 50}, 131)).toEqual(["cost", "usage"]);
        expect(collapse({context: 40, usage: 60}, {cost: 50}, 63)).toEqual(["cost", "usage", "context"]);
        expect(collapse({}, {}, 0)).toEqual([]);
        // 左边一块总在：左边空着时它与右边之间照样有一个间距。
        expect(collapse({}, {cost: 50}, 58)).toEqual([]);
        expect(collapse({}, {cost: 50}, 57)).toEqual(["cost"]);
    });

    it("提醒的宽照算、不收；没有提醒时不扣它两边的间距", () => {
        // 40 + 提醒 70 + 50 + 2 个间距 16 = 176
        expect(collapse({context: 40}, {cost: 50}, 176, 70)).toEqual([]);
        expect(collapse({context: 40}, {cost: 50}, 175, 70)).toEqual(["cost"]);
        // 没有提醒：40 + 50 + 1 个间距 8 = 98
        expect(collapse({context: 40}, {cost: 50}, 98)).toEqual([]);
    });
});
