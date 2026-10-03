import {describe, expect, it} from "vitest";
import {deriveModelGroup} from "nbook/shared/models/model-group";

describe("Model Group", () => {
    it("Cloudflare 命名空间保留平台与厂商，不截到模型名前缀", () => {
        expect(deriveModelGroup("@cf/mistralai/mistral-small-3.1-24b-instruct")).toBe("@cf/mistralai");
    });

    it("普通模型 ID 使用稳定前缀", () => {
        expect(deriveModelGroup("deepseek-v4-pro")).toBe("deepseek");
        expect(deriveModelGroup("openrouter/auto")).toBe("openrouter");
    });
});
