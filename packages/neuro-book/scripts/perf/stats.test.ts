/**
 * 性能测量的纯函数（w00017 t72）：分位数按最近秩取、不插值；RPC 帧只计请求与订阅。
 */

import {describe, expect, it} from "bun:test";

import {classifyFrame, countBy, hotspots, percentile, summarize} from "./stats";

describe("分位数", () => {
    it("最近秩：p50 与 p95 取排序后的第 ⌈q·n⌉ 个；没有样本或分位数越界时报错", () => {
        const values = Array.from({length: 20}, (_, index) => 20 - index);
        expect(percentile(values, 0.5)).toBe(10);
        expect(percentile(values, 0.95)).toBe(19);
        expect(percentile([7], 0.95)).toBe(7);
        expect(() => percentile([], 0.5)).toThrow(RangeError);
        expect(() => percentile([1], 0)).toThrow(RangeError);
        expect(summarize([3.14, 1, 2])).toEqual({count: 3, min: 1, p50: 2, p95: 3.1, max: 3.1});
    });
});

describe("RPC 帧分类", () => {
    it("请求按合同与方法、订阅按合同；其它帧与非 JSON 不计", () => {
        expect(classifyFrame(JSON.stringify({type: "request", id: 1, contract: "nbook.files/project", method: "read", input: {}}))).toBe("nbook.files/project read");
        expect(classifyFrame(JSON.stringify({type: "subscribe", id: 2, contract: "nbook.files/project", event: "changes"}))).toBe("nbook.files/project subscribe");
        expect(classifyFrame(JSON.stringify({type: "ack", id: 1}))).toBeNull();
        expect(classifyFrame("not json")).toBeNull();
        expect(classifyFrame("42")).toBeNull();
        expect(countBy(["a", "b", "a"])).toEqual({a: 2, b: 1});
    });
});

describe("CPU profile 的热点", () => {
    it("按函数与位置合并自身时间，按时间排序；没有采样的节点不列", () => {
        const profile = {
            nodes: [
                {id: 1, callFrame: {functionName: "(root)", url: "", lineNumber: -1}},
                {id: 2, callFrame: {functionName: "list", url: "file:///a/files-service.js", lineNumber: 9}},
                {id: 3, callFrame: {functionName: "list", url: "file:///a/files-service.js", lineNumber: 9}},
                {id: 4, callFrame: {functionName: "", url: "file:///a/b.js", lineNumber: 0}},
            ],
            samples: [2, 3, 4, 2],
            timeDeltas: [1000, 2000, 500, 1000],
        };
        expect(hotspots(profile)).toEqual([{name: "list files-service.js:10", selfMs: 4}, {name: "(匿名) b.js:1", selfMs: 0.5}]);
    });
});
