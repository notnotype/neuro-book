import {describe, expect, it} from "vitest";
import {completeModelCandidate} from "nbook/app/components/novel-ide/settings/sections/providers/model-draft-factory";
import type {DiscoveredProviderModelDto, ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";

describe("Model Candidate Completion", () => {
    it("完整远程字段保持优先", () => {
        const result = completeModelCandidate(discovered({
            reasoning: false,
            input: ["text"],
            contextWindowTokens: 32_000,
            maxTokens: 4_000,
        }), knowledge());

        expect(result).toMatchObject({
            status: "complete",
            model: {enabled: true, contextWindowTokens: 32_000, maxTokens: 4_000, reasoning: false},
            provenance: {contextWindowTokens: "remote", maxTokens: "remote"},
        });
    });

    it("Model Library 只补远端缺失字段", () => {
        const result = completeModelCandidate(discovered({contextWindowTokens: 64_000}), knowledge());
        expect(result).toMatchObject({
            status: "complete",
            model: {contextWindowTokens: 64_000, maxTokens: 8_000, reasoning: true, input: ["text"]},
            provenance: {contextWindowTokens: "remote", maxTokens: "model-library", reasoning: "model-library"},
        });
    });

    it("OpenAI 发现无法判断接口时使用 Provider Config 的 Responses 格式", () => {
        const result = completeModelCandidate(discovered({api: null}), knowledge(), "openai-responses");
        expect(result).toMatchObject({
            status: "complete",
            model: {api: "openai-responses"},
            provenance: {api: "provider-config"},
        });
    });

    it("未补全候选不产生可持久化 model", () => {
        const result = completeModelCandidate(discovered({api: null}), null);
        expect(result).toMatchObject({status: "incomplete"});
        expect(result).not.toHaveProperty("model");
        if (result.status === "incomplete") {
            expect(result.missingFields).toEqual(expect.arrayContaining(["api", "reasoning", "input", "contextWindowTokens", "maxTokens"]));
        }
    });
});

function discovered(overrides: Partial<DiscoveredProviderModelDto> = {}): DiscoveredProviderModelDto {
    return {
        id: "model",
        name: "Remote Model",
        group: null,
        api: "openai-completions",
        reasoning: null,
        input: null,
        contextWindowTokens: null,
        maxTokens: null,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        ...overrides,
    };
}

function knowledge(): ModelLibraryEntryDto {
    return {
        id: "model",
        name: "Library Model",
        source: "vendor",
        reasoning: true,
        thinkingLevelMap: null,
        input: ["text"],
        contextWindowTokens: 128_000,
        maxTokens: 8_000,
    };
}
