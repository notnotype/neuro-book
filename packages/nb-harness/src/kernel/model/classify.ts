/**
 * 服务商报错的归类：按状态码与 OMP 的错误标记，不看错误文字（搬自 master `run-result.ts` 的 `classifyProviderError`）。
 * 余额与配额用尽在 OMP 里是 `UsageLimit` 标记（可能带 402、403 或 429），排在最前：网关常以 403 回余额不足，
 * OMP 同时打上 `AuthFailed`，按认证归类会让人去查密钥。没有状态码不等于网络故障：只有网关类状态码、超时标记，
 * 或没有状态码而带瞬时故障标记时才归 `network`，证据不够时归 `provider`。
 */

import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import {Flag} from "@oh-my-pi/pi-ai/error/flags";
import type {ModelErrorKind} from "../api/index.js";

const NETWORK_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);

export function classifyProviderError(message: Pick<AssistantMessage, "errorStatus" | "errorId">): {kind: ModelErrorKind; status: number | null} {
    const status = typeof message.errorStatus === "number" ? message.errorStatus : null;
    const flags = typeof message.errorId === "number" ? message.errorId : 0;
    const has = (flag: number): boolean => (flags & flag) !== 0;
    let kind: ModelErrorKind;
    if (has(Flag.UsageLimit) || status === 402) kind = "quota";
    else if (has(Flag.AuthFailed) || status === 401 || status === 403) kind = "auth";
    else if (status === 429) kind = "rate_limit";
    else if (has(Flag.ContextOverflow)) kind = "context_overflow";
    else if (has(Flag.ContentBlocked) || has(Flag.ProviderFinishError)) kind = "provider";
    else if ((status !== null && NETWORK_STATUSES.has(status)) || has(Flag.Timeout) || (status === null && has(Flag.Transient))) kind = "network";
    else kind = "provider";
    return {kind, status};
}
