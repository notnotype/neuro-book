/**
 * 真实模型 smoke 的共享支持：凭据解析、隔离全局配置写入、dev server 探活。
 *
 * 凭据只从环境读取（仓库根 `.env` 由 `vitest.real-model.config.ts` 注入），不经用例名、不打印；
 * 写入的全局配置位于本次 run 的隔离 State Root，随 run 结束删除。
 */

import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {normalizeGlobalConfig} from "nbook/server/config/normalizer";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/** dev server 地址：与 smoke CLI 同口径。 */
export const REAL_MODEL_SMOKE_BASE_URL = process.env.AGENT_HTTP_BASE_URL ?? "http://localhost:3000";

/** 真实模型凭据；null 表示本机未配置，相关用例应 skip 并在证据中记为「未验证」。 */
export type RealModelCredentials = {
    providerId: string;
    modelId: string;
    apiKey: string;
    baseURL: string;
};

/**
 * 解析根 `.env` 的 DeepSeek 凭据。
 * `REAL_MODEL_SMOKE_MODEL` 可覆盖模型（`<provider>/<model>` 或裸 model id，默认 `deepseek/deepseek-flash`）。
 */
export function resolveRealModelCredentials(): RealModelCredentials | null {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) return null;

    const configuredModel = process.env.REAL_MODEL_SMOKE_MODEL?.trim() || "deepseek/deepseek-flash";
    const slash = configuredModel.indexOf("/");
    const providerId = slash > 0 ? configuredModel.slice(0, slash) : "deepseek";
    const modelId = slash > 0 ? configuredModel.slice(slash + 1) : configuredModel;
    if (!providerId || !modelId) {
        throw new Error(`REAL_MODEL_SMOKE_MODEL 格式非法：${configuredModel}（期望 <provider>/<model> 或裸 model id）`);
    }
    if (providerId !== "deepseek") {
        // 凭据与 baseURL 固定取自 DEEPSEEK_*；显式拒绝其他 provider，避免把模型发往错误端点。
        throw new Error(`REAL_MODEL_SMOKE_MODEL 只支持 deepseek provider（当前：${providerId}）`);
    }

    return {
        providerId,
        modelId,
        apiKey,
        baseURL: process.env.DEEPSEEK_API_BASE?.trim() || "https://api.deepseek.com/v1",
    };
}

/**
 * 把凭据写成当前 State Root 的全局配置；Harness 装配与 CLI smoke 走同一条读取路径。
 *
 * 只允许写本 run 的隔离 State Root：缺少 `NEURO_BOOK_STATE_ROOT` 时直接拒绝，
 * 避免 globalSetup 未生效时解析到用户真实根（`%LOCALAPPDATA%/NeuroBook/data`）并覆盖配置。
 */
export async function writeRealModelGlobalConfig(credentials: RealModelCredentials): Promise<void> {
    if (!process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
        throw new Error("拒绝写入真实 State Root：本次 run 缺少 NEURO_BOOK_STATE_ROOT（vitest globalSetup 未生效？）");
    }

    const stored = normalizeGlobalConfig({
        models: {
            default: `${credentials.providerId}/${credentials.modelId}`,
            providers: [{
                id: credentials.providerId,
                name: credentials.providerId,
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: credentials.apiKey,
                    baseURL: credentials.baseURL,
                    proxy: "",
                    timeoutMs: null,
                    requestOptions: {},
                },
                models: [{
                    id: credentials.modelId,
                    name: credentials.modelId,
                    group: null,
                    enabled: true,
                    api: "openai-completions",
                    reasoning: true,
                    input: ["text"],
                    maxTokens: 8192,
                    cost: null,
                    compat: null,
                    headers: null,
                    thinkingLevelMap: null,
                    contextWindowTokens: 128_000,
                }],
            }],
        },
    });

    const root = resolveUserNbookRoot();
    await mkdir(root, {recursive: true});
    // 副本含明文 Provider 密钥：POSIX 下创建即收紧为 0600；目录本身随 run teardown 删除。
    await writeFile(join(root, "config.json"), `${JSON.stringify(stored, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
}

/**
 * dev server 监听探活：只有 fetch 网络/超时失败才视为不可达（由调用方 skip）；
 * 收到任何 HTTP 响应都算已监听，状态码交给后续 API 调用暴露为真实失败。
 */
export async function probeRealModelDevServer(
    baseUrl = REAL_MODEL_SMOKE_BASE_URL,
    timeoutMs = 3_000,
): Promise<boolean> {
    try {
        await fetch(`${baseUrl}/api/app/version`, {signal: AbortSignal.timeout(timeoutMs)});
        return true;
    } catch {
        return false;
    }
}
