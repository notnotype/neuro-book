/**
 * 推理档：模型能做什么（`reasoningOf`）；一次请求实际用哪一档见 `api/reasoning.ts` 的 `requestEffort`。
 * 行为规则见 docs/specs/models/service.md 的“角色的思考档”与 docs/specs/harness/models.md。
 *
 * “能不能关”不能由 OMP 的 `requiresEffort`、`suppressWhenOff` 单独推出：协议策略 `reasoningDisableMode`
 * 为 `lowest-effort` 的模型（例如 `openai/gpt-5.4`）发 `disableReasoning` 时，线上实际是最低一档，不是关闭。
 * `off` 把这几个事实合成一个值：只有 `disable` 才有单独的“关闭”选项；`lowest` 的最低档本来就在 `levels` 里。
 */

import {defaultSupportedEffort, getSupportedEfforts, type Model} from "@oh-my-pi/pi-catalog";
import type {ModelReasoning, ReasoningOff} from "../api/model.js";

export function reasoningOf(model: Model): ModelReasoning {
    if (!model.reasoning) return {kind: "none"};
    const levels = [...getSupportedEfforts(model)] as string[];
    if (model.thinking === undefined || levels.length === 0) return {kind: "fixed"};
    const off = offOf(model);
    return {kind: "levels", levels, off, unset: unsetOf(model, off), verified: model.thinking.unverified !== true};
}

/** 这几种关闭方式的协议在没有请求档位时本来就是关着的（pi-ai 的 `isImplicitDisableWhenNotRequested`）。 */
const IMPLICIT_OFF_MODES = new Set(["zai-thinking-disabled", "qwen-enable-thinking-false", "qwen-template-false", "chat-template-thinking-false"]);

function unsetOf(model: Model, off: ReasoningOff): string | null {
    if (off === "none") return defaultSupportedEffort(model) ?? null;
    const mode = (model.compat as {reasoningDisableMode?: string} | undefined)?.reasoningDisableMode;
    return mode !== undefined && IMPLICIT_OFF_MODES.has(mode) ? "off" : null;
}

function offOf(model: Model): ReasoningOff {
    const thinking = model.thinking;
    if (thinking?.requiresEffort === true && thinking.suppressWhenOff !== true) return "none";
    // 只有 OpenAI 系传输带这个策略字段；别的协议没有它，关闭就是真的关。
    const mode = (model.compat as {reasoningDisableMode?: string} | undefined)?.reasoningDisableMode;
    return mode === "lowest-effort" ? "lowest" : "disable";
}
