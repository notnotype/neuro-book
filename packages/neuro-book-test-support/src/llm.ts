/**
 * 真实模型测试的开关与凭据。
 *
 * 只有显式设置 `NBOOK_LLM_TESTS=1` 才运行：是否调用模型由运行者的意图决定，不由环境里碰巧有没有
 * 凭据决定。凭据先看进程环境，没有时只从仓库根 `.env` 读白名单内的键并写入进程环境（模型客户端
 * 从进程环境读取），不读其它键、不打印值。
 */

import {existsSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

export const LLM_TESTS_ENV = "NBOOK_LLM_TESTS";
export const DEFAULT_LLM_TEST_MODEL = "deepseek/deepseek-flash";

const CREDENTIAL_KEYS = ["DEEPSEEK_API_KEY", "DEEPSEEK_API_BASE", "REAL_MODEL_SMOKE_MODEL"] as const;
const REPO_DOTENV = fileURLToPath(new URL("../../../.env", import.meta.url));

export interface LlmTestConfig {
    readonly apiKey: string;
    /** `REAL_MODEL_SMOKE_MODEL` 可覆盖，缺省 `deepseek/deepseek-flash`。 */
    readonly model: string;
}

export interface LlmTestConfigOptions {
    readonly env?: NodeJS.ProcessEnv;
    /** 缺省仓库根 `.env`。 */
    readonly dotenvPath?: string;
}

/**
 * 开关打开且取得凭据时返回配置；否则返回 null，用例应跳过，证据记为“未验证”。
 * 开关打开却缺凭据时打印一行提示，避免显式运行的人把跳过误当作通过。
 */
export function llmTestConfig(options: LlmTestConfigOptions = {}): LlmTestConfig | null {
    const env = options.env ?? process.env;
    if (env[LLM_TESTS_ENV] !== "1") return null;
    const dotenv = readDotenv(options.dotenvPath ?? REPO_DOTENV);
    for (const key of CREDENTIAL_KEYS) {
        const value = dotenv.get(key);
        if (env[key] === undefined && value !== undefined) env[key] = value;
    }
    const apiKey = env.DEEPSEEK_API_KEY;
    if (apiKey === undefined || apiKey === "") {
        console.warn(`${LLM_TESTS_ENV}=1 但缺少 DEEPSEEK_API_KEY：真实模型测试跳过，记为未验证`);
        return null;
    }
    return {apiKey, model: env.REAL_MODEL_SMOKE_MODEL || DEFAULT_LLM_TEST_MODEL};
}

/** 只解析 `KEY=VALUE` 行；值两侧成对的引号去掉。 */
function readDotenv(path: string): Map<string, string> {
    const values = new Map<string, string>();
    if (!existsSync(path)) return values;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
        const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line);
        if (match === null) continue;
        const [, key, raw] = match as unknown as [string, string, string];
        values.set(key, /^(["']).*\1$/u.test(raw) ? raw.slice(1, -1) : raw);
    }
    return values;
}
