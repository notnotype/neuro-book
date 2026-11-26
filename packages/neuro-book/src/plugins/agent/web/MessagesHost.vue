<script setup lang="ts">
/**
 * “消息”视图（docs/specs/agent/conversation.md 输出 1–3、53、57，docs/specs/bots/view.md）：nb-agent-ui 的 `AgentMessages` 外框，聊天区是右栏
 * 这个位置的对话（`ConversationHost`），视图段借给右轨（docs/specs/workbench/views.md 输出 21）：收着是 bot、新对话与最近会话，展开是完整列表，
 * 列表的会话一页是会话面板（`SessionPanelHost`），bot 一页是各归属插件的联系人。
 *
 * 视图段在哪、展开没有由工作台给（`viewRailOf`）：停靠时送进右轨的 `main`、`foot`，浮成只有它一个标签的窗时画在窗的右边缘，别的时候不画。
 * 展开只经 `request` 向工作台要：要过预算，窗口太窄时不展开。停靠时对话的头总是接管面板头的标题区（输出 44），左列不画“新建”（挪进了视图段），
 * 按标题不开列表；浮成窗时自绘整个头（`VIEW_OWN_HEAD`，见 `plugin.ts`），工作台此刻不看 `claim`。
 *
 * 点联系人到聊天出现之间（没有模型、正在取主对话、取不到）由这里持有一个选择，在聊天区上面盖一层（`ContactCover`）；盖层与聊天区是
 * 兄弟元素，宿主的对话不卸载，盖着时设 `inert`，焦点与读屏只到盖层。
 */
import {computed, nextTick, onBeforeUnmount, ref} from "vue";

import {AgentMessages} from "@notnotype/nb-agent-ui/vue";
import type {MessagesSegmentPlacement} from "@notnotype/nb-agent-ui/vue";

import {viewHeadOf, viewRailOf} from "nbook/plugins/workbench/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

import type {SessionOwnerProvider} from "../shared/contracts";
import type {ActivityItem} from "../shared/remote";
import ContactCover from "./components/ContactCover.vue";
import type {ContactCoverState} from "./components/ContactCover.vue";
import ConversationHost from "./ConversationHost.vue";
import {MESSAGES_HEAD_BAND} from "./messages-head";
import {createMessagesModel} from "./messages-model";
import type {SessionHost} from "./session-host";
import type {SessionListStore} from "./session-list";
import SessionPanelHost from "./SessionPanelHost.vue";
import {useAgentPageText} from "./text";
import {useWindowFocus} from "./window-focus";

const props = defineProps<{
    context: ViewContext;
    /** 交给 `ConversationHost` 的全部属性（不含 `head` 与 `titleAction`，这里给）。 */
    conversation: Omit<InstanceType<typeof ConversationHost>["$props"], "head" | "titleAction">;
    host: SessionHost;
    list: SessionListStore;
    providers: readonly {readonly plugin: string; readonly provider: SessionOwnerProvider}[];
    activity: readonly ActivityItem[];
    /** 有没有可用的模型：没有为 false，还没读到为 null。 */
    hasModel: boolean | null;
    openModelSettings: () => void;
}>();

const t = useAgentPageText();

// ─── 头 ──────────────────────────────────────────────────────────────────

const head = viewHeadOf(props.context);
const ownHead = computed(() => head?.ownHead.value === true);
/** 自绘头时给 nb-agent-ui 的头高与右端让位（工作台把盖在右端的按钮宽度写在内容上）。 */
const ownHeadStyle = computed(() => (ownHead.value ? {"--acv-head-height": `${MESSAGES_HEAD_BAND}px`, "--acv-head-inset-end": "var(--workbench-own-head-inset-end, 0px)"} : undefined));
// 停靠时总是接管面板头（输出 44、57）；浮成窗时工作台不看它。在 setup 里同步写，首帧不翻。
if (head !== null) {
    head.claim.value = true;
    head.titlePopup.value = null;
}
onBeforeUnmount(() => {
    if (head !== null) head.titlePopup.value = null;
});
/** 按标题不开列表：列表由右轨展开（输出 44 的 planned）。给一个空操作，`ConversationHost` 就不开它自己的下拉。 */
const titleAction = (): void => undefined;

// ─── 视图段 ───────────────────────────────────────────────────────────────

const rail = viewRailOf(props.context);
/** 工作台给的位置换成 nb-agent-ui 的：浮动窗是右边缘，侧轨的两个位置原样交过去（两边都写成 `object`，外框按元素收下）。 */
const placement = computed((): MessagesSegmentPlacement => {
    const current = rail?.placement.value ?? {kind: "none" as const};
    return current.kind === "window" ? {kind: "edge", width: current.width} : current;
});
const expanded = computed(() => rail?.expanded.value === true);
/** 停靠着、区域隐藏或拖到零（视图此刻不可见）：“当前”退成弱描边。 */
const weak = computed(() => placement.value.kind === "rail" && !props.context.visible.value);
/** bot 页的搜索词：视图段收起时列表拿掉，留在这里（会话页的在会话列表的状态里）。 */
const botQuery = ref("");

// ─── 联系人、选择与“看到”（`messages-model.ts`） ─────────────────────────

const model = createMessagesModel({
    host: props.host,
    providers: () => props.providers,
    activity: () => props.activity,
    hasModel: () => props.hasModel,
    sessions: () => props.list.roots.value,
    selectSession: (id) => props.host.act({type: "session.select", sessionId: id}),
    texts: {contactsFailed: (code) => t("conversation.messages.contactsFailed", {code}), untitled: () => t("conversation.messages.untitled")},
});
const {sections, selected, tab, pending, pickBot, recentSessions} = model;
const cover = computed((): ContactCoverState | null => {
    if (pickBot.value) return {kind: "pick-bot"};
    return pending.value === null ? null : {kind: "pending", pending: pending.value};
});

const messagesRef = ref<InstanceType<typeof AgentMessages> | null>(null);
const conversationRef = ref<InstanceType<typeof ConversationHost> | null>(null);
const focusComposer = (): void => {
    void nextTick(() => conversationRef.value?.focusComposer());
};

/** “全部 bot”“会话历史”“+N”：切页、请求展开，展开好了聚焦这一页的搜索框（输出 57 的“展开”）。窗口太窄时工作台不展开、按钮上给“窗口太窄”。 */
async function showList(page: "bot" | "sessions"): Promise<void> {
    tab.value = page;
    if (rail === null) return;
    const result = await rail.request(true);
    if (result === "done") messagesRef.value?.focusSearch(page);
}

function openSession(id: string): void {
    model.openSession(id);
    focusComposer();
}

/** 新对话也要先选 Profile（同对话头里的“新建”）；取消了不建。 */
async function newSession(): Promise<void> {
    const profile = await props.conversation.pickProfile();
    if (profile === null) return;
    props.host.act(profile === undefined ? {type: "session.create"} : {type: "session.create", profileKey: profile});
    focusComposer();
}

const focused = useWindowFocus();
model.watchSeen(() => props.context.visible.value && focused.value);
</script>

<template>
    <div class="h-full w-full" :style="ownHeadStyle" data-messages-host>
        <AgentMessages
            ref="messagesRef"
            v-model:tab="tab"
            v-model:bot-query="botQuery"
            :placement="placement"
            :expanded="expanded"
            :weak="weak"
            :sections="sections"
            :selected="selected"
            :recent-sessions="recentSessions"
            :now="props.list.now.value"
            @open-contact="(key: string) => void model.openContact(key)"
            @retry-contacts="model.retryContacts"
            @open-session="openSession"
            @new-session="() => void newSession()"
            @show-list="(page: 'bot' | 'sessions') => void showList(page)"
            @escape-search="focusComposer"
        >
            <div class="relative flex h-full min-h-0 w-full flex-col">
                <!-- 盖着时下面的对话不可用：焦点与读屏只到盖层（ConversationHost 有两个根，`inert` 透传不下去，包一层）。 -->
                <div class="flex h-full min-h-0 w-full flex-col" :inert="cover !== null">
                    <ConversationHost ref="conversationRef" v-bind="props.conversation" :head="head" :title-action="titleAction" no-new-session />
                </div>
                <ContactCover v-if="cover !== null" :cover="cover" @add-provider="props.openModelSettings()" @retry="(key: string) => void model.openContact(key)" @show-bots="() => void showList('bot')" />
            </div>
            <template #sessions>
                <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.conversation.pickProfile" :labels="props.conversation.labels" @opened="() => { model.sessionOpened(); focusComposer(); }" />
            </template>
        </AgentMessages>
    </div>
</template>
