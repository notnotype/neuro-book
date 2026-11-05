<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {Spinner} from "@notnotype/nb-ui/components";
import type {
    AgentConversationContext,
    AgentConversationServices,
    AssistantMessageView,
    MessageView,
} from "../../types";
import {visibleEntries, type AgentViewRegistry, type RoleEntry} from "../../registry";
import {buildTurn, defaultTurnExpanded} from "../../conversation-turns";
import AgentChainSummary from "./AgentChainSummary.vue";
import AgentDeliveryNotice from "./AgentDeliveryNotice.vue";
import AgentFileChanges from "./AgentFileChanges.vue";
import AgentMessageActions from "./AgentMessageActions.vue";
import AgentTurnBlock from "./AgentTurnBlock.vue";
import AgentUserContent from "./AgentUserContent.vue";
import {describeTurn, describeUsage} from "../../process-summary";
import {formatClock} from "../../format";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";

const props = withDefaults(defineProps<{
    messages: readonly MessageView[];
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    latest: boolean;
    first: boolean;
    /** 对话视图的 processDisclosure：live 时运行中这一轮的思维链与工具组默认展开。 */
    processDisclosure?: "collapsed" | "live";
}>(), {
    processDisclosure: "collapsed",
});

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {t, text, locale} = useAgentText();

/*
 * 整理这一轮只依赖下面几个值，各自算成 computed：宿主整体替换 ctx 时（例如每秒换 now）它们的值没变，这一轮就不重新整理。
 * 只有运行中的最新一轮用 now 算用时。
 */
const run = computed(() => props.ctx.run);
const history = computed(() => props.ctx.history);
const now = computed(() => (props.latest && props.ctx.run.status !== "idle" ? props.ctx.now : 0));

const turn = computed(() => buildTurn(props.messages, {
    registry: props.registry,
    run: run.value,
    history: history.value,
    now: now.value,
}, {isLatest: props.latest, isFirst: props.first}));

/** 运行中逐步展开：只对运行中与等待回答的这一轮生效，结束后回到默认折叠。 */
const live = computed(() => props.processDisclosure === "live" && (turn.value.status === "running" || turn.value.status === "waiting"));

const hasAssistantSide = computed(() => turn.value.blocks.length > 0 || turn.value.status !== "done");

// ─── 整轮收起 ───────────────────────────────────────────────────────────

/** 用户手动设定过的整轮展开状态；为 null 时跟随默认规则，所以运行结束时会自动收起。 */
const manualExpanded = ref<boolean | null>(null);

const expanded = computed(() => !turn.value.foldable || (manualExpanded.value ?? defaultTurnExpanded(turn.value, props.latest)));
const processBlocks = computed(() => turn.value.blocks.slice(0, turn.value.outcomeStart));
const outcomeBlocks = computed(() => turn.value.blocks.slice(turn.value.outcomeStart));

const summaryRef = ref<InstanceType<typeof AgentChainSummary> | null>(null);
const processRef = ref<HTMLElement | null>(null);

// 运行结束、整轮自动收起时，焦点若在将被收起的过程里，移到整轮摘要行，免得落回页面开头。
// 侦听器在界面更新之前执行，这时过程还在页面上。
watch(expanded, (now, before) => {
    if (before && !now && typeof document !== "undefined" && processRef.value?.contains(document.activeElement)) {
        void nextTick(() => (summaryRef.value?.$el as HTMLElement | undefined)?.focus());
    }
});

const turnDescription = computed(() => describeTurn(turn.value.metrics));
const turnLabel = computed(() => turnDescription.value.parts.map(text).join(" · "));
const turnAlert = computed(() => turnDescription.value.alert === null ? "" : text(turnDescription.value.alert));

// ─── 角色行 ─────────────────────────────────────────────────────────────

const FALLBACK_ROLE: RoleEntry = {id: "unknown", icon: "i-lucide-circle-user", label: "", tone: "neutral"};

function role(id: string): RoleEntry {
    return props.registry.list("roles").find((entry) => entry.id === id) ?? FALLBACK_ROLE;
}

const userRole = computed(() => role("user"));
const assistantRole = computed(() => role("assistant"));
/** 会话 Profile 的图标比角色的默认图标更具体。 */
const assistantIcon = computed(() => props.ctx.session?.profileIcon || assistantRole.value.icon);

/** 这一轮最后一条助手消息，角色行的模型与时间取自它。 */
const lastAssistant = computed(() => props.messages.findLast((message): message is AssistantMessageView => message.kind === "assistant") ?? null);

const statusLabel = computed(() => {
    switch (turn.value.status) {
        case "running": return props.ctx.run.phase || t("turn.running");
        case "waiting": return t("turn.waiting");
        case "error": return t("turn.error");
        case "stopped": return t("turn.stopped");
        case "done": return "";
    }
});

// ─── 轮末汇总 ───────────────────────────────────────────────────────────

const usage = computed(() => describeUsage(turn.value.metrics, props.ctx.usage.currency, {showDuration: hasAssistantSide.value}));

function openFileDiff(path: string) {
    const file = turn.value.changedFiles.find((item) => item.change.path === path);
    if (file !== undefined) {
        emit("action", {type: "file.openDiff", path, toolCallId: file.toolCallId});
    }
}

// ─── 消息操作 ───────────────────────────────────────────────────────────

function messageActionItems(message: MessageView): Array<{id: string; icon: string; label: string}> {
    return visibleEntries(props.registry.list("messageActions"), props.ctx)
        .filter((entry) => entry.messageKinds.includes(message.kind) && (entry.appliesTo?.(message) ?? true))
        .map((entry) => ({id: entry.id, icon: entry.icon, label: text(entry.label)}));
}

/** 用户一侧的消息没有结果节点；助手一侧带上这一轮的结果调用。 */
function runMessageAction(message: MessageView, id: string, outcomeCallId: string | null = null) {
    const entry = props.registry.list("messageActions").find((item) => item.id === id);
    if (entry !== undefined) {
        emit("action", entry.toAction(message, {outcomeCallId}));
    }
}
</script>

<template>
    <article class="acv-turn" :data-turn-status="turn.status">
        <div v-if="turn.user" class="acv-message" data-role="user">
            <header class="acv-message__head">
                <span class="acv-avatar" :data-tone="userRole.tone" aria-hidden="true"><span :class="userRole.icon" /></span>
                <span class="acv-role">{{ text(userRole.label) }}</span>
                <time class="acv-meta">{{ formatClock(turn.user.timestamp, locale) }}</time>
                <template v-if="turn.user.delivery === 'pending'">
                    <Spinner size="sm" :label="t('user.sending')" />
                    <span class="acv-meta" aria-hidden="true">{{ t("user.sending") }}</span>
                </template>
                <AgentMessageActions
                    class="acv-message__actions"
                    :actions="messageActionItems(turn.user)"
                    :branch="props.ctx.branches[turn.user.id] ?? null"
                    @select="runMessageAction(turn.user, $event)"
                    @branch="emit('action', {type: 'branch.switch', messageId: turn.user.id, direction: $event})"
                />
            </header>
            <div class="acv-user-bubble">
                <AgentUserContent
                    :message="turn.user"
                    :resolve-attachment-url="props.services.resolveAttachmentUrl"
                    @action="emit('action', $event)"
                />
            </div>
            <AgentDeliveryNotice
                v-if="turn.user.delivery === 'unknown'"
                class="acv-user-delivery"
                @resend="emit('action', {type: 'message.resend', messageId: turn.user!.id})"
                @dismiss="emit('action', {type: 'message.dismiss', messageId: turn.user!.id})"
            />
        </div>

        <div v-if="hasAssistantSide" class="acv-message" data-role="assistant" :data-status="turn.status">
            <header class="acv-message__head">
                <span class="acv-avatar" :data-tone="assistantRole.tone" aria-hidden="true"><span :class="assistantIcon" /></span>
                <span class="acv-role">{{ text(assistantRole.label) }}</span>
                <span v-if="lastAssistant?.model" class="acv-badge acv-badge--model" :title="lastAssistant.model">{{ lastAssistant.model }}</span>
                <time v-if="lastAssistant" class="acv-meta acv-meta--reply-time">{{ formatClock(lastAssistant.timestamp, locale) }}</time>
                <Spinner v-if="turn.status === 'running'" size="sm" :label="statusLabel" />
                <span v-if="statusLabel" class="acv-badge acv-badge--state" :data-status="turn.status">{{ statusLabel }}</span>
                <AgentMessageActions
                    v-if="turn.outcomeMessage"
                    class="acv-message__actions"
                    :actions="messageActionItems(turn.outcomeMessage)"
                    :branch="props.ctx.branches[turn.outcomeMessage.id] ?? null"
                    @select="runMessageAction(turn.outcomeMessage, $event, turn.outcomeCallId)"
                    @branch="emit('action', {type: 'branch.switch', messageId: turn.outcomeMessage!.id, direction: $event})"
                />
            </header>

            <div class="acv-blocks">
                <!-- 已结束的轮次：过程收成一行摘要，翻看历史时只看结果与轮末汇总 -->
                <AgentChainSummary
                    v-if="turn.foldable"
                    ref="summaryRef"
                    class="acv-turn-summary"
                    :expanded="expanded"
                    :label="turnLabel"
                    :alert="turnAlert"
                    :title="turnLabel"
                    data-turn-summary
                    @update:expanded="manualExpanded = $event"
                />
                <div v-if="expanded && processBlocks.length > 0" ref="processRef" class="acv-process" :data-foldable="turn.foldable || undefined">
                    <AgentTurnBlock
                        v-for="(block, index) in processBlocks"
                        :key="block.id"
                        :block="block"
                        :ctx="props.ctx"
                        :services="props.services"
                        :registry="props.registry"
                        :turn-status="turn.status"
                        :live="live"
                        :last="index === turn.blocks.length - 1"
                        @action="emit('action', $event)"
                    />
                </div>
                <AgentTurnBlock
                    v-for="block in outcomeBlocks"
                    :key="block.id"
                    :block="block"
                    :ctx="props.ctx"
                    :services="props.services"
                    :registry="props.registry"
                    :turn-status="turn.status"
                    :last="false"
                    @action="emit('action', $event)"
                />
                <p v-if="turn.status === 'stopped'" class="acv-stopped">
                    <span class="i-lucide-square acv-stopped__icon" aria-hidden="true" />{{ t("turn.stopped") }}
                </p>
            </div>

            <!-- 轮末汇总：改动文件靠左、用量靠右，同一行放不下时用量折到下一行 -->
            <footer v-if="turn.changedFiles.length > 0 || usage.parts.length > 0" class="acv-turn-end">
                <AgentFileChanges
                    v-if="turn.changedFiles.length > 0"
                    :files="turn.changedFiles.map((file) => file.change)"
                    @open="openFileDiff"
                />
                <span v-if="usage.parts.length > 0" class="acv-usage" :title="usage.detail === null ? undefined : text(usage.detail)">
                    <span v-for="part in usage.parts" :key="part.icon" class="acv-usage__part">
                        <span :class="[part.icon, 'acv-usage__icon']" aria-hidden="true" />{{ text(part.text) }}
                    </span>
                </span>
            </footer>
        </div>

        <AgentTurnBlock
            v-for="block in turn.trailing"
            :key="block.id"
            :block="block"
            :ctx="props.ctx"
            :services="props.services"
            :registry="props.registry"
            :turn-status="turn.status"
            :last="false"
            @action="emit('action', $event)"
        />
    </article>
</template>

<style scoped>
/*
 * 对话气泡版式：角色行在上，内容缩进 --nb-agent-block-indent（24px，16px 头像加 8px 间距），
 * 所以气泡左边、摘要行的箭头与角色名落在同一条线上。块自身的样式在 AgentTurnBlock 与 AgentChainBlock。
 */
.acv-turn {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 24px;
    /* 内容相对角色行的缩进；AgentTurnBlock 与 AgentChainBlock 读它，整轮展开的过程容器里改小。 */
    --nb-agent-block-indent: 24px;
    /* 用户气泡与 Agent 气泡同一个值。 */
    --nb-agent-bubble-radius: var(--radius-panel);
}

.acv-message {
    display: flex;
    flex-direction: column;
    min-width: 0;
    container-type: inline-size;
}

.acv-message__head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 28px;
    margin-bottom: 4px;
}

.acv-avatar {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-subtle);
    color: var(--text-muted);
}

.acv-avatar[data-tone="accent"] {
    border-color: var(--accent-main);
    background: var(--accent-bg);
    color: var(--accent-text);
}

.acv-avatar > span {
    width: 10px;
    height: 10px;
}

.acv-role {
    flex-shrink: 0;
    color: var(--text-main);
    font-size: calc(var(--text-2xs) - 1px);
    font-weight: var(--weight-medium, 500);
    letter-spacing: 0.24em;
    text-transform: uppercase;
}

.acv-meta {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: calc(var(--text-2xs) - 1px);
    font-variant-numeric: tabular-nums;
}

.acv-badge {
    flex-shrink: 0;
    padding: 1px 6px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-muted);
    font-size: calc(var(--text-2xs) - 1px);
    white-space: nowrap;
}

/* 模型名可能很长，窄屏时先让它截断，但至少露出开头几个字。 */
.acv-badge--model {
    flex-shrink: 1;
    min-width: 48px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-badge--state[data-status="error"] {
    border-color: var(--status-danger-border);
    background: var(--status-danger-bg);
    color: var(--status-danger);
}

.acv-badge--state[data-status="waiting"] {
    color: var(--status-warning);
}

.acv-message__actions {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--text-muted);
}

/*
 * 窄屏时助手一行放不下角色名、模型、时间与一整排操作（带分支切换时操作约 180px）：先去掉回复时间，
 * 用户消息那一行仍有时间，模型名不至于只剩一个字。
 */
@container (max-width: 400px) {
    .acv-meta--reply-time {
        display: none;
    }
}

.acv-user-bubble {
    min-width: 0;
    margin-left: var(--nb-agent-block-indent);
    padding: 12px 16px;
    border: var(--border-w, 1px) solid color-mix(in srgb, var(--accent-main) 18%, var(--border-color));
    border-radius: var(--nb-agent-bubble-radius);
    background: color-mix(in srgb, var(--accent-main) 5%, var(--bg-subtle));
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 10%, transparent);
    color: var(--text-main);
    font-size: var(--text-md);
    line-height: 1.65;
}

.acv-user-delivery {
    margin: 6px 0 0 var(--nb-agent-block-indent);
}

.acv-blocks {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.acv-process {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

/* 整轮展开后，过程挂在从整轮摘要箭头垂下的竖线上，和下面的结果分开。 */
.acv-process[data-foldable] {
    margin-left: 31px;
    padding: 2px 0 4px;
    border-left: var(--border-w, 1px) solid var(--divider);
    --nb-agent-block-indent: 10px;
}

.acv-turn-summary {
    align-self: flex-start;
    max-width: calc(100% - 20px);
    margin-left: 20px;
    --nb-agent-summary-px: 4px;
}

.acv-stopped {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: var(--nb-agent-block-indent);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-stopped__icon {
    width: 12px;
    height: 12px;
}

.acv-turn-end {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 6px 0 0 var(--nb-agent-block-indent);
}

.acv-usage {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px 8px;
    margin-left: auto;
    color: var(--text-muted);
    font-size: calc(var(--text-2xs) - 1px);
    font-variant-numeric: tabular-nums;
}

.acv-usage__part {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
}

.acv-usage__icon {
    width: 12px;
    height: 12px;
}
</style>
