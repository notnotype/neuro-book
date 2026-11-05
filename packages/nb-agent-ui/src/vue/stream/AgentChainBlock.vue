<script setup lang="ts">
/**
 * 一条思维链：一行摘要（`AgentChainSummary`），展开后步骤挂在从图标垂下的竖线上。步骤按种类分给工具组、
 * `AgentToolStepRow`、卡片、`AgentTextStepRow` 与并入的中间 content。链、组、卡片与各步骤行的展开状态都在这里按 id 记，
 * 思维链重新分组（步骤换了位置、换了实例）时不丢。
 */
import {CollapsibleCard, CollapsibleRow} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentConversationServices} from "../../types";
import type {AgentViewRegistry, ToolRendererEntry} from "../../registry";
import type {ChainBlock, ToolStep, TurnStatus} from "../../conversation-turns";
import {describeChain} from "../../process-summary";
import {toolCallPhase} from "../../tool-status";
import AgentMarkdown from "../parts/AgentMarkdown.vue";
import AgentToolDetail from "../tools/AgentToolDetail.vue";
import AgentChainSummary from "./AgentChainSummary.vue";
import AgentMessageAnnotations from "./AgentMessageAnnotations.vue";
import AgentTextStepRow from "./AgentTextStepRow.vue";
import AgentToolStepRow from "./AgentToolStepRow.vue";
import {useAgentText} from "../host";
import {useOpenSet} from "../use-open-set";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    chain: ChainBlock;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    turnStatus: TurnStatus;
    /** 是这一轮的最后一块：运行中时摘要行转圈，即使没有工具在跑（模型在思考或生成）。 */
    last: boolean;
    /** 运行中逐步展开：思维链与工具组默认展开，逐步列出每一步；用户点过的以用户为准。卡片与思考仍折叠。 */
    live: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, text} = useAgentText();
const openSet = useOpenSet();

function rendererOf(step: ToolStep): ToolRendererEntry {
    return props.registry.resolveTool(step.call.name);
}

/** 运行中的思维链摘要行换成正在执行的那一步，让人知道没有卡住。 */
function chainLabel(): string {
    const active = props.chain.active;
    if (active !== null) {
        return `${text(rendererOf(active).label)} ${rendererOf(active).summary(active.call)}`.trim();
    }
    return describeChain(props.chain.summary).parts.map(text).join(" · ");
}

function chainAlert(): string {
    const alert = describeChain(props.chain.summary).alert;
    return alert === null ? "" : text(alert);
}

function cardStatus(step: ToolStep): "running" | "waiting" | "success" | "error" {
    const phase = toolCallPhase(step.call.status);
    if (phase === "running") return props.turnStatus === "waiting" ? "waiting" : "running";
    return phase === "error" ? "error" : "success";
}
</script>

<template>
    <div class="acv-chain">
        <AgentChainSummary
            class="acv-chain__summary"
            :expanded="openSet.isOpen(props.chain.id, props.live)"
            :label="chainLabel()"
            :icon="props.chain.summary.thinking ? 'i-lucide-brain' : 'i-lucide-wrench'"
            :alert="chainAlert()"
            :running="props.chain.active !== null || (props.turnStatus === 'running' && props.last)"
            :title="chainLabel()"
            data-chain-summary
            @update:expanded="openSet.set(props.chain.id, $event)"
        />
        <div v-if="openSet.isOpen(props.chain.id, props.live)" class="acv-steps">
            <template v-for="entry in props.chain.entries" :key="entry.id">
                <template v-if="entry.kind === 'toolGroup'">
                    <CollapsibleRow
                        :running-label="t('turn.running')"
                        icon="i-lucide-layers"
                        :label="entry.phrases.map(text).join(t('stream.phraseSeparator'))"
                        :detail="entry.active ? rendererOf(entry.active).summary(entry.active.call) : ''"
                        :status="entry.active ? 'running' : 'done'"
                        :expanded="openSet.isOpen(entry.id, props.live)"
                        @update:expanded="openSet.set(entry.id, $event)"
                    >
                        <template v-for="item in entry.items" :key="item.id">
                            <AgentToolStepRow
                                v-if="item.kind === 'tool'"
                                :step="item"
                                :expanded="openSet.isOpen(item.id)"
                                :ctx="props.ctx"
                                :services="props.services"
                                :registry="props.registry"
                                @update:expanded="openSet.set(item.id, $event)"
                                @action="emit('action', $event)"
                            />
                            <AgentTextStepRow
                                v-else-if="item.kind === 'thinking'"
                                icon="i-lucide-brain"
                                :label="t('step.thinking')"
                                :text="item.text"
                                :services="props.services"
                                :expanded="openSet.isOpen(item.id)"
                                @update:expanded="openSet.set(item.id, $event)"
                                @action="emit('action', $event)"
                            />
                            <hr v-else class="acv-boundary">
                        </template>
                    </CollapsibleRow>
                    <!-- 组收起时，出错的项单独露出 -->
                    <template v-if="!openSet.isOpen(entry.id, props.live)">
                        <AgentToolStepRow
                            v-for="failed in entry.failed"
                            :key="failed.id"
                            class="acv-steps__nested"
                            :step="failed"
                            :expanded="openSet.isOpen(failed.id)"
                            :ctx="props.ctx"
                            :services="props.services"
                            :registry="props.registry"
                            @update:expanded="openSet.set(failed.id, $event)"
                            @action="emit('action', $event)"
                        />
                    </template>
                </template>
                <CollapsibleCard
                    v-else-if="entry.kind === 'tool' && rendererOf(entry).presentation === 'card'"
                    :running-label="t('turn.running')"
                    :icon="rendererOf(entry).icon"
                    :title="text(rendererOf(entry).label)"
                    :subtitle="rendererOf(entry).summary(entry.call)"
                    :status="cardStatus(entry)"
                    :expanded="openSet.isOpen(entry.id)"
                    @update:expanded="openSet.set(entry.id, $event)"
                >
                    <AgentToolDetail :call="entry.call" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
                </CollapsibleCard>
                <AgentToolStepRow
                    v-else-if="entry.kind === 'tool'"
                    :step="entry"
                    :expanded="openSet.isOpen(entry.id)"
                    :ctx="props.ctx"
                    :services="props.services"
                    :registry="props.registry"
                    @update:expanded="openSet.set(entry.id, $event)"
                    @action="emit('action', $event)"
                />
                <div v-else-if="entry.kind === 'text'" class="acv-narration">
                    <AgentMarkdown :text="entry.text" :resolve-asset="props.services.resolveMarkdownAsset" @action="emit('action', $event)" />
                    <AgentMessageAnnotations :message="entry.message" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
                </div>
                <AgentTextStepRow
                    v-else-if="entry.kind === 'thinking'"
                    icon="i-lucide-brain"
                    :label="t('step.thinking')"
                    :text="entry.text"
                    :services="props.services"
                    :expanded="openSet.isOpen(entry.id)"
                    @update:expanded="openSet.set(entry.id, $event)"
                    @action="emit('action', $event)"
                />
                <AgentTextStepRow
                    v-else-if="entry.kind === 'prompt'"
                    icon="i-lucide-scroll-text"
                    :label="text(entry.message.label)"
                    :text="entry.message.text"
                    :services="props.services"
                    :expanded="openSet.isOpen(entry.id)"
                    @update:expanded="openSet.set(entry.id, $event)"
                    @action="emit('action', $event)"
                />
                <hr v-else class="acv-boundary">
            </template>
        </div>
    </div>
</template>

<style scoped>
/* 思维链摘要自带 4px 内边距，所以整块少缩进 4px，箭头落在角色名那条线上。 */
.acv-chain {
    display: flex;
    flex-direction: column;
    min-width: 0;
    margin-left: calc(var(--nb-agent-block-indent, 24px) - 4px);
}

.acv-chain__summary {
    align-self: flex-start;
    max-width: 100%;
    --nb-agent-summary-px: 4px;
}

.acv-steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    margin: 4px 0 2px 11px;
    padding-left: 6px;
    border-left: var(--border-w, 1px) solid var(--divider);
    --nb-collapsible-row-px: 6px;
}

.acv-steps__nested {
    padding-left: 20px;
}

/* 同一条思维链里两条 assistant 消息之间的边界。 */
.acv-boundary {
    width: 24px;
    margin: 2px 6px;
    border: 0;
    border-top: var(--border-w, 1px) dashed var(--divider);
}

/* 并入思维链的中间 content 仍是 Agent 在对人说话，用浅底小气泡和正文色，和淡色的工具行拉开层级。 */
.acv-narration {
    margin: 4px 0;
    padding: 6px 10px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}
</style>
