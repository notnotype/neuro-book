import {describe, expect, it} from "vitest";
import {
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

    it("密钥留空保留旧值，输入新值时去空格，显式清除写空串", () => {
        const provider = {...createWebSettingsDraft().tavily, apiKeyConfigured: true, apiKeyMaskedValue: "sk-…7f3a"};

        expect(buildProviderSecretPayload(provider)).toEqual({configured: true, maskedValue: "sk-…7f3a"});
        expect(buildProviderSecretPayload({...provider, apiKey: "  sk-new  "})).toEqual({
            configured: true,
            maskedValue: "sk-…7f3a",
            value: "sk-new",
        });
        expect(buildProviderSecretPayload({...provider, apiKeyCleared: true, apiKey: "sk-new"})).toEqual({
            configured: true,
            maskedValue: "sk-…7f3a",
            value: "",
        });
    });

    it("数字非法或为空时回落到文档化默认值，兜底超时留空表示未配置", () => {
        const draft = createWebSettingsDraft();
        draft.localFetch = {...draft.localFetch, timeoutMs: "", maxRedirects: "-1", maxBytes: "abc"};
        draft.tavilyFallback = {enabled: true, timeoutMs: ""};

        const payload = buildWebPayload(draft);

        expect(payload.fetch?.local?.timeoutMs).toBe(15000);
        expect(payload.fetch?.local?.maxRedirects).toBe(5);
        expect(payload.fetch?.local?.maxBytes).toBe(2_000_000);
        expect(payload.fetch?.tavilyFallback).toEqual({enabled: true, timeoutMs: null});
        expect(payload.search?.order).toEqual(["tavily", "brave"]);
    });
});
