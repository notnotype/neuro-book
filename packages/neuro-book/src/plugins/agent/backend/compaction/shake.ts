/**
 * shake（docs/specs/agent/compaction.md 输出 1）：不调模型，把保留窗口之外能找回的工具结果换成占位。所有轮和上一次的摘要都留着。
 */

import {estimateImageTokens, estimateTokens} from "@notnotype/nb-harness/kernel";
import type {CompactionMethodImpl, Message, ToolCall} from "@notnotype/nb-harness/kernel/contracts";

import {KEEP_TOKENS} from "./cuts";

/** 省下的不到压缩前的这个比例算失败：省得太少很快又会触发。 */
const MIN_SAVING = 0.2;
/** 太小的结果换成占位省不了什么。 */
const WORTH_OMITTING_TOKENS = 100;
/** `shell` 只省输出长的：短输出换占位，模型要重跑一遍才知道结果，不值。 */
const LONG_SHELL_TOKENS = 1_000;

/** 工具结果的占位：写明怎么找回。没有办法找回的工具不省。 */
function placeholderFor(call: ToolCall, tokens: number): string | null {
    const path = typeof call.args.path === "string" ? call.args.path : "";
    switch (call.tool) {
        case "nbook.agent.read":
            return `（内容已省略，重新 read ${path} 可以取回）`;
        case "nbook.agent.grep":
        case "nbook.agent.glob":
            return "（搜索结果已省略，需要时重新搜索）";
        case "nbook.agent.shell":
            return tokens >= LONG_SHELL_TOKENS ? "（输出已省略，需要时重新运行）" : null;
        default:
            return null;
    }
}

const messageTokens = (message: Message): number => message.content.reduce((sum, block) => sum + (block.kind === "image" ? estimateImageTokens(block) : estimateTokens(block.text)), 0)
    + estimateTokens(JSON.stringify(message.toolCalls ?? []));

export const shakeMethod: CompactionMethodImpl = async (job) => {
    const {messages} = job.request;
    const calls = new Map(messages.flatMap((message) => (message.toolCalls ?? []).map((call) => [call.id, call] as const)));
    // 从末尾往前算保留窗口，窗口里的留原文。
    let kept = 0;
    let boundary = messages.length;
    while (boundary > 0 && kept + messageTokens(messages[boundary - 1]!) <= KEEP_TOKENS) {
        boundary -= 1;
        kept += messageTokens(messages[boundary]!);
    }
    const omitted: {entryId: string; placeholder: string}[] = [];
    let saved = 0;
    let images = 0;
    for (const message of messages.slice(0, boundary)) {
        if (message.role !== "tool" || message.callId === undefined) continue;
        const call = calls.get(message.callId);
        if (call === undefined) continue;
        const tokens = messageTokens(message);
        if (tokens < WORTH_OMITTING_TOKENS) continue;
        const origin = message.content.find((block) => block.origin.kind === "event")?.origin;
        if (origin?.kind !== "event") continue;
        const placeholder = placeholderFor(call, tokens);
        if (placeholder === null) continue;
        omitted.push({entryId: origin.eventId, placeholder});
        saved += tokens - estimateTokens(placeholder);
        if (message.content.some((block) => block.kind === "image")) images += 1;
    }
    // 溢出时问题常是字节太大（413），图的估算又很小：省掉了图就够，不按比例。省得少会很快再触发，所以平时仍然按比例。
    const enough = saved >= job.tokens * MIN_SAVING || (job.reason === "overflow" && images > 0);
    if (!enough || omitted.length === 0) return {failed: "saves-too-little"};
    // 切点取第一个：什么轮都不去掉，只换占位。
    return {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: null, omitted, tokensBefore: job.tokens, tokensAfter: job.tokens - saved, details: {require: [...job.require]}};
};
