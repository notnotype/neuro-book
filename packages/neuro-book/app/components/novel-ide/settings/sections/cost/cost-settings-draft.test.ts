import {describe, expect, it} from "vitest";
import type {ConfigEditorSnapshotDto, GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";
import {buildCostPayload, readCostCurrency} from "./cost-settings-draft";

/** 只放被测字段，其余从略。 */
function uiWith(ui: unknown): GlobalConfigUpdateDto["ui"] {
    return ui as GlobalConfigUpdateDto["ui"];
}

describe("cost-settings-draft", () => {
    it("只有 ui.costCurrency 显式为 CNY 才算 CNY", () => {
        expect(readCostCurrency(uiWith({costCurrency: "CNY"}))).toBe("CNY");
        expect(readCostCurrency(uiWith({costCurrency: "USD"}))).toBe("USD");
        expect(readCostCurrency(uiWith({}))).toBe("USD");
        expect(readCostCurrency(uiWith("CNY"))).toBe("USD");
        expect(readCostCurrency(undefined)).toBe("USD");
    });

    it("整段回写 ui：theme 与 customThemes 原样保留", () => {
        const baseUi = {
            theme: "sepia",
            customThemes: [{id: "custom-1", name: "我的主题"}],
        } as unknown as GlobalConfigUpdateDto["ui"];

        const payload = buildCostPayload(baseUi, "CNY");

        expect(payload.ui).toMatchObject({
            theme: "sepia",
            customThemes: [{id: "custom-1", name: "我的主题"}],
            costCurrency: "CNY",
        });
    });

    it("baseUi 缺失时只写 costCurrency，不替用户补主题", () => {
        expect(buildCostPayload(undefined, "USD")).toEqual({ui: {costCurrency: "USD"}});
    });
});
