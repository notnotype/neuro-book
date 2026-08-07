import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {isSupportedPiApi} from "nbook/shared/models/provider-config-contract";

import {writeJsonAtomic} from "#manager/files";

export type DesktopProviderInput = {
    name: string;
    baseURL: string;
    api: string;
    apiKey: string;
    model: string;
    discoverModels?: boolean;
};

export type DesktopProviderTestResult = {
    ok: boolean;
    status: number | null;
    warning: string | null;
};

/**
 * 将 Manager GUI 的首次 Provider 草稿写入现有 Global Config 合同。
 *
 * Provider 真值当前位于 State Root/workspace/.nbook/config.json（不是 Boot
 * Config 的 config.yaml）；这里只允许写入一个完整、可运行的自定义模型，
 * API Key 只经过 stdin 进入本函数，绝不出现在 argv、环境或日志。
 */
export async function configureDesktopProvider(stateRoot: string, input: DesktopProviderInput): Promise<{providerId: string; modelKey: string}> {
    const name = input.name.trim();
    const baseURL = input.baseURL.trim();
    const api = input.api.trim();
    const model = input.model.trim();
    if (!name || !baseURL || !api || !model) throw new Error("Provider 名称、Base URL、API 类型和模型不能为空。");
    const normalizedBaseURL = normalizeProviderBaseURL(baseURL);
    if (!isSupportedPiApi(api)) throw new Error(`不支持的 Provider API 类型：${api}`);
    if (input.apiKey.includes("\0") || input.apiKey.length > 16_384) throw new Error("Provider API Key 无效或超过 16 KiB。");
    const providerId = slug(name);
    const configPath = join(stateRoot, "workspace", ".nbook", "config.json");
    const current = await readJsonObject(configPath);
    const models = isRecord(current.models) ? current.models : {};
    const providers = Array.isArray(models.providers) ? models.providers.filter(isRecord) : [];
    const nextProvider = {
        id: providerId,
        name,
        enabled: true,
        modelApi: api,
        options: {
            apiKey: input.apiKey,
            baseURL: normalizedBaseURL,
            proxy: "",
            timeoutMs: null,
            requestOptions: {},
        },
        models: [{
            name: model,
            id: model,
            group: null,
            enabled: true,
            api,
            reasoning: true,
            input: ["text"],
            maxTokens: 8_192,
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: 128_000,
        }],
    };
    const next = {
        ...current,
        models: {
            ...models,
            default: `${providerId}/${model}`,
            providers: [...providers.filter((provider) => provider.id !== providerId), nextProvider],
        },
    };
    await writeJsonAtomic(configPath, next);
    return {providerId, modelKey: `${providerId}/${model}`};
}

/** 只测试 Provider 的可达性与 HTTP 状态；不保存配置，也不回显响应体或 Secret。 */
export async function testDesktopProvider(input: DesktopProviderInput): Promise<DesktopProviderTestResult> {
    const baseURL = normalizeProviderBaseURL(input.baseURL);
    if (!isSupportedPiApi(input.api.trim())) throw new Error(`不支持的 Provider API 类型：${input.api.trim()}`);
    const url = new URL(`${baseURL}/models`);
    const headers: Record<string, string> = {};
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    try {
        const response = await fetch(url, {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) return {ok: true, status: response.status, warning: null};
        return {ok: false, status: response.status, warning: `Provider 返回 HTTP ${String(response.status)}；配置仍可以保存。`};
    } catch {
        return {ok: false, status: null, warning: "Provider 当前不可达或处于离线状态；配置仍可以保存。"};
    }
}

function normalizeProviderBaseURL(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Provider Base URL 不能为空。");
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error("Provider Base URL 必须是有效的 http(s) 地址。");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Provider Base URL 必须使用 http 或 https。");
    }
    if (url.username || url.password) {
        throw new Error("Provider Base URL 不能携带用户名或密码；请使用 API Key 字段。");
    }
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
    try {
        const value = JSON.parse(await readFile(path, "utf8")) as unknown;
        return isRecord(value) ? value : {};
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
}

function slug(value: string): string {
    const result = value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48);
    if (!result) throw new Error("Provider 名称无法生成稳定 ID。");
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
