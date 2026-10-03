import {afterEach, describe, expect, it, vi} from "vitest";
import {assertVisibleModel, resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import {appLogger} from "nbook/server/app-logs/logger";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import type {EffectiveConfig} from "nbook/server/config/types";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("agent visible models", () => {
    it("空清单返回当前可解析的默认模型", () => {
        const config = createConfig();

        expect(resolveAgentVisibleModels(config)).toEqual([{
            modelKey: "local/default-model",
            note: "默认模型",
        }]);
    });

    it("保留有效条目顺序与用途，过滤失效 key 并记录 warning", () => {
        const warn = vi.spyOn(appLogger, "warn").mockResolvedValue();
        const config = createConfig();
        config.models.providers.local!.models["writing-model"] = {
            ...config.models.providers.local!.models["default-model"]!,
            id: "writing-model",
            name: "Writing Model",
        };
        config.agent.visibleModels = [
            {modelKey: "local/writing-model", note: "长文写作"},
            {modelKey: "missing/warn-once", note: "已经失效"},
            {modelKey: "local/default-model", note: "编码与审查"},
        ];

        expect(resolveAgentVisibleModels(config)).toEqual([
            {modelKey: "local/writing-model", note: "长文写作"},
            {modelKey: "local/default-model", note: "编码与审查"},
        ]);
        resolveAgentVisibleModels(config);
        expect(warn).toHaveBeenCalledWith(
            "agent.visibleModels.invalid",
            expect.objectContaining({modelKey: "missing/warn-once"}),
            "Agent 可见模型条目不可用，已忽略",
        );
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("全部显式条目失效时仍回退默认模型", () => {
        vi.spyOn(appLogger, "warn").mockResolvedValue();
        const config = createConfig();
        config.agent.visibleModels = [{modelKey: "missing/model", note: "失效"}];

        expect(resolveAgentVisibleModels(config)).toEqual([{
            modelKey: "local/default-model",
            note: "默认模型",
        }]);
    });

    it("工具校验只接受最终可见清单", () => {
        const config = createConfig();
        config.agent.visibleModels = [{modelKey: "local/default-model", note: "默认"}];

        expect(() => assertVisibleModel(config, "local/default-model")).not.toThrow();
        expect(() => assertVisibleModel(config, "local/other-model")).toThrow("不在 agent 可见模型清单内");
    });
});

/** 构造含一个完整可运行模型的 effective config。 */
function createConfig(): Pick<EffectiveConfig, "agent" | "models"> {
    const config = createDefaultEffectiveConfig();
    config.models = {
        defaultModelKey: "local/default-model",
        providers: {
            local: {
                name: "Local",
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: "secret",
                    baseURL: "https://example.com/v1",
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
                models: {
                    "default-model": {
                        name: "Default Model",
                        id: "default-model",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8_192,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                        contextWindowTokens: 128_000,
                    },
                },
            },
        },
    };
    return config;
}
