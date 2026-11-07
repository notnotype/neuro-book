/** 模型能力缺口（docs/specs/agent/profile-settings.md 输出 9）。 */

import {describe, expect, test} from "bun:test";

import {modelNeedGaps} from "./model-needs";

const model = {vision: false, reasoning: false, contextWindow: 1000};

describe("modelNeedGaps", () => {
    test("没声明就没有缺口", () => {
        expect(modelNeedGaps(undefined, model)).toEqual([]);
        expect(modelNeedGaps({}, model)).toEqual([]);
    });

    test("逐项比，缺的都列出来", () => {
        expect(modelNeedGaps({vision: true, thinking: true, minContext: 2000}, model)).toEqual([{kind: "vision"}, {kind: "thinking"}, {kind: "context", need: 2000, have: 1000}]);
        expect(modelNeedGaps({vision: true, thinking: true, minContext: 1000}, {vision: true, reasoning: true, contextWindow: 1000})).toEqual([]);
    });

    test("写了 false 不算要；窗口未知不算小于", () => {
        expect(modelNeedGaps({vision: false, thinking: false}, model)).toEqual([]);
        expect(modelNeedGaps({minContext: 2000}, {...model, contextWindow: null})).toEqual([]);
    });
});
