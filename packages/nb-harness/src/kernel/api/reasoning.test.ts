/**
 * 一次请求用哪一档的优先级与夹取（docs/specs/models/service.md“角色的思考档”）：
 * 会话里明确选的，其次角色的默认档，都没有就不发；选的档不在模型的档里时夹到不高于它的最近一档。
 */

import {describe, expect, test} from "bun:test";
import type {ModelInfo, ModelReasoning} from "./model.js";
import {requestEffort} from "./reasoning.js";

function info(reasoning?: ModelReasoning): ModelInfo {
    return {id: "p/m", contextWindow: 1000, capabilities: {vision: false, thinking: reasoning !== undefined && reasoning.kind !== "none"}, efforts: reasoning?.kind === "levels" ? reasoning.levels : [], ...(reasoning === undefined ? {} : {reasoning})};
}

const levels = (patch: Partial<Extract<ModelReasoning, {kind: "levels"}>> = {}): ModelReasoning => ({kind: "levels", levels: ["low", "medium", "high"], off: "disable", unset: null, verified: true, ...patch});

describe("requestEffort", () => {
    test("会话选的优先于角色的默认，角色的默认优先于不指定", () => {
        expect(requestEffort("low", {info: info(levels()), defaultEffort: "high"})).toEqual({effort: "low", effective: "low", source: "session"});
        expect(requestEffort(null, {info: info(levels()), defaultEffort: "high"})).toEqual({effort: "high", effective: "high", source: "role"});
        expect(requestEffort(null, {info: info(levels())})).toEqual({effective: null, source: null});
    });

    test("选的档不在模型的档里：夹到不高于它的最近一档，没有就取最低档", () => {
        expect(requestEffort("xhigh", {info: info(levels())}).effort).toBe("high");
        expect(requestEffort("minimal", {info: info(levels())}).effort).toBe("low");
        expect(requestEffort("not-an-effort", {info: info(levels())})).toEqual({effective: null, source: null});
    });

    test("关闭：协议能关就显式关；只能降档就发最低档；强制思考的模型落到 OMP 垫的那一档", () => {
        expect(requestEffort("off", {info: info(levels({off: "disable"}))})).toEqual({disableReasoning: true, effective: "off", source: "session"});
        expect(requestEffort("off", {info: info(levels({off: "lowest"}))})).toEqual({effort: "low", effective: "low", source: "session"});
        expect(requestEffort("off", {info: info(levels({off: "none", unset: "medium"}))}).effort).toBe("medium");
        expect(requestEffort("off", {info: info(levels({off: "none"}))}).effort).toBe("low");
        // 默认档不是最低档的可降档模型：选关闭落到最低档，不是默认档。
        expect(requestEffort("off", {info: info(levels({off: "lowest", unset: "high"}))}).effort).toBe("low");
    });

    test("没有明确的档时，线上实际发生的事就是“模型的默认”", () => {
        expect(requestEffort(null, {info: info(levels({unset: "off"}))})).toEqual({effective: "off", source: "model"});
        expect(requestEffort(null, {info: info(levels({off: "none", unset: "low"}))})).toEqual({effective: "low", source: "model"});
    });

    test("不推理或不能调档的模型：不发档，也没有有效档", () => {
        for (const reasoning of [{kind: "none"}, {kind: "fixed"}] as const) {
            expect(requestEffort("high", {info: info(reasoning), defaultEffort: "low"})).toEqual({effective: null, source: null});
        }
    });

    test("端口没给推理能力（旧端口）：选了什么发什么，由适配器夹取", () => {
        expect(requestEffort("high", {info: info()})).toEqual({effort: "high", effective: "high", source: "session"});
        expect(requestEffort(null, {info: info()})).toEqual({effective: null, source: null});
    });
});
