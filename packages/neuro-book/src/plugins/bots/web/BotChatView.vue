<script setup lang="ts">
/**
 * bot 视图（docs/specs/bots/view.md）：第一版只有一个 bot，视图里直接是它的聊天。没有模型时只显示引导、不取主对话；bot 列表读不到
 * 或是空的时写原因与重试，不一直转圈；取到主对话之后画
 * `nbook.agent` 交出的固定会话组件。可见且窗口有焦点时把组件报来的 seq 记成“看到”。
 */
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import type {Component} from "vue";

import {Button, Spinner} from "@notnotype/nb-ui/components";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";

import {avatarUrl} from "../shared/contracts";
import type {BotsStore} from "./store";
import {useBotsText} from "./text";

const props = defineProps<{
    context: ViewContext;
    store: BotsStore;
    /** `agentConversationKey` 交出的固定会话组件。 */
    conversation: Component;
}>();

const t = useBotsText();

/**
 * `loading` 是还在等模型与 bot 列表，`opening` 是在取主对话（期间列表再变不重取）。`failed` 分两种：bot 列表读不到或是空的（`list`，重试重读列表，列表到了自动取主对话），取主对话失败（`open`，重试再取一次）。
 */
type ChatState =
    | {readonly kind: "no-model"}
    | {readonly kind: "loading"}
    | {readonly kind: "opening"}
    | {readonly kind: "failed"; readonly step: "list"; readonly code: string | null}
    | {readonly kind: "failed"; readonly step: "open"; readonly code: string}
    | {readonly kind: "ready"; readonly sessionId: string};

const bot = computed(() => props.store.items.value[0] ?? null);
const state = shallowRef<ChatState>({kind: "loading"});
const identity = computed(() => (bot.value === null ? {name: ""} : {name: bot.value.name, avatar: avatarUrl(bot.value.id)}));

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
const active = computed(() => props.context.visible.value && focused.value);

let asking = 0;
async function open(): Promise<void> {
    const target = bot.value;
    if (target === null) return;
    const asked = (asking += 1);
    state.value = {kind: "opening"};
    const ensured = await props.store.ensureMain(target.id);
    if (asked !== asking) return;
    state.value = ensured.ok ? {kind: "ready", sessionId: ensured.sessionId} : {kind: "failed", step: "open", code: ensured.code};
}

// 没有模型时不取主对话（bots/view.md 输出 2）；还没读到有没有模型时先等，免得读到“没有”之前已经建了会话。模型配好了、bot 记录到了
// 才去取。取主对话失败停在原因与重试，列表再变也不自动重取。
watch([props.store.noModel, props.store.listState, bot], ([noModel, list, current]) => {
    if (noModel === true) {
        asking += 1;
        state.value = {kind: "no-model"};
        return;
    }
    const waiting = state.value.kind === "no-model" || state.value.kind === "loading" || (state.value.kind === "failed" && state.value.step === "list");
    if (!waiting) return;
    if (noModel === null || list.kind === "loading") state.value = {kind: "loading"};
    else if (list.kind === "failed") state.value = {kind: "failed", step: "list", code: list.code};
    else if (current === null) state.value = {kind: "failed", step: "list", code: null};
    else void open();
}, {immediate: true});

function retry(): void {
    if (state.value.kind === "failed" && state.value.step === "list") props.store.reload();
    else void open();
}

function seen(seq: number): void {
    if (bot.value !== null) props.store.markSeen(bot.value.id, seq);
}
</script>

<template>
    <div class="bot-chat" data-bot-chat>
        <div v-if="state.kind === 'no-model'" class="bot-chat__notice" data-bot-chat-no-model>
            <span class="i-lucide-plug-zap bot-chat__icon" aria-hidden="true" />
            <p class="bot-chat__title">{{ t("chat.noModel.title") }}</p>
            <p class="bot-chat__body">{{ t("chat.noModel.body") }}</p>
            <Button size="sm" variant="primary" data-bot-chat-add-provider @click="props.store.openProviders()">{{ t("chat.noModel.action") }}</Button>
        </div>
        <div v-else-if="state.kind === 'loading' || state.kind === 'opening'" class="bot-chat__notice" data-bot-chat-loading>
            <Spinner />
            <p class="bot-chat__body">{{ t("chat.loading") }}</p>
        </div>
        <div v-else-if="state.kind === 'failed'" class="bot-chat__notice" data-bot-chat-failed>
            <p class="bot-chat__body">{{ state.step === "open" ? t("chat.failed", {code: state.code}) : state.code === null ? t("chat.noBot") : t("chat.listFailed", {code: state.code}) }}</p>
            <Button size="sm" data-bot-chat-retry @click="retry()">{{ t("chat.retry") }}</Button>
        </div>
        <component
            :is="props.conversation"
            v-else
            :key="state.sessionId"
            :session-id="state.sessionId"
            :identity="identity"
            :active="active"
            @seen="seen"
        />
    </div>
</template>

<style scoped>
.bot-chat {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.bot-chat__notice {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: center;
}

.bot-chat__icon {
    width: 24px;
    height: 24px;
    color: var(--text-muted);
}

.bot-chat__title {
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: 600;
}

.bot-chat__body {
    max-width: 32ch;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
