import {describe, expect, it} from "vitest";
import {expandEnvTemplate} from "nbook/server/utils/env-template";

describe("expandEnvTemplate", () => {
    it("会展开已配置的环境变量", () => {
        const text = expandEnvTemplate("apiKey: ${DEEPSEEK_API_KEY}", {
            DEEPSEEK_API_KEY: "sk-test",
        });

        expect(text).toBe("apiKey: sk-test");
    });

    it("会在变量缺失时使用默认值", () => {
        const text = expandEnvTemplate("baseURL: ${DEEPSEEK_API_BASE:-https://api.deepseek.com/v1}", {});

        expect(text).toBe("baseURL: https://api.deepseek.com/v1");
    });

    it("会在变量缺失且没有默认值时展开为空字符串", () => {
        const text = expandEnvTemplate("apiKey: ${MISSING_API_KEY}", {});

        expect(text).toBe("apiKey: ");
    });

    it("会保留普通明文配置", () => {
        const text = expandEnvTemplate("apiKey: plain-token", {});

        expect(text).toBe("apiKey: plain-token");
    });
});
