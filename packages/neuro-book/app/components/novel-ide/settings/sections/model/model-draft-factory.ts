import type {
    ConfiguredModelDto,
    DiscoveredProviderModelDto,
    ModelLibraryEntryDto,
} from "nbook/shared/dto/app-settings.dto";
import {inspectModelCapability, selectModelApi} from "@notnotype/neuro-book-contracts/provider-config";

export type ModelCandidateSource = "remote" | "model-library" | "provider-config" | "provider-template" | "user";

export type ModelCandidateProvenance = Partial<Record<
    "name" | "api" | "reasoning" | "input" | "contextWindowTokens" | "maxTokens" | "thinkingLevelMap" | "cost" | "compat" | "headers",
    ModelCandidateSource
>>;

export type CompleteModelCandidate = {
    status: "complete";
    model: ConfiguredModelDto;
    provenance: ModelCandidateProvenance;
};

export type IncompleteModelCandidate = {
    status: "incomplete";
    candidate: Omit<ConfiguredModelDto, "enabled">;
    provenance: ModelCandidateProvenance;
    missingFields: string[];
};

export type CompletedModelCandidate = CompleteModelCandidate | IncompleteModelCandidate;

/**
 * 将远程候选按字段补全为可保存模型。
 * 远端明确字段优先，Model Library 只补缺；不完整候选不会得到可持久化 model。
 */
export function completeModelCandidate(
    discovered: DiscoveredProviderModelDto,
    knowledge: ModelLibraryEntryDto | null,
    providerModelApi: ConfiguredModelDto["api"] = null,
): CompletedModelCandidate {
    const api = selectModelApi(discovered.api, providerModelApi);
    const provenance: ModelCandidateProvenance = {
        name: "remote",
        ...(discovered.api ? {api: "remote" as const} : api ? {api: "provider-config" as const} : {}),
        ...(typeof discovered.reasoning === "boolean" ? {reasoning: "remote" as const} : {}),
        ...(discovered.input?.length ? {input: "remote" as const} : {}),
        ...(discovered.contextWindowTokens ? {contextWindowTokens: "remote" as const} : {}),
        ...(discovered.maxTokens ? {maxTokens: "remote" as const} : {}),
        ...(discovered.thinkingLevelMap ? {thinkingLevelMap: "remote" as const} : {}),
        ...(discovered.cost ? {cost: "remote" as const} : {}),
        ...(discovered.compat ? {compat: "remote" as const} : {}),
        ...(discovered.headers ? {headers: "remote" as const} : {}),
    };

    const candidate: Omit<ConfiguredModelDto, "enabled"> = {
        id: discovered.id,
        name: discovered.name,
        group: discovered.group,
        api,
        reasoning: discovered.reasoning ?? knowledge?.reasoning ?? null,
        input: discovered.input ?? (knowledge ? [...knowledge.input] : null),
        contextWindowTokens: discovered.contextWindowTokens ?? knowledge?.contextWindowTokens ?? null,
        maxTokens: discovered.maxTokens ?? knowledge?.maxTokens ?? null,
        thinkingLevelMap: discovered.thinkingLevelMap ?? (knowledge?.thinkingLevelMap ? {...knowledge.thinkingLevelMap} : null),
        cost: discovered.cost,
        compat: discovered.compat,
        headers: discovered.headers,
    };

    if (knowledge) {
        if (typeof discovered.reasoning !== "boolean") provenance.reasoning = "model-library";
        if (!discovered.input?.length) provenance.input = "model-library";
        if (!discovered.contextWindowTokens) provenance.contextWindowTokens = "model-library";
        if (!discovered.maxTokens) provenance.maxTokens = "model-library";
        if (!discovered.thinkingLevelMap && knowledge.thinkingLevelMap) provenance.thinkingLevelMap = "model-library";
    }

    const missingFields = requiredModelFields(candidate);
    if (missingFields.length > 0) {
        return {status: "incomplete", candidate, provenance, missingFields};
    }
    return {status: "complete", model: {...candidate, enabled: true}, provenance};
}

/** 从 Model Library 创建需要用户明确 API 的候选。 */
export function candidateFromLibrary(
    knowledge: ModelLibraryEntryDto,
    providerModelApi: ConfiguredModelDto["api"],
): CompletedModelCandidate {
    return completeModelCandidate({
        id: knowledge.id,
        name: knowledge.name,
        group: knowledge.source,
        api: null,
        reasoning: null,
        input: null,
        contextWindowTokens: null,
        maxTokens: null,
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
    }, knowledge, providerModelApi);
}

/** 返回模型保存前必须补齐的字段。 */
export function requiredModelFields(model: Pick<ConfiguredModelDto, "api" | "reasoning" | "input" | "contextWindowTokens" | "maxTokens">): string[] {
    const fieldByIssueCode: Readonly<Record<string, string>> = {
        missing_api: "api",
        unsupported_api: "api",
        missing_reasoning: "reasoning",
        missing_input: "input",
        missing_context_window: "contextWindowTokens",
        missing_max_tokens: "maxTokens",
        max_tokens_exceeds_context: "maxTokens<=contextWindowTokens",
    };
    return inspectModelCapability("candidate", {
        id: "model",
        enabled: true,
        api: model.api,
        reasoning: model.reasoning,
        input: model.input,
        contextWindowTokens: model.contextWindowTokens,
        maxTokens: model.maxTokens,
    }).map((issue) => fieldByIssueCode[issue.code] ?? issue.code);
}
