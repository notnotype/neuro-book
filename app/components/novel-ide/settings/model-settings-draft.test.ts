import {describe, expect, it} from "vitest";
import {
    buildAgentVisibleModels,
    buildProviderRequestOptions,
    splitProviderRequestOptions,
    cleanGlobalAgent,
    ensureRunnableDefault,
    inspectSettingsDraft,
    previewModelLibraryRepairs,
    previewProviderModelApiRepairs,
    renameAgentProvider,
    removeIncompleteDisabledModels,
    modelContractInput,
    type ContractSettingsDraft,
} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";

describe("model settings draft contract", () => {
    it("旧 Provider 配置把 maxRetries 拆到独立字段并保留其他高级参数", () => {
        expect(splitProviderRequestOptions({maxRetries: 0, maxRetryDelayMs: 3_000, metadata: {tenant: "test"}})).toEqual({
            maxRetries: "0",
            requestOptions: JSON.stringify({maxRetryDelayMs: 3_000, metadata: {tenant: "test"}}, null, 2),
        });
    });

    it("保存和临时请求合并空值默认、显式 0 与高级参数", () => {
        expect(buildProviderRequestOptions('{"maxRetryDelayMs":3000}', "")).toEqual({maxRetryDelayMs: 3_000, maxRetries: 5});
        expect(buildProviderRequestOptions('{"maxRetryDelayMs":3000}', "0")).toEqual({maxRetryDelayMs: 3_000, maxRetries: 0});
    });

    it("高级 JSON 重复声明 maxRetries 时拒绝合并", () => {
        expect(() => buildProviderRequestOptions('{"maxRetries":2}', "3")).toThrow("maxRetries");
        expect(() => buildProviderRequestOptions("{}", "1.5")).toThrow();
        expect(() => buildProviderRequestOptions("{}", "-1")).toThrow();
    });

    it("草稿补齐后实时 issue 立即消失", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.api = "";
        expect(inspectSettingsDraft(draft).issues[0]?.code).toBe("missing_api");

        draft.providers[0]!.models[0]!.api = "openai-completions";
        expect(inspectSettingsDraft(draft).issues).toEqual([]);
    });

    it("默认模型和候选只接受 runnable 模型", () => {
        const draft = createDraft();
        draft.providers[0]!.options.baseURL = "";
        expect(ensureRunnableDefault(draft)).toEqual(new Set());
        expect(draft.defaultModelKey).toBeNull();
    });

    it("Model Library 按精确 ID 补齐通用能力，但不猜测缺失 API", () => {
        const draft = createDraft();
        const model = draft.providers[0]!.models[0]!;
        model.id = "mimo-v2.5-pro";
        model.reasoning = "inherit";
        model.input = "";
        model.contextWindowTokens = "";
        model.maxTokens = "";

        const repairs = previewModelLibraryRepairs(draft, [mimoKnowledge()]);
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toMatchObject({
            source: "xiaomi",
            replacement: {
                api: "openai-completions",
                contextWindowTokens: 1_048_576,
                maxTokens: 131_072,
            },
        });
        model.api = "";
        expect(previewModelLibraryRepairs(draft, [mimoKnowledge()])).toEqual([]);
    });

    it("一键修复跳过重复 Provider/model 组，不删除、不禁用、不猜测保留项", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.id = "mimo-v2.5-pro";
        draft.providers[0]!.models[0]!.api = "";
        draft.providers[0]!.models.push({...draft.providers[0]!.models[0]!});

        expect(previewModelLibraryRepairs(draft, [mimoKnowledge()])).toEqual([]);
        expect(draft.providers[0]!.models.every((model) => model.enabled)).toBe(true);
    });

    it("disabled 不完整模型仍产生字段问题", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.enabled = false;
        draft.providers[0]!.models[0]!.api = "";
        expect(inspectSettingsDraft(draft).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing_api"}),
        ]));
    });

    it("一键修复只删除不完整的已停用模型", () => {
        const draft = createDraft();
        const completeDisabled = {...draft.providers[0]!.models[0]!, id: "complete-disabled", enabled: false};
        const incompleteDisabled = {...draft.providers[0]!.models[0]!, id: "incomplete-disabled", enabled: false, api: ""};
        const incompleteEnabled = {...draft.providers[0]!.models[0]!, id: "incomplete-enabled", enabled: true, api: ""};
        draft.providers[0]!.models = [completeDisabled, incompleteDisabled, incompleteEnabled];

        expect(removeIncompleteDisabledModels(draft)).toEqual([{
            providerId: "local",
            modelId: "incomplete-disabled",
            issueCodes: ["missing_api"],
        }]);
        expect(draft.providers[0]!.models.map((model) => model.id)).toEqual(["complete-disabled", "incomplete-enabled"]);
    });

    it("一键修复只从一致的已保存模型 API 补全 Provider 默认接口", () => {
        const draft = createDraft();
        draft.providers[0]!.modelApi = "";

        expect(previewProviderModelApiRepairs(draft)).toEqual([{
            providerIndex: 0,
            providerId: "local",
            api: "openai-completions",
        }]);

        draft.providers[0]!.models.push({...draft.providers[0]!.models[0]!, id: "responses", api: "openai-responses"});
        expect(previewProviderModelApiRepairs(draft)).toEqual([]);
        draft.providers[0]!.models = [];
        expect(previewProviderModelApiRepairs(draft)).toEqual([]);
    });

    it("一键修复遇到缺失或未知模型 API 时不猜 Provider 默认接口", () => {
        const draft = createDraft();
        draft.providers[0]!.modelApi = "";
        draft.providers[0]!.models[0]!.api = "";
        expect(previewProviderModelApiRepairs(draft)).toEqual([]);

        draft.providers[0]!.models[0]!.api = "unknown-api";
        expect(previewProviderModelApiRepairs(draft)).toEqual([]);
    });

    it("小数 token limit 作为无效字段处理，不会截断后进入 payload", () => {
        const draft = createDraft();
        draft.providers[0]!.models[0]!.contextWindowTokens = "8192.5";

        expect(modelContractInput(draft.providers[0]!.models[0]!).contextWindowTokens).toBeNull();
        expect(inspectSettingsDraft(draft).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "missing_context_window"}),
        ]));
    });

    it("Agent 可见模型保存前去重、清理已删除或停用的模型引用", () => {
        const agent = cleanGlobalAgent({
            visibleModels: buildAgentVisibleModels({
                agentVisibleModels: [
                    {modelKey: " local/available ", note: " 编码 "},
                    {modelKey: "local/removed", note: "已删除"},
                    {modelKey: "local/available", note: "重复"},
                ],
            }),
        }, new Set(["local/available"]));

        expect(agent?.visibleModels).toEqual([{
            modelKey: "local/available",
            note: "编码",
        }]);
    });

    it("Provider ID 重命名同步迁移 Agent 可见模型 key 和用途顺序", () => {
        const result = renameAgentProvider({
            visibleModels: [
                {modelKey: "provider/first", note: "高性能"},
                {modelKey: "other/second", note: "便宜"},
            ],
        }, "provider", "renamed");

        expect(result.changed).toBe(true);
        expect(result.agent?.visibleModels).toEqual([
            {modelKey: "renamed/first", note: "高性能"},
            {modelKey: "other/second", note: "便宜"},
        ]);
    });
});

function createDraft(): ContractSettingsDraft {
    return {
        defaultModelKey: "local/model",
        providers: [{
            id: "local",
            enabled: true,
            modelApi: "openai-completions",
            options: {baseURL: "https://example.com/v1"},
            models: [{
                id: "model",
                enabled: true,
                api: "openai-completions",
                reasoning: "false",
                input: "text",
                contextWindowTokens: "8192",
                maxTokens: "4096",
            }],
        }],
    };
}

function mimoKnowledge(): ModelLibraryEntryDto {
    return {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        source: "xiaomi",
        reasoning: true,
        thinkingLevelMap: null,
        input: ["text"],
        contextWindowTokens: 1_048_576,
        maxTokens: 131_072,
    };
}
