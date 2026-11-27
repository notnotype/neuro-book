<script setup lang="ts">
/**
 * “消息”视图借给侧轨的一段（同名 .md）：收着是快切的一列，展开是完整列表；按 `expanded` 换画法，不看宽度。
 * 展开收起按钮是视图段自己的（docs/specs/ui/workbench-layout.md 输出 50 的“三段”）：中段的第一个子元素，收着时排在头像上面，展开时定位到列表区的右上角，
 * 两种是同一个元素，焦点跟着它走。展开时底段藏起来，它的两项由列表底部的导航接替。
 *
 * 中段与底段各一个 `Teleport`：给了 `targets` 时送进侧轨的 `main`、`foot`，不给时 `disabled`，按顺序画在组件自己的根里（浮动窗的右边缘、Lab）。
 * 两种是同一个实例，换位置时搜索词、当前页这些状态都在；DOM 是被搬过去的（`insertBefore`），焦点与滚动位置在搬完后放回去（见下面 `lastFocus`）。
 */
import {computed, nextTick, ref, watch} from "vue";
import {useLayoutExtent} from "@notnotype/nb-layout/vue";
import {Tooltip} from "@notnotype/nb-ui/components";

import type {AgentLocale, MessagesContact, MessagesContactSection, MessagesRecentSession} from "../../types";
import {provideAgentText} from "../text";
import AgentMessagesList from "./AgentMessagesList.vue";
import {fitSegment} from "../../messages-segment-fit";

const props = withDefaults(defineProps<{
    expanded: boolean;
    targets?: {readonly main: HTMLElement; readonly foot: HTMLElement} | null;
    sections: readonly MessagesContactSection[];
    selected: {readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null;
    recentSessions: readonly MessagesRecentSession[];
    tab: "bot" | "sessions";
    weak?: boolean;
    /** 展开按钮给“窗口太窄”：宿主拒了展开请求、仍放不下（`data-rail-too-narrow`）。 */
    tooNarrow?: boolean;
    now: number;
    locale?: AgentLocale;
    tooltipSide?: "left" | "right";
}>(), {targets: null, weak: false, tooNarrow: false, locale: undefined, tooltipSide: "left"});

const emit = defineEmits<{
    "update:tab": [tab: "bot" | "sessions"];
    "open-contact": [key: string];
    "open-session": [id: string];
    "new-session": [];
    "show-list": [tab: "bot" | "sessions"];
    "retry-contacts": [sectionKey: string];
    "escape-search": [];
    /** 展开收起按钮：宿主转成展开请求（右轨与浮动窗都是）。 */
    "toggle-expanded": [];
}>();

defineSlots<{sessions(): unknown}>();

/** bot 页的搜索词：视图段收起时列表拿掉，宿主绑着它才留得住；不绑时这里记。 */
const botQuery = defineModel<string>("botQuery", {default: ""});

const {t} = provideAgentText(() => props.locale);

// ─── 收着：放几项 ─────────────────────────────────────────────────────────

const mainRef = ref<HTMLElement | null>(null);
const footRef = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(mainRef);
const contacts = computed(() => props.sections.flatMap((section) => section.contacts));
const currentBot = computed(() => (props.selected?.kind === "contact" ? props.selected.key : null));
const currentSession = computed(() => (props.selected?.kind === "session" ? props.selected.id : null));
const fit = computed(() => fitSegment({
    height: extent.value?.height ?? null,
    // “新对话”与展开按钮。
    fixed: 2,
    bots: contacts.value,
    sessions: props.recentSessions,
    isCurrentBot: (contact) => contact.key === currentBot.value,
    isCurrentSession: (session) => session.id === currentSession.value,
}));

const unreadTotal = computed(() => contacts.value.reduce((sum, contact) => sum + (contact.unread ?? 0), 0));
const anyWaiting = computed(() => contacts.value.some((contact) => contact.activity === "waiting"));

const initial = (text: string): string => Array.from(text.trim())[0] ?? "?";
const brokenAvatars = ref<ReadonlySet<string>>(new Set());
const avatarOf = (contact: MessagesContact): string | null => (contact.avatar !== undefined && !brokenAvatars.value.has(contact.avatar) ? contact.avatar : null);
function markBroken(src: string): void {
    brokenAvatars.value = new Set([...brokenAvatars.value, src]);
}
function contactLabel(contact: MessagesContact): string {
    if (contact.activity === "waiting") return t("messages.contactWaiting", {name: contact.name});
    return (contact.unread ?? 0) > 0 ? t("messages.contactUnread", {name: contact.name, count: contact.unread ?? 0}) : contact.name;
}

// ─── 底段与展开 ───────────────────────────────────────────────────────────

/** 收着时的“+N”与底段两项：请求展开并切到那一页（展开后这些项都不在，切页由列表底部的导航做）。 */
function openPage(page: "bot" | "sessions"): void {
    emit("show-list", page);
}

const listRef = ref<InstanceType<typeof AgentMessagesList> | null>(null);
/** 宿主请求展开、还没挂上列表时要给焦点的那一页：挂上后给。 */
const pendingFocus = ref<"bot" | "sessions" | null>(null);
function focusSearch(page: "bot" | "sessions"): void {
    if (props.expanded && listRef.value !== null) {
        listRef.value.focusSearch(page);
        return;
    }
    pendingFocus.value = page;
}
watch(listRef, (list) => {
    const page = pendingFocus.value;
    if (list === null || page === null) return;
    pendingFocus.value = null;
    void nextTick(() => list.focusSearch(page));
});
// 宿主只在请求展开成功后才调 `focusSearch`；列表挂上之前又收起了，记下的那一页作废，下次展开不抢焦点。
watch(() => props.expanded, (expanded) => {
    if (!expanded) pendingFocus.value = null;
});

defineExpose({focusSearch});

/**
 * 换位置（侧轨与浮动窗的右边缘之间、侧轨换了元素）后视图段自己放回焦点与滚动位置（views.md 输出 21）。浏览器里搬动或拆掉祖先的节点丢焦点、滚动回到顶。
 * 不能等换位置时再取：右轨的元素在外壳重渲染时就被拆掉，排在这个组件之前，轮到这里时焦点已经落到 body、滚动量读出来是 0。
 * 所以平时就记：`focusin` 记下最后获得焦点的那一项，`focusout` 之后它还看得见、焦点去了别处（用户自己挪走）才清掉，被拆掉或藏起来的不清；
 * 滚动在捕获阶段记每个滚过的元素。搬完（`post`）还记着的就放回去：焦点是随节点被拆掉丢的，工作台的焦点规则（ui/workbench-layout 输出 16）
 * 可能已经把它交给了标签或外壳根，那不是用户的选择；用户自己把焦点挪出视图段时上面已经清掉了。
 */
let lastFocus: HTMLElement | null = null;
const scrolled = new Map<HTMLElement, number>();
const insideSegment = (node: Node | null): boolean => node !== null && [mainRef.value, footRef.value].some((root) => root?.contains(node) === true);
function onFocusIn(event: FocusEvent): void {
    if (event.target instanceof HTMLElement) lastFocus = event.target;
}
function onFocusOut(event: FocusEvent): void {
    const left = event.target;
    queueMicrotask(() => {
        // 被拆掉或藏起来（换位置的中途）丢的焦点不算用户挪走；`checkVisibility` 没有的环境（happy-dom）按看得见算。
        const shown = left instanceof HTMLElement && left.isConnected && left.checkVisibility?.() !== false;
        if (shown && lastFocus === left && !insideSegment(document.activeElement)) lastFocus = null;
    });
}
function onScroll(event: Event): void {
    if (!(event.target instanceof HTMLElement)) return;
    // 收起时列表整块卸掉，它的滚动容器不会再回来；记新的之前清掉，表不随展开收起的次数长。
    for (const element of scrolled.keys()) if (!element.isConnected) scrolled.delete(element);
    if (event.target.scrollTop > 0) scrolled.set(event.target, event.target.scrollTop);
    else scrolled.delete(event.target);
}
watch(() => props.targets, () => {
    for (const [element, top] of scrolled) {
        if (!element.isConnected) scrolled.delete(element);
        else if (element.scrollTop !== top) element.scrollTop = top;
    }
    const focus = lastFocus;
    if (focus?.isConnected === true && insideSegment(focus) && document.activeElement !== focus) focus.focus({preventScroll: true});
}, {flush: "post"});

const state = computed(() => (props.expanded ? "expanded" : "collapsed"));
const toggleTip = computed(() => (props.expanded ? t("messages.collapse") : props.tooNarrow ? t("messages.tooNarrow") : t("messages.expand")));
const tooNarrowShown = computed(() => props.tooNarrow && !props.expanded);
</script>

<template>
    <div class="acv-segment" :class="{'acv-segment--inline': props.targets === null}">
        <Teleport :to="props.targets?.main ?? 'body'" :disabled="props.targets === null">
            <div
                ref="mainRef"
                class="acv-segment__main"
                @focusin="onFocusIn"
                @focusout="onFocusOut"
                @scroll.capture="onScroll"
                :class="`acv-segment__main--${state}`"
                data-messages-segment
                :data-messages-segment-state="state"
                :data-rail-weak="props.weak ? '' : undefined"
            >
                <!-- 收着与展开是同一个元素（只换类与属性），焦点不经 body；展开时不进侧轨的纵向工具条，是列表区里的普通按钮。 -->
                <div class="acv-segment__toggle-slot" :class="{'acv-segment__toggle-slot--expanded': props.expanded}">
                    <Tooltip :text="toggleTip" :side="props.expanded ? 'bottom' : props.tooltipSide">
                        <button
                            type="button"
                            class="acv-segment__item acv-segment__toggle nb-ui-focus-ring"
                            :aria-label="t('messages.expand')"
                            :aria-expanded="props.expanded"
                            :aria-description="tooNarrowShown ? t('messages.tooNarrow') : undefined"
                            :data-rail-too-narrow="tooNarrowShown ? '' : undefined"
                            :data-rail-item="props.expanded ? undefined : ''"
                            data-rail-toggle
                            data-messages-segment-toggle
                            @click="emit('toggle-expanded')"
                        >
                            <span :class="props.expanded ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" class="acv-segment__icon" aria-hidden="true" />
                        </button>
                    </Tooltip>
                </div>
                <template v-if="!props.expanded">
                    <div v-for="contact in fit.bots" :key="contact.key" class="acv-segment__row">
                        <span class="acv-segment__bar" :data-shown="contact.key === currentBot ? '' : undefined" aria-hidden="true" />
                        <Tooltip :text="contact.name" :side="props.tooltipSide">
                            <button
                                type="button"
                                class="acv-segment__item acv-segment__item--bot nb-ui-focus-ring"
                                :aria-label="contactLabel(contact)"
                                :aria-current="contact.key === currentBot ? 'true' : undefined"
                                :data-strip-contact="contact.key"
                                :data-strip-waiting="contact.activity === 'waiting' ? '' : undefined"
                                data-rail-item
                                @click="emit('open-contact', contact.key)"
                            >
                                <img v-if="avatarOf(contact) !== null" :src="avatarOf(contact)!" alt="" class="acv-segment__avatar" @error="markBroken(contact.avatar!)">
                                <span v-else class="acv-segment__avatar acv-segment__avatar--initial" aria-hidden="true">{{ initial(contact.name) }}</span>
                                <span v-if="contact.activity === 'waiting'" class="acv-segment__dot" aria-hidden="true" />
                                <span v-else-if="(contact.unread ?? 0) > 0" class="acv-segment__count" aria-hidden="true">{{ (contact.unread ?? 0) > 99 ? "99+" : contact.unread }}</span>
                            </button>
                        </Tooltip>
                    </div>
                    <div v-if="fit.more > 0" class="acv-segment__row">
                        <Tooltip :text="t('messages.moreBots', {count: fit.more})" :side="props.tooltipSide">
                            <button type="button" class="acv-segment__item acv-segment__item--more nb-ui-focus-ring" :aria-label="t('messages.moreBots', {count: fit.more})" data-strip-more data-rail-item @click="openPage('bot')">+{{ fit.more }}</button>
                        </Tooltip>
                    </div>
                    <span class="acv-segment__divider" aria-hidden="true" />
                    <div class="acv-segment__row">
                        <Tooltip :text="t('messages.newSession')" :side="props.tooltipSide">
                            <button type="button" class="acv-segment__item nb-ui-focus-ring" :aria-label="t('messages.newSession')" data-messages-new-session data-rail-item @click="emit('new-session')">
                                <span class="i-lucide-square-pen acv-segment__icon" aria-hidden="true" />
                            </button>
                        </Tooltip>
                    </div>
                    <div v-for="session in fit.sessions" :key="session.id" class="acv-segment__row">
                        <Tooltip :text="session.title" :side="props.tooltipSide">
                            <button
                                type="button"
                                class="acv-segment__item acv-segment__item--session nb-ui-focus-ring"
                                :aria-label="session.title"
                                :aria-current="session.id === currentSession ? 'true' : undefined"
                                :data-strip-session="session.id"
                                data-rail-item
                                @click="emit('open-session', session.id)"
                            >{{ initial(session.title) }}</button>
                        </Tooltip>
                    </div>
                </template>
                <div v-else class="acv-segment__list" data-messages-list-panel>
                    <AgentMessagesList
                        ref="listRef"
                        v-model:bot-query="botQuery"
                        :tab="props.tab"
                        :sections="props.sections"
                        :selected-contact="currentBot"
                        :now="props.now"
                        :locale="props.locale"
                        @update:tab="emit('update:tab', $event)"
                        @open-contact="emit('open-contact', $event)"
                        @retry-contacts="emit('retry-contacts', $event)"
                        @escape-search="emit('escape-search')"
                    >
                        <template #sessions><slot name="sessions" /></template>
                    </AgentMessagesList>
                </div>
            </div>
        </Teleport>
        <Teleport :to="props.targets?.foot ?? 'body'" :disabled="props.targets === null">
            <!-- 展开时整段藏起来（列表底部的导航接替），Teleport 的目标不拆：收起时原地回来。 -->
            <div ref="footRef" class="acv-segment__foot" :hidden="props.expanded" @focusin="onFocusIn" @focusout="onFocusOut">
                <Tooltip :text="t('messages.allBots')" :side="props.tooltipSide">
                    <button
                        type="button"
                        class="acv-segment__item nb-ui-focus-ring"
                        :aria-label="t('messages.allBots')"
                        data-messages-open="bot"
                        data-rail-item
                        @click="openPage('bot')"
                    >
                        <span class="i-lucide-bot acv-segment__icon" aria-hidden="true" />
                        <span
                            v-if="unreadTotal > 0"
                            class="acv-segment__count"
                            data-messages-summary
                            :data-messages-summary-waiting="anyWaiting ? '' : undefined"
                            aria-hidden="true"
                        >{{ unreadTotal > 99 ? "99+" : unreadTotal }}</span>
                        <span v-else-if="anyWaiting" class="acv-segment__dot" data-messages-summary data-messages-summary-waiting aria-hidden="true" />
                    </button>
                </Tooltip>
                <Tooltip :text="t('messages.history')" :side="props.tooltipSide">
                    <button
                        type="button"
                        class="acv-segment__item nb-ui-focus-ring"
                        :aria-label="t('messages.history')"
                        data-messages-open="sessions"
                        data-rail-item
                        @click="openPage('sessions')"
                    >
                        <span class="i-lucide-history acv-segment__icon" aria-hidden="true" />
                    </button>
                </Tooltip>
            </div>
        </Teleport>
    </div>
</template>

<style scoped>
/* 送进侧轨时根是空的，不占位。画在自己的位置上时是一列：中段撑满、底段贴底。 */
.acv-segment {
    display: contents;
}

.acv-segment--inline {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.acv-segment__main {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-height: 0;
    padding-block: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
}

.acv-segment__main--expanded {
    position: relative;
    align-items: stretch;
    padding-block: 0;
    overflow: hidden;
}

.acv-segment__toggle-slot {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    width: 100%;
}

/*
 * 展开时按钮在列表区右上角，与第一行的搜索框同一条中线（搜索行上内边距 8、框高 28，按钮 26）；
 * 列表第一行按 `--acv-list-inset-end` 让出它的宽与间距（见下面 `.acv-segment__list`）。
 */
.acv-segment__toggle-slot--expanded {
    position: absolute;
    top: 9px;
    right: 8px;
    z-index: 1;
    width: auto;
}

.acv-segment__toggle-slot--expanded .acv-segment__toggle {
    width: 26px;
    height: 26px;
}

.acv-segment__toggle-slot--expanded .acv-segment__icon {
    width: 16px;
    height: 16px;
}

.acv-segment__row {
    position: relative;
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    width: 100%;
}

/* 当前 bot：头像外侧（侧轨外缘，右边）一条竖条，不随悬停变；换当前 bot 时旧的淡出、新的淡入。 */
.acv-segment__bar {
    position: absolute;
    top: 8px;
    bottom: 8px;
    inset-inline-end: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    background: var(--accent-main);
    opacity: 0;
    transition: opacity var(--motion-fast), background-color var(--motion-fast);
}

.acv-segment__bar[data-shown] {
    opacity: 1;
}

[data-rail-weak] .acv-segment__bar {
    background: var(--border-strong);
}

.acv-segment__item {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--skin-activitybar-foreground, var(--text-muted));
    font: inherit;
    cursor: pointer;
    transition: background-color var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
}

.acv-segment__item:hover {
    background: var(--skin-activitybar-hover, var(--bg-hover));
    color: var(--skin-activitybar-active, var(--text-main));
}

.acv-segment__item--bot {
    border-radius: 50%;
}

.acv-segment__avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
}

.acv-segment__avatar--initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.acv-segment__item--more {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
}

/* 会话方块：写标题首字；当前会话描边（只突出这一层，不另加底色）。 */
.acv-segment__item--session {
    width: 30px;
    height: 30px;
    margin-block: 3px;
    border-radius: 7px;
    background: var(--bg-subtle);
    box-shadow: inset 0 0 0 var(--border-w) var(--border-color);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
}

.acv-segment__item--session[aria-current="true"] {
    box-shadow: inset 0 0 0 1.5px var(--accent-main);
    color: var(--text-main);
}

[data-rail-weak] .acv-segment__item--session[aria-current="true"] {
    box-shadow: inset 0 0 0 1.5px var(--border-strong);
}

.acv-segment__icon {
    width: 18px;
    height: 18px;
}

/* 未读：右上角的数字徽标。等你处理：warning 色的圆点，和数字徽标形状不同。 */
.acv-segment__count {
    position: absolute;
    top: 0;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent-main);
    color: var(--text-inverse);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    pointer-events: none;
}

/* 汇总里有等你处理：warning 色，并且换成方角，不只靠颜色区分（有的主题里强调色与 warning 同色）。 */
.acv-segment__count[data-messages-summary-waiting] {
    border-radius: 4px;
    background: var(--status-warning);
}

.acv-segment__dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 9px;
    height: 9px;
    border: 2px solid var(--skin-activitybar-surface, var(--panel-surface));
    border-radius: 50%;
    background: var(--status-warning);
    pointer-events: none;
}

.acv-segment__divider {
    flex-shrink: 0;
    width: 20px;
    height: 1px;
    margin-block: 4px;
    background: var(--border-color);
}

.acv-segment__foot[hidden] {
    display: none;
}

.acv-segment__foot {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding-top: 4px;
}

/* 画在自己的位置上（浮动窗）时贴底留 8px；送进右轨时底部的余地是侧轨的。 */
.acv-segment--inline .acv-segment__foot {
    padding-bottom: 8px;
}

/* 展开后的列表晚于宽度过渡淡入：宽度长出来的过程中不挤着显示名字。减少动效时两个时长令牌都是 0，直接显示。 */
.acv-segment__list {
    --acv-list-inset-end: 30px;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    animation: acv-segment-list-in var(--motion-base) var(--motion-layout) both;
}

@keyframes acv-segment-list-in {
    from {
        opacity: 0;
    }
}
</style>
