<script setup lang="ts">
/**
 * 一轮里的一块，按种类分派：思维链交给 `AgentChainBlock`，其余（回复气泡、人机交互控件、信息条目、分隔线、steer、
 * 错误）在这里画。
 */
import {CollapsibleCard, Spinner} from "@notnotype/nb-ui/components";
import type {Text} from "@notnotype/nb-ui/text";
import type {AgentConversationContext, AgentConversationServices} from "../../types";
import type {AgentViewRegistry, ToolRendererEntry} from "../../registry";
import type {ToolStep, TurnBlock, TurnStatus} from "../../conversation-turns";
import {toolCallPhase} from "../../tool-status";
import AgentMarkdown from "../parts/AgentMarkdown.vue";
import RenderGuard from "../parts/RenderGuard.vue";
import AgentToolDetail from "../tools/AgentToolDetail.vue";
import AgentChainBlock from "./AgentChainBlock.vue";
import AgentCompactionDetail from "./AgentCompactionDetail.vue";
import AgentDeliveryNotice from "./AgentDeliveryNotice.vue";
import AgentMessageAnnotations from "./AgentMessageAnnotations.vue";
import AgentUserContent from "./AgentUserContent.vue";
import {useAgentRenderers, useAgentText} from "../host";
import {useOpenSet} from "../use-open-set";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    block: TurnBlock;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    turnStatus: TurnStatus;
    last: boolean;
    /** 运行中逐步展开（processDisclosure 为 live 且这一轮在运行）；交给思维链作为默认展开。 */
    live?: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, text, locale} = useAgentText();
const renderers = useAgentRenderers();
/** 通用控件卡片、信息条目与分隔线的展开状态。 */
const openSet = useOpenSet();

/** 分隔线的正文只是把标签重说一遍时不值得点开。 */
function dividerHasBody(message: {label: Text; text: string; compaction?: unknown}): boolean {
    // 有压缩详情就能点开：整理工具结果的压缩没有摘要，详情是它唯一的内容。
    if (message.compaction !== undefined) return true;
    const body = message.text.trim();
    return body !== "" && body !== text(message.label).trim();
}

/** 步骤只带调用本身，渲染器按工具名向注册表查。 */
function rendererOf(step: ToolStep): ToolRendererEntry {
    return props.registry.resolveTool(step.call.name);
}

function cardStatus(step: ToolStep): "running" | "waiting" | "success" | "error" {
    const phase = toolCallPhase(step.call.status);
    if (phase === "running") return props.turnStatus === "waiting" ? "waiting" : "running";
    return phase === "error" ? "error" : "success";
}

/** 通用控件卡片的副标题：Workflow 运行中时显示它正在做的事。 */
function nodeSubtitle(step: ToolStep): string {
    return props.ctx.workflows[step.id]?.currentAction || rendererOf(step).summary(step.call);
}
</script>

<template>
    <AgentChainBlock
        v-if="props.block.kind === 'chain'"
        :chain="props.block"
        :ctx="props.ctx"
        :services="props.services"
        :registry="props.registry"
        :turn-status="props.turnStatus"
        :last="props.last"
        :live="props.live"
        @action="emit('action', $event)"
    />

    <!-- Agent 说出的 content：最终回复用完整气泡，运行中的中间 content 用轻气泡 -->
    <div
        v-else-if="props.block.kind === 'content'"
        class="acv-block acv-bubble"
        :data-final-reply="props.block.final || undefined"
        :data-intermediate="!props.block.final || undefined"
    >
        <AgentMarkdown :text="props.block.message.text" :resolve-asset="props.services.resolveMarkdownAsset" :streaming="props.block.message.status === 'streaming'" @action="emit('action', $event)" />
        <AgentMessageAnnotations :message="props.block.message" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
    </div>

    <!-- 没有文字的助手消息上的附注：单独一块 -->
    <div v-else-if="props.block.kind === 'annotations'" class="acv-block" data-annotations>
        <AgentMessageAnnotations :message="props.block.message" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
    </div>

    <!-- 人机交互控件 -->
    <div v-else-if="props.block.kind === 'node'" class="acv-block" data-node>
        <RenderGuard v-if="rendererOf(props.block.step).node" :source="`工具 ${props.block.step.call.name} 的节点组件`">
            <component
                :is="rendererOf(props.block.step).node"
                :call="props.block.step.call"
                :ctx="props.ctx"
                :services="props.services"
                :locale="locale"
                @action="emit('action', $event)"
            />
        </RenderGuard>
        <CollapsibleCard
            v-else
            :running-label="t('turn.running')"
            :icon="rendererOf(props.block.step).icon"
            :title="text(rendererOf(props.block.step).label)"
            :subtitle="nodeSubtitle(props.block.step)"
            :status="cardStatus(props.block.step)"
            :expanded="openSet.isOpen(props.block.id)"
            @update:expanded="openSet.set(props.block.id, $event)"
        >
            <AgentToolDetail :call="props.block.step.call" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
        </CollapsibleCard>
    </div>

    <!-- 信息条目：系统提醒、自定义消息，淡色一行，点开看全文 -->
    <div v-else-if="props.block.kind === 'notice'" class="acv-block" data-notice>
        <button
            type="button"
            class="acv-notice__row"
            :aria-expanded="openSet.isOpen(props.block.id)"
            @click="openSet.set(props.block.id, !openSet.isOpen(props.block.id))"
        >
            <span class="i-lucide-info acv-notice__icon" aria-hidden="true" />
            <span class="acv-notice__label">{{ text(props.block.message.label) }}</span>
            <span v-if="!openSet.isOpen(props.block.id)" class="acv-notice__text">{{ renderers.markdownPreview(props.block.message.text) }}</span>
            <span class="i-lucide-chevron-right acv-notice__chevron" aria-hidden="true" />
        </button>
        <AgentMarkdown v-if="openSet.isOpen(props.block.id)" class="acv-notice__body" :text="props.block.message.text" :resolve-asset="props.services.resolveMarkdownAsset" @action="emit('action', $event)" />
    </div>

    <!-- 分隔线：上下文压缩、分支摘要；带摘要正文时标签可点开 -->
    <div v-else-if="props.block.kind === 'divider'" class="acv-divider-block" data-divider>
        <p class="acv-divider">
            <button
                v-if="dividerHasBody(props.block.message)"
                type="button"
                class="acv-divider__toggle"
                :aria-expanded="openSet.isOpen(props.block.id)"
                @click="openSet.set(props.block.id, !openSet.isOpen(props.block.id))"
            >
                {{ text(props.block.message.label) }}<span class="i-lucide-chevron-right acv-notice__chevron" aria-hidden="true" />
            </button>
            <template v-else>{{ text(props.block.message.label) }}</template>
        </p>
        <AgentCompactionDetail v-if="openSet.isOpen(props.block.id) && props.block.message.compaction !== undefined" :detail="props.block.message.compaction" :currency="props.ctx.usage.currency" />
        <AgentMarkdown v-if="openSet.isOpen(props.block.id) && props.block.message.text.trim() !== ''" class="acv-divider__body" :text="props.block.message.text" :resolve-asset="props.services.resolveMarkdownAsset" @action="emit('action', $event)" />
    </div>

    <div v-else-if="props.block.kind === 'steer'" class="acv-block acv-steer">
        <span class="acv-steer__label">{{ t("step.steer") }}</span>
        <AgentUserContent
            class="acv-steer__content"
            :message="props.block.message"
            :resolve-attachment-url="props.services.resolveAttachmentUrl"
            @action="emit('action', $event)"
        />
        <Spinner v-if="props.block.message.delivery === 'pending'" class="acv-steer__pending" size="sm" :label="t('user.sending')" />
        <AgentDeliveryNotice
            v-if="props.block.message.delivery === 'unknown'"
            class="acv-steer__notice"
            @resend="emit('action', {type: 'message.resend', messageId: props.block.message.id})"
            @dismiss="emit('action', {type: 'message.dismiss', messageId: props.block.message.id})"
        />
    </div>

    <p v-else class="acv-block acv-bubble" data-error>{{ text(props.block.message) }}</p>
</template>

<style scoped>
/*
 * 各块左缩进 --nb-agent-block-indent，与角色名对齐；值由 AgentConversationTurn 声明（整轮展开时在过程容器里改小），
 * 单独挂载没有它时按 24px。思维链的缩进在 AgentChainBlock。
 */
.acv-block {
    min-width: 0;
    margin-left: var(--nb-agent-block-indent, 24px);
}

.acv-bubble {
    padding: 12px 16px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--nb-agent-bubble-radius, var(--radius-panel));
    background: var(--bg-subtle);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 10%, transparent);
    color: var(--text-main);
    font-size: var(--text-md);
    line-height: 1.65;
}

/* 运行中的中间 content：比最终回复轻一级，结束后并入思维链。 */
.acv-bubble[data-intermediate] {
    padding: 8px 12px;
    border-color: var(--divider);
    border-radius: var(--nb-agent-bubble-radius, var(--radius-panel));
    background: color-mix(in srgb, var(--text-main) 3%, transparent);
    box-shadow: none;
}

.acv-bubble[data-error] {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger);
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.acv-notice__row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    min-height: 20px;
    padding: 0 4px;
    margin-left: -4px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-notice__row:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
}

.acv-notice__chevron {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    opacity: 0.7;
    transition: transform var(--motion-fast) var(--ease-standard);
}

[aria-expanded="true"] > .acv-notice__chevron {
    transform: rotate(90deg);
}

/* 全文与思考同一档：淡色小字，挂在细竖线上，不抢回复气泡的注意力。 */
.acv-notice__body,
.acv-divider__body {
    margin: 2px 0 4px 5px;
    padding: 2px 8px;
    border-left: var(--border-w, 1px) solid var(--divider);
    --nb-agent-markdown-color: var(--text-muted);
    --nb-agent-markdown-size: var(--text-xs);
}

.acv-divider__toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-radius: var(--radius-control);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-divider__toggle:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
}

.acv-divider__body {
    margin: 4px auto 0;
    max-width: 90%;
}

.acv-notice__icon {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
}

.acv-notice__label {
    flex-shrink: 0;
}

.acv-notice__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 标签、正文与发送中指示排成一行；投递未知的提示占满下一行。 */
.acv-steer {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 6px;
    padding: 6px 10px;
    border-left: 2px solid var(--accent-main);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
    background: color-mix(in srgb, var(--accent-main) 5%, transparent);
    font-size: var(--text-sm);
}

.acv-steer__label {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-steer__content {
    flex: 1;
}

.acv-steer__pending {
    flex-shrink: 0;
    align-self: center;
}

.acv-steer__notice {
    flex-basis: 100%;
}

.acv-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-divider::before,
.acv-divider::after {
    content: "";
    flex: 1;
    border-top: var(--border-w, 1px) solid var(--divider);
}
</style>
