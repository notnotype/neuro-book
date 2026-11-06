<script setup lang="ts">
/** 用户消息就地变成的编辑器（docs/specs/agent/conversation.md 输出 25）。这一版只改文字。 */
import {computed, nextTick, onMounted, ref} from "vue";
import {Button} from "@notnotype/nb-ui/components";

import {useAgentText} from "../host";

const props = defineProps<{
    text: string;
    /** 原文还在加载：只读。 */
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "submit", text: string): void;
    (e: "cancel"): void;
}>();

const {t} = useAgentText();

const value = ref(props.text);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const canSubmit = computed(() => !props.loading && value.value.trim() !== "");

function fit(): void {
    const element = inputRef.value;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
}

function submit(): void {
    if (canSubmit.value) emit("submit", value.value);
}

function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
    }
    else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
    }
}

onMounted(() => void nextTick(() => {
    fit();
    inputRef.value?.focus();
}));
</script>

<template>
    <div class="acv-message-editor" data-message-editor>
        <textarea
            ref="inputRef"
            v-model="value"
            class="acv-message-editor__input"
            rows="1"
            :readonly="props.loading"
            :aria-label="t('messageEditor.label')"
            @input="fit"
            @keydown="onKeydown"
        />
        <div class="acv-message-editor__tools">
            <span class="acv-message-editor__hint">{{ t("messageEditor.hint") }}</span>
            <Button size="sm" variant="secondary" data-message-editor-cancel @click="emit('cancel')">{{ t("messageEditor.cancel") }}</Button>
            <Button size="sm" :disabled="!canSubmit" data-message-editor-submit @click="submit">{{ t("messageEditor.submit") }}</Button>
        </div>
    </div>
</template>

<style scoped>
.acv-message-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--focus-outline);
    border-radius: var(--nb-agent-bubble-radius);
    background: var(--bg-panel);
}

.acv-message-editor__input {
    width: 100%;
    max-height: 40vh;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-main);
    font: inherit;
}

.acv-message-editor__tools {
    display: flex;
    align-items: center;
    gap: 6px;
}

.acv-message-editor__hint {
    min-width: 0;
    flex: 1;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
