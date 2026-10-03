import {createHash} from "node:crypto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {SessionEntry, SessionSnapshot} from "nbook/server/agent/session/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {messageText} from "nbook/server/agent/messages/message-utils";

export const AGENT_DIALOGUE_CONTENT_RENDERER_VERSION = 1;

export type AgentDialogueContent = {
    text: string;
    tokens: number;
    fingerprint: string;
    entryIds: string[];
};

/**
 * 从当前 active path 构造用于 session 展示摘要的可见正文。
 */
export function buildAgentDialogueContent(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    summarizerProfileKey: string;
    summarizerInput: JsonValue;
}): AgentDialogueContent {
    const lines: string[] = [];
    const entryIds: string[] = [];
    for (const entry of input.repo.activePath(input.snapshot)) {
        const rendered = renderDialogueEntry(entry);
        if (!rendered) {
            continue;
        }
        entryIds.push(entry.id);
        lines.push(rendered);
    }

    const text = lines.join("\n\n");
    const tokens = estimateDialogueContentTokens(text);
    const fingerprintPayload = {
        rendererVersion: AGENT_DIALOGUE_CONTENT_RENDERER_VERSION,
        entryIds,
        textHash: hashText(text),
        summarizerProfileKey: input.summarizerProfileKey,
        summarizerInputHash: hashText(stableJsonStringify(input.summarizerInput)),
    };
    return {
        text,
        tokens,
        fingerprint: hashText(stableJsonStringify(fingerprintPayload)),
        entryIds,
    };
}

/**
 * 粗略 token 估算，和 harness 现有 estimateTextTokens 保持同一量级。
 */
export function estimateDialogueContentTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function renderDialogueEntry(entry: SessionEntry): string | null {
    if (entry.type === "compaction") {
        const summary = entry.summary.trim();
        return summary ? `[compaction ${entry.id}]\n${summary}` : null;
    }
    if (entry.type !== "message") {
        return null;
    }
    if (entry.message.role !== "user" && entry.message.role !== "assistant") {
        return null;
    }
    const text = (entry.message.role === "user"
        ? messageText(entry.message, {stripThinking: true})
        : entry.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"))
        .trim();
    if (!text) {
        return null;
    }
    return `[${entry.message.role} ${entry.id}]\n${text}`;
}

function hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function stableJsonStringify(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`).join(",")}}`;
}
