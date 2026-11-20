<script setup lang="ts">
/**
 * 书房案头的看板娘入口与从右边滑出的聊天（同名 .md；docs/specs/agent/conversation.md 输出 54，docs/specs/bots/view.md）。叠在书架
 * 案头看板娘那一格上（`projects.desk`），猫由书架画，这里画盖在猫上的按钮、角标、气泡与面板，经 `update:mood` 改猫的表情。
 *
 * 面板开着期间自己借用宿主（`host.borrow()`）：打开会话之前一定有借用，面板里的对话组件晚挂上、或面板在它挂上之前就关了，订阅都照
 * 现有的 30 秒规则放开。联系人的打开、盖层与“看到”在 `contact-opener.ts`，与消息视图同一套。
 */
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import type {Component} from "vue";

import {Badge, SidePanel} from "@notnotype/nb-ui/components";

import {entryCountText} from "nbook/plugins/workbench/shared/entry-count";

import type {SessionOwnerProvider} from "../../shared/contracts";
import type {ActivityItem} from "../../shared/remote";
import ContactCover from "./ContactCover.vue";
import type {ContactCoverState} from "./ContactCover.vue";
import {contactKey, createContactOpener} from "../contact-opener";
import type {ContactHostPart} from "../contact-opener";
import {useAgentPageText} from "../text";
import {useWindowFocus} from "../window-focus";

defineOptions({name: "DeskCompanion"});

const props = defineProps<{
    providers: readonly {readonly plugin: string; readonly provider: SessionOwnerProvider}[];
    activity: readonly ActivityItem[];
    /** 有没有可用的模型：没有为 false，还没读到为 null。 */
    hasModel: boolean | null;
    host: ContactHostPart & {borrow(): () => void};
    /** 面板里的对话：收 `close`，暴露 `focusComposer()`。第一次打开时才加载（异步组件）。 */
    conversation: Component;
    openModelSettings: () => void;
    /** 读模型、Profile 与 Skill：点开时调，模型读到之前盖“正在打开”。 */
    ensureStarted: () => void;
}>();

const emit = defineEmits<{
    (e: "update:mood", mood: "ask" | "idle"): void;
}>();

const t = useAgentPageText();

const opener = createContactOpener({
    host: props.host,
    providers: () => props.providers,
    activity: () => props.activity,
    hasModel: () => props.hasModel,
});

/** 入口代表谁：按提供者表的次序，第一个有联系人的归属插件的第一个联系人（第一版只有一个 bot）。 */
const contact = computed(() => {
    for (const {plugin, provider} of props.providers) {
        const first = provider.contacts.value[0];
        if (first !== undefined) return {...first, key: contactKey({plugin, id: first.id}), unread: first.unread ?? 0};
    }
    return null;
});
/** 没有联系人时联系人读不到的原因（写在提示里）；还没读到、bots 停用时没有原因。 */
const failure = computed(() => {
    if (contact.value !== null) return null;
    const failed = props.providers.map(({provider}) => provider.state.value).find((state) => state.kind === "failed");
    return failed?.kind === "failed" ? t("conversation.desk.failed", {code: failed.code}) : null;
});

const waiting = computed(() => contact.value !== null && opener.activityOf(contact.value.sessionId) === "waiting");
watch(waiting, (now) => emit("update:mood", now ? "ask" : "idle"), {immediate: true});

const badge = computed(() => {
    if (contact.value === null) return null;
    if (waiting.value) return {tone: "warning" as const, text: "!"};
    return contact.value.unread > 0 ? {tone: "accent" as const, text: entryCountText(contact.value.unread)} : null;
});
const bubble = computed(() => {
    if (contact.value === null) return null;
    if (waiting.value) return {waiting: true, text: t("conversation.desk.waiting")};
    const last = contact.value.last;
    return contact.value.unread > 0 && last !== null ? {waiting: false, text: last.text} : null;
});
const label = computed(() => {
    const current = contact.value;
    if (current === null) return "";
    if (waiting.value) return t("conversation.desk.labelWaiting", {name: current.name});
    return current.unread > 0 ? t("conversation.desk.labelUnread", {name: current.name, count: current.unread}) : current.name;
});

// ─── 面板 ────────────────────────────────────────────────────────────

const open = ref(false);
let giveBack: (() => void) | null = null;
watch(open, (now) => {
    if (now) {
        giveBack = props.host.borrow();
        props.ensureStarted();
        if (contact.value !== null) void opener.openContact(contact.value.key);
        return;
    }
    // 关着面板时模型配好，不在没人看的宿主上打开会话。
    opener.cancel();
    giveBack?.();
    giveBack = null;
    composerFocused = false;
});
onBeforeUnmount(() => giveBack?.());
// 联系人没了（归属插件停了、bots 停用）：关面板。
watch(contact, (now) => {
    if (now === null) open.value = false;
});
function close(): void {
    open.value = false;
}

/** 盖层：在途的联系人按它的步骤；面板里没有会话时写“找不到 bot”，不露出会隐式新建会话的第一屏。 */
const cover = computed((): ContactCoverState | null => {
    if (opener.pending.value !== null) return {kind: "pending", pending: opener.pending.value};
    return props.host.sessionId.value === null ? {kind: "missing"} : null;
});

const focused = useWindowFocus();
opener.watchSeen(() => open.value && focused.value);

/**
 * 焦点：打开时 Reka 先放进面板；第一次满足“没有盖层、输入框已挂上”时，焦点还在面板里、看板娘或页面上（用户没挪到别处）就放进输入框。
 */
const buttonRef = ref<HTMLButtonElement | null>(null);
const conversationRef = ref<{focusComposer(): void} | null>(null);
let composerFocused = false;
watch(() => open.value && cover.value === null && conversationRef.value !== null, async (ready) => {
    if (!ready || composerFocused) return;
    composerFocused = true;
    await nextTick();
    const active = document.activeElement;
    const panelId = buttonRef.value?.getAttribute("aria-controls") ?? null;
    const panel = panelId === null ? null : document.getElementById(panelId);
    if (active === null || active === document.body || active === buttonRef.value || panel?.contains(active) === true) conversationRef.value?.focusComposer();
});
</script>

<template>
    <div class="desk-companion" :title="failure ?? undefined" data-desk-companion>
        <SidePanel v-if="contact !== null" v-model:open="open" :label="contact.name">
            <template #trigger>
                <button ref="buttonRef" type="button" class="desk-companion__button nb-ui-focus-ring" :aria-label="label" data-desk-companion-button />
            </template>
            <div class="desk-companion__chat" data-desk-chat>
                <!-- 盖着时下面的对话不可用：焦点与读屏只到盖层。 -->
                <div class="desk-companion__conversation" :inert="cover !== null">
                    <component :is="props.conversation" ref="conversationRef" :close="close" />
                </div>
                <ContactCover v-if="cover !== null" :cover="cover" @add-provider="props.openModelSettings()" @retry="(key: string) => void opener.openContact(key)" />
            </div>
        </SidePanel>
        <Badge v-if="badge !== null" size="sm" :tone="badge.tone" class="desk-companion__badge" aria-hidden="true" data-desk-badge>{{ badge.text }}</Badge>
        <div v-if="bubble !== null" class="desk-companion__bubble-anchor" aria-hidden="true">
            <span class="desk-companion__tail" />
            <span class="desk-companion__bubble" :class="{'desk-companion__bubble--waiting': bubble.waiting}" data-desk-bubble>{{ bubble.text }}</span>
        </div>
    </div>
</template>

<style scoped>
/* 铺满看板娘那一格，圆角跟格子（ShelfDesk.md 的约束）。角标与气泡挂在它的边上，气泡不推动案头的布局。 */
.desk-companion {
    position: relative;
    display: grid;
    border-radius: inherit;
}

.desk-companion__button {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
}

.desk-companion__badge {
    position: absolute;
    top: -7px;
    right: -7px;
    pointer-events: none;
}

/* 气泡的锚：格子正下方一条与格子同宽、不占位的带，气泡右对齐、可以往左伸出格子；尖角在带的中线，对准猫。 */
.desk-companion__bubble-anchor {
    position: absolute;
    top: 100%;
    right: 0;
    left: 0;
    display: flex;
    justify-content: flex-end;
    padding-top: 9px;
    pointer-events: none;
}

.desk-companion__tail {
    position: absolute;
    top: 5px;
    left: calc(50% - 5px);
    width: 10px;
    height: 10px;
    rotate: 45deg;
    background: var(--bg-panel);
    box-shadow: -1px -1px 0 0 var(--border-color);
}

.desk-companion__bubble {
    position: relative;
    max-width: 260px;
    width: max-content;
    overflow: hidden;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-panel);
    box-shadow: var(--elevation-raised);
    color: var(--text-main);
    font-size: var(--text-xs);
    line-height: 1.6;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.desk-companion__bubble--waiting {
    color: var(--status-warning);
    font-weight: 600;
}

/* 案头窄了（看板娘 96px）：气泡放不下，只留角标（与 ShelfDesk 同一个容器查询）。 */
@container (max-width: 720px) {
    .desk-companion__bubble-anchor {
        display: none;
    }
}

.desk-companion__chat {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
}

.desk-companion__conversation {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}
</style>
