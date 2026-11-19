<script setup lang="ts">
/**
 * bot 视图（docs/specs/bots/view.md）：第一版只有一个 bot，视图里直接是它的聊天。没有模型时只显示引导、不取主对话；取到主对话之后画
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

type ChatState = {readonly kind: "no-model"} | {readonly kind: "loading"} | {readonly kind: "failed"; readonly code: string} | {readonly kind: "ready"; readonly sessionId: string};

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
    state.value = {kind: "loading"};
    const ensured = await props.store.ensureMain(target.id);
    if (asked !== asking) return;
    state.value = ensured.ok ? {kind: "ready", sessionId: ensured.sessionId} : {kind: "failed", code: ensured.code};
}

// 没有模型时不取主对话（bots/view.md 输出 2）；模型配好了、bot 记录到了才去取。模型服务不在（null）时照常取，对话里有它自己的提示。
watch([props.store.noModel, bot], ([noModel, current]) => {
    if (noModel === true) {
        asking += 1;
        state.value = {kind: "no-model"};
        return;
    }
    if (current !== null && (state.value.kind === "no-model" || state.value.kind === "loading")) void open();
}, {immediate: true});

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
        <div v-else-if="state.kind === 'loading'" class="bot-chat__notice" data-bot-chat-loading>
            <Spinner />
            <p class="bot-chat__body">{{ t("chat.loading") }}</p>
        </div>
        <div v-else-if="state.kind === 'failed'" class="bot-chat__notice" data-bot-chat-failed>
            <p class="bot-chat__body">{{ t("chat.failed", {code: state.code}) }}</p>
            <Button size="sm" data-bot-chat-retry @click="open()">{{ t("chat.retry") }}</Button>
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
