<script setup lang="ts">
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/bubbles/base/AgentMarkdownContent.vue";
import type {ProfileTemplatePreviewMessageDto} from "nbook/shared/dto/profile-template.dto";

type StructuredTextMode = "rich" | "source";

const props = defineProps<{
    message: ProfileTemplatePreviewMessageDto;
    index: number;
    mode: StructuredTextMode;
    collapsed: boolean;
}>();

const emit = defineEmits<{
    (e: "update:mode", value: StructuredTextMode): void;
    (e: "toggle"): void;
    (e: "copy"): void;
}>();

const roleIconClass = computed(() => {
    if (props.message.role === "assistant") {
        return "i-lucide-sparkles";
    }
    if (props.message.role === "human" || props.message.role === "user") {
        return "i-lucide-user";
    }
    return "i-lucide-shield";
});

const copyTitle = computed(() => props.message.role === "assistant" ? "复制为 JSON" : "复制文本");
</script>

<template>
    <article class="profile-prompt-message-card">
        <header class="profile-prompt-message-header">
            <button class="message-icon-button" :title="props.collapsed ? '展开消息' : '收起消息'" @click="emit('toggle')">
                <span :class="props.collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
            </button>
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-text)]">
                <span :class="roleIconClass" class="h-3 w-3"></span>
            </span>
            <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-main)]">{{ props.message.role }}</span>
                    <span v-if="props.message.source" class="truncate text-[11px] text-[var(--text-muted)]">{{ props.message.source }}</span>
                    <span class="ml-auto text-[11px] tabular-nums text-[var(--text-muted)]">#{{ props.index + 1 }}</span>
                </div>
            </div>
            <div class="message-mode-switch">
                <button :class="props.mode === 'rich' ? 'active' : ''" @click="emit('update:mode', 'rich')">渲染</button>
                <button :class="props.mode === 'source' ? 'active' : ''" @click="emit('update:mode', 'source')">源码</button>
            </div>
            <button class="message-icon-button" :title="copyTitle" @click="emit('copy')">
                <span class="i-lucide-copy h-3.5 w-3.5"></span>
            </button>
        </header>

        <div v-if="!props.collapsed" class="space-y-2 p-2.5">
            <div v-if="props.mode === 'rich'" class="profile-prompt-message-markdown custom-scrollbar">
                <AgentMarkdownContent :content="props.message.text" />
            </div>
            <StructuredTextEditor
                v-else
                :model-value="props.message.text"
                readonly
                mode="source"
                :min-height="130"
                :max-height="360"
                :show-toolbar="false"
                size="sm"
            />

            <div v-if="props.message.toolCalls?.length" class="space-y-2">
                <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Tool Calls</div>
                <div v-for="toolCall in props.message.toolCalls" :key="toolCall.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/55">
                    <div class="flex min-w-0 items-center gap-2 border-b border-[var(--border-color)]/60 px-2 py-1.5">
                        <span class="i-lucide-wrench h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                        <span class="truncate font-mono text-[11px] font-semibold text-[var(--text-main)]">{{ toolCall.name }}</span>
                        <span class="ml-auto truncate font-mono text-[10px] text-[var(--text-muted)]">{{ toolCall.id }}</span>
                    </div>
                    <pre class="m-0 max-h-48 overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">{{ toolCall.argsText }}</pre>
                </div>
            </div>
        </div>
    </article>
</template>

<style scoped>
.profile-prompt-message-card {
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    flex-shrink: 0;
}

.profile-prompt-message-header {
    display: grid;
    min-width: 0;
    grid-template-columns: 24px 22px minmax(0, 1fr) auto 24px;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border-color);
    padding: 7px 10px;
}

.message-icon-button {
    display: inline-flex;
    height: 24px;
    width: 24px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--text-muted);
    transition: background-color 0.18s ease, color 0.18s ease;
}

.message-icon-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.message-mode-switch {
    display: inline-flex;
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-input);
}

.message-mode-switch button {
    padding: 3px 7px;
    font-size: 11px;
    color: var(--text-muted);
}

.message-mode-switch button.active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.profile-prompt-message-markdown {
    max-height: min(360px, 42vh);
    overflow: auto;
    scrollbar-gutter: stable;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 76%, var(--bg-panel));
    padding: 9px 12px;
    color: var(--text-main);
}

.profile-prompt-message-markdown :deep(.agent-markdown > :first-child) {
    margin-top: 0;
}

.profile-prompt-message-markdown :deep(.agent-markdown > :last-child) {
    margin-bottom: 0;
}
</style>
