/** 阈值判断（docs/specs/harness/compaction.md 输出 9）：纯函数，给 runtime 决定要不要压缩。 */

import {calculateContextTokens, effectiveReserveTokens, getLastAssistantUsage} from "@oh-my-pi/pi-agent-core";
import type {SessionEntry} from "../session/session";
import {ompSettings} from "./soft";
import type {CompactionSettings, TriggerDecision} from "./types";

function thresholdFor(contextWindow: number, settings: CompactionSettings): number {
    if (contextWindow <= 0) return 0;
    const ceiling = contextWindow - 1;
    if ("tokens" in settings.threshold) return Math.min(ceiling, Math.max(1, settings.threshold.tokens));
    // 百分比阈值不能吃掉给下一次请求留的余量（余量按 OMP 的规则：缺省 16384 与窗口 15% 取大）
    const belowReserve = contextWindow - effectiveReserveTokens(contextWindow, ompSettings(settings));
    return Math.min(ceiling, Math.max(1, Math.min(Math.floor((contextWindow * settings.threshold.percent) / 100), belowReserve)));
}

export function shouldCompact(input: {entries: readonly SessionEntry[]; contextWindow: number; settings: CompactionSettings}): TriggerDecision {
    const usage = getLastAssistantUsage([...input.entries]);
    const contextTokens = usage === undefined ? null : calculateContextTokens(usage);
    const thresholdTokens = thresholdFor(input.contextWindow, input.settings);
    if (input.contextWindow <= 0 || contextTokens === null) return {compact: false, contextTokens, thresholdTokens};
    return {compact: contextTokens > thresholdTokens, contextTokens, thresholdTokens};
}
