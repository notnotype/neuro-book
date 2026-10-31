/**
 * 页面取数“要不要留着旧结果”的判据（docs/specs/story/viewer.md 状态与转换，issue 268）：只有往后挪阅读位置才留，往前挪、
 * 参数变了一律清，旧位置之后的内容不能留在更早的位置上。
 */

import {describe, expect, test} from "bun:test";

import type {PositionInput} from "../../contract/contract";
import {keepsOld, type QueryInput} from "./query";

const input = (at: PositionInput, patch: Partial<QueryInput> = {}): QueryInput => ({params: {kinds: ["person"]}, at, version: 1, ...patch});
const shownAt = (at: PositionInput | null) => ({at, hasData: at !== null});

describe("keepsOld", () => {
    test("没有上一次：不留", () => {
        expect(keepsOld(input({chapter: 8}), undefined, shownAt(null), true)).toBe(false);
    });

    test("只是数据版本变了：位置与参数没变，留着；没开 keepOnForward 也一样", () => {
        expect(keepsOld(input({chapter: 8}, {version: 2}), input({chapter: 8}), shownAt({chapter: 8}), false)).toBe(true);
    });

    test("往后挪：开了 keepOnForward 才留", () => {
        expect(keepsOld(input({chapter: 8}), input({chapter: 7}), shownAt({chapter: 7}), true)).toBe(true);
        expect(keepsOld(input({chapter: 8}), input({chapter: 7}), shownAt({chapter: 7}), false)).toBe(false);
    });

    test("往前挪：清，旧结果可能含新位置之后的内容", () => {
        expect(keepsOld(input({chapter: 7}), input({chapter: 8}), shownAt({chapter: 8}), true)).toBe(false);
    });

    test("请求在途时又挪动：和现在显示的结果所在的位置比，不和上一次请求的位置比", () => {
        // 显示的是第 7 章；往第 9 章的请求没回，又拨回第 8 章：8 不早于 7，留；拨回第 6 章：清。
        expect(keepsOld(input({chapter: 8}), input({chapter: 9}), shownAt({chapter: 7}), true)).toBe(true);
        expect(keepsOld(input({chapter: 6}), input({chapter: 9}), shownAt({chapter: 7}), true)).toBe(false);
    });

    test("同一章里：不写段是读完这一章，排在所有段之后", () => {
        // (7) → (7, 5) 是往前：清；(7, 5) → (7) 是往后：留
        expect(keepsOld(input({chapter: 7, paragraph: 5}), input({chapter: 7}), shownAt({chapter: 7}), true)).toBe(false);
        expect(keepsOld(input({chapter: 7}), input({chapter: 7, paragraph: 5}), shownAt({chapter: 7, paragraph: 5}), true)).toBe(true);
    });

    test("参数变了（换视角、类别）：清，哪怕往后挪", () => {
        expect(keepsOld(input({chapter: 8}), input({chapter: 7}, {params: {kinds: ["group"]}}), shownAt({chapter: 7}), true)).toBe(false);
    });

    test("现在没有结果（出错、还没到）：不留", () => {
        expect(keepsOld(input({chapter: 8}), input({chapter: 7}), {at: null, hasData: false}, true)).toBe(false);
        expect(keepsOld(input({chapter: 8}), input({chapter: 7}), {at: {chapter: 7}, hasData: false}, true)).toBe(false);
    });
});
