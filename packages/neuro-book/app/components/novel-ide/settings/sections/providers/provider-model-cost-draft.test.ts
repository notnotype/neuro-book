import {describe, expect, it} from "vitest";
import {clearModelCostDraft, createEmptyModelCostDraft, createModelCostDraft, parseModelCostDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-model-cost-draft";

describe("model cost draft", () => {
    it("从已有 USD cost 初始化结构化字段", () => {
        const draft = createModelCostDraft({
            input: 0.14,
            output: 0.28,
            cacheRead: 0.0028,
            cacheWrite: 0,
            tiers: [],
        });

        expect(draft).toMatchObject({
            input: "0.14",
            output: "0.28",
            cacheRead: "0.0028",
            cacheWrite: "0",
        });
    });

    it("空价格草稿保存为 null", () => {
        expect(parseModelCostDraft(createEmptyModelCostDraft())).toBeNull();
    });

    it("USD 输入保存为完整 cost 对象并包含 tiers", () => {
        const draft = createEmptyModelCostDraft();
        draft.input = "0.14";
        draft.output = "0.28";
        draft.cacheRead = "0";
        draft.cacheWrite = "0";

        expect(parseModelCostDraft(draft)).toEqual({
            input: 0.14,
            output: 0.28,
            cacheRead: 0,
            cacheWrite: 0,
            tiers: [],
        });
    });

    it("模型价格输入固定按 USD 保存，不受 UI 显示币种影响", () => {
        const draft = createEmptyModelCostDraft();
        draft.input = "7";
        draft.output = "0";
        draft.cacheRead = "0";
        draft.cacheWrite = "0";

        expect(parseModelCostDraft(draft)?.input).toBe(7);
    });

    it("覆盖状态下基础价格缺失会明确失败", () => {
        const draft = createEmptyModelCostDraft();
        draft.input = "1";
        expect(() => parseModelCostDraft(draft)).toThrow("output 未填写");
    });

    it("tiers 保存时按 threshold 排序并拒绝重复 threshold", () => {
        const draft = createModelCostDraft({
            input: 1,
            output: 2,
            cacheRead: 0.5,
            cacheWrite: 0,
            tiers: [],
        });
        draft.tiers.push(
            {inputTokensAbove: "200", input: "3", output: "4", cacheRead: "1", cacheWrite: "0"},
            {inputTokensAbove: "100", input: "2", output: "3", cacheRead: "1", cacheWrite: "0"},
        );
        expect(parseModelCostDraft(draft)?.tiers.map((tier) => tier.inputTokensAbove)).toEqual([100, 200]);

        draft.tiers[0]!.inputTokensAbove = "100";
        expect(() => parseModelCostDraft(draft)).toThrow("threshold 重复");
    });

    it("清空价格覆盖后恢复继承状态", () => {
        const draft = createModelCostDraft({
            input: 1,
            output: 2,
            cacheRead: 0.5,
            cacheWrite: 0,
            tiers: [],
        });

        clearModelCostDraft(draft);

        expect(parseModelCostDraft(draft)).toBeNull();
    });
});
