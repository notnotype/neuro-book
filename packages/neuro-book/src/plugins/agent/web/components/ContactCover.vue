<script setup lang="ts">
/**
 * 聊天区上的盖层（同名 .md）：点联系人到聊天出现之间（没有模型、正在打开、打不开），还没选 bot，或面板里找不到 bot。只发事件。
 */
import {Button, IconButton, Spinner} from "@notnotype/nb-ui/components";

import type {PendingContact} from "../contact-opener";
import {useAgentPageText} from "../text";

defineOptions({name: "ContactCover"});

export type ContactCoverState =
    | {readonly kind: "pick-bot"}
    | {readonly kind: "missing"}
    | {readonly kind: "pending"; readonly pending: PendingContact};

const props = defineProps<{
    cover: ContactCoverState;
    /** 右上角画“关闭”（书房的面板）：盖层盖住了对话的头，头上的“关闭”这时点不到。 */
    closable?: boolean;
}>();

const emit = defineEmits<{
    (e: "add-provider"): void;
    (e: "retry", key: string): void;
    (e: "close"): void;
    /** 还没选 bot 时的按钮：等同视图段的“全部 bot”（conversation.md 输出 57）。 */
    (e: "show-bots"): void;
}>();

const t = useAgentPageText();
</script>

<template>
    <div class="contact-cover" data-messages-cover>
        <IconButton v-if="props.closable" size="xs" icon-class="i-lucide-x" class="contact-cover__close" :title="t('conversation.desk.close')" :aria-label="t('conversation.desk.close')" data-messages-cover-close @click="emit('close')" />
        <template v-if="props.cover.kind === 'pick-bot'">
            <p class="contact-cover__body" data-messages-pick-bot>{{ t("conversation.messages.pickBot") }}</p>
            <Button variant="primary" size="sm" data-messages-pick-bot-open @click="emit('show-bots')">{{ t("conversation.messages.allBots") }}</Button>
        </template>
        <p v-else-if="props.cover.kind === 'missing'" class="contact-cover__body" data-messages-missing>{{ t("conversation.messages.missing") }}</p>
        <template v-else-if="props.cover.pending.step === 'no-model'">
            <span class="i-lucide-plug-zap contact-cover__icon" aria-hidden="true" />
            <p class="contact-cover__title">{{ t("conversation.messages.noModel.title") }}</p>
            <p class="contact-cover__body">{{ t("conversation.messages.noModel.body") }}</p>
            <Button size="sm" variant="primary" data-messages-add-provider @click="emit('add-provider')">{{ t("conversation.messages.noModel.action") }}</Button>
        </template>
        <template v-else-if="props.cover.pending.step === 'opening'">
            <Spinner />
            <p class="contact-cover__body" data-messages-opening>{{ t("conversation.messages.opening") }}</p>
        </template>
        <template v-else>
            <p class="contact-cover__body" data-messages-open-failed>{{ t("conversation.messages.openFailed", {name: props.cover.pending.name, code: props.cover.pending.code ?? ""}) }}</p>
            <Button variant="primary" size="sm" data-messages-open-retry @click="props.cover.kind === 'pending' && emit('retry', props.cover.pending.key)">{{ t("conversation.messages.retry") }}</Button>
        </template>
    </div>
</template>

<style scoped>
.contact-cover {
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

.contact-cover__close {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
}

.contact-cover__icon {
    width: 24px;
    height: 24px;
    color: var(--text-muted);
}

.contact-cover__title {
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: 600;
}

.contact-cover__body {
    max-width: 32ch;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
