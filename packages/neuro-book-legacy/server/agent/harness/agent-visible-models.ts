import type {AgentVisibleModelConfig, EffectiveConfig} from "nbook/server/config/types";
import {resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {appLogger} from "nbook/server/app-logs/logger";

/** 归一化后的可见模型条目（modelKey 已验证可解析） */
export type AgentVisibleModel = {
    modelKey: string;
    note: string;
};

/** 相同失效条目在进程内只告警一次，避免每轮 prompt prepare 重复刷日志。 */
const warnedInvalidEntries = new Set<string>();
const MAX_WARNED_INVALID_ENTRIES = 200;

/** 使用正式 Pi model resolver 校验 key；返回 null 表示可解析，否则返回可记录的失败原因。 */
function modelResolutionError(config: Pick<EffectiveConfig, "agent" | "models">, modelKey: string): string | null {
    try {
        resolvePiModelFromConfig(config, "leader.default", {modelKey});
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * agent 可见模型清单的唯一真相源（Task 111）。
 *
 * - 配置了 `agent.visibleModels`：过滤掉当前解析不了（provider/model 不存在或未启用）的条目；
 * - 未配置或全部失效：兜底为单条默认模型（models.defaultModelKey）；连默认都没有则返回空表。
 *
 * `run_workflow` 的 model 校验与 leader prompt 的清单渲染都必须消费这里，勿各自兜底。
 */
export function resolveAgentVisibleModels(config: Pick<EffectiveConfig, "agent" | "models">): AgentVisibleModel[] {
    const configured: AgentVisibleModelConfig[] = config.agent.visibleModels ?? [];
    const valid = configured.filter((entry) => {
        const error = modelResolutionError(config, entry.modelKey);
        if (!error) {
            return true;
        }
        const warningFingerprint = `${entry.modelKey}\u0000${error}`;
        if (!warnedInvalidEntries.has(warningFingerprint)) {
            if (warnedInvalidEntries.size >= MAX_WARNED_INVALID_ENTRIES) {
                const oldest = warnedInvalidEntries.values().next().value;
                if (oldest) {
                    warnedInvalidEntries.delete(oldest);
                }
            }
            warnedInvalidEntries.add(warningFingerprint);
            void appLogger.warn("agent.visibleModels.invalid", {modelKey: entry.modelKey, error}, "Agent 可见模型条目不可用，已忽略");
        }
        return false;
    });
    if (valid.length > 0) return valid.map((entry) => ({modelKey: entry.modelKey, note: entry.note}));
    const fallback = config.models.defaultModelKey;
    if (fallback && modelResolutionError(config, fallback) === null) {
        return [{modelKey: fallback, note: "默认模型"}];
    }
    return [];
}

/** 校验 modelKey 在可见清单内；不在则抛错并列出可选项（工具面直接透出给 agent） */
export function assertVisibleModel(config: Pick<EffectiveConfig, "agent" | "models">, modelKey: string): void {
    const visible = resolveAgentVisibleModels(config);
    if (visible.some((entry) => entry.modelKey === modelKey)) return;
    const options = visible.map((entry) => entry.modelKey).join("、") || "（无可用模型）";
    throw new Error(`模型 ${modelKey} 不在 agent 可见模型清单内。可选：${options}`);
}
