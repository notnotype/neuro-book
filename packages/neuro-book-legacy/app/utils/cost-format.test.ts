import {describe, expect, it} from "vitest";
import {formatCost, formatCostExact, usingCnyRate} from "nbook/app/utils/cost-format";

describe("cost format", () => {
    it("格式化 USD 费用", () => {
        expect(formatCost(0.123456, {currency: "USD"})).toBe("$0.1235");
    });

    it("按汇率格式化 CNY 费用", () => {
        expect(formatCost(1, {currency: "CNY", usdToCnyRate: 7.2})).toBe("¥7.2000");
        expect(usingCnyRate({currency: "CNY", usdToCnyRate: 7.2})).toBe(true);
    });

    it("CNY 无汇率时回退 USD", () => {
        expect(formatCost(1, {currency: "CNY", usdToCnyRate: null})).toBe("$1.0000");
        expect(usingCnyRate({currency: "CNY", usdToCnyRate: null})).toBe(false);
    });

    it("0 或缺失费用隐藏", () => {
        expect(formatCost(0, {currency: "USD"})).toBe("");
        expect(formatCost(undefined, {currency: "USD"})).toBe("");
    });

    it("tooltip exact 在无费用时返回对应零值", () => {
        expect(formatCostExact(0, {currency: "USD"})).toBe("$0.0000");
        expect(formatCostExact(0, {currency: "CNY", usdToCnyRate: 7.2})).toBe("¥0.0000");
    });
});
