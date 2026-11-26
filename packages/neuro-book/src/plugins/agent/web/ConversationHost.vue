<script setup lang="ts">
/**
 * 对话位置的组件：右栏的视图和编辑区的页面是同一个。状态都在插件级的宿主里（`session-host.ts`），这里借用它，把视图接上，再放切换会话的面板。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch} from "vue";

import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationServices, AgentViewAction, AgentViewRegistry, AgentWelcomeView, StatusLineSetting} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";

import SkillInitDialog from "./components/SkillInitDialog.vue";
import type {SessionHost} from "./session-host";
import type {SkillInit} from "./skill-init";
import type {RecentSessions, SessionListStore} from "./session-list";
import {subagentStoreKey, toolActionKey, toolActionOf} from "./subagent-store";
import SessionPanelHost from "./SessionPanelHost.vue";
import {watchPaint} from "./paint-metric";
import type {PaintPosition, PaintRecord} from "./paint-metric";
import SubagentsEntry from "./components/SubagentsEntry.vue";
import type {ProfileEntry} from "../shared/contracts";
import type {RunResults, SeenErrors} from "./subagents-panel";
import type {ViewHead} from "nbook/plugins/workbench/shared/contracts";

const props = defineProps<{
    host: SessionHost;
    list: SessionListStore;
    /** 第一屏的最近对话，第一屏出现时这里刷新它。 */
    recent: RecentSessions;
    welcome: AgentWelcomeView;
    draftProfile: {readonly name: string; readonly icon: string} | null;
    registry: AgentViewRegistry;
    renderers: AgentViewRenderers;
    services: AgentConversationServices;
    pickProfile: () => Promise<string | null | undefined>;
    labels: {readonly renameTitle: string; readonly rename: string; readonly cancel: string};
    /** 选了未初始化的 Skill 时的确认框（skills.md 输出 27）。 */
    skillInit: SkillInit;
    /** 子代理入口要的（conversation.md 输出 43）：Profile 名、插件作用域的出错看过没有与收口结果。 */
    subagents: {readonly profiles: readonly ProfileEntry[]; readonly seen: SeenErrors; readonly results: RunResults};
    /** 右栏的视图接管了面板头时工作台给的标题区（views.md 输出 19）；编辑区页面没有。 */
    head?: ViewHead | null;
    /** 状态栏的设置与它的两个动作（conversation.md 输出 45）：勾选改设置、“状态栏设置…”打开设置分区。 */
    statusLine: {readonly setting: StatusLineSetting; toggle(id: string): void; openSettings(): void};
    /**
     * 按面板头的标题做什么：不给时开头里的会话列表下拉（编辑区页面）；消息视图给开抽屉，列表在消息视图里，没有下拉，`titlePopup` 也由它写。
     */
    titleAction?: (() => void) | null;
    /** 放在可关的面板里（书房的看板娘面板）：头的右列最后画“关闭”，点它与输入框里按 Esc 都调它。 */
    close?: (() => void) | null;
    /** 不放会话列表（头的标题下拉）：书房的面板里只开 bot 的主对话。没传的布尔属性 Vue 当成 false，所以写成反向的。 */
    noSessionList?: boolean;
    /** 首屏指标（conversation.md 输出 56）：这个位置叫什么、记到哪。 */
    paint?: {readonly position: PaintPosition; readonly now: () => number; readonly record: (level: "info" | "warning", record: PaintRecord) => void} | null;
}>();

const rootRef = ref<InstanceType<typeof AgentConversationView> | null>(null);

// 子代理与后台命令卡片的数据：按宿主（这个对话位置的当前会话）一份，卡片注入，不进 ctx。
provide(subagentStoreKey, props.host.subagents);
provide(toolActionKey, (tool) => toolActionOf(props.registry, tool));

/**
 * 头送进面板头的三列（视图的 `headTargets`）：面板头画出位置时送过去，成了标签条、浮动窗等不给位置时回到内容里。位置是工作台的
 * 元素，共用合同里写成 `object`，这里按元素收下。
 */
const headTargets = computed(() => {
    const slots = props.head?.slots.value ?? null;
    if (slots === null) return null;
    const {start, title, end, handle} = slots;
    return start instanceof HTMLElement && title instanceof HTMLElement && end instanceof HTMLElement && handle instanceof HTMLElement ? {start, title, end, anchor: handle} : null;
});
/** 会话列表开着没有：本地持有，按面板头的标题切换、写回标题按钮的 `aria-expanded`；头回到内容里时照旧开着。 */
const sessionsOpen = ref(false);
const ownList = computed(() => !props.noSessionList && (props.titleAction === undefined || props.titleAction === null));
watch(sessionsOpen, (open) => {
    if (props.head && ownList.value) props.head.titlePopup.value = {expanded: open};
}, {immediate: true});

let giveBack: (() => void) | null = null;
let stopTitlePress: (() => void) | null = null;
let stopPaint: (() => void) | null = null;
/** 视图画出下一帧：Vue 先把这次的改动写进 DOM，再等浏览器画一帧、下一帧开始时就画过了。 */
const afterPaint = (): Promise<void> => nextTick().then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const page = {
    visible: () => document.visibilityState === "visible",
    onHidden: (listener: () => void) => {
        const onChange = (): void => {
            if (document.visibilityState === "hidden") listener();
        };
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
    },
};
onMounted(() => {
    // 先挂上指标再借用：借用可能就地开始重新订阅（`reattach`），起点要被看到。
    if (props.paint) stopPaint = watchPaint({host: props.host, position: props.paint.position, now: props.paint.now, afterPaint, page, record: props.paint.record});
    giveBack = props.host.borrow();
    void props.host.restore();
    stopTitlePress = props.head?.onTitlePress(() => {
        if (props.titleAction) props.titleAction();
        else sessionsOpen.value = !sessionsOpen.value;
    }) ?? null;
});
onBeforeUnmount(() => {
    stopPaint?.();
    giveBack?.();
    stopTitlePress?.();
    if (props.head && ownList.value) props.head.titlePopup.value = null;
});

// 第一屏出现时（切到没有消息的会话、新建、没选会话）重取最近对话：别处新建、改名、归档过，这里不知道（conversation.md 输出 41）。
// 两个源分别比较：getter 交回新数组时 ctx 每变一次都算变了，第一屏开着期间会一直重取。
watch([() => props.host.ctx.value.session?.id ?? null, () => props.host.ctx.value.messages.length === 0], ([, empty]) => {
    if (empty) void props.recent.refresh();
}, {immediate: true});

/** 顶栏的新建也要先选 Profile。 */
async function onAction(action: AgentViewAction): Promise<void> {
    if (action.type === "statusLine.toggle") {
        props.statusLine.toggle(action.id);
        return;
    }
    if (action.type === "statusLine.openSettings") {
        props.statusLine.openSettings();
        return;
    }
    if (action.type !== "session.create" || action.profileKey !== undefined) {
        props.host.act(action);
        return;
    }
    const profile = await props.pickProfile();
    if (profile !== null) props.host.act(profile === undefined ? action : {...action, profileKey: profile});
}

defineExpose({focusComposer: () => rootRef.value?.focusComposer()});
</script>

<template>
    <AgentConversationView
        ref="rootRef"
        class="h-full w-full"
        :ctx="props.host.ctx.value"
        :services="props.services"
        :registry="props.registry"
        :renderers="props.renderers"
        status-bar
        new-session
        :welcome="props.welcome"
        :draft-profile="props.draftProfile"
        :status-line="props.statusLine.setting"
        :head-targets="headTargets"
        :head-window-drag="props.head?.ownHead.value === true"
        :sessions-open="sessionsOpen"
        :closable="typeof props.close === 'function'"
        @update:sessions-open="(open: boolean) => (sessionsOpen = open)"
        @action="onAction"
        @close="props.close?.()"
        @escape="props.close?.()"
    >
        <template v-if="ownList" #sessions="{close}">
            <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.pickProfile" :labels="props.labels" @opened="close()" />
        </template>
        <template #head-trailing>
            <SubagentsEntry
                :profiles="props.subagents.profiles"
                :seen="props.subagents.seen"
                :results="props.subagents.results"
                @select="(sessionId: string) => props.host.act({type: 'session.select', sessionId})"
            />
        </template>
    </AgentConversationView>
    <SkillInitDialog
        :open="props.skillInit.state.value.open"
        :name="props.skillInit.state.value.name"
        :phase="props.skillInit.state.value.phase"
        :plan="props.skillInit.state.value.plan"
        :failure="props.skillInit.state.value.failure"
        @update:open="(open: boolean) => open || props.skillInit.close()"
        @confirm="void props.skillInit.confirm()"
    />
</template>
