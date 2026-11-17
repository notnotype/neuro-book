/**
 * 状态栏的目录与解算（docs/specs/agent/conversation.md 输出 45、ui/agent-conversation-view.md 的“状态栏”）：空设置就是此前的状态栏，
 * 次序与显隐只记改过的，写回时去掉与缺省相同的，插件的项停用后设置还在。
 */

import {describe, expect, it} from "bun:test";

import {moveStatusItem, resolveStatusLine, statusLineCatalog, toggleStatusItem} from "./status-line";
import type {StatusLineItem} from "./status-line";

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

describe("写回", () => {
    const catalog = statusLineCatalog([plugin("x.words", "left")]);

    it("勾选只改被点的一项；改回缺省时去掉这个键，设置空了交回空对象", () => {
        const on = toggleStatusItem(catalog, {}, "model");
        expect(on).toEqual({visible: {model: true}});
        expect(toggleStatusItem(catalog, on, "model")).toEqual({});
        expect(toggleStatusItem(catalog, {}, "cost")).toEqual({visible: {cost: false}});
        expect(toggleStatusItem(catalog, {}, "没有这项")).toEqual({});
    });

    it("移动：这一侧写成完整次序，另一侧与目录里没有的 id 原样留着；移回缺省次序时 order 去掉", () => {
        const moved = moveStatusItem(catalog, {order: ["gone"]}, "cost", 0);
        expect(moved.order).toEqual(["gone", "cost", "usage", "model"]);
        expect(ids(resolveStatusLine(catalog, moved).right)).toEqual(["cost", "usage", "model"]);
        expect(moveStatusItem(catalog, {order: ["gone", "cost", "usage", "model"]}, "usage", 0)).toEqual({order: ["gone", "usage", "cost", "model"]});
        expect(moveStatusItem(catalog, {order: ["cost", "usage", "model"]}, "usage", 0)).toEqual({});
        // 位置不变与夹取
        expect(moveStatusItem(catalog, {}, "usage", 0)).toEqual({});
        expect(moveStatusItem(catalog, {}, "usage", -5)).toEqual({});
        expect(ids(resolveStatusLine(catalog, moveStatusItem(catalog, {}, "usage", 99)).right)).toEqual(["cost", "model", "usage"]);
        // 不能移到另一侧：左边只有两项，位置夹在左边的范围里
        expect(ids(resolveStatusLine(catalog, moveStatusItem(catalog, {}, "context", 3)).left)).toEqual(["x.words", "context"]);
    });

    it("移动不丢显隐，显隐不丢次序", () => {
        const first = moveStatusItem(catalog, {visible: {model: true}}, "model", 0);
        expect(first).toEqual({order: ["model", "usage", "cost"], visible: {model: true}});
        expect(toggleStatusItem(catalog, first, "usage")).toEqual({order: ["model", "usage", "cost"], visible: {model: true, usage: false}});
    });
});
