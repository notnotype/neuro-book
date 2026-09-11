import {describe, expect, it} from "vitest";
import {
    SEARCH_PROVIDER_CATALOG,
    buildProviderSecretPayload,
    buildWebPayload,
    createWebSettingsDraft,
    moveProvider,
    normalizeProviderOrder,
} from "./web-settings-draft";

describe("web-settings-draft", () => {
    it("规范化优先级：滤掉未知项、去重并补齐缺失的 provider", () => {
        expect(normalizeProviderOrder(["brave", "brave", "unknown"])).toEqual(["brave", "tavily"]);
        expect(normalizeProviderOrder(undefined)).toEqual(["tavily", "brave"]);
    });

    it("上移下移越界时保持原顺序", () => {
        expect(moveProvider(["tavily", "brave"], "tavily", -1)).toEqual(["tavily", "brave"]);
        expect(moveProvider(["tavily", "brave"], "brave", 1)).toEqual(["tavily", "brave"]);
        expect(moveProvider(["tavily", "brave"], "brave", -1)).toEqual(["brave", "tavily"]);
    });

    it("每个服务都有一份草稿，独有字段按 catalog 的默认值初始化", () => {
        const draft = createWebSettingsDraft();
        for (const definition of SEARCH_PROVIDER_CATALOG) {
            expect(draft.providers[definition.key]).toBeDefined();
            for (const field of definition.extraFields) {
                expect(draft.providers[definition.key]!.extras[field.key]).toBe(field.defaultValue);
            }
        }
        // 没有独有字段的服务不该凭空多出 extras
        expect(Object.keys(draft.providers.tavily.extras)).toEqual([]);
    });

    it("密钥留空保留旧值，输入新值时去空格，显式清除写空串", () => {
        const provider = {...createWebSettingsDraft().providers.tavily, apiKeyConfigured: true, apiKeyMaskedValue: "sk-…7f3a"};

        expect(buildProviderSecretPayload(provider)).toEqual({configured: true, maskedValue: "sk-…7f3a"});
        expect(buildProviderSecretPayload({...provider, apiKey: "  sk-new  "})).toEqual({
            configured: true,
            maskedValue: "sk-…7f3a",
            value: "sk-new",
        });
        expect(buildProviderSecretPayload({...provider, apiKeyCleared: true})).toEqual({
            configured: true,
            maskedValue: "sk-…7f3a",
            value: "",
        });
    });

    it("数字字段留空或非法时回落到文档化默认值", () => {
        const draft = createWebSettingsDraft();
        draft.localFetch.maxRedirects = "";
        draft.localFetch.maxBytes = "abc";
        draft.tavilyFallback.timeoutMs = "";

        const payload = buildWebPayload(draft);
        expect(payload.fetch!.local!.maxRedirects).toBe(5);
        expect(payload.fetch!.local!.maxBytes).toBe(2_000_000);
        expect(payload.fetch!.tavilyFallback!.timeoutMs).toBeNull();
    });

    it("写回体的服务键与 catalog 一一对应（往表里加服务却忘了改写回段，这条先红）", () => {
        const payload = buildWebPayload(createWebSettingsDraft());
        expect(Object.keys(payload.search!.providers!).sort()).toEqual([...SEARCH_PROVIDER_CATALOG.map((item) => item.key)].sort());
    });

    it("写回体的 provider 段与 catalog 对齐，Brave 的独有字段来自 extras", () => {
        const draft = createWebSettingsDraft();
        draft.providers.brave.enabled = true;
        draft.providers.brave.extras.country = " cn ";
        draft.providers.brave.extras.searchLang = " ZH ";

        const payload = buildWebPayload(draft);
        expect(payload.search!.order).toEqual(["tavily", "brave"]);
        expect(payload.search!.providers!.brave).toMatchObject({enabled: true, country: "CN", searchLang: "zh"});
        expect(payload.search!.providers!.tavily).toMatchObject({enabled: false});
    });
});
