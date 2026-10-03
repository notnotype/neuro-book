import {describe, expect, it} from "vitest";
import {providerTemplate, providerTemplateLibrary} from "nbook/server/models/provider-template-library";

describe("Provider Template Library", () => {
    it("MiMo Token Plan 模板包含连接和完整模型快照", () => {
        const template = providerTemplate("xiaomi-token-plan-cn");
        expect(template?.baseUrl).toBeTruthy();
        expect(template?.models.find((model) => model.id === "mimo-v2.5-pro")).toMatchObject({
            api: "openai-completions",
            contextWindowTokens: 1_048_576,
            maxTokens: 131_072,
            compat: expect.objectContaining({maxTokensField: "max_tokens"}),
        });
    });

    it("提供单一 Custom Provider 创建入口", () => {
        const custom = providerTemplateLibrary().templates.filter((template) => template.id === "custom");
        expect(custom).toEqual([{id: "custom", name: "Custom Provider", baseUrl: "", defaultModelApi: null, models: []}]);
    });

    it("普通连接模板不会把 Pi Registry 全量模型写入用户配置", () => {
        expect(providerTemplate("openrouter")).toMatchObject({
            defaultModelApi: "openai-completions",
            models: [],
        });
        expect(providerTemplate("openai")?.models).toEqual([]);
        expect(providerTemplate("google")?.models).toEqual([]);
    });
});
