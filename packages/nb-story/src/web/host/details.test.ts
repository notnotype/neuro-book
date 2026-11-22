/**
 * 右侧详情的状态（docs/specs/story/viewer.md 输出 66 到 69）：纯函数的结果。
 */

import {describe, expect, it} from "bun:test";

import {checkCards, close, collapse, detailLabel, EMPTY_DETAILS, expand, fromView, openBeside, openIn, requestedCards, swap, toView, touch, visibleDetails, type DetailsState} from "./details";

const card = (entity: string, tab?: "summary" | "relations" | "records" | "episodes") => ({kind: "card" as const, entity, ...(tab === undefined ? {} : {tab})});
/** 每张写成“对象:页签”或内容种类，最近点过的那张加星号。 */
function shape(state: DetailsState): string[] {
    return state.items.map((item) => {
        const text = item.content.kind === "card" ? `${item.content.entity}:${item.content.tab}` : item.content.kind;
        return item.key === state.active ? `${text}*` : text;
    });
}
const two = (): DetailsState => openBeside(openIn(EMPTY_DETAILS, card("林雨"), "active"), card("王五"));

describe("打开", () => {
    it("没有详情时开第一张，人物卡没给页签停在概况", () => {
        const state = openIn(EMPTY_DETAILS, card("林雨"), "active");
        expect(shape(state)).toEqual(["林雨:summary*"]);
        expect(state.open).toBe(true);
    });

    it("主区里的链接换最近点过的那张；卡片里的换它自己那张；别的内容换新 key", () => {
        const state = two();
        const [left, right] = state.items;
        const fromMain = openIn(state, card("赵六"), "active");
        expect(shape(fromMain)).toEqual(["林雨:summary", "赵六:summary*"]);
        expect(fromMain.items[1]!.key).not.toBe(right!.key);
        const fromLeft = openIn(state, card("赵六"), {key: left!.key});
        expect(shape(fromLeft)).toEqual(["赵六:summary*", "王五:summary"]);
    });

    it("卡内换页签：原位换、key 不变；没给页签时不动页签", () => {
        const state = openIn(EMPTY_DETAILS, card("林雨"), "active");
        const key = state.items[0]!.key;
        const retabbed = openIn(state, card("林雨", "relations"), {key});
        expect(shape(retabbed)).toEqual(["林雨:relations*"]);
        expect(retabbed.items[0]!.key).toBe(key);
        expect(shape(openIn(retabbed, card("林雨"), "active"))).toEqual(["林雨:relations*"]);
    });

    it("同一内容在另一张里：那张成为最近的，给了页签就换（关系图点进来），没给就不动", () => {
        const state = two();
        expect(shape(openIn(state, card("林雨", "relations"), "active"))).toEqual(["林雨:relations*", "王五:summary"]);
        expect(shape(openIn(state, card("林雨"), "active"))).toEqual(["林雨:summary*", "王五:summary"]);
    });

    it("目标那张已经不在（异步回来时被关掉了）：按最近点过的那张", () => {
        const state = two();
        expect(shape(openIn(state, card("赵六"), {key: 999}))).toEqual(["林雨:summary", "赵六:summary*"]);
    });

    it("整块收起时打开：先展开，记着的一起回来，新内容成为最近的", () => {
        const collapsed = collapse(two());
        expect(visibleDetails(collapsed)).toEqual([]);
        const reopened = openIn(collapsed, card("赵六"), "active");
        expect(reopened.open).toBe(true);
        expect(shape(reopened)).toEqual(["林雨:summary", "赵六:summary*"]);
    });
});

describe("在旁边打开", () => {
    it("只有一张时加在右边；两张时换掉不是最近的那张", () => {
        expect(shape(two())).toEqual(["林雨:summary", "王五:summary*"]);
        expect(shape(openBeside(two(), card("赵六")))).toEqual(["赵六:summary*", "王五:summary"]);
    });

    it("同一内容已开着：只让它成为最近的，不改它的页签", () => {
        const state = openIn(two(), card("林雨", "relations"), "active");
        const again = openBeside(touch(state, state.items[1]!.key), card("林雨"));
        expect(shape(again)).toEqual(["林雨:relations*", "王五:summary"]);
    });

    it("关掉最后一张（整块收起、记着它）再在旁边打开别人：只开这一张，刚关掉的不复活", () => {
        const one = openIn(EMPTY_DETAILS, card("林雨"), "active");
        const closed = close(one, one.items[0]!.key);
        expect(closed.open).toBe(false);
        expect(shape(openBeside(closed, card("王五")))).toEqual(["王五:summary*"]);
    });
});

describe("最近、关闭、对调、收起", () => {
    it("touch 换最近的；key 不在时不动", () => {
        const state = two();
        expect(shape(touch(state, state.items[0]!.key))).toEqual(["林雨:summary*", "王五:summary"]);
        expect(touch(state, 999)).toBe(state);
    });

    it("关掉一张剩下的成为最近的；关最后一张等于整块收起、记着它，展开回来", () => {
        const state = two();
        const one = close(state, state.items[1]!.key);
        expect(shape(one)).toEqual(["林雨:summary*"]);
        const collapsed = close(one, one.items[0]!.key);
        expect(collapsed.open).toBe(false);
        expect(shape(expand(collapsed))).toEqual(["林雨:summary*"]);
        expect(close(state, 999)).toBe(state);
    });

    it("对调：两张换位，被拖的那张成为最近的；只有一张时不动", () => {
        const state = two();
        expect(shape(swap(state, state.items[0]!.key))).toEqual(["王五:summary", "林雨:summary*"]);
        const one = openIn(EMPTY_DETAILS, card("林雨"), "active");
        expect(swap(one, one.items[0]!.key)).toBe(one);
    });
});

describe("地址与存下的状态（输出 69）", () => {
    it("左边是 entity、tab，右边是 entity2、tab2；整块收起时都没有", () => {
        const state = openIn(two(), card("王五", "records"), "active");
        expect(toView(state)).toEqual({entity: "林雨", tab: "summary", entity2: "王五", tab2: "records"});
        expect(toView(collapse(state))).toEqual({entity: null, tab: null, entity2: null, tab2: null});
    });

    it("只有人物卡进去：左边是原文、右边是人物卡时记成只有一张", () => {
        const state = openBeside(openIn(EMPTY_DETAILS, {kind: "source", ref: "3.2"}, "active"), card("王五"));
        expect(toView(state)).toEqual({entity: "王五", tab: "summary", entity2: null, tab2: null});
    });

    it("从地址建：只有 entity、只有 entity2、两个相同只留左边；右边那张成为最近的", () => {
        expect(shape(fromView({entity: "林雨", tab: "relations", entity2: null, tab2: null}))).toEqual(["林雨:relations*"]);
        expect(shape(fromView({entity: null, tab: null, entity2: "王五", tab2: null}))).toEqual(["王五:summary*"]);
        expect(shape(fromView({entity: "林雨", tab: null, entity2: "林雨", tab2: "records"}))).toEqual(["林雨:summary*"]);
        expect(shape(fromView({entity: "林雨", tab: null, entity2: "王五", tab2: "records"}))).toEqual(["林雨:summary", "王五:records*"]);
        expect(fromView({entity: null, tab: null, entity2: null, tab2: null}).open).toBe(false);
    });
});

describe("打开书页时要哪几张（输出 4、69）", () => {
    const saved = {entity: "s1", tab: "records", entity2: "s2", tab2: "episodes"};
    it("地址里一个都没写：整组用存下的", () => {
        expect(requestedCards({}, saved)).toEqual([{entity: "s1", tab: "records"}, {entity: "s2", tab: "episodes"}]);
    });
    it("地址里写了任一个：四个都取地址，没写的当没有，页签缺省概况", () => {
        expect(requestedCards({entity: "u1"}, saved)).toEqual([{entity: "u1", tab: "summary"}]);
        expect(requestedCards({entity2: "u2"}, saved)).toEqual([{entity: "u2", tab: "summary"}]);
        expect(requestedCards({tab: "relations"}, saved)).toEqual([]);
        expect(requestedCards({entity: "u1", tab: "nope", entity2: "u2", tab2: "relations"}, saved)).toEqual([{entity: "u1", tab: "summary"}, {entity: "u2", tab: "relations"}]);
    });
    it("空串与没有值的参数当没写：不丢存下的", () => {
        expect(requestedCards({entity: "", tab: null}, saved)).toEqual(requestedCards({}, saved));
    });
    it("逐张核对：换成规范化之后的 id；没出现的去掉、按左右的次序列出，留下的放左边", async () => {
        // 右边那张先回来、左边的后回来：提示的次序仍按左右。
        const answers = new Map<string, (id: string | null) => void>();
        const pending = checkCards([{entity: "a", tab: "records"}, {entity: "b", tab: "summary"}], (entity) => new Promise((resolve) => answers.set(entity, resolve)));
        answers.get("b")!(null);
        await Promise.resolve();
        answers.get("a")!(null);
        expect(await pending).toEqual({view: {entity: null, tab: null, entity2: null, tab2: null}, missing: ["a", "b"]});
        const right = await checkCards([{entity: "a", tab: "records"}, {entity: "b", tab: "episodes"}], async (entity) => (entity === "a" ? null : "b-main"));
        expect(right).toEqual({view: {entity: "b-main", tab: "episodes", entity2: null, tab2: null}, missing: ["a"]});
    });
    it("两张规范化之后是同一个人：只留左边那张", async () => {
        const checked = await checkCards([{entity: "a", tab: "records"}, {entity: "a-alias", tab: "summary"}], async () => "a");
        const state = fromView(checked.view);
        expect(visibleDetails(state).map((item) => item.content)).toEqual([{kind: "card", entity: "a", tab: "records"}]);
    });
});

describe("显示名", () => {
    it("一张时“详情”；两张时“左边的详情”“右边的详情”", () => {
        expect(detailLabel(0, 1)).toBe("详情");
        expect([detailLabel(0, 2), detailLabel(1, 2)]).toEqual(["左边的详情", "右边的详情"]);
    });
});
