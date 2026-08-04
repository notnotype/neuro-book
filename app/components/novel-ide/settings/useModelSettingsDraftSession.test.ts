import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useModelSettingsDraftSession} from "nbook/app/components/novel-ide/settings/useModelSettingsDraftSession";
import type {ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

vi.mock("nbook/app/composables/useConfigApi", () => ({
    useConfigApi: () => ({editorSnapshot: vi.fn(), saveGlobal: vi.fn(), saveProject: vi.fn()}),
}));

vi.mock("nbook/app/stores/novel-ide", () => ({
    useNovelIdeStore: () => ({setSelectedModelLabel: vi.fn()}),
}));

describe("Provider Config draft frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("新模型 API 只进入 Provider 请求提示，模型仍保存自己的 API", () => {
        const session = createSession();
        const provider = createProvider();
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;

        session.enableModel(configuredModel());

        expect(session.buildProviderRequest(provider)).toMatchObject({modelApi: "openai-responses"});
        expect(provider.models[0]).toMatchObject({api: "openai-responses", enabled: true});
        expect(session.draft.value.defaultModelKey).toBe("provider/model");
    });

    it("Provider 请求重复声明 maxRetries 时在发请求前拒绝", () => {
        const session = createSession();
        const provider = createProvider();
        provider.options.requestOptions = '{"maxRetries":2}';

        expect(() => session.buildProviderRequest(provider)).toThrow("maxRetries");
    });

    it("Provider 检查请求保留默认重试次数和显式 0", () => {
        const session = createSession();
        const provider = createProvider();

        expect(session.buildProviderRequest(provider).options.requestOptions.maxRetries).toBe(5);
        provider.options.maxRetries = "0";
        expect(session.buildProviderRequest(provider).options.requestOptions.maxRetries).toBe(0);
    });

    it("Provider ID 重命名会迁移默认模型并通知临时会话", () => {
        const renameDiscovery = vi.fn();
        const cancelProviderChecks = vi.fn();
        const session = createSession({renameDiscovery, cancelProviderChecks});
        const provider = createProvider();
        provider.models.push(session.cloneModel(configuredModel()));
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;
        session.draft.value.defaultModelKey = "provider/model";
        session.draft.value.agentVisibleModels = [{modelKey: "provider/model", note: "编码"}];

        session.renameActiveProviderId("renamed");

        expect(session.draft.value.defaultModelKey).toBe("renamed/model");
        expect(session.draft.value.agentVisibleModels).toEqual([{modelKey: "renamed/model", note: "编码"}]);
        expect(renameDiscovery).toHaveBeenCalledWith("provider", "renamed");
        expect(cancelProviderChecks).toHaveBeenCalledWith(provider, true);
    });

    it("已保存 Provider ID 不可修改，显式复制不会继承 Secret 或模型引用", () => {
        const session = createSession();
        const provider = createProvider();
        provider.sourceIndex = 0;
        provider.options.apiKeyConfigured = true;
        provider.options.apiKeyMaskedValue = "sk-...aved";
        provider.models.push(session.cloneModel(configuredModel()));
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;
        session.draft.value.defaultModelKey = "provider/model";

        session.renameActiveProviderId("renamed");
        expect(provider.id).toBe("provider");

        session.cloneActiveProviderConnection();
        const clone = session.activeProvider.value!;
        expect(clone).toMatchObject({
            id: "provider-copy",
            options: {apiKey: "", apiKeyConfigured: false, apiKeyMaskedValue: null, maxRetries: ""},
        });
        expect(clone.sourceIndex).toBeUndefined();
        expect(clone.models.map((model) => model.id)).toEqual(["model"]);
        expect(session.draft.value.defaultModelKey).toBe("provider/model");
    });

    it("一键修复会从一致的已保存模型 API 补全 Provider 默认接口", async () => {
        const session = createSession();
        const provider = createProvider();
        provider.modelApi = "";
        provider.models.push(session.cloneModel(configuredModel()));
        session.draft.value.providers.push(provider);
        session.activeProviderKey.value = provider.localKey;

        await session.repair();

        expect(provider.modelApi).toBe("openai-responses");
    });
});

/** 创建被测 Config 草稿会话。 */
function createSession(overrides: Partial<Parameters<typeof useModelSettingsDraftSession>[0]> = {}) {
    return useModelSettingsDraftSession({
        props: {scope: "global", targetLabel: ""},
        loadLibraries: async () => ({models: []}),
        resetChecks: () => undefined,
        cancelProviderChecks: () => undefined,
        cancelModelCheck: () => undefined,
        resetDiscovery: () => undefined,
        renameDiscovery: () => undefined,
        removeDiscovery: () => undefined,
        ...overrides,
    });
}

/** 创建 Provider Config 草稿。 */
function createProvider(): ModelSettingsProviderDraft {
    return {
        localKey: "provider-local",
        id: "provider",
        name: "Provider",
        enabled: true,
        modelApi: "openai-responses",
        options: {
            apiKey: "",
            apiKeyConfigured: false,
            apiKeyMaskedValue: null,
            apiKeyCleared: false,
            baseURL: "https://example.com/v1",
            proxy: "",
            timeoutMs: "",
            maxRetries: "",
            requestOptions: "",
        },
        models: [],
    };
}

/** 创建完整模型 DTO。 */
function configuredModel(): ConfiguredModelDto {
    return {
        name: "Model",
        id: "model",
        group: "group",
        enabled: true,
        api: "openai-responses",
        reasoning: false,
        input: ["text"],
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        contextWindowTokens: 8192,
    };
}
