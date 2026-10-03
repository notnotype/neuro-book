/**
 * World Engine 嵌入服务：把文本转成向量。
 *
 * 仅复用项目既有的 embedding 配置与 OpenAI 兼容 /embeddings 调用（参考
 * subject-rag-index 的实现），不引入其向量表 / 分块逻辑。向量最终落到
 * WorldPatch 的 vector 列（Decision #8）。
 */

import {loadProjectModuleConfig} from "nbook/server/config/config-service";
import type {EmbeddingServiceConfig} from "nbook/server/config/types";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";

/** 解析出的嵌入模型句柄。 */
export type WorldEmbeddingModel = {
    /** provider/model 组合键，用于日志与按 model 过滤（Decision #19） */
    key: string;
    /** 模型 id，写入 WorldPatch.model 列 */
    modelId: string;
    baseUrl: string;
    apiKey: string;
    dimensions: number;
    timeoutMs: number;
    requestOptions: Record<string, unknown>;
};

/** World Engine generation固定的结构化配置目标。 */
export type WorldEmbeddingTarget = {
    readonly workspaceRoot: AbsoluteFsPath;
    readonly projectWorkspace: ResolvedProjectWorkspace;
};

const MAX_EMBED_BATCH = 64;

/**
 * 解析当前项目生效的 embedding 模型；未启用 / 配置缺失时抛出可读错误。
 *
 * 调用方必须传入当前ProjectSession generation捕获的结构化Workspace，禁止重新按路径查询当前generation。
 */
export async function resolveWorldEmbedding(target: WorldEmbeddingTarget): Promise<WorldEmbeddingModel> {
    const config = await loadProjectModuleConfig(target);
    const embedding = config.embedding;
    if (!embedding.enabled) {
        throw new Error("world.search.text 需要 embedding 服务，但尚未启用。请在 Embedding 设置中启用嵌入服务。");
    }
    if (embedding.provider !== "openai-compatible") {
        throw new Error(`world.search.text 暂不支持 embedding provider：${embedding.provider}`);
    }
    if (!embedding.model) {
        throw new Error("world.search.text 缺少 embedding model。请在 Embedding 设置中配置模型名。");
    }
    if (!embedding.dimensions) {
        throw new Error("world.search.text 缺少 embedding dimensions。请在 Embedding 设置中配置嵌入维度。");
    }
    const apiKey = embedding.apiKey.trim();
    if (!apiKey) {
        throw new Error("embedding 服务缺少 API Key。");
    }
    const baseUrl = embedding.baseURL.trim();
    if (!baseUrl) {
        throw new Error("embedding 服务缺少 API Base。");
    }
    return {
        key: `${embedding.provider}/${embedding.model}`,
        modelId: embedding.model,
        baseUrl,
        apiKey,
        dimensions: embedding.dimensions,
        timeoutMs: embedding.timeoutMs ?? 30_000,
        requestOptions: embeddingRequestOptions(embedding),
    };
}

/** 批量把文本转成已归一化向量（顺序与输入一致）。 */
export async function embedTexts(model: WorldEmbeddingModel, texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (let index = 0; index < texts.length; index += MAX_EMBED_BATCH) {
        embeddings.push(...await embedTextBatch(model, texts.slice(index, index + MAX_EMBED_BATCH)));
    }
    return embeddings;
}

async function embedTextBatch(model: WorldEmbeddingModel, texts: string[]): Promise<number[][]> {
    const controller = model.timeoutMs ? new AbortController() : null;
    const timeout = model.timeoutMs ? globalThis.setTimeout(() => controller?.abort(), model.timeoutMs) : null;
    const url = `${model.baseUrl.replace(/\/+$/u, "")}/embeddings`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json", "Authorization": `Bearer ${model.apiKey}`},
            signal: controller?.signal,
            body: JSON.stringify({model: model.modelId, input: texts, dimensions: model.dimensions, ...model.requestOptions}),
        });
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error(`embedding 请求超时：model=${model.modelId} timeoutMs=${model.timeoutMs} url=${url}`);
        }
        throw error;
    } finally {
        if (timeout) {
            globalThis.clearTimeout(timeout);
        }
    }
    if (!response.ok) {
        throw new Error(`embedding 请求失败：HTTP ${response.status} ${await response.text().catch(() => response.statusText)}`);
    }
    const payload = await response.json() as {data?: Array<{embedding?: unknown}>};
    const vectors = payload.data?.map((item, index) => parseEmbedding(item.embedding, `${model.key}[${index}]`)) ?? [];
    if (vectors.length !== texts.length) {
        throw new Error(`embedding 返回数量异常：expected=${texts.length} actual=${vectors.length}`);
    }
    for (const vector of vectors) {
        if (vector.length !== model.dimensions) {
            throw new Error(`embedding 维度不匹配：expected=${model.dimensions} actual=${vector.length}`);
        }
    }
    return vectors.map((vector, index) => normalizeVector(vector, `${model.key}[${index}]`));
}

function embeddingRequestOptions(config: EmbeddingServiceConfig): Record<string, unknown> {
    const blockedKeys = new Set(["model", "input", "dimensions"]);
    return Object.fromEntries(Object.entries(config.requestOptions).filter(([key]) => !blockedKeys.has(key)));
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function parseEmbedding(value: unknown, label: string): number[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} embedding 必须是 number[]。`);
    }
    return value.map((item, index) => {
        if (typeof item !== "number" || !Number.isFinite(item)) {
            throw new Error(`${label}.embedding[${index}] 必须是有限 number。`);
        }
        return item;
    });
}

function normalizeVector(vector: number[], label: string): number[] {
    let sumSquares = 0;
    for (const value of vector) {
        sumSquares += value * value;
    }
    const magnitude = Math.sqrt(sumSquares);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
        throw new Error(`${label} embedding 不能是零向量。`);
    }
    return vector.map((value) => value / magnitude);
}
