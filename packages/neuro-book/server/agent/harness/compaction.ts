import {tracedCompleteSimple} from "nbook/server/agent/observability/traced-provider";
import type {PiTraceBinding} from "nbook/server/agent/observability/traced-provider";
import type {Models} from "@earendil-works/pi-ai";
import {estimateStoredContextTokens, estimateStoredMessageTokens} from "nbook/server/agent/messages/stored-message-tokens";
import {
    type StoredMessageLike,
    storedMessageText,
} from "nbook/server/agent/messages/stored-message-presentation";
import type {AgentMessage, AssistantMessage, JsonValue, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import {
    COMPACTION_PROMPT,
    COMPACTION_SUMMARY_PREFIX,
    DEFAULT_PROFILE_RUNTIME_SETTINGS,
    resolveProfileRuntimeSettings,
} from "nbook/server/agent/profiles/profile-runtime-settings";
import type {ProfileCompactionRuntimePatch} from "nbook/shared/agent/profile-runtime-settings";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {CompactionSessionEntry, CustomMessageSessionEntry, MessageSessionEntry, SessionEntry, SessionSnapshot} from "nbook/server/agent/session/types";
import type {RecoveryMaterialCandidateMetadata} from "nbook/server/agent/harness/recovery-materials";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";
import {mergePiRequestHeaders, parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {assertProviderContextWithinWindow, estimateProviderTextTokens} from "nbook/server/agent/harness/context-admission";
import type {StoredAgentMessage, StoredToolResultMessage} from "nbook/server/agent/messages/stored-types";
export {COMPACTION_PROMPT, COMPACTION_SUMMARY_PREFIX};

export type CompactionOptions = {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    triggerPercent?: number;
    triggerTokens?: number;
    prompt: string;
    summaryPrefix: string;
    promptSource: "default" | "profile";
    summaryPrefixSource: "default" | "profile";
};

export const DEFAULT_NEURO_COMPACTION_OPTIONS: Omit<CompactionOptions, "enabled"> = {
    reserveTokens: DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.reserveTokens,
    keepRecentTokens: DEFAULT_PROFILE_RUNTIME_SETTINGS.compaction.keepRecent.value,
    prompt: COMPACTION_PROMPT,
    summaryPrefix: COMPACTION_SUMMARY_PREFIX,
    promptSource: "default",
    summaryPrefixSource: "default",
};
type CompactionPlan = {
    firstKeptEntry: ModelVisibleSessionEntry | null;
    messagesToSummarize: StoredMessageLike[];
    previousSummary?: string;
    metrics: {
        recentTokens: number;
        summarizedTokens: number;
        firstKeptEntryType?: ModelVisibleSessionEntry["type"];
        visibleEntryCountBefore: number;
        recentEntryCount: number;
        summarizedEntryCount: number;
    };
};

type CompactionSummaryResult = {
    text: string;
    strategy: "llm" | "deterministic-fallback";
    inputTokens: number;
    inputBudgetTokens: number;
    summaryError?: string;
};

type ModelVisibleSessionEntry = MessageSessionEntry | CustomMessageSessionEntry;

const COMPACTION_INPUT_BUDGET_RATIO = 0.45;
const COMPACTION_INPUT_MIN_TOKENS = 1;
const COMPACTION_INPUT_MAX_TOKENS = 32_000;
const COMPACTION_TOOL_RESULT_MAX_CHARS = 2_000;
const COMPACTION_TEXT_TRUNCATION_MARKER = "\n\n[... tool result truncated for compaction ...]";

/**
 * 自动压缩：超过上下文预算时追加 compaction entry。
 */
export async function compactIfNeeded(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    messages: StoredMessageLike[];
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    thinkingLevel?: ThinkingLevel;
    compaction?: ProfileCompactionRuntimePatch;
    trace?: PiTraceBinding;
    /** 为空表示调用方没有可取消生命周期；非空时透传给摘要 Provider。 */
    signal?: AbortSignal;
    prepareRecoveryCandidates?: () => Promise<RecoveryMaterialCandidateMetadata[]>;
    writeCompactionEntry: (entry: Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">) => Promise<void>;
}): Promise<boolean> {
    if (!input.compaction) {
        return false;
    }
    const options = resolveCompactionOptions(input.compaction, input.model);
    if (!options.enabled) {
        return false;
    }

    const usage = estimateStoredContextTokens(input.messages);
    if (!shouldCompactWithOptions(usage.tokens, input.model.contextWindow, options)) {
        return false;
    }
    const recoveryCandidates = await input.prepareRecoveryCandidates?.();
    await appendCompaction({
        repo: input.repo,
        snapshot: input.snapshot,
        messages: input.messages,
        models: input.models,
        tokensBefore: usage.tokens,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        requestOptions: input.requestOptions,
        thinkingLevel: input.thinkingLevel,
        options,
        trace: input.trace,
        signal: input.signal,
        recoveryCandidates,
        allowFallback: true,
        writeCompactionEntry: input.writeCompactionEntry,
    });
    return true;
}

/**
 * 追加 compaction entry。自动摘要失败时写入确定性 checkpoint，手动命令保持失败可见。
 */
export async function appendCompaction(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    messages: StoredMessageLike[];
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    thinkingLevel?: ThinkingLevel;
    tokensBefore?: number;
    instructions?: string;
    compaction?: ProfileCompactionRuntimePatch;
    options?: CompactionOptions;
    trace?: PiTraceBinding;
    signal?: AbortSignal;
    allowFallback?: boolean;
    recoveryCandidates?: RecoveryMaterialCandidateMetadata[];
    writeCompactionEntry: (entry: Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">) => Promise<void>;
}): Promise<void> {
    if (!input.options && !input.compaction) {
        throw new Error("缺少 profile compaction 配置，无法执行压缩。");
    }
    const options = input.options ?? resolveCompactionOptions(input.compaction!, input.model);
    const path = input.repo.activePath(input.snapshot);
    const visibleEntries = path.filter(isModelVisibleEntry);
    assertNoPendingToolCall(visibleEntries.map(entryMessage));
    const plan = selectCompactionPlan(path, options);
    let generatedSummary: CompactionSummaryResult;
    try {
        generatedSummary = await generateCompactionSummary({
            messages: plan.messagesToSummarize,
            models: input.models,
            model: input.model,
            apiKey: input.apiKey,
            timeoutMs: input.timeoutMs,
            requestOptions: input.requestOptions,
            instructions: input.instructions,
            previousSummary: plan.previousSummary,
            thinkingLevel: input.thinkingLevel,
            reserveTokens: options.reserveTokens,
            prompt: options.prompt,
            trace: input.trace,
            signal: input.signal,
        });
    } catch (error) {
        if (!input.allowFallback) {
            throw error;
        }
        const outputBudgetTokens = resolveSummaryOutputBudget(input.model, options.reserveTokens);
        generatedSummary = {
            text: deterministicCompactionFallback({
                previousSummary: plan.previousSummary,
                conversation: plan.messagesToSummarize.map((message) => `${message.role}: ${storedMessageText(message)}`).join("\n\n") || "No prior history.",
                outputBudgetTokens,
            }),
            strategy: "deterministic-fallback",
            inputTokens: 0,
            inputBudgetTokens: resolveSummaryInputBudget(input.model, options.prompt, outputBudgetTokens),
            summaryError: sanitizeProviderErrorMessage(error instanceof Error ? error.message : String(error)),
        };
    }
    if (generatedSummary.strategy === "deterministic-fallback" && !input.allowFallback) {
        throw new Error(generatedSummary.summaryError ?? "压缩摘要生成失败，未写入 compaction entry");
    }
    const summary = `${options.summaryPrefix}\n\n${generatedSummary.text || deterministicCompactionFallback({conversation: "No prior history.", outputBudgetTokens: resolveSummaryOutputBudget(input.model, options.reserveTokens)})}`;
    const tokensBefore = input.tokensBefore ?? estimateStoredContextTokens(input.messages).tokens;
    const entry = {
        type: "compaction",
        summary,
        firstKeptEntryId: plan.firstKeptEntry?.id ?? null,
        tokensBefore,
        details: {
            instructions: input.instructions,
            reserveTokens: options.reserveTokens,
            keepRecentTokens: options.keepRecentTokens,
            triggerPercent: options.triggerPercent,
            triggerTokens: options.triggerTokens,
            promptSource: options.promptSource,
            summaryPrefixSource: options.summaryPrefixSource,
            recentTokens: plan.metrics.recentTokens,
            summarizedTokens: plan.metrics.summarizedTokens,
            visibleTokensBefore: tokensBefore,
            firstKeptEntryType: plan.metrics.firstKeptEntryType,
            visibleEntryCountBefore: plan.metrics.visibleEntryCountBefore,
            recentEntryCount: plan.metrics.recentEntryCount,
            summarizedEntryCount: plan.metrics.summarizedEntryCount,
            summaryStrategy: generatedSummary.strategy,
            summaryInputTokens: generatedSummary.inputTokens,
            summaryInputBudgetTokens: generatedSummary.inputBudgetTokens,
            ...(generatedSummary.summaryError ? {summaryError: generatedSummary.summaryError} : {}),
            ...(input.recoveryCandidates?.length ? {recoveryCandidates: input.recoveryCandidates} : {}),
        },
    } satisfies Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">;
    input.signal?.throwIfAborted();
    await input.writeCompactionEntry(entry);
}
/**
 * 将 profile compaction plan 解析成当前模型下的执行策略。
 */
export function resolveCompactionOptions(patch: ProfileCompactionRuntimePatch, model: Model<any>): CompactionOptions {
    const plan = resolveProfileRuntimeSettings(undefined, {compaction: patch}).compaction;
    const keepRecentTokens = plan.keepRecent.kind === "percent"
        ? Math.max(1, Math.floor(model.contextWindow * plan.keepRecent.value))
        : plan.keepRecent.value;
    return {
        enabled: plan.enabled,
        reserveTokens: plan.reserveTokens,
        keepRecentTokens,
        triggerPercent: plan.trigger.kind === "percent" ? plan.trigger.value : undefined,
        triggerTokens: plan.trigger.kind === "tokens" ? plan.trigger.value : undefined,
        prompt: plan.prompt,
        summaryPrefix: plan.summaryPrefix,
        promptSource: plan.prompt === COMPACTION_PROMPT ? "default" : "profile",
        summaryPrefixSource: plan.summaryPrefix === COMPACTION_SUMMARY_PREFIX ? "default" : "profile",
    };
}

/**
 * 根据 profile/harness 策略判断是否需要自动压缩。
 */
export function shouldCompactWithOptions(contextTokens: number, contextWindow: number, options: CompactionOptions): boolean {
    if (!options.enabled) {
        return false;
    }
    if (typeof options.triggerTokens === "number") {
        return contextTokens >= options.triggerTokens;
    }
    if (typeof options.triggerPercent === "number") {
        return contextTokens / contextWindow >= options.triggerPercent;
    }
    return contextTokens > contextWindow - options.reserveTokens;
}

/**
 * 把压缩策略折算成一个绝对 token 触发线，供上下文面板展示「离压缩还有多远」。
 *
 * 必须与 `shouldCompactWithOptions` 的判定顺序一致（tokens 优先、其次 percent、
 * 最后 window - reserve），否则面板显示的线和真实触发时机会对不上。
 * 关闭压缩、或按窗口推算却拿不到窗口时返回 null。
 */
export function resolveCompactionTriggerTokens(options: CompactionOptions, contextWindow: number | null): number | null {
    if (!options.enabled) {
        return null;
    }
    if (typeof options.triggerTokens === "number") {
        return options.triggerTokens;
    }
    if (contextWindow === null) {
        return null;
    }
    if (typeof options.triggerPercent === "number") {
        return Math.floor(contextWindow * options.triggerPercent);
    }
    return contextWindow - options.reserveTokens;
}

/**
 * 已有 checkpoint 的会话若压缩并恢复上下文后仍达到触发线，继续重试只会反复消耗摘要请求。
 */
export function assertCompactionMadeProgress(input: {
    beforeTokens: number;
    afterTokens: number;
    contextWindow: number;
    options: CompactionOptions;
    hadPreviousCompaction: boolean;
}): void {
    if (!input.hadPreviousCompaction
        || !shouldCompactWithOptions(input.afterTokens, input.contextWindow, input.options)) {
        return;
    }
    const triggerTokens = resolveCompactionTriggerTokens(input.options, input.contextWindow);
    throw new Error(
        `自动压缩无进展：压缩前 ${input.beforeTokens} tokens，恢复上下文后 ${input.afterTokens} tokens，`
        + `仍达到 ${triggerTokens ?? "unknown"} token 触发线。已停止重复压缩。`,
    );
}
/**
 * 构造有界 LLM 摘要请求；摘要输入和摘要输出使用独立预算。
 *
 * 工具结果先按消息裁剪，仍超预算时保留会话头尾并在中间插入省略标记。
 * 这只修改 provider 临时输入，不改写 session 中的完整历史。
 */
async function generateCompactionSummary(input: {
    messages: StoredMessageLike[];
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    instructions?: string;
    previousSummary?: string;
    thinkingLevel?: ThinkingLevel;
    reserveTokens: number;
    prompt: string;
    trace?: PiTraceBinding;
    signal?: AbortSignal;
}): Promise<CompactionSummaryResult> {
    input.signal?.throwIfAborted();
    const outputBudgetTokens = resolveSummaryOutputBudget(input.model, input.reserveTokens);
    const inputBudgetTokens = resolveSummaryInputBudget(input.model, input.prompt, outputBudgetTokens);
    const bounded = buildBoundedSummaryPrompt({
        messages: input.messages,
        instructions: input.instructions,
        previousSummary: input.previousSummary,
        systemPrompt: input.prompt,
        inputBudgetTokens,
    });
    const requestOptions = parsePiSimpleRequestOptions(input.requestOptions);
    const completeContext = {
        systemPrompt: input.prompt,
        messages: [createUserMessage({text: bounded.prompt})],
    };
    const completeOptions = {
        ...requestOptions,
        ...piRequestAuthOptions({
            api: input.model.api,
            apiKey: input.apiKey,
            env: requestOptions.env,
        }),
        headers: mergePiRequestHeaders(input.model.headers, requestOptions.headers),
        timeoutMs: input.timeoutMs ?? undefined,
        maxTokens: Math.min(outputBudgetTokens, input.model.maxTokens),
        reasoning: input.thinkingLevel && input.thinkingLevel !== "off" ? input.thinkingLevel as never : undefined,
        signal: input.signal,
    };

    try {
        assertProviderContextWithinWindow({
            ...completeContext,
            contextWindow: input.model.contextWindow,
            modelId: input.model.id,
        });
        const response = await tracedCompleteSimple(input.models, input.model, completeContext, completeOptions, input.trace);
        input.signal?.throwIfAborted();
        if (response.stopReason === "error" || response.stopReason === "aborted") {
            throw new Error(sanitizeProviderErrorMessage(response.errorMessage || "compaction summary 生成失败"));
        }
        const text = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join("\n")
            .trim();
        return {
            text: truncateTextToTokens(text, outputBudgetTokens),
            strategy: "llm",
            inputTokens: bounded.inputTokens,
            inputBudgetTokens,
        };
    } catch (error) {
        input.signal?.throwIfAborted();
        const summaryError = sanitizeProviderErrorMessage(error instanceof Error ? error.message : String(error));
        return {
            text: deterministicCompactionFallback({
                previousSummary: input.previousSummary,
                conversation: bounded.conversation,
                outputBudgetTokens,
            }),
            strategy: "deterministic-fallback",
            inputTokens: bounded.inputTokens,
            inputBudgetTokens,
            summaryError,
        };
    }
}

function resolveSummaryOutputBudget(model: Model<any>, reserveTokens: number): number {
    const providerLimit = model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY;
    return Math.max(1, Math.min(
        providerLimit,
        Math.floor(Math.max(1, reserveTokens) * 0.8),
        Math.floor(Math.max(1, model.contextWindow) * 0.2),
    ));
}

function resolveSummaryInputBudget(model: Model<any>, systemPrompt: string, outputBudgetTokens: number): number {
    const fixedTokens = estimateProviderTextTokens(systemPrompt) + 32;
    const available = Math.max(1, model.contextWindow - fixedTokens - outputBudgetTokens);
    return Math.max(1, Math.min(
        COMPACTION_INPUT_MAX_TOKENS,
        Math.floor(model.contextWindow * COMPACTION_INPUT_BUDGET_RATIO),
        available,
    ));
}

function buildBoundedSummaryPrompt(input: {
    messages: StoredMessageLike[];
    instructions?: string;
    previousSummary?: string;
    systemPrompt: string;
    inputBudgetTokens: number;
}): {prompt: string; conversation: string; inputTokens: number} {
    const rows = input.messages.map((message) => {
        const text = message.role === "toolResult"
            ? truncateTextToChars(storedMessageText(message), COMPACTION_TOOL_RESULT_MAX_CHARS)
            : storedMessageText(message);
        return `${message.role}: ${text}`;
    });
    let conversation = rows.length > 0 ? rows.join("\n\n") : "No prior history.";
    let prompt = composeSummaryPrompt(conversation, input.instructions, input.previousSummary);
    let inputTokens = estimateSummaryRequestTokens(input.systemPrompt, prompt);
    for (let attempt = 0; inputTokens > input.inputBudgetTokens && attempt < 12; attempt += 1) {
        const targetChars = Math.max(1, Math.floor(conversation.length * 0.65));
        const nextConversation = truncateTextToChars(conversation, targetChars);
        if (nextConversation === conversation) {
            break;
        }
        conversation = nextConversation;
        prompt = composeSummaryPrompt(conversation, input.instructions, input.previousSummary);
        inputTokens = estimateSummaryRequestTokens(input.systemPrompt, prompt);
    }
    if (inputTokens > input.inputBudgetTokens) {
        const availablePromptChars = Math.max(1, input.inputBudgetTokens * 4);
        prompt = truncateTextToChars(prompt, availablePromptChars);
        inputTokens = estimateSummaryRequestTokens(input.systemPrompt, prompt);
        while (inputTokens > input.inputBudgetTokens && prompt.length > 1) {
            prompt = truncateTextToChars(prompt, Math.max(1, Math.floor(prompt.length * 0.8)));
            inputTokens = estimateSummaryRequestTokens(input.systemPrompt, prompt);
        }
    }
    return {prompt, conversation, inputTokens};
}

function composeSummaryPrompt(conversation: string, instructions?: string, previousSummary?: string): string {
    return [
        "Summarize the following conversation history for a future LLM resume point.",
        instructions ? `Additional instructions:\n${instructions}` : "",
        previousSummary ? `<previous-summary>\n${previousSummary}\n</previous-summary>` : "",
        `<conversation>\n${conversation}\n</conversation>`,
    ].filter(Boolean).join("\n\n");
}

function estimateSummaryRequestTokens(systemPrompt: string, prompt: string): number {
    return estimateProviderTextTokens(systemPrompt) + estimateStoredContextTokens([createUserMessage({text: prompt})]).tokens;
}

function deterministicCompactionFallback(input: {previousSummary?: string; conversation: string; outputBudgetTokens: number}): string {
    const text = [
        "Deterministic context checkpoint: the summary provider failed; preserve this bounded history and continue from the retained messages.",
        input.previousSummary ? `Previous checkpoint:\n${input.previousSummary}` : "",
        `Bounded history:\n${input.conversation}`,
    ].filter(Boolean).join("\n\n");
    return truncateTextToTokens(text, input.outputBudgetTokens);
}

function truncateTextToTokens(text: string, tokens: number): string {
    return truncateTextToChars(text, Math.max(1, tokens * 4));
}

function truncateTextToChars(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    if (maxChars <= 32) {
        return text.slice(0, maxChars);
    }
    const marker = COMPACTION_TEXT_TRUNCATION_MARKER;
    const available = Math.max(0, maxChars - marker.length);
    const front = Math.ceil(available / 2);
    const back = Math.floor(available / 2);
    return `${text.slice(0, front)}${marker}${back > 0 ? text.slice(-back) : ""}`;
}

/**
 * 选择压缩边界，并保证保留下来的历史不会从 toolResult 半截开始。
 */
function selectCompactionPlan(path: SessionEntry[], options: CompactionOptions): CompactionPlan {
    const visibleEntries = path.filter(isModelVisibleEntry);
    if (visibleEntries.length === 0) {
        return {
            firstKeptEntry: null,
            messagesToSummarize: [],
            metrics: {
                recentTokens: 0,
                summarizedTokens: 0,
                visibleEntryCountBefore: 0,
                recentEntryCount: 0,
                summarizedEntryCount: 0,
            },
        };
    }

    const previousCompaction = [...path].reverse().find((entry) => entry.type === "compaction");
    const previousFirstKeptIndex = previousCompaction?.type === "compaction" && previousCompaction.firstKeptEntryId
        ? path.findIndex((entry) => entry.id === previousCompaction.firstKeptEntryId)
        : -1;
    const boundaryStart = previousFirstKeptIndex >= 0
        ? previousFirstKeptIndex
        : previousCompaction
            ? path.findIndex((entry) => entry.id === previousCompaction.id) + 1
            : 0;

    let tokens = 0;
    let selectedPathIndex = -1;
    for (let index = path.length - 1; index >= boundaryStart; index -= 1) {
        const entry = path[index];
        if (!entry || !isModelVisibleEntry(entry)) {
            continue;
        }
        tokens += estimateStoredMessageTokens(entryMessage(entry));
        selectedPathIndex = index;
        if (tokens >= options.keepRecentTokens) {
            break;
        }
    }

    if (selectedPathIndex < 0) {
        const summarizableMessages = path
            .slice(boundaryStart)
            .filter((entry): entry is MessageSessionEntry => entry.type === "message")
            .map((entry) => entry.message);
        return {
            firstKeptEntry: null,
            messagesToSummarize: summarizableMessages,
            previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
            metrics: {
                recentTokens: 0,
                summarizedTokens: sumMessageTokens(summarizableMessages),
                visibleEntryCountBefore: countVisibleEntries(path.slice(boundaryStart)),
                recentEntryCount: 0,
                summarizedEntryCount: summarizableMessages.length,
            },
        };
    }

    selectedPathIndex = moveCutBeforeToolResult(path, selectedPathIndex, boundaryStart);
    const selectedEntry = path[selectedPathIndex];
    const firstKeptEntry = selectedEntry && isModelVisibleEntry(selectedEntry) ? selectedEntry : null;
    const messagesToSummarize = path
        .slice(boundaryStart, selectedPathIndex)
        .filter((entry): entry is MessageSessionEntry => entry.type === "message")
        .map((entry) => entry.message);
    const recentEntries = path.slice(selectedPathIndex).filter(isModelVisibleEntry);

    return {
        firstKeptEntry,
        messagesToSummarize,
        previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
        metrics: {
            recentTokens: sumVisibleEntryTokens(path.slice(selectedPathIndex)),
            summarizedTokens: sumMessageTokens(messagesToSummarize),
            firstKeptEntryType: firstKeptEntry?.type,
            visibleEntryCountBefore: countVisibleEntries(path.slice(boundaryStart)),
            recentEntryCount: recentEntries.length,
            summarizedEntryCount: messagesToSummarize.length,
        },
    };
}

/**
 * 如果保留区从 toolResult 开始，把 cut point 前移到对应 assistant toolCall。
 */
function moveCutBeforeToolResult(path: SessionEntry[], selectedPathIndex: number, boundaryStart: number): number {
    const selected = path[selectedPathIndex];
    if (!selected || !isModelVisibleEntry(selected)) {
        return selectedPathIndex;
    }
    const toolResult = entryMessage(selected);
    if (!isToolResultMessage(toolResult)) {
        return selectedPathIndex;
    }

    for (let index = selectedPathIndex - 1; index >= boundaryStart; index -= 1) {
        const entry = path[index];
        if (!entry || !isModelVisibleEntry(entry)) {
            continue;
        }
        const message = entryMessage(entry);
        if (!isAssistantMessage(message)) {
            continue;
        }
        const hasMatchingToolCall = message.content.some((block) => {
            return block.type === "toolCall" && block.id === toolResult.toolCallId;
        });
        if (hasMatchingToolCall) {
            return index;
        }
    }
    return selectedPathIndex;
}

/**
 * 未完成 tool call 会破坏 continue/approval 恢复语义，压缩前必须拒绝。
 */
function assertNoPendingToolCall(messages: StoredMessageLike[]): void {
    const completedToolCallIds = new Set(messages
        .filter(isToolResultMessage)
        .map((message) => message.toolCallId));
    const pendingToolCall = messages
        .filter(isAssistantMessage)
        .flatMap((message) => message.content.filter((block) => block.type === "toolCall"))
        .find((toolCall) => !completedToolCallIds.has(toolCall.id));
    if (pendingToolCall) {
        throw new Error(`当前 session 存在未完成 tool call，无法压缩：${pendingToolCall.name}`);
    }
}

function isModelVisibleEntry(entry: SessionEntry): entry is ModelVisibleSessionEntry {
    return entry.type === "message" || (entry.type === "custom_message" && entry.visibleToModel);
}

function entryMessage(entry: ModelVisibleSessionEntry): StoredMessageLike {
    return entry.message as AgentMessage | StoredAgentMessage;
}

function isAssistantMessage(message: StoredMessageLike): message is AssistantMessage {
    return message.role === "assistant";
}

function isToolResultMessage(message: StoredMessageLike): message is ToolResultMessage | StoredToolResultMessage {
    return message.role === "toolResult";
}

function countVisibleEntries(entries: SessionEntry[]): number {
    return entries.filter(isModelVisibleEntry).length;
}

function sumVisibleEntryTokens(entries: SessionEntry[]): number {
    return entries.reduce((total, entry) => {
        return isModelVisibleEntry(entry) ? total + estimateStoredMessageTokens(entryMessage(entry)) : total;
    }, 0);
}

function sumMessageTokens(messages: StoredMessageLike[]): number {
    return messages.reduce((total, message) => total + estimateStoredMessageTokens(message), 0);
}
