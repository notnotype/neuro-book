/**
 * 推理档：模型能做什么（`reasoningOf`）；一次请求实际用哪一档见 `api/reasoning.ts` 的 `requestEffort`。
 * 行为规则见 docs/specs/models/service.md 的“角色的思考档”与 docs/specs/harness/models.md。
 *
 * “能不能关”不能由 OMP 的 `requiresEffort`、`suppressWhenOff` 单独推出，要看各协议发 `disableReasoning` 时线上实际是什么：
 * OpenAI 系按 `reasoningDisableMode`（`lowest-effort` 是最低一档，`omit` 是什么都不发）；Anthropic 的自适应模型不接受
 * `thinking: disabled`，OMP 发最低档的 `effort` 或 `between_tools`；Gemini 的“分档、不抑制”模型只关掉思考内容的回传。
 * `off` 把这些事实合成一个值：只有 `disable` 才有单独的“关闭”选项；`lowest` 的最低档本来就在 `levels` 里。
 * 实收的请求体见 `reasoning.test.ts`；OMP 升级后协议的分支可能变，该测试是第一道报警。
 */

import {defaultSupportedEffort, getSupportedEfforts, type Model} from "@oh-my-pi/pi-catalog";
import type {ModelReasoning, ReasoningOff} from "../api/model.js";

export function reasoningOf(model: Model): ModelReasoning {
    if (!model.reasoning) return {kind: "none"};
    // 路由不发推理参数（OpenAI 兼容端点的 `supportsReasoningParams: false`）：选什么线上都一样，不能让用户以为调了档。
    if ((model.compat as {supportsReasoningParams?: boolean} | undefined)?.supportsReasoningParams === false) return {kind: "fixed"};
    const levels = [...getSupportedEfforts(model)] as string[];
    if (model.thinking === undefined || levels.length === 0) return {kind: "fixed"};
    const off = offOf(model);
    return {kind: "levels", levels, off, unset: unsetOf(model, off), verified: model.thinking.unverified !== true};
}

type Compat = {
    reasoningDisableMode?: string;
    supportsBetweenToolsThinking?: boolean;
    disableAdaptiveThinking?: boolean;
};

/** 这几种关闭方式的协议在没有请求档位时本来就是关着的（pi-ai 的 `isImplicitDisableWhenNotRequested`）。 */
const IMPLICIT_OFF_MODES = new Set(["zai-thinking-disabled", "qwen-enable-thinking-false", "qwen-template-false", "chat-template-thinking-false"]);

/**
 * Anthropic 的自适应模型（pi-ai 的 `isAdaptiveOnlyThinking`）不接受 `thinking: disabled`：关闭时 OMP 只发最低档的 `effort`，
 * Sonnet 5.5 发 `between_tools`（最低的思考设置）。所有档都映射到 `adaptive` 的（MiniMax）走真正的关闭。
 */
function anthropicCannotDisable(model: Model, compat: Compat): boolean {
    if (compat.supportsBetweenToolsThinking === true) return true;
    const thinking = model.thinking;
    if (thinking?.mode !== "anthropic-adaptive" || compat.disableAdaptiveThinking === true) return false;
    const map = thinking.effortMap as Record<string, string> | undefined;
    const tagOnly = map !== undefined && thinking.efforts.length > 0 && thinking.efforts.every((effort) => map[effort] === "adaptive");
    return !tagOnly;
}

function offOf(model: Model): ReasoningOff {
    const thinking = model.thinking;
    if (thinking?.requiresEffort === true && thinking.suppressWhenOff !== true) return "none";
    const compat = (model.compat ?? {}) as Compat;
    if (model.api === "anthropic-messages") return anthropicCannotDisable(model, compat) ? "lowest" : "disable";
    // `google-level` 且不抑制的模型，OMP 只关掉思考内容的回传，思考本身照旧；`budget` 与抑制的发预算 0 或最低级别。
    if (model.api === "google-generative-ai" || model.api === "google-vertex" || model.api === "google-gemini-cli") {
        return thinking?.mode === "google-level" && thinking.suppressWhenOff !== true ? "lowest" : "disable";
    }
    // 只有 OpenAI 系传输带这个策略字段；别的协议没有它，关闭就是真的关。`omit` 什么都不发，不是关闭。
    return compat.reasoningDisableMode === "lowest-effort" || compat.reasoningDisableMode === "omit" ? "lowest" : "disable";
}

function unsetOf(model: Model, off: ReasoningOff): string | null {
    if (off === "none") return defaultSupportedEffort(model) ?? null;
    // Anthropic 与 Gemini 在没有请求档位时按“关闭”发（pi-ai 的 `stream.ts`），关闭是真的关才算“默认关”。
    if (off === "disable" && (model.api === "anthropic-messages" || model.api.startsWith("google-"))) return "off";
    const mode = (model.compat as Compat | undefined)?.reasoningDisableMode;
    return mode !== undefined && IMPLICIT_OFF_MODES.has(mode) ? "off" : null;
}
