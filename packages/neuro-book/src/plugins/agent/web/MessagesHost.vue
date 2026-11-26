<script setup lang="ts">
/**
 * “消息”视图（docs/specs/agent/conversation.md 输出 1–3、53，docs/specs/bots/view.md）：nb-agent-ui 的 `AgentMessages` 外框，聊天区是右栏
 * 这个位置的对话（`ConversationHost`），会话一页是会话面板（`SessionPanelHost`），bot 一页是各归属插件的联系人。
 *
 * 版式由视图根的大小定：宽不小于 600、高不小于 360 像素是宽版（列表栏常驻，对话的头画在聊天区上方，交还面板头的标题区），其余是窄版（头像列
 * 加抽屉，对话的头接管面板头，按标题开抽屉）。量到 null 或 0（还没挂上、区域拖到零）时保持上一次的版式。
 *
 * 浮成只有它一个标签的窗时自绘整个头（docs/specs/workbench/views.md 输出 19 的“自绘头”，实现上声明了 `VIEW_OWN_HEAD`，见 `plugin.ts`）：
 * 宽窄两版都没有面板头，列表的切换行、头像列顶上那一行与对话头是第一行、同高，也是窗口的拖动区；工作台此刻不看 `claim`，标题按钮不开抽屉。
 *
 * 点联系人到聊天出现之间（没有模型、正在取主对话、取不到）由这里持有一个选择，在聊天区上面盖一层（`ContactCover`）；盖层与聊天区是
 * 兄弟元素，宿主的对话不卸载，盖着时设 `inert`，焦点与读屏只到盖层。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {AgentMessages} from "@notnotype/nb-agent-ui/vue";
import {useLayoutExtent} from "@notnotype/nb-layout/vue";

import {viewHeadOf} from "nbook/plugins/workbench/shared/contracts";
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

/** 版式、列表栏的收起与宽度的记忆：插件作用域一份，视图换代、重新挂上时接着用（首帧就按它定接管与否，不翻）。 */
export interface MessagesMemory {
    layout: "wide" | "narrow";
    listCollapsed: boolean;
    /** 宽版列表栏的宽度（CSS px）。 */
    listWidth: number;
}

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
    memory: MessagesMemory;
}>();

const t = useAgentPageText();

// ─── 版式 ─────────────────────────────────────────────────────────────

const rootRef = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(rootRef);
const layout = ref<"wide" | "narrow">(props.memory.layout);
watch(extent, (size) => {
    if (size === null || size.width === 0 || size.height === 0) return;
    layout.value = size.width >= 600 && size.height >= 360 ? "wide" : "narrow";
    props.memory.layout = layout.value;
});

const head = viewHeadOf(props.context);
const ownHead = computed(() => head?.ownHead.value === true);
/** 自绘头时给 nb-agent-ui 的头高与右端让位（工作台把盖在右端的按钮宽度写在内容上）。 */
const ownHeadStyle = computed(() => (ownHead.value ? {"--acv-head-height": `${MESSAGES_HEAD_BAND}px`, "--acv-head-inset-end": "var(--workbench-own-head-inset-end, 0px)"} : undefined));
// 窄版接管面板头（对话的头在标题区里，按标题开抽屉）；宽版交还，头画在聊天区上方（t15 决定 6）。在 setup 里同步写初值，首帧不翻。
if (head !== null) head.claim.value = layout.value === "narrow";
watch(layout, (next) => {
    if (head !== null) head.claim.value = next === "narrow";
});

const listCollapsed = ref(props.memory.listCollapsed);
watch(listCollapsed, (collapsed) => {
    props.memory.listCollapsed = collapsed;
});
const listWidth = ref(props.memory.listWidth);
watch(listWidth, (width) => {
    props.memory.listWidth = width;
});
const drawerOpen = ref(false);
// 窄版的标题按钮开抽屉：写它的弹出状态；宽版标题区交还了，自绘头时标题按钮不开抽屉，都不写。版式变了也要重写（例如宽版挂上之后缩到窄版）。
watch([drawerOpen, layout, ownHead], ([open, current, own]) => {
    if (head !== null) head.titlePopup.value = current === "narrow" && !own ? {expanded: open} : null;
}, {immediate: true});
onBeforeUnmount(() => {
    if (head !== null) head.titlePopup.value = null;
});
const drawerAnchor = computed(() => {
    const handle = head?.slots.value?.handle ?? null;
    return handle instanceof HTMLElement ? handle : null;
});

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
/** 选了会话：经外框关抽屉，焦点回到开它的按钮（被选的行跟着收起）。 */
function closeDrawer(): void {
    if (drawerOpen.value) messagesRef.value?.closeDrawer();
}
function openSession(id: string): void {
    model.openSession(id);
    closeDrawer();
}
function onSessionOpened(): void {
    model.sessionOpened();
    closeDrawer();
}

const focused = useWindowFocus();
model.watchSeen(() => props.context.visible.value && focused.value);
</script>

<template>
    <div ref="rootRef" class="h-full w-full" :style="ownHeadStyle" data-messages-host>
        <AgentMessages
            ref="messagesRef"
            v-model:list-collapsed="listCollapsed"
            v-model:list-width="listWidth"
            v-model:drawer-open="drawerOpen"
            v-model:tab="tab"
            :layout="layout"
            :sections="sections"
            :selected="selected"
            :recent-sessions="recentSessions"
            :drawer-anchor="drawerAnchor"
            :window-drag="ownHead"
            :now="props.list.now.value"
            @open-contact="(key: string) => void model.openContact(key)"
            @retry-contacts="model.retryContacts"
            @open-session="openSession"
        >
            <div class="relative flex h-full min-h-0 w-full flex-col">
                <!-- 盖着时下面的对话不可用：焦点与读屏只到盖层（ConversationHost 有两个根，`inert` 透传不下去，包一层）。 -->
                <div class="flex h-full min-h-0 w-full flex-col" :inert="cover !== null">
                    <ConversationHost v-bind="props.conversation" :head="head" :title-action="() => (drawerOpen = !drawerOpen)" />
                </div>
                <ContactCover v-if="cover !== null" :cover="cover" @add-provider="props.openModelSettings()" @retry="(key: string) => void model.openContact(key)" />
            </div>
            <template #sessions>
                <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.conversation.pickProfile" :labels="props.conversation.labels" @opened="onSessionOpened" />
            </template>
        </AgentMessages>
    </div>
</template>
