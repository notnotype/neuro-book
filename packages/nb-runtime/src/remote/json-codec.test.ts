import {describe, expect, it} from "bun:test";

import {decodeJsonFrame, encodeJsonFrame, encodeJsonValue, FrameEncodingError, parseFrame} from "./remote";
import type {Frame} from "./remote";

/** 把任意值放进一个事件帧的内容里编码。 */
function encodePayload(payload: unknown): string {
    return encodeJsonFrame({type: "event", id: "s1", payload});
}

describe("Spec plugin-channel WebSocket 传输第 1 条：JSON 编码", () => {
    it("JSON 能如实表示的值往返不变；对象上的 undefined 属性省略，与可选字段缺省同义", () => {
        const payload = {text: "章节", n: -1.5, ok: true, none: null, list: [1, "a", {deep: [null]}], bare: Object.create(null) as object};
        const decoded = decodeJsonFrame(encodePayload(payload)) as Extract<Frame, {type: "event"}>;
        expect(decoded.payload).toEqual({...payload, bare: {}});
        expect(decodeJsonFrame(encodePayload({kept: 1, dropped: undefined}))).toEqual({type: "event", id: "s1", payload: {kept: 1}});
    });

    it("JSON 会丢弃或改写的值在编码时抛 FrameEncodingError：函数、symbol、bigint、非有限数、数组里的 undefined、非普通对象", () => {
        class Point {
            readonly x = 1;
        }
        const rejected: ReadonlyArray<readonly [string, unknown]> = [
            ["函数", {callback: () => 1}],
            ["symbol", {tag: Symbol("t")}],
            ["bigint", {big: 10n}],
            ["NaN", {n: Number.NaN}],
            ["无穷", [Number.POSITIVE_INFINITY]],
            ["数组里的 undefined", [1, undefined]],
            ["Date", {at: new Date(0)}],
            ["Map", {index: new Map([["a", 1]])}],
            ["类实例", {point: new Point()}],
        ];
        for (const [label, payload] of rejected) {
            expect(() => encodePayload(payload), label).toThrow(FrameEncodingError);
        }
    });

    it("错误消息只含字段名与类型，不含值", () => {
        expect(() => encodePayload({token: Number.NaN})).toThrow(/字段 token/u);
        let message = "";
        try {
            encodePayload({secret: new Map([["password", "hunter2"]])});
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain("Map");
        expect(message).not.toContain("hunter2");
    });

    it("业务值按同一规则编码：能如实表示的往返不变，不能的与 undefined 本身都抛 FrameEncodingError", () => {
        expect(JSON.parse(encodeJsonValue({a: [1, "x", null]}))).toEqual({a: [1, "x", null]});
        expect(() => encodeJsonValue({at: new Date(0)})).toThrow(FrameEncodingError);
        expect(() => encodeJsonValue(undefined)).toThrow(FrameEncodingError);
    });

    it("循环引用在编码时抛错", () => {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        expect(() => encodePayload(loop)).toThrow(TypeError);
    });

    it("解码：不是 JSON 的文本原样返回，帧解析把它判为无效帧", () => {
        const decoded = decodeJsonFrame("{not json");
        expect(decoded).toBe("{not json");
        expect(parseFrame(decoded)).toBeNull();
    });
});
