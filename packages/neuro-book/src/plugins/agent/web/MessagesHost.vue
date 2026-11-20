<script setup lang="ts">
/**
 * “消息”视图（docs/specs/agent/conversation.md 输出 1–3、53，docs/specs/bots/view.md）：nb-agent-ui 的 `AgentMessages` 外框，聊天区是右栏
 * 这个位置的对话（`ConversationHost`），会话一页是会话面板（`SessionPanelHost`），bot 一页是各归属插件的联系人。
 *
 * 版式由视图根的大小定：宽不小于 600、高不小于 360 像素是宽版（列表栏常驻，对话的头画在聊天区上方，交还面板头的标题区），其余是窄版（头像列
 * 加抽屉，对话的头接管面板头，按标题开抽屉）。量到 null 或 0（还没挂上、区域拖到零）时保持上一次的版式。
 *
 * 点联系人到聊天出现之间（没有模型、正在取主对话、取不到）由这里持有一个选择，在聊天区上面盖一层；盖层与聊天区是兄弟元素，宿主的对话不卸载。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {AgentMessages} from "@notnotype/nb-agent-ui/vue";
import {useLayoutExtent} from "@notnotype/nb-layout/vue";
import {Button, Spinner} from "@notnotype/nb-ui/components";

import {viewHeadOf} from "nbook/plugins/workbench/shared/contracts";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

import type {SessionOwnerProvider} from "../shared/contracts";
import type {ActivityItem} from "../shared/remote";
import ConversationHost from "./ConversationHost.vue";
import {createMessagesModel} from "./messages-model";
import type {SessionHost} from "./session-host";
import type {SessionListStore} from "./session-list";
import SessionPanelHost from "./SessionPanelHost.vue";
import {useAgentPageText} from "./text";

/** 版式与列表栏收起的记忆：插件作用域一份，视图换代、重新挂上时接着用（首帧就按它定接管与否，不翻）。 */
export interface MessagesMemory {
    layout: "wide" | "narrow";
    listCollapsed: boolean;
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
// 窄版接管面板头（对话的头在标题区里，按标题开抽屉）；宽版交还，头画在聊天区上方（t15 决定 6）。在 setup 里同步写初值，首帧不翻。
if (head !== null) head.claim.value = layout.value === "narrow";
watch(layout, (next) => {
    if (head !== null) head.claim.value = next === "narrow";
});

const listCollapsed = ref(props.memory.listCollapsed);
watch(listCollapsed, (collapsed) => {
    props.memory.listCollapsed = collapsed;
});
const drawerOpen = ref(false);
watch(drawerOpen, (open) => {
    if (head !== null) head.titlePopup.value = layout.value === "narrow" ? {expanded: open} : null;
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
    sessions: () => props.list.items.value,
    selectSession: (id) => props.host.act({type: "session.select", sessionId: id}),
    texts: {contactsFailed: (plugin, code) => t("conversation.messages.contactsFailed", {name: plugin, code}), untitled: () => t("conversation.messages.untitled")},
});
const {sections, selected, tab, pending, pickBot, recentSessions} = model;

function openSession(id: string): void {
    model.openSession(id);
    drawerOpen.value = false;
}
function onSessionOpened(): void {
    model.sessionOpened();
    drawerOpen.value = false;
}

/** 窗口有没有焦点：视图可见还不够，切到别的程序时不算看到（bots/view.md 输出 4）。 */
const focused = ref(typeof document === "undefined" ? true : document.hasFocus());
const onFocus = (): void => {
    focused.value = true;
};
const onBlur = (): void => {
    focused.value = false;
};
onMounted(() => {
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
});
onBeforeUnmount(() => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
});
model.watchSeen(() => props.context.visible.value && focused.value);
</script>

<template>
    <div ref="rootRef" class="h-full w-full" data-messages-host>
        <AgentMessages
            v-model:list-collapsed="listCollapsed"
            v-model:drawer-open="drawerOpen"
            v-model:tab="tab"
            :layout="layout"
            :sections="sections"
            :selected="selected"
            :recent-sessions="recentSessions"
            :drawer-anchor="drawerAnchor"
            :now="props.list.now.value"
            @open-contact="(key: string) => void model.openContact(key)"
            @retry-contacts="model.retryContacts"
            @open-session="openSession"
        >
            <div class="relative flex h-full min-h-0 w-full flex-col">
                <ConversationHost v-bind="props.conversation" :head="head" :title-action="() => (drawerOpen = !drawerOpen)" />
                <div v-if="pending !== null || pickBot" class="messages-host__cover" data-messages-cover>
                    <template v-if="pickBot">
                        <p class="messages-host__body" data-messages-pick-bot>{{ t("conversation.messages.pickBot") }}</p>
                    </template>
                    <template v-else-if="pending!.step === 'no-model'">
                        <span class="i-lucide-plug-zap messages-host__icon" aria-hidden="true" />
                        <p class="messages-host__title">{{ t("conversation.messages.noModel.title") }}</p>
                        <p class="messages-host__body">{{ t("conversation.messages.noModel.body") }}</p>
                        <Button size="sm" variant="primary" data-messages-add-provider @click="props.openModelSettings()">{{ t("conversation.messages.noModel.action") }}</Button>
                    </template>
                    <template v-else-if="pending!.step === 'opening'">
                        <Spinner />
                        <p class="messages-host__body" data-messages-opening>{{ t("conversation.messages.opening") }}</p>
                    </template>
                    <template v-else-if="pending!.step === 'failed'">
                        <p class="messages-host__body" data-messages-open-failed>{{ t("conversation.messages.openFailed", {name: pending!.name, code: pending!.code ?? ""}) }}</p>
                        <Button size="sm" data-messages-open-retry @click="void model.openContact(pending!.key)">{{ t("conversation.messages.retry") }}</Button>
                    </template>
                </div>
            </div>
            <template #sessions>
                <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.conversation.pickProfile" :labels="props.conversation.labels" @opened="onSessionOpened" />
            </template>
        </AgentMessages>
    </div>
</template>

<style scoped>
.messages-host__cover {
    position: absolute;
    z-index: 5;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--bg-panel);
    text-align: center;
}

.messages-host__icon {
    width: 24px;
    height: 24px;
    color: var(--text-muted);
}

.messages-host__title {
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: 600;
}

.messages-host__body {
    max-width: 32ch;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
