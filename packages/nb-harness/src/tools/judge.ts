/**
 * 审批模型（docs/specs/harness/tools.md 输出 7）：一次不带工具的模型调用，严格解析一行 JSON。
 * 任何失败路径都是 escalate：审批模型出问题不能变成放行。
 */

import {streamSimple} from "@oh-my-pi/pi-ai";
import type {Message} from "@oh-my-pi/pi-ai";
import type {JsonValue, JudgeRequest, Judgement, Model, StreamFn} from "./types";

const ARGS_LIMIT = 4 * 1024;
const RECENT_LIMIT = 1024;
const RECENT_COUNT = 6;
const encoder = new TextEncoder();

function truncateUtf8(text: string, budget: number): string {
    let bytes = 0;
    let end = 0;
    for (const char of text) {
        const size = encoder.encode(char).length;
        if (bytes + size > budget) return `${text.slice(0, end)}…`;
        bytes += size;
        end += char.length;
    }
    return text;
}

/** 参数里任意深度的字符串各自截到上限，整体再截一次。 */
function describeArgs(args: JsonValue): string {
    const trimmed = (value: JsonValue): JsonValue => {
        if (typeof value === "string") return truncateUtf8(value, ARGS_LIMIT);
        if (Array.isArray(value)) return value.map(trimmed);
        if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimmed(item)]));
        return value;
    };
    return truncateUtf8(JSON.stringify(trimmed(args)), ARGS_LIMIT);
}

function describeRecent(recent: readonly Message[]): string {
    return recent
        .slice(-RECENT_COUNT)
        .map((message) => {
            const text = typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : `[${block.type}]`)).join("");
            return `${message.role}: ${truncateUtf8(text, RECENT_LIMIT)}`;
        })
        .join("\n");
}

export const JUDGE_SYSTEM_PROMPT =
    "你是写作助手的工具调用审批员。给你一次工具调用的信息，判断它是否应该执行。" +
    '只输出一行 JSON：{"decision": "allow" | "deny" | "escalate", "reason": "一句话"}。' +
    "拿不准就 escalate（交给用户）。不要输出别的内容。";

export function buildJudgeMessages(request: JudgeRequest): {systemPrompt: string[]; messages: Message[]} {
    const lines = [
        `工具：${request.tool.id}`,
        `说明：${request.tool.description}`,
        `等级：${request.tier}`,
        ...(request.reason === undefined ? [] : [`工具给出的理由：${request.reason}`]),
        `参数：${describeArgs(request.args)}`,
        `Profile：${request.profile.id}（${request.profile.name}）`,
        "最近的对话：",
        describeRecent(request.recent),
    ];
    return {systemPrompt: [JUDGE_SYSTEM_PROMPT], messages: [{role: "user", content: lines.join("\n"), timestamp: 0}]};
}

function parseJudgement(text: string): Judgement | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    for (let end = text.indexOf("}", start); end !== -1; end = text.indexOf("}", end + 1)) {
        try {
            const parsed: unknown = JSON.parse(text.slice(start, end + 1));
            if (typeof parsed !== "object" || parsed === null) continue;
            const {decision, reason} = parsed as {decision?: unknown; reason?: unknown};
            if (decision !== "allow" && decision !== "deny" && decision !== "escalate") return null;
            return {decision, reason: typeof reason === "string" ? reason : ""};
        } catch {
            // 第一个 } 可能在字符串里，继续找下一个。
        }
    }
    return null;
}

export async function judgeWithModel(input: {model: Model; apiKey?: string; request: JudgeRequest; stream?: StreamFn; signal?: AbortSignal; timeoutMs?: number}): Promise<Judgement> {
    const escalate = (reason: string): Judgement => ({decision: "escalate", reason});
    if (input.signal?.aborted) return escalate("aborted");
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    input.signal?.addEventListener("abort", abort, {once: true});
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
    try {
        const {systemPrompt, messages} = buildJudgeMessages(input.request);
        const stream = await (input.stream ?? streamSimple)(input.model, {systemPrompt, messages}, {...(input.apiKey === undefined ? {} : {apiKey: input.apiKey}), signal: controller.signal, maxTokens: 200});
        const reply = await stream.result();
        if (reply.stopReason === "error" || reply.stopReason === "aborted") return escalate(input.signal?.aborted ? "aborted" : controller.signal.aborted ? "timeout" : `request-failed: ${reply.errorMessage ?? reply.stopReason}`);
        const text = reply.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        return parseJudgement(text) ?? escalate("invalid-output");
    } catch (error) {
        if (input.signal?.aborted) return escalate("aborted");
        if (controller.signal.aborted) return escalate("timeout");
        return escalate(`request-failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
    }
}
