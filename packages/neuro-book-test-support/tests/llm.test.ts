// test-lint-allow-file: 测的是开关本身，凭据都是注入的假值，不读真实凭据
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {DEFAULT_LLM_TEST_API, llmTestConfig} from "@notnotype/neuro-book-test-support/llm";

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

const FULL = "NBOOK_LLM_BASE_URL=https://example.test/v1\nNBOOK_LLM_API_KEY=\"from-dotenv\"\nNBOOK_LLM_MODEL=m1\n";

describe("llmTestConfig", () => {
    it("没有显式开关时不运行，即使环境里有凭据", async () => {
        const env: NodeJS.ProcessEnv = {NBOOK_LLM_BASE_URL: "https://example.test/v1", NBOOK_LLM_API_KEY: "key-in-env", NBOOK_LLM_MODEL: "m1"};
        expect(llmTestConfig({env, dotenvPath: await dotenv("")})).toBeNull();
    });

    it("开关打开时从 .env 只取白名单内的键写入环境，环境里已有的值优先；协议缺省 openai-completions", async () => {
        const env: NodeJS.ProcessEnv = {NBOOK_LLM_TESTS: "1", NBOOK_LLM_MODEL: "from-env"};
        const path = await dotenv(`${FULL}UNRELATED_SECRET=x\n`);
        expect(llmTestConfig({env, dotenvPath: path})).toEqual({baseUrl: "https://example.test/v1", apiKey: "from-dotenv", model: "from-env", api: DEFAULT_LLM_TEST_API});
        expect(env.NBOOK_LLM_API_KEY).toBe("from-dotenv");
        expect(env.UNRELATED_SECRET).toBeUndefined();
    });

    it("NBOOK_LLM_API 可改协议；三个必需键缺任意一个都跳过", async () => {
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1"}, dotenvPath: await dotenv(`${FULL}NBOOK_LLM_API=openai-responses\n`)})?.api).toBe("openai-responses");
        for (const dropped of ["NBOOK_LLM_BASE_URL", "NBOOK_LLM_API_KEY", "NBOOK_LLM_MODEL"]) {
            const partial = FULL.split("\n").filter((line) => !line.startsWith(`${dropped}=`)).join("\n");
            expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1"}, dotenvPath: await dotenv(partial)})).toBeNull();
        }
        expect(llmTestConfig({env: {NBOOK_LLM_TESTS: "1", NBOOK_LLM_API_KEY: ""}, dotenvPath: await dotenv(FULL)})).toBeNull();
    });
});
