// test-lint-allow-file: 测的是开关本身，凭据都是注入的假值，不读真实凭据
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {DEFAULT_LLM_TEST_MODEL, llmTestConfig, llmTestKey} from "@notnotype/neuro-book-test-support/llm";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

async function dotenv(text: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-llm-config-"));
    roots.push(root);
    const path = join(root, ".env");
    await writeFile(path, text, "utf8");
    return path;
}

describe("llmTestConfig", () => {
    it("没有显式开关时不运行，即使环境里有凭据", async () => {
        const env: NodeJS.ProcessEnv = {DEEPSEEK_API_KEY: "key-in-env"};
        expect(llmTestConfig({env, dotenvPath: await dotenv("")})).toBeNull();
    });

    it("开关打开时从 .env 只取白名单内的键写入环境，环境里已有的值优先", async () => {
        const env: NodeJS.ProcessEnv = {NBOOK_LLM_TESTS: "1", REAL_MODEL_SMOKE_MODEL: "deepseek/other"};
        const path = await dotenv('DEEPSEEK_API_KEY="from-dotenv"\nREAL_MODEL_SMOKE_MODEL=ignored\nUNRELATED_SECRET=x\n');
        expect(llmTestConfig({env, dotenvPath: path})).toEqual({apiKey: "from-dotenv", model: "deepseek/other", baseUrl: null, apiKeyEnv: "DEEPSEEK_API_KEY"});
        expect(env.DEEPSEEK_API_KEY).toBe("from-dotenv");
        expect(env.UNRELATED_SECRET).toBeUndefined();
    });

    it("开关打开但缺凭据时跳过；模型缺省为 deepseek-flash", async () => {
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1"}, dotenvPath: await dotenv("")})).toBeNull();
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1", DEEPSEEK_API_KEY: "k"}, dotenvPath: await dotenv("")})?.model).toBe(DEFAULT_LLM_TEST_MODEL);
    });

    it("DEEPSEEK_API_BASE 作为 baseUrl 交给调用方，空白当作没给", async () => {
        const path = await dotenv("DEEPSEEK_API_KEY=k\nDEEPSEEK_API_BASE=https://proxy.example/v1\n");
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1"}, dotenvPath: path})?.baseUrl).toBe("https://proxy.example/v1");
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1", DEEPSEEK_API_KEY: "k", DEEPSEEK_API_BASE: "  "}, dotenvPath: await dotenv("")})?.baseUrl).toBeNull();
    });
});

describe("llmTestKey", () => {
    it("开关没开时不给；开了先看环境，再只从 .env 读这一个键，不写进环境；都没有时为 null", async () => {
        const path = await dotenv("TAVILY_API_KEY=from-dotenv\nDEEPSEEK_API_KEY=other\n");
        expect(llmTestKey("TAVILY_API_KEY", {env: {TAVILY_API_KEY: "in-env"}, dotenvPath: path})).toBeNull();
        expect(llmTestKey("TAVILY_API_KEY", {env: {NBOOK_LLM_TESTS: "1", TAVILY_API_KEY: "in-env"}, dotenvPath: path})).toBe("in-env");
        const env: NodeJS.ProcessEnv = {NBOOK_LLM_TESTS: "1"};
        expect(llmTestKey("TAVILY_API_KEY", {env, dotenvPath: path})).toBe("from-dotenv");
        expect(env.TAVILY_API_KEY).toBeUndefined();
        expect(env.DEEPSEEK_API_KEY).toBeUndefined();
        expect(llmTestKey("TAVILY_API_KEY", {env: {NBOOK_LLM_TESTS: "1"}, dotenvPath: await dotenv("")})).toBeNull();
    });
});
