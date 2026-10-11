/**
 * 真实模型测试的开关与凭据。
 *
 * 只有显式设置 `NBOOK_LLM_TESTS=1` 才运行：是否调用模型由运行者的意图决定，不由环境里碰巧有没有
 * 凭据决定。服务由专属的三个键描述（`NBOOK_LLM_BASE_URL`、`NBOOK_LLM_API_KEY`、`NBOOK_LLM_MODEL`），
 * 不借用任何产品或个人提供方的键名：换服务只改 `.env`，测试代码不动。先看进程环境，没有时只从仓库根
 * `.env` 读白名单内的键并写入进程环境，不读其它键、不打印值。
 */

import {existsSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

export const LLM_TESTS_ENV = "NBOOK_LLM_TESTS";
/** 服务协议缺省为 OpenAI 兼容的 chat completions；别的协议用 `NBOOK_LLM_API` 指定（值是 OMP 的 Api 名）。 */
export const DEFAULT_LLM_TEST_API = "openai-completions";
/** 测试在自己的配置里为这个服务登记的提供方 id；凭据库里的 key 也挂在它名下。 */
export const LLM_TEST_PROVIDER_ID = "smoke";

const CREDENTIAL_KEYS = ["NBOOK_LLM_BASE_URL", "NBOOK_LLM_API_KEY", "NBOOK_LLM_MODEL", "NBOOK_LLM_API"] as const;
const REQUIRED_KEYS = ["NBOOK_LLM_BASE_URL", "NBOOK_LLM_API_KEY", "NBOOK_LLM_MODEL"] as const;
const REPO_DOTENV = fileURLToPath(new URL("../../../.env", import.meta.url));

export interface LlmTestConfig {
    /** 服务地址，交给测试写进自己的提供方配置。 */
    readonly baseUrl: string;
    readonly apiKey: string;
    /** 服务上的模型 id（不带提供方前缀）。 */
    readonly model: string;
    /** OMP 的 Api 名。 */
    readonly api: string;
}

export interface LlmTestConfigOptions {
    readonly env?: NodeJS.ProcessEnv;
    /** 缺省仓库根 `.env`。 */
    readonly dotenvPath?: string;
}

/**
 * 开关打开且三个必需键齐全时返回配置；否则返回 null，用例应跳过，证据记为“未验证”。
 * 开关打开却缺键时打印一行提示（只提键名），避免显式运行的人把跳过误当作通过。
 */
export function llmTestConfig(options: LlmTestConfigOptions = {}): LlmTestConfig | null {
    const env = options.env ?? process.env;
    if (env[LLM_TESTS_ENV] !== "1") return null;
    const dotenv = readDotenv(options.dotenvPath ?? REPO_DOTENV);
    for (const key of CREDENTIAL_KEYS) {
        const value = dotenv.get(key);
        if (env[key] === undefined && value !== undefined) env[key] = value;
    }
    const missing = REQUIRED_KEYS.filter((key) => env[key] === undefined || env[key] === "");
    if (missing.length > 0) {
        console.warn(`${LLM_TESTS_ENV}=1 但缺少 ${missing.join("、")}：真实模型测试跳过，记为未验证`);
        return null;
    }
    return {baseUrl: env.NBOOK_LLM_BASE_URL!, apiKey: env.NBOOK_LLM_API_KEY!, model: env.NBOOK_LLM_MODEL!, api: env.NBOOK_LLM_API || DEFAULT_LLM_TEST_API};
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
