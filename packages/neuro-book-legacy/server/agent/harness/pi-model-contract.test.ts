import {describe, expect, it} from "vitest";
import {calculateCost, clampThinkingLevel} from "@earendil-works/pi-ai";
import type {Model, Usage} from "@earendil-works/pi-ai";

describe("Pi model contracts", () => {
    it("tier 只在 input tokens 严格大于 threshold 时整请求生效", () => {
        const model = createModel();
        expect(calculateCost(model, usage(100_000)).input).toBe(1);
        expect(calculateCost(model, usage(100_001)).input).toBeCloseTo(2.00002);
    });

    it("max thinking 会按模型支持级别 clamp", () => {
        const model = createModel();
        expect(clampThinkingLevel(model, "max")).toBe("high");
        expect(clampThinkingLevel({...model, thinkingLevelMap: {max: "max"}}, "max")).toBe("max");
    });
});

function createModel(): Model<"openai-completions"> {
    return {
        id: "contract",
        name: "Contract",
        provider: "contract",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1",
        reasoning: true,
        input: ["text"],
        cost: {
            input: 10,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            tiers: [{inputTokensAbove: 100_000, input: 20, output: 0, cacheRead: 0, cacheWrite: 0}],
        },
        contextWindow: 200_000,
        maxTokens: 8_000,
    };
}

function usage(input: number): Usage {
    return {
        input,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    };
}
