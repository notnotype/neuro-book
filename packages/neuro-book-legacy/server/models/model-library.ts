import type {Api, Model} from "@earendil-works/pi-ai";
import {builtinProviders} from "@earendil-works/pi-ai/providers/all";
import {
    ModelLibraryDtoSchema,
    type ModelLibraryDto,
    type ModelLibraryEntryDto,
} from "nbook/shared/dto/app-settings.dto";
import {isSupportedPiApi} from "@notnotype/neuro-book-contracts/provider-config";

const PROVIDER_SOURCE_PRIORITY = [
    "anthropic", "openai", "google", "deepseek", "xai", "xiaomi", "mistral", "minimax", "minimax-cn",
    "moonshotai", "moonshotai-cn", "zai", "zai-coding-cn", "kimi-coding", "cerebras", "groq", "nvidia",
    "amazon-bedrock", "google-vertex", "azure-openai-responses", "fireworks", "together", "huggingface",
    "openrouter", "vercel-ai-gateway", "cloudflare-ai-gateway", "cloudflare-workers-ai", "github-copilot",
    "opencode", "opencode-go", "ant-ling", "xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp",
] as const;

let cachedLibrary: ModelLibraryDto | null = null;

/** 返回进程级只读 Model Library。 */
export function modelLibrary(): ModelLibraryDto {
    cachedLibrary ??= ModelLibraryDtoSchema.parse(buildLibrary());
    return cachedLibrary;
}

/** 按精确 model ID 查询标准模型资料。 */
export function modelKnowledge(modelId: string): ModelLibraryEntryDto | null {
    return modelLibrary().models.find((model) => model.id === modelId.trim()) ?? null;
}

function buildLibrary(): ModelLibraryDto {
    const candidates = new Map<string, Array<{providerId: string; model: Model<Api>}>>();
    for (const provider of builtinProviders()) {
        for (const model of provider.getModels()) {
            if (!isSupportedPiApi(model.api)) {
                continue;
            }
            const entries = candidates.get(model.id) ?? [];
            entries.push({providerId: provider.id, model});
            candidates.set(model.id, entries);
        }
    }

    return {
        models: [...candidates.entries()]
            .map(([modelId, entries]) => buildEntry(modelId, entries.sort(compareSource)))
            .sort((left, right) => left.id.localeCompare(right.id)),
    };
}

function buildEntry(modelId: string, entries: Array<{providerId: string; model: Model<Api>}>): ModelLibraryEntryDto {
    const canonical = entries[0];
    if (!canonical) {
        throw new Error(`Model Library 缺少 canonical model：${modelId}`);
    }
    return {
        id: canonical.model.id,
        name: canonical.model.name,
        source: canonical.providerId,
        reasoning: canonical.model.reasoning,
        thinkingLevelMap: canonical.model.thinkingLevelMap ? {...canonical.model.thinkingLevelMap} : null,
        input: [...canonical.model.input],
        contextWindowTokens: canonical.model.contextWindow,
        maxTokens: canonical.model.maxTokens,
    };
}

function compareSource(left: {providerId: string}, right: {providerId: string}): number {
    const leftIndex = PROVIDER_SOURCE_PRIORITY.indexOf(left.providerId as typeof PROVIDER_SOURCE_PRIORITY[number]);
    const rightIndex = PROVIDER_SOURCE_PRIORITY.indexOf(right.providerId as typeof PROVIDER_SOURCE_PRIORITY[number]);
    const normalizedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.providerId.localeCompare(right.providerId);
}
