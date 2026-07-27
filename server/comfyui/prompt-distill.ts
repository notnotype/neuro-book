import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {resolveConfiguredModel, resolveDefaultModel} from "nbook/server/utils/model-settings";
import {resolvePiModelMetadata} from "nbook/server/agent/harness/pi-model-metadata";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {mergePiRequestHeaders, parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {tracedStreamSimple} from "nbook/server/agent/observability/traced-provider";
import {sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";
import {useAgentHarness} from "nbook/server/agent/http";
import type {ComfyUiDistillResponseDto} from "nbook/shared/dto/comfyui.dto";

/**
 * 提示词蒸馏：把小说/RP 正文选段转成 Anima 风格英文生图提示词。
 *
 * 模型选择：config.comfyui.promptModelKey → 全局默认模型；
 * 输出拼装：config.comfyui.positivePrefix + ", " + LLM 输出；负向直接用 negativeDefault。
 * trace 走正式 health-check bucket（mode=comfyui-prompt-distill），不落 session trace。
 */

/** 输入截断上限：提示词蒸馏不需要全文，超长选段截前 6000 字符。 */
const DISTILL_INPUT_MAX_CHARS = 6_000;
const DISTILL_TIMEOUT_MS = 60_000;

/**
 * 蒸馏系统提示词。要求纯提示词输出：质量前缀由服务端拼接，不让模型自带。
 */
const DISTILL_SYSTEM_PROMPT = [
    "You convert a passage from a novel into a single English prompt for an anime-style text-to-image model.",
    "The model accepts a mix of danbooru-style tags and short natural-language phrases, separated by commas, all lowercase.",
    "Describe only what should appear in ONE illustration of the scene:",
    "- characters: count (1girl / 2boys ...), hair, eyes, clothing, expression, pose, action",
    "- setting: location, time of day, weather, lighting, atmosphere",
    "- composition: camera angle or framing if implied (close-up, wide shot, from above ...)",
    "Rules:",
    "- output the prompt text only: one line, comma-separated, no quotes, no explanations, no markdown",
    "- do not include quality tags (masterpiece, best quality ...), artist names, or negative prompt content",
    "- do not invent characters or events that are not in the passage; unspecified details may be filled with neutral choices",
    "- keep it under 80 tags/phrases",
].join("\n");

export class ComfyUiDistillError extends Error {
    constructor(message: string, readonly statusCode = 500) {
        super(message);
        this.name = "ComfyUiDistillError";
    }
}

/**
 * 执行一次蒸馏调用。projectPath 用于解析 project 级配置（模型 key 覆盖等走 effective config）。
 */
export async function distillIllustrationPrompt(input: {
    projectPath: string;
    text: string;
    styleHint?: string;
}): Promise<ComfyUiDistillResponseDto> {
    const config = await loadEffectiveConfigForAgentRuntime({projectPath: input.projectPath});
    if (!config.comfyui.enabled) {
        throw new ComfyUiDistillError("ComfyUI 生图功能未启用，请先在配置中心的「ComfyUI 生图」中开启", 400);
    }
    const resolved = resolveConfiguredModel(config.models, config.comfyui.promptModelKey)
        ?? resolveDefaultModel(config.models);
    if (!resolved) {
        throw new ComfyUiDistillError("没有可用的提示词蒸馏模型：请在「ComfyUI 生图」设置中指定模型，或配置全局默认模型", 400);
    }
    if (resolved.provider.options.proxy.trim()) {
        throw new ComfyUiDistillError(`模型 ${resolved.providerId}/${resolved.model.id} 配置了代理，蒸馏调用暂不支持 Provider 代理；请换用无代理模型`, 400);
    }

    const text = input.text.slice(0, DISTILL_INPUT_MAX_CHARS);
    const styleHint = input.styleHint?.trim();
    const userText = styleHint
        ? `Passage:\n${text}\n\nAdditional style guidance from the author (follow it): ${styleHint}`
        : `Passage:\n${text}`;

    const model = resolvePiModelMetadata(resolved.providerId, resolved.provider, resolved.model);
    const models = resolvePiModelsFromConfig({models: config.models}, model);
    const requestOptions = parsePiSimpleRequestOptions(resolved.provider.options.requestOptions);
    const apiKey = resolved.provider.options.apiKey.trim() || undefined;
    const stream = tracedStreamSimple(models, model, {
        systemPrompt: DISTILL_SYSTEM_PROMPT,
        messages: [createUserMessage({text: userText, images: []})],
        tools: [],
    }, {
        ...requestOptions,
        ...piRequestAuthOptions({
            api: model.api,
            apiKey,
            env: requestOptions.env,
        }),
        headers: mergePiRequestHeaders(model.headers, requestOptions.headers),
        timeoutMs: resolved.provider.options.timeoutMs ?? DISTILL_TIMEOUT_MS,
        maxTokens: Math.min(512, model.maxTokens),
        reasoning: undefined,
        cacheRetention: "none",
    }, useAgentHarness().traceBinding(config, {kind: "health-check", mode: "comfyui-prompt-distill"}));
    const response = await stream.result();
    if (response.stopReason === "error") {
        throw new ComfyUiDistillError(`提示词蒸馏失败：${sanitizeProviderErrorMessage(response.errorMessage || "provider 未返回错误详情")}`, 502);
    }

    const raw = response.content
        .filter((block): block is {type: "text"; text: string} => block.type === "text")
        .map((block) => block.text)
        .join(" ");
    const distilled = cleanupPromptText(raw);
    if (!distilled) {
        throw new ComfyUiDistillError("提示词蒸馏失败：模型没有返回可用内容", 502);
    }
    const prefix = config.comfyui.positivePrefix.trim();
    return {
        positive: prefix ? `${prefix}, ${distilled}` : distilled,
        negative: config.comfyui.negativeDefault,
        modelKey: `${resolved.providerId}/${resolved.model.id}`,
    };
}

/** 清理模型输出：剥代码围栏、首尾引号、换行折叠为空格。 */
function cleanupPromptText(raw: string): string {
    let text = raw.trim();
    const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/u.exec(text);
    if (fenced?.[1]) {
        text = fenced[1].trim();
    }
    text = text.replace(/^["'`]+|["'`]+$/gu, "");
    return text.replace(/\s*\n+\s*/gu, ", ").replace(/\s{2,}/gu, " ").trim();
}
