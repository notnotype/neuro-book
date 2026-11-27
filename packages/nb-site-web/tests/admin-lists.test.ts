/**
 * 管理面板列表页的查询状态与时间写法（`pages/admin/list-query.ts`、`format.ts`）：都是纯函数，这里直接调用。
 * 地址与状态的来回、不合的值读成缺省、翻页基准的沿用与重来、页码越界改到哪一页。页面上的样子与请求在三个列表页的组件测试里。
 */

import {describe, expect, it} from "bun:test";

import {LOGIN_IDENTIFIER, USER_FILTERS} from "@notnotype/nb-site-identity-contract/constants";

import {endOfLocalDay, localToday, shortDate} from "../src/pages/admin/format";
import {anchorFor, lastPageIfPastEnd, listKey, listQueryOf, matching, oneOf, readListState, rememberAnchor, searchText, searchTerm, withField} from "../src/pages/admin/list-query";
import type {ListSchema, ListState} from "../src/pages/admin/list-query";

type Field = "filter" | "q";
const SCHEMA: ListSchema<Field> = {filter: oneOf(USER_FILTERS, "all"), q: searchText(LOGIN_IDENTIFIER.maxLength)};
const DEFAULT: ListState<Field> = {page: 1, fields: {filter: "all", q: ""}};

describe("地址到状态", () => {
    it("合规的值照读", () => {
        expect(readListState(SCHEMA, {page: "3", filter: "banned", q: "ali"})).toEqual({page: 3, fields: {filter: "banned", q: "ali"}});
    });

    it("什么都没写是第 1 页、各项缺省", () => {
        expect(readListState(SCHEMA, {})).toEqual(DEFAULT);
    });

    it("不合的页码读成第 1 页", () => {
        for (const page of ["0", "-1", "1.5", "abc", "", "01", " 2", "1e3", "1234567890123456"]) expect({page, state: readListState(SCHEMA, {page})}).toEqual({page, state: DEFAULT});
        expect(readListState(SCHEMA, {page: "123456789012345"}).page).toBe(123456789012345);
    });

    it("不认识的筛选项、超长或带前后空白的搜索词读成缺省；其余参数照读", () => {
        expect(readListState(SCHEMA, {filter: "nobody", q: "ok"})).toEqual({page: 1, fields: {filter: "all", q: "ok"}});
        expect(readListState(SCHEMA, {q: " ali"}).fields.q).toBe("");
        expect(readListState(SCHEMA, {q: "x".repeat(LOGIN_IDENTIFIER.maxLength + 1)}).fields.q).toBe("");
        // 按码点数：表情算一个字。
        expect(readListState(SCHEMA, {q: "😀".repeat(LOGIN_IDENTIFIER.maxLength)}).fields.q).toBe("😀".repeat(LOGIN_IDENTIFIER.maxLength));
    });

    it("同一个参数写了两遍、写成空值的都当作没写", () => {
        expect(readListState(SCHEMA, {page: ["2", "3"], filter: ["admin", "banned"], q: null})).toEqual(DEFAULT);
    });

    it("照写法收的参数：空串是缺省，不合写法的读成空串", () => {
        const schema: ListSchema<"actorId"> = {actorId: matching(/^(?:cli|[1-9][0-9]*)$/u)};
        expect(readListState(schema, {actorId: "cli"}).fields.actorId).toBe("cli");
        expect(readListState(schema, {actorId: "12"}).fields.actorId).toBe("12");
        expect(readListState(schema, {actorId: "abc"}).fields.actorId).toBe("");
    });
});

describe("状态到地址", () => {
    it("等于缺省的参数与第 1 页不写", () => {
        expect(listQueryOf(SCHEMA, DEFAULT)).toEqual({});
        expect(listQueryOf(SCHEMA, {page: 1, fields: {filter: "admin", q: ""}})).toEqual({filter: "admin"});
        expect(listQueryOf(SCHEMA, {page: 4, fields: {filter: "all", q: "bob"}})).toEqual({q: "bob", page: "4"});
    });

    it("写出去再读回来是同一个状态", () => {
        const states: ListState<Field>[] = [DEFAULT, {page: 2, fields: {filter: "email_pending", q: "张三"}}, {page: 9, fields: {filter: "all", q: "a&b=c"}}];
        for (const state of states) {
            const search = new URLSearchParams(listQueryOf(SCHEMA, state));
            expect(readListState(SCHEMA, Object.fromEntries(search))).toEqual(state);
        }
    });

    it("换筛选或搜索回到第 1 页", () => {
        expect(withField({page: 5, fields: {filter: "all", q: ""}}, "filter", "banned")).toEqual({page: 1, fields: {filter: "banned", q: ""}});
        expect(withField({page: 5, fields: {filter: "admin", q: ""}}, "q", "bob")).toEqual({page: 1, fields: {filter: "admin", q: "bob"}});
    });

    it("输入框里的字去掉前后空白才是搜索词", () => {
        expect(searchTerm("  bob ")).toBe("bob");
        expect(searchTerm("   ")).toBe("");
    });
});

describe("翻页的基准", () => {
    const first = listKey(SCHEMA, DEFAULT);

    it("还没取过时不带", () => {
        expect(anchorFor(undefined, first)).toBeUndefined();
    });

    it("同一份列表翻页时沿用第一次回来的基准", () => {
        const memory = rememberAnchor(undefined, first, "t100");
        const pageTwo = listKey(SCHEMA, {...DEFAULT, page: 2});
        expect(pageTwo).toBe(first);
        expect(anchorFor(memory, pageTwo)).toBe("t100");
        // 带着基准取回来的仍是那个基准：记着的不变。
        expect(rememberAnchor(memory, pageTwo, "t100")).toBe(memory);
    });

    it("换了筛选或搜索就不带，回来的新基准取代旧的", () => {
        const memory = rememberAnchor(undefined, first, "t100");
        const banned = listKey(SCHEMA, withField(DEFAULT, "filter", "banned"));
        const searched = listKey(SCHEMA, withField(DEFAULT, "q", "bob"));
        expect(anchorFor(memory, banned)).toBeUndefined();
        expect(anchorFor(memory, searched)).toBeUndefined();

        const next = rememberAnchor(memory, banned, "t200");
        expect(anchorFor(next, banned)).toBe("t200");
        // 再换回原来的筛选也是另一次翻页：旧基准不再用。
        expect(anchorFor(next, first)).toBeUndefined();
    });

    it("参数值里的字不会让两份不同的列表撞成同一个", () => {
        const schema: ListSchema<"a" | "b"> = {a: searchText(20), b: searchText(20)};
        expect(listKey(schema, {page: 1, fields: {a: "x,", b: ""}})).not.toBe(listKey(schema, {page: 1, fields: {a: "x", b: ","}}));
    });
});

describe("页码越界", () => {
    it("这一页空着而总数不为 0：改到最后一页", () => {
        expect(lastPageIfPastEnd({items: [], total: 45}, 9, 20)).toBe(3);
        expect(lastPageIfPastEnd({items: [], total: 40}, 9, 20)).toBe(2);
        expect(lastPageIfPastEnd({items: [], total: 1}, 2, 20)).toBe(1);
    });

    it("有行、或一条都没有时不改", () => {
        expect(lastPageIfPastEnd({items: [1], total: 45}, 3, 20)).toBeUndefined();
        expect(lastPageIfPastEnd({items: [], total: 0}, 4, 20)).toBeUndefined();
    });

    it("已经在最后一页还是空的（两次请求之间数据变了）：不再改，免得来回取", () => {
        expect(lastPageIfPastEnd({items: [], total: 45}, 3, 20)).toBeUndefined();
    });
});

describe("时间写法", () => {
    const now = new Date(2026, 10, 26, 10, 0).getTime();

    it("今年的只写月日，往年的带上年份", () => {
        expect(shortDate(new Date(2026, 0, 5, 9, 30).toISOString(), now)).toBe("01-05");
        expect(shortDate(new Date(2025, 11, 31, 23, 0).toISOString(), now)).toBe("2025-12-31");
    });

    it("过期日期发出的是那一天在本地结束的一刻", () => {
        expect(new Date(endOfLocalDay("2026-12-01")).getTime()).toBe(new Date(2026, 11, 1, 23, 59, 59, 999).getTime());
    });

    it("今天按本地时区", () => {
        expect(localToday(now)).toBe("2026-11-26");
        expect(localToday(new Date(2026, 0, 1, 0, 0).getTime())).toBe("2026-01-01");
    });
});
