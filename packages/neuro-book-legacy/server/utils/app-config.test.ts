import {describe, expect, it} from "vitest";
import {parseAppConfigText} from "nbook/server/utils/app-config";

describe("parseAppConfigText", () => {
    it("会在解析旧配置文本前展开环境变量占位符", () => {
        const config = parseAppConfigText(`
models:
  default: deepseek/deepseek-v4-flash
  providers:
    deepseek:
      name: DeepSeek
      options:
        apiKey: \${DEEPSEEK_API_KEY}
        baseURL: \${DEEPSEEK_API_BASE:-https://api.deepseek.com/v1}
      models:
        deepseek-v4-flash:
          id: deepseek-v4-flash
`, {
            DEEPSEEK_API_KEY: "sk-test",
        });

        expect(config.models.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(config.models.providers.deepseek?.options).toMatchObject({
            apiKey: "sk-test",
            baseURL: "https://api.deepseek.com/v1",
        });
    });

    it("会把缺失环境变量收敛为空配置文本", () => {
        const config = parseAppConfigText(`
models:
  providers:
    deepseek:
      options:
        apiKey: \${MISSING_API_KEY}
`, {});

        expect(config.models.providers.deepseek?.options.apiKey).toBe("");
    });

    it("迁移旧配置时忽略 provider adapter 字符串简写", () => {
        const config = parseAppConfigText(`
models:
  providers:
    mimo:
      adapter: openai-compatible
`);

        expect(config.models.providers.mimo).toMatchObject({
            name: "mimo",
            options: {apiKey: ""},
        });
        expect("adapter" in (config.models.providers.mimo ?? {})).toBe(false);
    });

    it("迁移旧配置时忽略 provider adapter 对象形式", () => {
        const config = parseAppConfigText(`
models:
  providers:
    custom:
      adapter:
        type: openai-compatible
        reasoningContentReplay: false
`);

        expect("adapter" in (config.models.providers.custom ?? {})).toBe(false);
    });

    it("支持配置 provider 请求超时时间", () => {
        const config = parseAppConfigText(`
models:
  providers:
    mimo:
      options:
        timeoutMs: 180000
`);

        expect(config.models.providers.mimo?.options.timeoutMs).toBe(180000);
    });

    it("解析配置时保留完整、自包含的模型字段", () => {
        const config = parseAppConfigText(`
models:
  default: custom/mimo-vl
  providers:
    custom:
      name: Custom
      modelApi: openai-completions
      options:
        baseURL: https://model.example/v1
      models:
        mimo-vl:
          name: Mimo Vision
          api: openai-completions
          reasoning: true
          input:
            - text
            - image
          maxTokens: 1234
          cost:
            input: 1
            output: 2
            cacheRead: 3
            cacheWrite: 4
          compat:
            thinkingFormat: deepseek
            supportsStrictMode: false
          headers:
            X-Test: value
          thinkingLevelMap:
            high: high
          contextWindowTokens: 98765
`);

        expect(config.models.defaultModelKey).toBe("custom/mimo-vl");
        expect(config.models.providers.custom?.modelApi).toBe("openai-completions");
        expect(config.models.providers.custom?.models["mimo-vl"]).toMatchObject({
            api: "openai-completions",
            reasoning: true,
            input: ["text", "image"],
            maxTokens: 1234,
            cost: {
                input: 1,
                output: 2,
                cacheRead: 3,
                cacheWrite: 4,
            },
            compat: {
                thinkingFormat: "deepseek",
                supportsStrictMode: false,
            },
            headers: {"X-Test": "value"},
            thinkingLevelMap: {high: "high"},
            contextWindowTokens: 98765,
        });
    });

    it("迁移旧配置时丢弃非正 maxTokens 和 contextWindowTokens", () => {
        const config = parseAppConfigText(`
models:
  providers:
    custom:
      models:
        broken:
          maxTokens: 0
          contextWindowTokens: -1
`);

        expect(config.models.providers.custom?.models.broken?.maxTokens).toBeNull();
        expect(config.models.providers.custom?.models.broken?.contextWindowTokens).toBeNull();
    });
});
