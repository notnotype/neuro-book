import {computed} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useModelCheckSession} from "nbook/app/components/novel-ide/settings/useModelCheckSession";
import type {ModelSettingsModelDraft, ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn()}),
}));

describe("Model health check frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("批量检查只请求 Provider Config 合同判定为 runnable 的模型", async () => {
        const provider = createProvider([createModel("runnable"), createModel("incomplete")]);
        const fetchMock = vi.fn(async (_url: string, _init: {body: {model: {id: string}}}) => ({success: true, latencyMs: 12, message: "ok"}));
        vi.stubGlobal("$fetch", fetchMock);
        const session = createSession(provider, new Set(["provider/runnable"]));

        await session.checkAll();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({body: {
            provider: {options: {requestOptions: {maxRetries: 5}}},
            model: {id: "runnable"},
        }});
        expect(session.result(provider, provider.models[0]!)).toMatchObject({success: true, latencyMs: 12});
        expect(session.checkingAll.value).toBe(false);
    });

    it("取消单模型检查会记录 cancelled 结果并释放会话状态", async () => {
        const provider = createProvider([createModel("model")]);
        vi.stubGlobal("$fetch", vi.fn((_url: string, init: {signal: AbortSignal}) => new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
        })));
        const session = createSession(provider, new Set(["provider/model"]));

        const pending = session.checkModel(provider.models[0]!);
        await Promise.resolve();
        expect(session.isChecking(provider, provider.models[0]!)).toBe(true);
        session.cancelActiveModel(provider.models[0]!);
        await pending;

        expect(session.result(provider, provider.models[0]!)).toMatchObject({cancelled: true, success: false});
        expect(session.isChecking(provider, provider.models[0]!)).toBe(false);
    });

    it("批量检查限制并发请求数量", async () => {
        const models = Array.from({length: 9}, (_, index) => createModel(`model-${String(index)}`));
        const provider = createProvider(models);
        let active = 0;
        let maxActive = 0;
        vi.stubGlobal("$fetch", vi.fn(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return {success: true, latencyMs: 1, message: "ok"};
        }));
        const session = createSession(provider, new Set(models.map((model) => `provider/${model.id}`)));

        await session.checkAll();

        expect(maxActive).toBeLessThanOrEqual(4);
        expect(session.checkingAll.value).toBe(false);
    });
});

/** 创建被测健康检查会话。 */
function createSession(provider: ModelSettingsProviderDraft, runnableKeys: Set<string>) {
    return useModelCheckSession({
        activeProvider: computed(() => provider),
        runnableModelKeys: computed(() => runnableKeys),
        buildProviderRequest: (value) => ({
            id: value.id,
            name: value.name,
            modelApi: "openai-completions",
            options: {
                apiKey: "",
                baseURL: value.options.baseURL,
                proxy: "",
                timeoutMs: null,
                requestOptions: {maxRetries: value.options.maxRetries.trim() ? Number(value.options.maxRetries) : 5},
            },
        }),
        buildModelDraft: (model) => ({
            name: model.name,
            id: model.id,
            group: model.group || null,
            api: model.api || null,
            reasoning: model.reasoning === "true",
            input: ["text"],
            maxTokens: 4096,
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: 8192,
        }),
        credentialSource: () => "cleared",
    });
}

/** 创建 Provider 草稿。 */
function createProvider(models: ModelSettingsModelDraft[]): ModelSettingsProviderDraft {
    return {
        localKey: "provider-local",
        id: "provider",
        name: "Provider",
        enabled: true,
        modelApi: "openai-completions",
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
        models,
    };
}

/** 创建完整模型草稿。 */
function createModel(id: string): ModelSettingsModelDraft {
    return {
        localKey: `model-${id}`,
        name: id,
        id,
        group: "group",
        enabled: true,
        api: "openai-completions",
        reasoning: "false",
        input: "text",
        maxTokens: "4096",
        cost: {input: "", output: "", cacheRead: "", cacheWrite: "", tiers: []},
        compat: "",
        headers: "",
        thinkingLevelMap: "",
        contextWindowTokens: "8192",
    };
}
