<script setup lang="ts">
import {ref} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, ViewText} from "./agent-view.types";
import type {AgentViewRegistry, ToolRendererEntry} from "./agent-view-registry";
import type {ChainBlock, ToolStep, TurnBlock, TurnStatus} from "./conversation-turns";
import AgentCard from "./AgentCard.vue";
import AgentChainSummary from "./AgentChainSummary.vue";
import AgentDeliveryNotice from "./AgentDeliveryNotice.vue";
import AgentMarkdown from "./AgentMarkdown.vue";
import AgentStepLine from "./AgentStepLine.vue";
import AgentToolDetail from "./AgentToolDetail.vue";
import AgentUserContent from "./AgentUserContent.vue";
import {describeChain} from "./process-summary";

const props = defineProps<{
    block: TurnBlock;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    turnStatus: TurnStatus;
    last: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
}>();

const {t} = useI18n();

function text(value: ViewText): string {
    return typeof value === "string" ? value : t(value.key, value.params ?? {});
}

/** 思维链、工具组、卡片与思考的展开状态，按 id 记录；思维链默认折叠。 */
const openItems = ref<Record<string, boolean>>({});

function setOpen(id: string, open: boolean) {
    openItems.value = {...openItems.value, [id]: open};
}

/** 分隔线的正文只是把标签重说一遍时不值得点开。 */
function dividerHasBody(message: {label: string; text: string}): boolean {
    const body = message.text.trim();
    return body !== "" && body !== message.label.trim();
}

// ─── 思维链摘要 ─────────────────────────────────────────────────────────

/** 运行中的思维链摘要行换成正在执行的那一步，让人知道没有卡住。 */
function chainLabel(chain: ChainBlock): string {
    if (chain.active !== null) {
        return `${toolLabel(chain.active)} ${rendererOf(chain.active).summary(chain.active.call)}`.trim();
    }
    return describeChain(chain.summary).parts.map(text).join(" · ");
}

function chainAlert(chain: ChainBlock): string {
    const alert = describeChain(chain.summary).alert;
    return alert === null ? "" : text(alert);
}

/** 开头图标说明这条链里主要是什么：有思考用大脑，否则是工具。 */
function chainIcon(chain: ChainBlock): string {
    return chain.summary.thinking ? "i-lucide-brain" : "i-lucide-wrench";
}

/** 运行中的最后一条思维链即使没有工具在跑（模型在思考或生成），也显示转圈。 */
function chainRunning(chain: ChainBlock): boolean {
    return chain.active !== null || (props.turnStatus === "running" && props.last);
}

// ─── 步骤 ───────────────────────────────────────────────────────────────

/** 步骤只带调用本身，渲染器按工具名向注册表查。 */
function rendererOf(step: ToolStep): ToolRendererEntry {
    return props.registry.resolveTool(step.call.name);
}

function toolLabel(step: ToolStep): string {
    return text(rendererOf(step).label);
}

function stepStatus(step: ToolStep): "running" | "error" | "done" {
    switch (step.call.status) {
        case "streaming":
        case "running": return "running";
        case "error":
        case "invalid": return "error";
        case "success": return "done";
    }
}

function cardStatus(step: ToolStep): "running" | "waiting" | "success" | "error" {
    const status = stepStatus(step);
    if (status === "running") {
        return props.turnStatus === "waiting" ? "waiting" : "running";
    }
    return status === "error" ? "error" : "success";
}

/** 通用控件卡片的副标题：Workflow 运行中时显示它正在做的事。 */
function nodeSubtitle(step: ToolStep): string {
    return props.ctx.workflows[step.id]?.currentAction || rendererOf(step).summary(step.call);
}

/** 单文件改动的增删行；多文件的补丁不在行内显示统计。 */
function mutateStat(step: ToolStep): {added: number | null; removed: number | null} | null {
    const changed = rendererOf(step).effects?.(step.call).changed ?? [];
    return changed.length === 1 ? {added: changed[0]!.added, removed: changed[0]!.removed} : null;
}

function firstLine(value: string): string {
    return value.trim().split("\n")[0] ?? "";
}
</script>

<template>
    <!-- 思维链：默认折叠成一行 -->
    <div v-if="props.block.kind === 'chain'" class="acv-chain">
        <AgentChainSummary
            class="acv-chain__summary"
            :expanded="Boolean(openItems[props.block.id])"
            :label="chainLabel(props.block)"
            :icon="chainIcon(props.block)"
            :alert="chainAlert(props.block)"
            :running="chainRunning(props.block)"
            :title="chainLabel(props.block)"
            data-chain-summary
            @toggle="setOpen(props.block.id, $event)"
        />
        <div v-if="openItems[props.block.id]" class="acv-steps">
            <template v-for="entry in props.block.entries" :key="entry.id">
                <AgentStepLine
                    v-if="entry.kind === 'toolGroup'"
                    icon="i-lucide-layers"
                    :label="entry.phrases.map(text).join(t('agentView.stream.phraseSeparator'))"
                    :detail="entry.active ? rendererOf(entry.active).summary(entry.active.call) : ''"
                    :status="entry.active ? 'running' : 'done'"
                    :expanded="Boolean(openItems[entry.id])"
                    @toggle="setOpen(entry.id, $event)"
                >
                    <template v-for="item in entry.items" :key="item.id">
                        <AgentStepLine
                            v-if="item.kind === 'tool'"
                            :icon="rendererOf(item).icon"
                            :label="toolLabel(item)"
                            :detail="rendererOf(item).summary(item.call)"
                            :status="stepStatus(item)"
                            :expanded="Boolean(openItems[item.id])"
                            @toggle="setOpen(item.id, $event)"
                        >
                            <AgentToolDetail :call="item.call" :ctx="props.ctx" :registry="props.registry" />
                        </AgentStepLine>
                        <AgentStepLine
                            v-else-if="item.kind === 'thinking'"
                            icon="i-lucide-brain"
                            :label="t('agentView.step.thinking')"
                            :detail="openItems[item.id] ? '' : firstLine(item.text)"
                            :expanded="Boolean(openItems[item.id])"
                            @toggle="setOpen(item.id, $event)"
                        >
                            <AgentMarkdown class="acv-thinking" :text="item.text" :sanitize-html="props.services.sanitizeHtml" />
                        </AgentStepLine>
                        <hr v-else class="acv-boundary">
                    </template>
                </AgentStepLine>
                <AgentStepLine
                    v-for="failed in (entry.kind === 'toolGroup' && !openItems[entry.id] ? entry.failed : [])"
                    :key="failed.id"
                    class="acv-steps__nested"
                    :icon="rendererOf(failed).icon"
                    :label="toolLabel(failed)"
                    :detail="rendererOf(failed).summary(failed.call)"
                    status="error"
                    :expanded="Boolean(openItems[failed.id])"
                    @toggle="setOpen(failed.id, $event)"
                >
                    <AgentToolDetail :call="failed.call" :ctx="props.ctx" :registry="props.registry" />
                </AgentStepLine>
                <AgentCard
                    v-if="entry.kind === 'tool' && rendererOf(entry).presentation === 'card'"
                    :icon="rendererOf(entry).icon"
                    :title="toolLabel(entry)"
                    :subtitle="rendererOf(entry).summary(entry.call)"
                    :status="cardStatus(entry)"
                    :expanded="Boolean(openItems[entry.id])"
                    @toggle="setOpen(entry.id, $event)"
                >
                    <AgentToolDetail :call="entry.call" :ctx="props.ctx" :registry="props.registry" />
                </AgentCard>
                <AgentStepLine
                    v-else-if="entry.kind === 'tool'"
                    :icon="rendererOf(entry).icon"
                    :label="toolLabel(entry)"
                    :detail="rendererOf(entry).summary(entry.call)"
                    :stat="rendererOf(entry).category === 'mutate' ? mutateStat(entry) : null"
                    :status="stepStatus(entry)"
                    :expanded="Boolean(openItems[entry.id])"
                    @toggle="setOpen(entry.id, $event)"
                >
                    <AgentToolDetail :call="entry.call" :ctx="props.ctx" :registry="props.registry" />
                </AgentStepLine>
                <AgentMarkdown v-else-if="entry.kind === 'text'" class="acv-narration" :text="entry.text" :sanitize-html="props.services.sanitizeHtml" />
                <AgentStepLine
                    v-else-if="entry.kind === 'thinking'"
                    icon="i-lucide-brain"
                    :label="t('agentView.step.thinking')"
                    :detail="openItems[entry.id] ? '' : firstLine(entry.text)"
                    :expanded="Boolean(openItems[entry.id])"
                    @toggle="setOpen(entry.id, $event)"
                >
                    <AgentMarkdown class="acv-thinking" :text="entry.text" :sanitize-html="props.services.sanitizeHtml" />
                </AgentStepLine>
                <AgentStepLine
                    v-else-if="entry.kind === 'prompt'"
                    icon="i-lucide-scroll-text"
                    :label="entry.message.label"
                    :detail="openItems[entry.id] ? '' : firstLine(entry.message.text)"
                    :expanded="entry.message.text ? Boolean(openItems[entry.id]) : undefined"
                    @toggle="setOpen(entry.id, $event)"
                >
                    <AgentMarkdown class="acv-thinking" :text="entry.message.text" :sanitize-html="props.services.sanitizeHtml" />
                </AgentStepLine>
                <hr v-else-if="entry.kind === 'boundary'" class="acv-boundary">
            </template>
        </div>
    </div>

    <!-- Agent 说出的 content：最终回复用完整气泡，运行中的中间 content 用轻气泡 -->
    <div
        v-else-if="props.block.kind === 'content'"
        class="acv-bubble"
        :data-final-reply="props.block.final || undefined"
        :data-intermediate="!props.block.final || undefined"
    >
        <AgentMarkdown :text="props.block.message.text" :sanitize-html="props.services.sanitizeHtml" :streaming="props.block.message.status === 'streaming'" />
    </div>

    <!-- 人机交互控件 -->
    <div v-else-if="props.block.kind === 'node'" class="acv-node" data-node>
        <component :is="rendererOf(props.block.step).node" v-if="rendererOf(props.block.step).node" :call="props.block.step.call" :ctx="props.ctx" />
        <AgentCard
            v-else
            :icon="rendererOf(props.block.step).icon"
            :title="toolLabel(props.block.step)"
            :subtitle="nodeSubtitle(props.block.step)"
            :status="cardStatus(props.block.step)"
            :expanded="Boolean(openItems[props.block.id])"
            @toggle="setOpen(props.block.id, $event)"
        >
            <AgentToolDetail :call="props.block.step.call" :ctx="props.ctx" :registry="props.registry" />
        </AgentCard>
    </div>

    <!-- 信息条目：系统提醒、自定义消息，淡色一行，点开看全文 -->
    <div v-else-if="props.block.kind === 'notice'" class="acv-notice" data-notice>
        <button
            type="button"
            class="acv-notice__row"
            :aria-expanded="Boolean(openItems[props.block.id])"
            @click="setOpen(props.block.id, !openItems[props.block.id])"
        >
            <span class="i-lucide-info acv-notice__icon" aria-hidden="true" />
            <span class="acv-notice__label">{{ props.block.message.label }}</span>
            <span v-if="!openItems[props.block.id]" class="acv-notice__text">{{ firstLine(props.block.message.text) }}</span>
            <span class="i-lucide-chevron-right acv-notice__chevron" aria-hidden="true" />
        </button>
        <AgentMarkdown v-if="openItems[props.block.id]" class="acv-notice__body" :text="props.block.message.text" :sanitize-html="props.services.sanitizeHtml" />
    </div>

    <!-- 分隔线：上下文压缩、分支摘要；带摘要正文时标签可点开 -->
    <div v-else-if="props.block.kind === 'divider'" class="acv-divider-block" data-divider>
        <p class="acv-divider">
            <button
                v-if="dividerHasBody(props.block.message)"
                type="button"
                class="acv-divider__toggle"
                :aria-expanded="Boolean(openItems[props.block.id])"
                @click="setOpen(props.block.id, !openItems[props.block.id])"
            >
                {{ props.block.message.label }}<span class="i-lucide-chevron-right acv-notice__chevron" aria-hidden="true" />
            </button>
            <template v-else>{{ props.block.message.label }}</template>
        </p>
        <AgentMarkdown v-if="openItems[props.block.id]" class="acv-divider__body" :text="props.block.message.text" :sanitize-html="props.services.sanitizeHtml" />
    </div>

    <div v-else-if="props.block.kind === 'steer'" class="acv-steer">
        <span class="acv-steer__label">{{ t("agentView.step.steer") }}</span>
        <AgentUserContent class="acv-steer__content" :message="props.block.message" :resolve-attachment-url="props.services.resolveAttachmentUrl" />
        <Spinner v-if="props.block.message.delivery === 'pending'" class="acv-steer__pending" size="sm" :label="t('agentView.user.sending')" />
        <AgentDeliveryNotice
            v-if="props.block.message.delivery === 'unknown'"
            class="acv-steer__notice"
            @resend="emit('action', {type: 'message.resend', messageId: props.block.message.id})"
            @dismiss="emit('action', {type: 'message.dismiss', messageId: props.block.message.id})"
        />
    </div>

    <p v-else class="acv-bubble" data-error>{{ props.block.message }}</p>
</template>

<style scoped>
/*
 * 气泡、控件与信息条目左缩进 --acv-block-indent（默认 24px，与角色名对齐）；思维链摘要自带 4px 内边距，
 * 所以它少缩进 4px，箭头也落在这条线上。整轮展开时父组件在过程容器里改小这个缩进。
 */
.acv-bubble {
    min-width: 0;
    margin-left: var(--acv-block-indent, 24px);
    padding: 12px 16px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: 16px;
    background: var(--bg-subtle);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color, #000) 10%, transparent);
    color: var(--text-main);
    font-size: 14px;
    line-height: 1.65;
}

/* 运行中的中间 content：比最终回复轻一级，结束后并入思维链。 */
.acv-bubble[data-intermediate] {
    padding: 8px 12px;
    border-color: var(--divider);
    border-radius: 12px;
    background: color-mix(in srgb, var(--text-main) 3%, transparent);
    box-shadow: none;
}

.acv-bubble[data-error] {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger);
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.acv-chain {
    display: flex;
    flex-direction: column;
    min-width: 0;
    margin-left: calc(var(--acv-block-indent, 24px) - 4px);
}

.acv-chain__summary {
    align-self: flex-start;
    max-width: 100%;
    --acv-summary-px: 4px;
}

.acv-steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    margin: 4px 0 2px 11px;
    padding-left: 6px;
    border-left: var(--border-w, 1px) solid var(--divider);
    --acv-step-px: 6px;
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
    border-radius: 10px;
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}

.acv-thinking {
    padding: 2px 8px 4px 0;
    --acv-markdown-color: var(--text-muted);
    --acv-markdown-size: 12px;
}

.acv-node {
    min-width: 0;
    margin-left: var(--acv-block-indent, 24px);
}

.acv-notice {
    min-width: 0;
    margin-left: var(--acv-block-indent, 24px);
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
    font-size: 11px;
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
    --acv-markdown-color: var(--text-muted);
    --acv-markdown-size: 12px;
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
    margin-left: var(--acv-block-indent, 24px);
    padding: 6px 10px;
    border-left: 2px solid var(--accent-main);
    border-radius: 0 10px 10px 0;
    background: color-mix(in srgb, var(--accent-main) 5%, transparent);
    font-size: 13px;
}

.acv-steer__label {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
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
    font-size: 11px;
}

.acv-divider::before,
.acv-divider::after {
    content: "";
    flex: 1;
    border-top: var(--border-w, 1px) solid var(--divider);
}
</style>
