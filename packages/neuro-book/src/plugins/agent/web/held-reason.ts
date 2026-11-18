/**
 * 排队区里一条留着的话的原因（docs/specs/agent/conversation.md 输出 48）：按 `cause` 与 `heldBy` 取文案；带码时写运行没开起来、码的说明
 * 取下面的表，不认识的码照写码本身。`t` 把文字引用翻成当前语言（码的说明要先翻好，再作参数放进外层那句）。
 */

import type {KernelQueued} from "@notnotype/nb-agent-ui";
import type {TextRef} from "@notnotype/nb-ui/text";

import {agentText} from "../shared/text";

/**
 * 留着的原因里带的码：运行没开起来的原因（harness/runtime.md 输出 104，解析时抛错是 `internal`），与异步回答在别人的暂停运行上
 * 留着时的 `not-allowed`（输出 36）。
 */
const CODE_KEYS = {
    "no-model": "conversation.held.codes.no-model",
    "no-credentials": "conversation.held.codes.no-credentials",
    "unknown-model": "conversation.held.codes.unknown-model",
    "role-unbound": "conversation.held.codes.role-unbound",
    "profile-invalid": "conversation.held.codes.profile-invalid",
    "read-only": "conversation.held.codes.read-only",
    "session-closing": "conversation.held.codes.session-closing",
    "reassembly-pending": "conversation.held.codes.reassembly-pending",
    "log-broken": "conversation.held.codes.log-broken",
    "not-allowed": "conversation.held.codes.not-allowed",
    internal: "conversation.held.codes.internal",
} as const;

export function heldReason(item: Pick<KernelQueued, "cause" | "heldBy">, t: (ref: TextRef) => string): string {
    const cause = item.cause;
    if (cause === undefined) return t(agentText("conversation.held.unknown"));
    if (cause.code !== undefined) {
        const key = CODE_KEYS[cause.code as keyof typeof CODE_KEYS];
        return t(agentText("conversation.held.notStarted", {reason: key === undefined ? cause.code : t(agentText(key))}));
    }
    if ("queued" in cause) return t(agentText("conversation.held.idle"));
    switch (cause.end) {
        case "completed": return t(agentText("conversation.held.completed"));
        case "finished": return t(agentText("conversation.held.finished"));
        case "error": return t(agentText("conversation.held.error"));
        case "interrupted": return t(agentText("conversation.held.interrupted"));
        case "aborted":
            if (item.heldBy?.kind === "session") return t(agentText("conversation.held.stoppedByAgent"));
            if (item.heldBy?.kind === "host") return t(agentText("conversation.held.stoppedByHost", {name: item.heldBy.source.label}));
            return t(agentText("conversation.held.stoppedByYou"));
        default: return t(agentText("conversation.held.unknown"));
    }
}
