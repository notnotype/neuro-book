import {describe, expect, it} from "vitest";
import {canonicalSessionModel, projectSessionModelRef, sessionModelsEqual} from "nbook/server/agent/session/session-model";

describe("session model canonicalizer", () => {
    it("JSONL只持久化Provider Config与模型ID", () => {
        const model = {id: "model", provider: "upstream", providerConfigId: "local", compat: {field: undefined}, headers: undefined};
        expect(canonicalSessionModel(model as never)).toEqual({providerConfigId: "local", modelId: "model"});
        expect(sessionModelsEqual(model as never, {providerConfigId: "local", modelId: "model"})).toBe(true);
    });

    it("metadata变化不改选择身份，Provider或模型ID变化会被检测", () => {
        expect(sessionModelsEqual({id: "model", provider: "upstream", providerConfigId: "local", maxTokens: 1} as never, {id: "model", provider: "upstream", providerConfigId: "local", maxTokens: 2} as never)).toBe(true);
        expect(sessionModelsEqual({id: "model", provider: "upstream", providerConfigId: "local"} as never, {id: "other", provider: "upstream", providerConfigId: "local"} as never)).toBe(false);
    });

    it("公开引用只保留 Provider Config 与模型 ID", () => {
        const projected = projectSessionModelRef({
            id: "private-model",
            provider: "upstream-provider",
            providerConfigId: "local-provider",
            baseUrl: "https://private-provider.example/v1",
            headers: {Authorization: "Bearer private-token"},
            compat: {supportsDeveloperRole: true},
        } as never);

        expect(projected).toEqual({
            providerConfigId: "local-provider",
            modelId: "private-model",
        });
        expect(JSON.stringify(projected)).not.toContain("private-provider.example");
        expect(JSON.stringify(projected)).not.toContain("private-token");
        expect(() => projectSessionModelRef({id: "fallback-model", provider: "fallback-provider"} as never))
            .toThrow("拒绝从Pi Provider身份猜测");
        expect(projectSessionModelRef(null)).toBeNull();
    });
});
