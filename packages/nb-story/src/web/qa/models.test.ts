import {describe, expect, test} from "bun:test";

import type {MessageView} from "@notnotype/nb-agent-ui";

import {candidateInfos, clampThinking, contextTokensOf, defaultChoice, priceCurrency, providerNote, resolveChoice, type CatalogProvider} from "./models";

const model = (id: string, fields: Partial<CatalogProvider["models"][number]> = {}): CatalogProvider["models"][number] => ({id, name: id.toUpperCase(), api: "openai-completions", contextWindow: 200_000, maxTokens: null, reasoning: true, efforts: ["low", "high", "max"], images: false, price: null, ...fields});
const PROVIDERS: CatalogProvider[] = [
    {id: "relay", name: "relay", source: "custom", access: "key", keyEnvs: ["RELAY_KEY"], keySet: true, models: [model("gpt-5.6-sol", {images: true})]},
    {id: "deepseek", name: "DeepSeek", source: "catalog", access: "key", keyEnvs: ["DEEPSEEK_API_KEY"], keySet: false, models: [model("deepseek-flash", {contextWindow: 1_000_000})]},
    {id: "anthropic", name: "Anthropic", source: "catalog", access: "login", keyEnvs: [], keySet: false, models: [model("claude-sonnet-5")]},
];

describe("候选模型", () => {
    test("下拉的各项：名称、服务商、图片；密钥没值、要登录、目录里没有的灰掉并写原因", () => {
        const infos = candidateInfos({models: ["relay/gpt-5.6-sol", "deepseek/deepseek-flash", "anthropic/claude-sonnet-5", "relay/gone"]}, PROVIDERS);
        expect([...infos.values()].map(info => info.view)).toEqual([
            {key: "relay/gpt-5.6-sol", label: "GPT-5.6-SOL", supportsImages: true, group: "relay"},
            {key: "deepseek/deepseek-flash", label: "DEEPSEEK-FLASH", supportsImages: false, group: "DeepSeek", unavailable: "DEEPSEEK_API_KEY 没有值"},
            {key: "anthropic/claude-sonnet-5", label: "CLAUDE-SONNET-5", supportsImages: false, group: "Anthropic", unavailable: "要登录，这里用不了"},
            {key: "relay/gone", label: "gone", supportsImages: false, group: "relay", unavailable: "目录里没有这个模型"},
        ]);
        expect(infos.get("deepseek/deepseek-flash")).toMatchObject({contextWindow: 1_000_000, efforts: ["low", "high", "max"]});
    });

    test("服务商的密钥状态：用不了的服务商即使变量有值也用不了；不设密钥也能用的写明", () => {
        const base = PROVIDERS[1]!;
        expect(providerNote({...base, access: "unsupported", keySet: true})).toEqual({usable: false, text: "这家服务商在这里用不了"});
        expect(providerNote({...base, access: "keyless", keyEnvs: []})).toEqual({usable: true, text: "不设密钥也能用"});
        expect(providerNote({...base, keySet: true})).toEqual({usable: true, text: "DEEPSEEK_API_KEY 已设置"});
        expect(providerNote(PROVIDERS[0]!)).toEqual({usable: true, text: "RELAY_KEY 已设置"});
    });

    test("推理档往下夹；没有档时不写；比最低档还低取最低档", () => {
        expect(clampThinking(["low", "high", "max"], "medium")).toBe("low");
        expect(clampThinking(["low", "high", "max"], "xhigh")).toBe("high");
        expect(clampThinking(["low", "high"], "minimal")).toBe("low");
        expect(clampThinking([], "high")).toBeNull();
        expect(clampThinking(["low"], null)).toBeNull();
    });

    test("没选过时：新对话用默认模型与它的档；续问接着用上一轮的（还在候选里），档不写", () => {
        const config = {models: ["relay/gpt-5.6-sol", "deepseek/deepseek-flash"], model: {use: "relay/gpt-5.6-sol", thinking: "high" as const}};
        expect(defaultChoice(config, null)).toEqual({model: "relay/gpt-5.6-sol", thinking: "high"});
        expect(defaultChoice(config, "deepseek/deepseek-flash")).toEqual({model: "deepseek/deepseek-flash", thinking: null});
        expect(defaultChoice(config, "qa-model")).toEqual({model: "relay/gpt-5.6-sol", thinking: "high"});
    });

    test("选过的模型还在候选里时用选的；在设置里被去掉后当作没选过", () => {
        const config = {models: ["relay/gpt-5.6-sol", "deepseek/deepseek-flash"], model: {use: "relay/gpt-5.6-sol", thinking: "high" as const}};
        expect(resolveChoice(config, {modelKey: "deepseek/deepseek-flash", thinking: "low"}, null)).toEqual({model: "deepseek/deepseek-flash", requested: "low"});
        expect(resolveChoice(config, {modelKey: "relay/removed", thinking: "low"}, null)).toEqual({model: "relay/gpt-5.6-sol", requested: "high"});
        expect(resolveChoice(config, {modelKey: null, thinking: null}, "deepseek/deepseek-flash")).toEqual({model: "deepseek/deepseek-flash", requested: null});
    });

    test("上下文用量取最近一条正常完成、带用量的助手消息，含缓存读写", () => {
        const assistant = (id: string, usage?: {input: number; cacheRead: number; cacheWrite: number}, status: "done" | "stopped" | "error" = "done"): MessageView => ({kind: "assistant", id, timestamp: 0, status, text: "", thinking: "", model: "m", toolCalls: [], contentOmitted: false, ...(usage === undefined ? {} : {usage: {...usage, output: 9, cost: null}})});
        expect(contextTokensOf([assistant("a", {input: 100, cacheRead: 0, cacheWrite: 0}), assistant("b", {input: 20, cacheRead: 3000, cacheWrite: 50}), assistant("c")])).toBe(3070);
        expect(contextTokensOf([assistant("a", {input: 100, cacheRead: 0, cacheWrite: 0}), assistant("b", {input: 0, cacheRead: 0, cacheWrite: 0}, "stopped"), assistant("c", {input: 0, cacheRead: 0, cacheWrite: 0}, "error")])).toBe(100);
        expect(contextTokensOf([])).toBe(0);
    });
});

describe("单价币种", () => {
    test("取目录里写的币种；没有这个模型或没写单价为 null", () => {
        const priced: CatalogProvider[] = [{...PROVIDERS[0]!, models: [model("a", {price: {input: 1, output: 2, currency: "CNY"}}), model("b")]}, {...PROVIDERS[1]!, models: [model("c", {price: {input: 1, output: 2, currency: "USD"}})]}];
        expect(priceCurrency(priced, "relay/a")).toBe("CNY");
        expect(priceCurrency(priced, "deepseek/c")).toBe("USD");
        expect(priceCurrency(priced, "relay/b")).toBeNull();
        expect(priceCurrency(priced, "relay/gone")).toBeNull();
    });
});
