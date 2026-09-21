<script setup lang="ts">
import {Badge, Dropdown, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";

export type SummarizerStatus = {
    className: string;
    title: string;
    icon: string;
    spinning: boolean;
    label: string;
};

const props = withDefaults(defineProps<{
    drawerIconClass: string;
    activeSessionTitle: string;
    activeDrawerTitle: string;
    activeSessionSummaryText: string;
    summarizerStatus?: SummarizerStatus | null;
    canChooseCreateProfile?: boolean;
    createProfileDropdownItems?: DropdownItem[];
    loadingSession?: boolean;
    activeSessionId: number | null;
    attachmentPanelOpen?: boolean;
    sessionAttachmentUniqueTotal?: number;
    linkedAgentPanelOpen?: boolean;
    linkedAgentCount?: number;
    canMutateHistory?: boolean;
    systemPromptPanelOpen?: boolean;
}>(), {
    summarizerStatus: null,
    canChooseCreateProfile: false,
    createProfileDropdownItems: () => [],
    loadingSession: false,
    attachmentPanelOpen: false,
    sessionAttachmentUniqueTotal: 0,
    linkedAgentPanelOpen: false,
    linkedAgentCount: 0,
    canMutateHistory: false,
    systemPromptPanelOpen: false,
});

const emit = defineEmits<{
    (e: "create-session", profileKey?: string): void;
    (e: "toggle-attachment-panel"): void;
    (e: "toggle-linked-agent-panel"): void;
    (e: "open-session-tree"): void;
    (e: "toggle-system-prompt"): void;
    (e: "open-session-dialog"): void;
    (e: "close"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <!-- 抽屉头部 -->
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
            <div class="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] border border-[var(--accent-main)]/40 bg-[var(--accent-bg)]">
                <span class="h-3.5 w-3.5" :class="props.drawerIconClass"></span>
            </div>
            <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-1.5">
                    <div class="truncate text-sm font-medium tracking-wide text-[var(--text-main)]" :title="props.activeSessionTitle">
                        {{ props.activeSessionTitle }}
                    </div>
                    <span
                        v-if="props.activeDrawerTitle"
                        class="inline-flex shrink-0 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--text-muted)]"
                        :title="props.activeDrawerTitle"
                    >
                        {{ props.activeDrawerTitle }}
                    </span>
                </div>
                <div class="flex min-w-0 items-center gap-1.5">
                    <div class="truncate text-[10px] leading-4 text-[var(--text-muted)]" :title="props.activeSessionSummaryText">
                        {{ props.activeSessionSummaryText }}
                    </div>
                    <span
                        v-if="props.summarizerStatus"
                        class="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-0.5 text-[10px] font-medium tracking-normal"
                        :class="props.summarizerStatus.className"
                        :title="props.summarizerStatus.title"
                    >
                        <span class="h-3 w-3" :class="[props.summarizerStatus.icon, props.summarizerStatus.spinning ? 'animate-spin' : '']"></span>
                        {{ props.summarizerStatus.label }}
                    </span>
                </div>
            </div>
        </div>

        <div class="flex shrink-0 items-center gap-0.5">
            <Dropdown
                v-if="props.canChooseCreateProfile"
                :items="props.createProfileDropdownItems"
                root-class="relative inline-block"
                menu-class="right-0 top-full mt-1.5 w-44"
                compact
                @select="emit('create-session', $event)"
            >
                <IconButton
                    icon-class="i-lucide-plus"
                    size="sm"
                    variant="default"
                    :title="t('agent.session.newChat')"
                    :aria-label="t('agent.session.newChat')"
                    :disabled="props.loadingSession"
                />
            </Dropdown>
            <IconButton
                v-else
                icon-class="i-lucide-plus"
                size="sm"
                variant="default"
                :title="t('agent.session.newChat')"
                :aria-label="t('agent.session.newChat')"
                :disabled="props.loadingSession"
                @click="emit('create-session')"
            />

            <div class="relative inline-flex items-center">
                <IconButton
                    icon-class="i-lucide-paperclip"
                    size="sm"
                    :variant="props.attachmentPanelOpen ? 'secondary' : 'default'"
                    :class="props.attachmentPanelOpen ? 'text-[var(--accent-text)]' : ''"
                    title="查看当前 Session 的全部附件"
                    aria-label="查看当前 Session 的全部附件"
                    :disabled="!props.activeSessionId"
                    @click="emit('toggle-attachment-panel')"
                />
                <Badge
                    v-if="props.sessionAttachmentUniqueTotal"
                    variant="solid"
                    size="sm"
                    class="absolute -top-1 -right-1 !h-3.5 !min-w-[14px] !px-1 pointer-events-none"
                >
                    {{ props.sessionAttachmentUniqueTotal }}
                </Badge>
            </div>

            <div class="relative inline-flex items-center">
                <IconButton
                    icon-class="i-lucide-users"
                    size="sm"
                    :variant="props.linkedAgentPanelOpen ? 'secondary' : 'default'"
                    :class="props.linkedAgentPanelOpen ? 'text-[var(--accent-text)]' : ''"
                    :title="t('agent.chatSurface.linkedAgentsTitle')"
                    :aria-label="t('agent.chatSurface.linkedAgentsTitle')"
                    @click="emit('toggle-linked-agent-panel')"
                />
                <Badge
                    v-if="props.linkedAgentCount"
                    variant="solid"
                    size="sm"
                    class="absolute -top-1 -right-1 !h-3.5 !min-w-[14px] !px-1 pointer-events-none"
                >
                    {{ props.linkedAgentCount }}
                </Badge>
            </div>

            <IconButton
                icon-class="i-lucide-git-branch"
                size="sm"
                variant="default"
                :title="t('agent.chatSurface.sessionTreeTitle')"
                :aria-label="t('agent.chatSurface.sessionTreeTitle')"
                :disabled="!props.activeSessionId || !props.canMutateHistory"
                @click="emit('open-session-tree')"
            />

            <IconButton
                icon-class="i-lucide-terminal-square"
                size="sm"
                :variant="props.systemPromptPanelOpen ? 'secondary' : 'default'"
                :class="props.systemPromptPanelOpen ? 'text-[var(--accent-text)]' : ''"
                :title="t('agent.systemPrompt.open')"
                :aria-label="t('agent.systemPrompt.open')"
                :disabled="!props.activeSessionId"
                @click="emit('toggle-system-prompt')"
            />

            <IconButton
                icon-class="i-lucide-messages-square"
                size="sm"
                variant="default"
                :title="t('agent.chatSurface.sessionListTitle')"
                :aria-label="t('agent.chatSurface.sessionListTitle')"
                @click="emit('open-session-dialog')"
            />

            <IconButton
                icon-class="i-lucide-x"
                size="sm"
                variant="default"
                title="关闭"
                aria-label="关闭"
                @click="emit('close')"
            />
        </div>
    </div>
</template>
