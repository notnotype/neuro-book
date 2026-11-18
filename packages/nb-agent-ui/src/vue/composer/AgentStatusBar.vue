<script setup lang="ts">
/**
 * 输入框下面一行小字（docs/specs/agent/conversation.md 输出 15–18、45）。左边是现在怎样了，右边是累计的用量，图标与轮末的用量相同。
 * 视图不自己计时：用时按宿主给的 `ctx.now` 算。数据项（上下文、用量、费用、模型与宿主加的项）按用户设置 `statusLine` 显示、排序与
 * 分边，提醒类总显示；放不下时先右后左收进悬停（见同名 .md）。
 */
import {computed, onBeforeUnmount, ref, shallowReactive} from "vue";
import {ContextMenu, Spinner, Tooltip} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";

import {formatDuration} from "../../process-summary";
import {visibleEntries} from "../../registry";
import type {AgentViewRegistry} from "../../registry";
import {collapsedItems, resolveStatusLine, statusLineCatalog} from "../../status-line";
import type {StatusLineItem, StatusLineSetting, StatusLineWidth} from "../../status-line";
import type {AgentConversationContext} from "../../types";
import {useAgentText} from "../host";
import {isDocked} from "../../wizard";
import AgentStatusItem from "./AgentStatusItem.vue";
import {useStatusData} from "./status-data";

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

const {t, text} = useAgentText();
const {usage, presentBuiltin, builtinText} = useStatusData(() => props.ctx);

/** 停止超过这么久还没停下，多半是工具不理会中止。 */
const STOP_SLOW_MS = 10_000;

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

const disconnected = computed(() => props.ctx.connection.status !== "connected");
const costWarned = computed(() => usage.value.costState === "warned");
const hasReminders = computed(() => phase.value !== null || costWarned.value || disconnected.value);

// ─── 可选项、次序与边 ───────────────────────────────────────────────────

const hostEntries = computed(() => props.registry.list("statusItems"));
const catalog = computed<StatusLineItem[]>(() => statusLineCatalog(hostEntries.value.map((entry) => ({
    id: entry.id, side: entry.side, title: entry.title, defaultVisible: entry.defaultVisible ?? false,
    ...(entry.description === undefined ? {} : {description: entry.description}),
    ...(entry.source === undefined ? {} : {source: entry.source}),
}))));
const resolved = computed(() => resolveStatusLine(catalog.value, props.statusLine ?? {}));
/** 宿主项的组件：`when` 为假的这一刻不画。 */
const hostComponents = computed(() => new Map(visibleEntries(hostEntries.value, props.ctx).map((entry) => [entry.id, entry.component] as const)));

/** 这一刻能画出东西的项：数据项要有数据，宿主项要它的组件在。 */
const present = (id: string): boolean => presentBuiltin(id) ?? hostComponents.value.has(id);
const leftItems = computed(() => resolved.value.left.filter((item) => item.visible && present(item.id)));
const rightItems = computed(() => resolved.value.right.filter((item) => item.visible && present(item.id)));

/** 收起的项在悬停里写的字：数据项写自己的内容，宿主项只有标题（组件的内容这里拿不到）。 */
const textOf = (item: StatusLineItem): string => builtinText(item.id) ?? text(item.title);

// ─── 窄时收项 ───────────────────────────────────────────────────────────

/** 状态栏的左右内边距、项之间的间距、“…”占的宽度：与下面的样式一致。 */
const PADDING = 24;
const GAP = 6;
const MORE_WIDTH = 16;

const barRef = ref<HTMLElement | null>(null);
const barWidth = ref(0);
/** 各项的自然宽度：收起的项仍在页面里（不可见、不占位），所以量得到，放宽之后据此判断放不放得下。 */
const widths = shallowReactive(new Map<string, number>());
/**
 * 量宽的槽，键是“边:id”。按 id 登记不行：一项从右边换到左边时，Vue 先挂上左边的新槽、再卸下右边的旧槽，卸下那次的回调拿不到
 * 旧元素，会把刚登记的新槽当成它删掉。
 */
const slots = new Map<string, HTMLElement>();
const idOfSlot = (key: string): string => key.slice(key.indexOf(":") + 1);
/** 提醒那一块的自然宽度：它不收缩，量到的就是它要的宽。 */
const remindersWidth = ref(0);
let remindersRef: HTMLElement | null = null;
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    barWidth.value = barRef.value?.clientWidth ?? 0;
    remindersWidth.value = remindersRef?.offsetWidth ?? 0;
    // 宽度 0（组件还在加载、加载失败、没有内容）也记：它是量到了，只是不占位。
    for (const [key, element] of slots) widths.set(idOfSlot(key), element.offsetWidth);
});
onBeforeUnmount(() => observer?.disconnect());

function bindBar(element: unknown): void {
    barRef.value = element instanceof HTMLElement ? element : null;
    if (barRef.value !== null) observer?.observe(barRef.value);
}
function bindReminders(element: unknown): void {
    const next = element instanceof HTMLElement ? element : null;
    if (next === remindersRef) return;
    if (remindersRef !== null) observer?.unobserve(remindersRef);
    remindersRef = next;
    if (next !== null) observer?.observe(next);
    else remindersWidth.value = 0;
}
function bindSlot(side: "left" | "right", id: string, element: unknown): void {
    const key = `${side}:${id}`;
    const previous = slots.get(key);
    if (element instanceof HTMLElement) {
        if (previous !== element) {
            if (previous !== undefined) observer?.unobserve(previous);
            slots.set(key, element);
            observer?.observe(element);
        }
    } else if (previous !== undefined) {
        observer?.unobserve(previous);
        slots.delete(key);
    }
}

const collapsedIds = computed<ReadonlySet<string>>(() => {
    // 还没量到（首次渲染、没有布局的环境）时不收；量到宽度 0 的项不占位，不参与计数。
    if (barWidth.value === 0 || [...leftItems.value, ...rightItems.value].some((item) => !widths.has(item.id))) return new Set();
    const sized = (items: readonly StatusLineItem[]): StatusLineWidth[] => items.filter((item) => widths.get(item.id)! > 0).map((item) => ({id: item.id, width: widths.get(item.id)!}));
    return new Set(collapsedItems({
        left: sized(leftItems.value),
        right: sized(rightItems.value),
        reserved: hasReminders.value ? remindersWidth.value : 0,
        available: barWidth.value - PADDING,
        gap: GAP,
        moreWidth: MORE_WIDTH,
    }));
});
/** 收起的项按呈现顺序列在“…”的悬停里。 */
const collapsedText = computed(() => [...leftItems.value, ...rightItems.value].filter((item) => collapsedIds.value.has(item.id)).map(textOf).join(" · "));
/** 量到宽度 0 的项不占位：同收起的槽一样脱离文档流，不白占一个间距。 */
const isEmpty = (id: string): boolean => widths.get(id) === 0;
/** 右边一块：有占位的项，或左边有项收起要放“…”时才画；空着画出来会多占一个间距。 */
const showsRight = computed(() => rightItems.value.some((item) => !isEmpty(item.id)) || collapsedIds.value.size > 0);

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
            <span
                v-for="item in leftItems"
                :key="item.id"
                :ref="(element) => bindSlot('left', item.id, element)"
                class="acv-status__slot"
                :class="{'is-collapsed': collapsedIds.has(item.id), 'is-empty': isEmpty(item.id)}"
                :data-status-item="item.id"
            >
                <AgentStatusItem :id="item.id" :ctx="props.ctx" :host="hostComponents.get(item.id)" @inspect="emit('inspect')" />
            </span>
            <!-- 提醒不收缩、量自然宽；放不下的部分由左边整块裁掉（最后才截断）。 -->
            <span v-if="hasReminders" :ref="bindReminders" class="acv-status__reminders" data-status-reminders>
                <span v-if="phase !== null" class="acv-status__phase" :data-tone="phase.tone" data-status-phase>
                    <span v-if="phase.tone === 'wait'" class="acv-status__dot" aria-hidden="true" />
                    <Spinner v-else-if="phase.spin" size="sm" :label="phase.text" />
                    <span>{{ phase.text }}</span>
                </span>
                <span v-if="costWarned" class="acv-status__flag is-warn" data-status-cost-warned>{{ t("status.costWarned") }}</span>
                <span v-if="disconnected" class="acv-status__flag is-warn" data-status-connection>{{ props.ctx.connection.status === "connecting" ? t("status.connecting") : t("status.disconnected") }}</span>
            </span>
        </div>
        <div v-if="showsRight" class="acv-status__right" data-status-right>
            <Tooltip v-if="collapsedIds.size > 0" :text="collapsedText" side="top">
                <span class="acv-status__more" tabindex="0" :aria-label="collapsedText" data-status-more><span class="i-lucide-ellipsis" aria-hidden="true" /></span>
            </Tooltip>
            <span
                v-for="item in rightItems"
                :key="item.id"
                :ref="(element) => bindSlot('right', item.id, element)"
                class="acv-status__slot"
                :class="{'is-collapsed': collapsedIds.has(item.id), 'is-empty': isEmpty(item.id)}"
                :data-status-item="item.id"
            >
                <AgentStatusItem :id="item.id" :ctx="props.ctx" :host="hostComponents.get(item.id)" @inspect="emit('inspect')" />
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

/* 左边占剩下的宽；放不下的部分裁掉（数据项先由脚本收起，最后才裁到提醒）。 */
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

.acv-status__reminders {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
}

.acv-status__phase {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
}

.acv-status__phase[data-tone="warn"],
.acv-status__flag.is-warn {
    color: var(--status-warning);
}

.acv-status__phase[data-tone="wait"] {
    color: var(--accent-text);
}

.acv-status__flag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.acv-status__dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main);
}

/* 右边的项不收缩；放不下的由脚本收起：收起的项仍在页面里（量得到宽度）但不占位、看不见。 */
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

/* 收起的槽仍要能量宽：脱离文档流并贴到状态栏左缘，宽度不超过状态栏，不撑出横向滚动。量到宽度 0 的槽同样脱离，不白占一个间距。 */
.acv-status__slot.is-collapsed,
.acv-status__slot.is-empty {
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
