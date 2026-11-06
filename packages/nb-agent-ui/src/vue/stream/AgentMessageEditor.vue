<script setup lang="ts">
/** 用户消息就地变成的编辑器（docs/specs/agent/conversation.md 输出 25）：和输入框同一个注入的编辑器，所以 `@` 与标签一样能用。 */
import {computed, onMounted, ref} from "vue";
import {Button} from "@notnotype/nb-ui/components";

import type {PromptEditorPortExpose} from "../../ports";
import type {AgentConversationServices} from "../../types";
import {useEditorHandle} from "../composer/use-editor-handle";
import {useAgentRenderers, useAgentText} from "../host";

const props = defineProps<{
    text: string;
    /** 原文还在加载：只读。 */
    loading: boolean;
    services?: AgentConversationServices;
}>();

const emit = defineEmits<{
    (e: "submit", text: string): void;
    (e: "cancel"): void;
}>();

const {t, locale} = useAgentText();
const renderers = useAgentRenderers();
const {editorRef, withEditor} = useEditorHandle<PromptEditorPortExpose>();

const value = ref(props.text);
const draft = computed(() => ({text: props.text, version: 1}));
const canSubmit = computed(() => !props.loading && value.value.trim() !== "");
const resolve = computed(() => props.services?.resolveTriggerMenu);
const triggers = computed(() => (resolve.value === undefined ? [] : ["@"]));

function submit(): void {
    if (canSubmit.value) emit("submit", value.value);
}

onMounted(() => withEditor((editor) => editor.focus("end")));
</script>

<template>
    <div class="acv-message-editor" data-message-editor>
        <div class="acv-message-editor__input">
            <component
                :is="renderers.promptEditor"
                ref="editorRef"
                :draft="draft"
                :locale="locale"
                placeholder=""
                :aria-label="t('messageEditor.label')"
                :readonly="props.loading"
                enter-submits
                :triggers="triggers"
                :resolve-menu="resolve ?? (() => ({items: []}))"
                :commands="[]"
                :accept-images="false"
                :accept-files="false"
                :attachments="[]"
                :recall="[]"
                bare
                @change="value = $event"
                @submit="submit"
                @escape="emit('cancel')"
            />
        </div>
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
    max-height: 40vh;
    overflow-y: auto;
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
