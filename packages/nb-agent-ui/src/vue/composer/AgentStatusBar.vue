<script setup lang="ts">
/**
 * 输入框下面一行小字（docs/specs/agent/conversation.md 输出 15–18、45）。左边是现在怎样了，右边是累计的用量，图标与轮末的用量相同。
 * 视图不自己计时：用时按宿主给的 `ctx.now` 算。数据项（上下文、用量、费用、模型与宿主加的项）按用户设置 `statusLine` 显示与排序，
 * 提醒类总显示；右边放不下时从前往后收进悬停（见同名 .md）。
 */
import {computed, onBeforeUnmount, ref, shallowReactive} from "vue";
import {ContextMenu, Spinner, Tooltip} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";

import {THINKING_LEVEL_KEYS} from "../../composer-actions";
import {formatCost, formatDuration, formatTokens} from "../../process-summary";
import {visibleEntries} from "../../registry";
import type {AgentViewRegistry} from "../../registry";
import {collapsedCount, resolveStatusLine, statusLineCatalog} from "../../status-line";
import type {StatusLineItem, StatusLineSetting} from "../../status-line";
import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";
import {isDocked} from "../../wizard";
import RenderGuard from "../parts/RenderGuard.vue";
import AgentContextMeter from "./AgentContextMeter.vue";

const props = defineProps<{
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
    /** 用户的状态栏设置；不给时按缺省显示，也不弹右键菜单。 */
    statusLine?: StatusLineSetting;
}>();

const emit = defineEmits<{
    (e: "inspect"): void;
    (e: "toggle", id: string): void;
    (e: "openSettings"): void;
}>();

const inspectable = computed(() => props.ctx.interaction.canInspectContext === true);

const {t, text} = useAgentText();

/** 停止超过这么久还没停下，多半是工具不理会中止。 */
const STOP_SLOW_MS = 10_000;

const usage = computed(() => props.ctx.usage);
const elapsed = computed(() => {
    const started = props.ctx.run.startedAt;
    return started === undefined || started === null ? null : Math.max(0, props.ctx.now - started);
});

/** 左边的运行状态，同一时间只有一个。 */
const phase = computed<{text: string; tone: "normal" | "warn" | "wait"; spin: boolean} | null>(() => {
    const {run} = props.ctx;
    const time = elapsed.value === null ? "" : ` ${formatDuration(elapsed.value)}`;
    if (run.status === "waiting") {
        // 只看阻塞的：子代理的审批与异步提问在停靠区，不是这一轮在等的。
        const approvals = props.ctx.pendingInputs.some((item) => item.kind === "approval" && !isDocked(item));
        return {text: approvals ? t("wizard.waitingApproval") : t("wizard.waitingAnswer"), tone: "wait", spin: false};
    }
    if (run.status === "stopping") {
        const slow = elapsed.value !== null && props.ctx.stopRequestedAt !== undefined && props.ctx.now - props.ctx.stopRequestedAt > STOP_SLOW_MS;
        return {text: slow ? t("status.stopSlow") : t("status.stopping"), tone: slow ? "warn" : "normal", spin: true};
    }
    if (run.status !== "running") return null;
    if (run.retry !== undefined && run.retry !== null) {
        const seconds = Math.max(0, Math.ceil((run.retry.resumeAt - props.ctx.now) / 1000));
        return {text: t("status.retry", {attempt: run.retry.attempt, max: run.retry.max, seconds}), tone: "warn", spin: true};
    }
    return {text: `${run.phase}${time}`, tone: "normal", spin: true};
});

const yolo = computed(() => {
    const approval = props.ctx.composer.approval;
    return approval?.options.find((option) => option.key === approval.value)?.danger === true;
});
/** 不是默认模式才标出来：默认模式没什么要提醒的。 */
const modeFlag = computed(() => {
    const {modes, mode} = props.ctx.composer;
    return mode !== modes[0]?.key ? modes.find((item) => item.key === mode) ?? null : null;
});
const disconnected = computed(() => props.ctx.connection.status !== "connected");

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
/** 没选会话时不画数据项（上下文、用量、费用），提醒项照常（Spec“状态栏”）：没有会话就没有可量的东西，写 0% 只是噪声。 */
const hasSession = computed(() => props.ctx.session !== null);
const hasUsage = computed(() => hasSession.value && usage.value.totalTokens > 0);
const cachePercent = computed(() => (usage.value.cacheHitRate === null ? null : `${String(Math.round(usage.value.cacheHitRate * 100))}%`));

// ─── 可选项与次序 ───────────────────────────────────────────────────────

const hostEntries = computed(() => props.registry.list("statusItems"));
const catalog = computed<StatusLineItem[]>(() => statusLineCatalog(hostEntries.value.map((entry) => ({
    id: entry.id, side: entry.side, title: entry.title, defaultVisible: entry.defaultVisible ?? false,
    ...(entry.description === undefined ? {} : {description: entry.description}),
    ...(entry.source === undefined ? {} : {source: entry.source}),
}))));
const resolved = computed(() => resolveStatusLine(catalog.value, props.statusLine ?? {}));
/** 宿主项的组件：`when` 为假的这一刻不画。 */
const hostComponents = computed(() => new Map(visibleEntries(hostEntries.value, props.ctx).map((entry) => [entry.id, entry.component] as const)));

const thinkingText = computed(() => {
    const level = props.ctx.composer.thinking;
    if (level === null || level === undefined) return "";
    const key = THINKING_LEVEL_KEYS[level];
    return key === undefined ? level : t(key);
});
/** 模型与推理档：一行文字；没有解析出模型时没有。 */
const modelText = computed(() => {
    const model = props.ctx.composer.effectiveModel;
    if (!hasSession.value || model === null || model === undefined) return "";
    return thinkingText.value === "" ? model : `${model} · ${thinkingText.value}`;
});
const usageText = computed(() => `${formatTokens(usage.value.totalTokens)} · ${detail.value}`);

/** 这一刻能画出东西的项：数据项要有数据，宿主项要它的组件在。 */
function present(id: string): boolean {
    switch (id) {
        case "context": return hasSession.value && ((usage.value.contextLimit !== null && usage.value.contextLimit > 0) || usage.value.contextTokens > 0);
        case "usage": return hasUsage.value;
        case "cost": return hasSession.value && costText.value !== null;
        case "model": return modelText.value !== "";
        default: return hostComponents.value.has(id);
    }
}
const leftItems = computed(() => resolved.value.left.filter((item) => item.visible && present(item.id)));
const rightItems = computed(() => resolved.value.right.filter((item) => item.visible && present(item.id)));

/** 收起的项在悬停里写的字：数据项写自己的内容，宿主项只有标题（组件的内容这里拿不到）。 */
function textOf(item: StatusLineItem): string {
    switch (item.id) {
        case "usage": return usageText.value;
        case "cost": return costText.value ?? "";
        case "model": return modelText.value;
        default: return text(item.title);
    }
}

// ─── 窄时收项 ───────────────────────────────────────────────────────────

/** 右边至少让出的左边宽度：圆环与百分比。 */
const LEFT_MIN = 72;
/** 状态栏的左右内边距、项之间的间距、“…”占的宽度：与下面的样式一致。 */
const PADDING = 24;
const GAP = 6;
const MORE_WIDTH = 16;

const barRef = ref<HTMLElement | null>(null);
const barWidth = ref(0);
/** 各项的自然宽度：收起的项仍在页面里（不可见、不占位），所以量得到，放宽之后据此判断放不放得下。 */
const widths = shallowReactive(new Map<string, number>());
const slots = new Map<string, HTMLElement>();
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    barWidth.value = barRef.value?.clientWidth ?? 0;
    // 宽度 0（组件还在加载、加载失败、没有内容）也记：它是量到了，只是不占位。
    for (const [id, element] of slots) widths.set(id, element.offsetWidth);
});
onBeforeUnmount(() => observer?.disconnect());

function bindBar(element: unknown): void {
    barRef.value = element instanceof HTMLElement ? element : null;
    if (barRef.value !== null) observer?.observe(barRef.value);
}
function bindSlot(id: string, element: unknown): void {
    const previous = slots.get(id);
    if (element instanceof HTMLElement) {
        if (previous !== element) {
            if (previous !== undefined) observer?.unobserve(previous);
            slots.set(id, element);
            observer?.observe(element);
        }
    } else if (previous !== undefined) {
        observer?.unobserve(previous);
        slots.delete(id);
    }
}

const collapsedIds = computed<ReadonlySet<string>>(() => {
    // 还没量到（首次渲染、没有布局的环境）时不收；量到宽度 0 的项不占位，不参与计数。
    if (barWidth.value === 0 || rightItems.value.some((item) => !widths.has(item.id))) return new Set();
    const sized = rightItems.value.filter((item) => widths.get(item.id)! > 0);
    const count = collapsedCount(sized.map((item) => widths.get(item.id)!), barWidth.value - PADDING - LEFT_MIN, GAP, MORE_WIDTH);
    return new Set(sized.slice(0, count).map((item) => item.id));
});
const collapsedText = computed(() => rightItems.value.filter((item) => collapsedIds.value.has(item.id)).map(textOf).join(" · "));

// ─── 右键菜单 ───────────────────────────────────────────────────────────

/** `ContextMenu` 要常挂着、靠 `open` 的变化定位与夹取：打开时才挂上的话它不会量自己，菜单会伸出视口。 */
const menu = ref({open: false, x: 0, y: 0});
/** 打开菜单时焦点在哪：菜单把焦点拿走，选了项、Esc、Tab 关闭时还回去（点到菜单外时焦点已跟着用户走了，不抢）。 */
let opener: HTMLElement | null = null;
function onMenuClose(reason: "select" | "outside" | "escape" | "tab"): void {
    if (reason !== "outside" && opener?.isConnected) opener.focus();
    opener = null;
}
function onContextMenu(event: MouseEvent): void {
    if (props.statusLine === undefined) return;
    event.preventDefault();
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu.value = {open: true, x: event.clientX, y: event.clientY};
}
const menuItems = computed<ContextMenuItem[]>(() => [
    ...[...resolved.value.left, ...resolved.value.right].map((item): ContextMenuItem => ({
        label: item.source === undefined ? text(item.title) : `${text(item.title)} · ${t("status.line.plugin")}`,
        type: "checkbox",
        checked: item.visible,
        ...(item.description === undefined ? {} : {title: text(item.description)}),
        action: () => emit("toggle", item.id),
    })),
    {separator: true},
    {label: t("status.line.settings"), iconClass: "i-lucide-settings", action: () => emit("openSettings")},
]);
</script>

<template>
    <div :ref="bindBar" class="acv-status" data-agent-status @contextmenu="onContextMenu">
        <div class="acv-status__left">
            <template v-for="item in leftItems" :key="item.id">
                <template v-if="item.id === 'context'">
                    <AgentContextMeter v-if="usage.contextLimit !== null && usage.contextLimit > 0" :used="usage.contextTokens" :limit="usage.contextLimit" :interactive="inspectable" @inspect="emit('inspect')" />
                    <span v-else class="acv-status__context">{{ formatTokens(usage.contextTokens) }}</span>
                </template>
                <span v-else class="acv-status__host" :data-status-item="item.id">
                    <RenderGuard :source="`statusItem:${item.id}`">
                        <component :is="hostComponents.get(item.id)" :ctx="props.ctx" />
                        <template #fallback />
                    </RenderGuard>
                </span>
            </template>
            <span v-if="phase !== null" class="acv-status__phase" :data-tone="phase.tone" data-status-phase>
                <span v-if="phase.tone === 'wait'" class="acv-status__dot" aria-hidden="true" />
                <Spinner v-else-if="phase.spin" size="sm" :label="phase.text" />
                <span class="acv-status__text">{{ phase.text }}</span>
            </span>
            <span v-if="usage.costState === 'warned'" class="acv-status__flag is-warn" data-status-cost-warned>{{ t("status.costWarned") }}</span>
            <span v-if="modeFlag" class="acv-status__flag is-accent" data-status-mode><span :class="modeFlag.icon ?? 'i-lucide-circle-dot'" aria-hidden="true" />{{ t("status.modeFlag", {mode: modeFlag.label}) }}</span>
            <span v-if="yolo" class="acv-status__flag is-danger" data-status-yolo><span class="i-lucide-triangle-alert" aria-hidden="true" />{{ t("status.yolo") }}</span>
            <span v-if="disconnected" class="acv-status__flag is-warn" data-status-connection>{{ props.ctx.connection.status === "connecting" ? t("status.connecting") : t("status.disconnected") }}</span>
        </div>
        <div class="acv-status__right" data-status-right>
            <Tooltip v-if="collapsedIds.size > 0" :text="collapsedText" side="top">
                <span class="acv-status__more" tabindex="0" :aria-label="collapsedText" data-status-more><span class="i-lucide-ellipsis" aria-hidden="true" /></span>
            </Tooltip>
            <span
                v-for="item in rightItems"
                :key="item.id"
                :ref="(element) => bindSlot(item.id, element)"
                class="acv-status__slot"
                :class="{'is-collapsed': collapsedIds.has(item.id)}"
                :data-status-item="item.id"
            >
                <Tooltip v-if="item.id === 'usage'" :text="detail" side="top">
                    <span class="acv-status__usage" tabindex="0" :aria-label="detail" data-status-usage>
                        <span class="acv-status__metric"><span class="i-lucide-zap" aria-hidden="true" />{{ formatTokens(usage.totalTokens) }}</span>
                        <span class="acv-status__metric"><span class="i-lucide-arrow-down" aria-hidden="true" />{{ formatTokens(usage.input ?? 0) }}</span>
                        <span class="acv-status__metric"><span class="i-lucide-arrow-up" aria-hidden="true" />{{ formatTokens(usage.output ?? 0) }}</span>
                        <component
                            :is="inspectable ? 'button' : 'span'"
                            v-if="cachePercent !== null"
                            v-bind="inspectable ? {type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('panel.context.open')} : {}"
                            class="acv-status__metric"
                            :class="{'is-button': inspectable}"
                            data-status-cache
                            @click="inspectable && emit('inspect')"
                        ><span class="i-lucide-database-zap" aria-hidden="true" />{{ cachePercent }}</component>
                    </span>
                </Tooltip>
                <span v-else-if="item.id === 'cost'" class="acv-status__metric acv-status__cost" :class="{'is-warn': usage.costState === 'warned'}" :title="costTitle" data-status-cost>
                    <span class="i-lucide-circle-dollar-sign" aria-hidden="true" />{{ costText }}
                </span>
                <span v-else-if="item.id === 'model'" class="acv-status__metric" data-status-model>{{ modelText }}</span>
                <RenderGuard v-else :source="`statusItem:${item.id}`">
                    <component :is="hostComponents.get(item.id)" :ctx="props.ctx" />
                    <template #fallback />
                </RenderGuard>
            </span>
        </div>
        <ContextMenu
            v-if="props.statusLine !== undefined"
            :open="menu.open"
            :x="menu.x"
            :y="menu.y"
            :items="menuItems"
            @request-close="onMenuClose"
            @update:open="menu = {...menu, open: $event}"
        />
    </div>
</template>

<style scoped>
.acv-status {
    position: relative;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 24px;
    padding: 0 12px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    white-space: nowrap;
}

/* 左边放不下时先省略，右边的用量不收缩。 */
.acv-status__left {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 6px;
    /* 裁剪的边往外让一点：圆环能点，焦点环要看得见。 */
    margin: -4px 0 -4px -4px;
    padding: 4px 0 4px 4px;
    overflow: hidden;
}

.acv-status__phase {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
}

.acv-status__text {
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-status__phase[data-tone="warn"],
.acv-status__flag.is-warn,
.acv-status__cost.is-warn {
    color: var(--status-warning);
}

.acv-status__phase[data-tone="wait"] {
    color: var(--accent-text);
}

.acv-status__flag {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.acv-status__flag.is-accent {
    color: var(--accent-text);
}

.acv-status__flag.is-danger {
    color: var(--status-danger);
}

.acv-status__dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main);
}

.acv-status__usage {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    border-radius: 3px;
}

.acv-status__usage:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-status__metric {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    font-variant-numeric: tabular-nums;
}

.acv-status__metric.is-button {
    border-radius: 3px;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.acv-status__metric.is-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.acv-status__metric.is-button:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

/* 右边的项不收缩；放不下的由脚本从前往后收：收起的项仍在页面里（量得到宽度）但不占位、看不见。 */
.acv-status__right {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
}

.acv-status__slot {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
}

.acv-status__host {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
}

/* 收起的槽仍要能量宽：脱离文档流并贴到状态栏左缘，宽度不超过状态栏，不撑出横向滚动。 */
.acv-status__slot.is-collapsed {
    position: absolute;
    inset-inline-start: 0;
    visibility: hidden;
    pointer-events: none;
}

.acv-status__more {
    display: inline-flex;
    width: 16px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    cursor: default;
}

.acv-status__more:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}
</style>
