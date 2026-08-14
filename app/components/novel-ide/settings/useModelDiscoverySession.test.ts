import {computed, nextTick, reactive, ref} from "vue";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {useModelDiscoverySession} from "nbook/app/components/novel-ide/settings/useModelDiscoverySession";
import type {ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {DiscoveredProviderModelDto, ModelLibraryDto} from "nbook/shared/dto/app-settings.dto";

const notificationSpies = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
}));

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => notificationSpies,
}));

describe("Automatic Model Discovery frontend session", () => {
    beforeEach(() => {
        vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("发现列表只包含本次远端结果，不混入 Provider 已保存但未发现的模型", async () => {
        const provider = createProvider({
            models: [
                createModel("remote-model", true),
                createModel("saved-only", true),
                createModel("disabled-only", false),
            ],
        });
        vi.stubGlobal("$fetch", vi.fn(async () => ({
            models: [remoteModel({id: "remote-model", name: "Remote"})],
            message: "ok",
            diagnostics: completeDiagnostics(),
        })));
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value.flatMap((group) => group.models.map((model) => model.id))).toEqual(["remote-model"]);
        expect(session.discoveryGroups.value[0]?.models[0]?.state).toBe("enabled");
        expect(notificationSpies.success).toHaveBeenCalledWith("ok");
        expect(notificationSpies.warning).not.toHaveBeenCalled();
    });

    it("普通 OpenAI 发现使用 Provider Model API 补全 Responses", async () => {
        const provider = createProvider({modelApi: "openai-responses", models: []});
        vi.stubGlobal("$fetch", vi.fn(async () => ({
            models: [remoteModel({api: null})],
            message: "ok",
            diagnostics: completeDiagnostics(),
        })));
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value[0]?.models[0]).toMatchObject({
            state: "remote-complete",
            completeModel: {api: "openai-responses"},
        });
    });

    it("发现请求显式声明凭据来源", async () => {
        const provider = reactive(createProvider({models: []}));
        const fetchMock = vi.fn(async () => ({models: [], message: "ok", diagnostics: completeDiagnostics()}));
        vi.stubGlobal("$fetch", fetchMock);
        const session = createSession(provider, "saved");

        await session.discover();

        expect(fetchMock).toHaveBeenCalledWith("/api/config/models/provider-discover", expect.objectContaining({
            body: expect.objectContaining({
                credentialSource: "saved",
                provider: expect.objectContaining({
                    options: expect.objectContaining({requestOptions: {maxRetries: 5}}),
                }),
            }),
        }));
    });

    it("仅有重复模型时保留模型并缓存 partial 诊断", async () => {
        const provider = reactive(createProvider({models: []}));
        const fetchMock = vi.fn(async () => ({
            models: [remoteModel()],
            message: "ok",
            diagnostics: {
                fetchedCount: 2,
                returnedCount: 1,
                skippedCount: 0,
                duplicateCount: 1,
                pageCount: 1,
                truncated: false,
                partial: true,
            },
        }));
        vi.stubGlobal("$fetch", fetchMock);
        const session = createSession(provider);

        await session.discover();

        expect(session.discoveryGroups.value).toHaveLength(1);
        expect(session.discoveryDiagnostics.value).toMatchObject({skippedCount: 0, duplicateCount: 1, partial: true});
        expect(notificationSpies.warning).toHaveBeenCalledWith(expect.stringContaining("settings.panels.models.discoveryPartial"));
        expect(notificationSpies.success).not.toHaveBeenCalled();
    });

    it("缺少 Provider Model API 时阻止模型发现", async () => {
        const provider = createProvider({modelApi: "", models: []});
        const fetchMock = vi.fn(async () => ({
            models: [remoteModel({api: null})],
            message: "ok",
        }));
        vi.stubGlobal("$fetch", fetchMock);
        const session = createSession(provider);

        await session.discover();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(session.discoveryGroups.value).toEqual([]);
    });

    it("provided Secret 内容变化会作废旧发现缓存", async () => {
        const provider = reactive(createProvider({models: []}));
        provider.options.apiKey = "first-secret";
        vi.stubGlobal("$fetch", vi.fn(async () => ({models: [remoteModel()], message: "ok", diagnostics: completeDiagnostics()})));
        const session = createSession(provider, "provided");
        await session.discover();
        expect(session.discoveryGroups.value).toHaveLength(1);

        provider.options.apiKey = "second-secret";
        await nextTick();

        expect(session.discoveryGroups.value).toEqual([]);
        expect(session.discoveryDiagnostics.value).toBeNull();
    });

    it("Provider request options 变化会同时作废旧模型和诊断缓存", async () => {
        const provider = reactive(createProvider({models: []}));
        vi.stubGlobal("$fetch", vi.fn(async () => ({models: [remoteModel()], message: "ok", diagnostics: completeDiagnostics()})));
        const session = createSession(provider, "provided");

        await session.discover();
        expect(session.discoveryGroups.value).toHaveLength(1);
        expect(session.discoveryDiagnostics.value).not.toBeNull();

        provider.options.requestOptions = '{"headers":{"X-Tenant":"tenant-b"}}';
        await nextTick();

        expect(session.discoveryGroups.value).toEqual([]);
        expect(session.discoveryDiagnostics.value).toBeNull();
    });

    it("请求期间修改 Provider Model API 不会把旧协议结果绑定到新协议", async () => {
        const provider = reactive(createProvider({models: []}));
        let resolveRequest: ((value: {models: DiscoveredProviderModelDto[]; message: string; diagnostics: ReturnType<typeof completeDiagnostics>}) => void) | undefined;
        vi.stubGlobal("$fetch", vi.fn(() => new Promise<{models: DiscoveredProviderModelDto[]; message: string; diagnostics: ReturnType<typeof completeDiagnostics>}>((resolve) => {
            resolveRequest = resolve;
        })));
        const session = createSession(provider, "saved");

        const discovering = session.discover();
        await nextTick();
        provider.modelApi = "openai-responses";
        resolveRequest?.({models: [remoteModel()], message: "ok", diagnostics: completeDiagnostics()});
        await discovering;

        expect(session.discoveryGroups.value).toEqual([]);
        expect(session.discoveryDiagnostics.value).toBeNull();
    });
});

/** 创建被测发现会话。 */
function createSession(provider: ModelSettingsProviderDraft, credentialSource: "provided" | "saved" | "cleared" = "cleared") {
    const activeProvider = computed(() => provider);
    const modelLibrary = ref<ModelLibraryDto>({models: []});
    return useModelDiscoverySession({
        activeProvider,
        modelLibrary,
        loadLibraries: async () => modelLibrary.value,
        findLibraryModel: () => null,
        buildProviderRequest: (value) => ({
            id: value.id,
            name: value.name,
            modelApi: value.modelApi === "openai-responses" ? "openai-responses" : "openai-completions",
            options: {
                apiKey: "",
                baseURL: value.options.baseURL,
                proxy: "",
                timeoutMs: null,
                requestOptions: {maxRetries: value.options.maxRetries.trim() ? Number(value.options.maxRetries) : 5},
            },
        }),
        credentialSource: () => credentialSource,
        enableModel: () => undefined,
        disableModel: () => undefined,
        openTransientCandidate: async () => undefined,
        ensureDefaultModel: () => undefined,
    });
}

/** 创建 Provider Config 草稿。 */
function createProvider(overrides: Partial<ModelSettingsProviderDraft> = {}): ModelSettingsProviderDraft {
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
        models: [],
        ...overrides,
    };
}

/** 创建完整已保存模型草稿。 */
function createModel(id: string, enabled: boolean): ModelSettingsProviderDraft["models"][number] {
    return {
        localKey: `model-${id}`,
        name: id,
        id,
        group: "group",
        enabled,
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

/** 创建远程发现 DTO。 */
function remoteModel(overrides: Partial<DiscoveredProviderModelDto> = {}): DiscoveredProviderModelDto {
    return {
        id: "remote-model",
        name: "Remote Model",
        group: "remote",
        api: null,
        reasoning: false,
        input: ["text"],
        contextWindowTokens: 8192,
        maxTokens: 4096,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
        ...overrides,
    };
}

function completeDiagnostics() {
    return {
        fetchedCount: 1,
        returnedCount: 1,
        skippedCount: 0,
        duplicateCount: 0,
        pageCount: 1,
        truncated: false,
        partial: false,
    };
}
