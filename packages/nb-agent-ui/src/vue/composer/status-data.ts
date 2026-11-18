/**
 * 状态栏数据项的文字与有没有可画的（docs/specs/ui/agent-conversation-view.md 的“状态栏”）。状态栏要据此决定画不画、收起时悬停写什么，
 * 每一项（`AgentStatusItem`）要据此画自己，两处读同一份，免得各算一遍。
 */

import {computed} from "vue";

import {THINKING_LEVEL_KEYS} from "../../composer-actions";
import {formatCost, formatTokens} from "../../process-summary";
import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";

export function useStatusData(ctx: () => AgentConversationContext) {
    const {t} = useAgentText();
    const usage = computed(() => ctx().usage);
    /** 没选会话时不画数据项：没有会话就没有可量的东西，写 0% 只是噪声。 */
    const hasSession = computed(() => ctx().session !== null);
    const hasContextLimit = computed(() => usage.value.contextLimit !== null && usage.value.contextLimit > 0);
    const costText = computed(() => {
        const {cost, currency} = usage.value;
        if (cost === null) return null;
        return cost === 0 ? t("status.free") : formatCost(cost, currency);
    });
    const costTitle = computed(() => (usage.value.costState === "unpriced" ? t("status.unpriced") : undefined));
    const detail = computed(() => t("status.detail", {
        input: formatTokens(usage.value.input ?? 0),
        output: formatTokens(usage.value.output ?? 0),
        cacheRead: formatTokens(usage.value.cacheRead),
        cacheWrite: formatTokens(usage.value.cacheWrite),
    }));
    const cachePercent = computed(() => (usage.value.cacheHitRate === null ? null : `${String(Math.round(usage.value.cacheHitRate * 100))}%`));
    const thinkingText = computed(() => {
        const level = ctx().composer.thinking;
        if (level === null || level === undefined) return "";
        const key = THINKING_LEVEL_KEYS[level];
        return key === undefined ? level : t(key);
    });
    /** 模型与推理档：一行文字；没有解析出模型时没有。 */
    const modelText = computed(() => {
        const model = ctx().composer.effectiveModel;
        if (!hasSession.value || model === null || model === undefined) return "";
        return thinkingText.value === "" ? model : `${model} · ${thinkingText.value}`;
    });
    const usageText = computed(() => `${formatTokens(usage.value.totalTokens)} · ${detail.value}`);
    /** 上下文收起时悬停里写的：同圆环旁的字（`AgentContextMeter`），有窗口写百分比、不到 0.5% 写“<1%”，没有窗口写绝对数。 */
    const contextText = computed(() => {
        const {contextTokens, contextLimit} = usage.value;
        if (!hasContextLimit.value) return formatTokens(contextTokens);
        const percent = Math.round((contextTokens / contextLimit!) * 100);
        return contextTokens > 0 && percent === 0 ? "<1%" : `${String(percent)}%`;
    });

    /** 内置项这一刻能不能画出东西；宿主项由调用方看它的组件在不在。 */
    function presentBuiltin(id: string): boolean | undefined {
        switch (id) {
            case "context": return hasSession.value && (hasContextLimit.value || usage.value.contextTokens > 0);
            case "usage": return hasSession.value && usage.value.totalTokens > 0;
            case "cost": return hasSession.value && costText.value !== null;
            case "model": return modelText.value !== "";
            default: return undefined;
        }
    }
    /** 内置项收起时写的字；宿主项交回 undefined（组件的内容拿不到，调用方写标题）。 */
    function builtinText(id: string): string | undefined {
        switch (id) {
            case "context": return contextText.value;
            case "usage": return usageText.value;
            case "cost": return costText.value ?? "";
            case "model": return modelText.value;
            default: return undefined;
        }
    }

    return {usage, hasContextLimit, costText, costTitle, detail, cachePercent, modelText, presentBuiltin, builtinText};
}
