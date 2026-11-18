<script setup lang="ts">
/**
 * 状态栏的一项（内部零件，`AgentStatusBar` 用）：上下文、用量、费用、模型或宿主的项，画在左边右边都一样。画不画由状态栏按
 * `useStatusData` 的 `presentBuiltin` 定，这里只管画。
 */
import type {Component} from "vue";
import {Tooltip} from "@notnotype/nb-ui/components";

import {formatTokens} from "../../process-summary";
import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";
import RenderGuard from "../parts/RenderGuard.vue";
import AgentContextMeter from "./AgentContextMeter.vue";
import {useStatusData} from "./status-data";

const props = defineProps<{
    ctx: AgentConversationContext;
    id: string;
    /** 宿主项的组件；内置项不给。 */
    host?: Component | undefined;
}>();

const emit = defineEmits<{(e: "inspect"): void}>();

const {t} = useAgentText();
const {usage, hasContextLimit, costText, costTitle, detail, cachePercent, modelText} = useStatusData(() => props.ctx);
const inspectable = () => props.ctx.interaction.canInspectContext === true;
</script>

<template>
    <template v-if="props.id === 'context'">
        <AgentContextMeter v-if="hasContextLimit" :used="usage.contextTokens" :limit="usage.contextLimit!" :interactive="inspectable()" @inspect="emit('inspect')" />
        <span v-else class="acv-status-item__context">{{ formatTokens(usage.contextTokens) }}</span>
    </template>
    <Tooltip v-else-if="props.id === 'usage'" :text="detail" side="top">
        <span class="acv-status-item__usage" tabindex="0" :aria-label="detail" data-status-usage>
            <span class="acv-status-item__metric"><span class="i-lucide-zap" aria-hidden="true" />{{ formatTokens(usage.totalTokens) }}</span>
            <span class="acv-status-item__metric"><span class="i-lucide-arrow-down" aria-hidden="true" />{{ formatTokens(usage.input ?? 0) }}</span>
            <span class="acv-status-item__metric"><span class="i-lucide-arrow-up" aria-hidden="true" />{{ formatTokens(usage.output ?? 0) }}</span>
            <component
                :is="inspectable() ? 'button' : 'span'"
                v-if="cachePercent !== null"
                v-bind="inspectable() ? {type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('panel.context.open')} : {}"
                class="acv-status-item__metric"
                :class="{'is-button': inspectable()}"
                data-status-cache
                @click="inspectable() && emit('inspect')"
            ><span class="i-lucide-database-zap" aria-hidden="true" />{{ cachePercent }}</component>
        </span>
    </Tooltip>
    <span v-else-if="props.id === 'cost'" class="acv-status-item__metric" :class="{'is-warn': usage.costState === 'warned'}" :title="costTitle" data-status-cost>
        <span class="i-lucide-circle-dollar-sign" aria-hidden="true" />{{ costText }}
    </span>
    <span v-else-if="props.id === 'model'" class="acv-status-item__metric" data-status-model>{{ modelText }}</span>
    <RenderGuard v-else :source="`statusItem:${props.id}`">
        <component :is="props.host" :ctx="props.ctx" />
        <template #fallback />
    </RenderGuard>
</template>

<style scoped>
.acv-status-item__usage {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    border-radius: 3px;
}

.acv-status-item__usage:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-status-item__metric {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    font-variant-numeric: tabular-nums;
}

.acv-status-item__metric.is-warn {
    color: var(--status-warning);
}

.acv-status-item__metric.is-button {
    border-radius: 3px;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.acv-status-item__metric.is-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.acv-status-item__metric.is-button:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}
</style>
