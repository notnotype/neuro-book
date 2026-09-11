import {describe, expect, it} from "vitest";
import type {ConfigEditorSnapshotDto, EmbeddingServiceConfigDto} from "nbook/shared/dto/config.dto";
import {buildGlobalEmbeddingPayload, buildProjectEmbeddingPayload, createEmbeddingSettingsDraftFromConfig} from "./embedding-settings-draft";

/** 只放被测字段，其余从略。 */
function snapshotWith(input: {global: EmbeddingServiceConfigDto; project?: {model?: string | null; dimensions?: number | null}}): ConfigEditorSnapshotDto {
    return {
        embeddingSettings: {
            global: input.global,
            project: input.project ?? null,
            effective: input.global,
        },
    } as unknown as ConfigEditorSnapshotDto;
}

const GLOBAL_CONFIG: EmbeddingServiceConfigDto = {
    enabled: true,
    provider: "openai-compatible",
    model: "text-embedding-3-small",
    dimensions: 1536,
    apiKey: {configured: true, maskedValue: "sk-…abcd"},
    baseURL: "https://api.example.com/v1",
    timeoutMs: 30000,
    requestOptions: {encoding_format: "float"},
};

describe("embedding-settings-draft config 入口", () => {
    it("config → 草稿 → 写回体回到原值", () => {
        const draft = createEmbeddingSettingsDraftFromConfig(snapshotWith({
            global: GLOBAL_CONFIG,
            project: {model: "text-embedding-3-large", dimensions: 512},
        }));

        expect(buildGlobalEmbeddingPayload(draft.global)).toEqual(GLOBAL_CONFIG);
        expect(buildProjectEmbeddingPayload(draft.project)).toEqual({model: "text-embedding-3-large", dimensions: 512});
    });

    it("密钥只回显 configured / maskedValue，输入框留空", () => {
        const draft = createEmbeddingSettingsDraftFromConfig(snapshotWith({global: GLOBAL_CONFIG}));

        expect(draft.global.apiKey).toBe("");
        expect(draft.global.apiKeyConfigured).toBe(true);
        expect(draft.global.apiKeyMaskedValue).toBe("sk-…abcd");
        expect(draft.global.apiKeyCleared).toBe(false);
    });

    it("requestOptions 缩进 2 空格回显，空对象回显空串", () => {
        const draft = createEmbeddingSettingsDraftFromConfig(snapshotWith({global: GLOBAL_CONFIG}));
        expect(draft.global.requestOptions).toBe("{\n  \"encoding_format\": \"float\"\n}");

        const empty = createEmbeddingSettingsDraftFromConfig(snapshotWith({global: {...GLOBAL_CONFIG, requestOptions: {}}}));
        expect(empty.global.requestOptions).toBe("");
    });
});
