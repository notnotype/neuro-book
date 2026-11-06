/**
 * 摘要模型（docs/specs/agent/compaction.md 输出 3）：把对话序列化成文字，交“压缩”角色的模型。放不下时分段，后一段带前一段的摘要。
 * 预算来自 `job.modelInfo`，和发请求同一次解析的规则：会话的模型可能比压缩的模型窗口大得多。
 */

import {estimateTokens} from "@notnotype/nb-harness/kernel";
import type {CompactionMethodImpl, Message, Usage} from "@notnotype/nb-harness/kernel/contracts";

import {keptMessageIndex, pickCut, summaryResult} from "./cuts";
import {summaryInput, summarySystem} from "./prompts";
import {modelFailure, outputLimit, responseText, sumUsage} from "./replies";

/** 提示词与估算误差的余量：估算只是每 3 字节一个 token。 */
const MARGIN_TOKENS = 2_000;

/** 只摘对话本身：开场、规则文件、扩展的槽每次请求都会重新渲染，摘要它们是白占预算。 */
const isConversation = (block: Message["content"][number]): boolean => block.origin.kind === "event" || block.origin.kind === "summary";

function messageText(message: Message): string {
    const parts = message.content.filter(isConversation).flatMap((block) => {
        if (block.kind === "text") return [block.text];
        // 思考不进摘要；图片的 base64 不当文字，只留尺寸。
        if (block.kind === "imageRef" || block.kind === "image") return [`[图片${block.width === undefined || block.height === undefined ? "" : ` ${String(block.width)}×${String(block.height)}`}]`];
        return [];
    });
    for (const call of message.toolCalls ?? []) parts.push(`[调用 ${call.tool}] ${JSON.stringify(call.args)}`);
    const role = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : `工具结果${message.isError === true ? "（失败）" : ""}`;
    return `【${role}】\n${parts.join("\n")}`;
}

/** 把一段文字切成每块不超过预算：按估算的口径（UTF-8 字节 / 3）切，不切开代理对。 */
function splitText(text: string, budgetTokens: number): string[] {
    const limit = budgetTokens * 3;
    const pieces: string[] = [];
    let start = 0;
    let bytes = 0;
    let index = 0;
    for (const char of text) {
        const size = Buffer.byteLength(char, "utf8");
        if (bytes + size > limit && index > start) {
            pieces.push(text.slice(start, index));
            start = index;
            bytes = 0;
        }
        bytes += size;
        index += char.length;
    }
    if (index > start) pieces.push(text.slice(start, index));
    return pieces;
}

/** 按预算分段：尽量整条放在一段里，单条放不下才切。 */
export function segmentsOf(messages: readonly Message[], budgetTokens: number): string[] {
    const segments: string[] = [];
    let current: string[] = [];
    let tokens = 0;
    const flush = (): void => {
        if (current.length > 0) segments.push(current.join("\n\n"));
        current = [];
        tokens = 0;
    };
    for (const message of messages) {
        if (!message.content.some(isConversation) && (message.toolCalls ?? []).length === 0) continue;
        const text = messageText(message);
        const size = estimateTokens(text);
        if (budgetTokens > 0 && size > budgetTokens) {
            flush();
            segments.push(...splitText(text, budgetTokens));
            continue;
        }
        if (budgetTokens > 0 && tokens + size > budgetTokens) flush();
        current.push(text);
        tokens += size;
    }
    flush();
    return segments;
}

export const summaryMethod: CompactionMethodImpl = async (job) => {
    const info = job.modelInfo({role: "compaction"});
    if (info === null) return {failed: "no-compaction-model"};
    const output = outputLimit(info);
    // 窗口未知（0）时不分段。后一段还要带前一段的摘要，所以再扣一份输出。
    const budget = info.contextWindow > 0 ? info.contextWindow - output * 2 - MARGIN_TOKENS : 0;
    if (info.contextWindow > 0 && budget <= 0) return {failed: "window-too-small"};
    const picked = pickCut(job.cuts, job.modelInfo({sessionModel: true})?.contextWindow ?? 0);
    const kept = keptMessageIndex(job.request.messages, picked);
    // 定位不到保留部分：整段换成摘要，不留尾巴，免得尾巴既进摘要又原样留下。
    const cut = kept === null ? null : picked;
    const segments = segmentsOf(job.request.messages.slice(0, kept ?? job.request.messages.length), budget);
    if (segments.length === 0) return {failed: "nothing-to-summarize"};
    let summary: string | null = null;
    const usages: Usage[] = [];
    let model = "";
    for (const segment of segments) {
        const response = await job.model({
            params: {maxTokens: output},
            headers: {},
            system: [{kind: "text", text: summarySystem(job.require), origin: {kind: "fixed", by: "kernel"}}],
            messages: [{role: "user", content: [{kind: "text", text: summaryInput(segment, summary), origin: {kind: "fixed", by: "kernel"}}]}],
            tools: [],
        }, {purpose: "compaction", role: "compaction"});
        const failure = modelFailure(response);
        if (failure !== null) return {failed: failure};
        summary = responseText(response);
        usages.push(response.usage);
        model = response.model;
    }
    return {method: job.method, ...summaryResult(job, cut, estimateTokens(summary ?? "")), replacement: summary, omitted: [], details: {model, usage: sumUsage(usages), require: [...job.require]}};
};
