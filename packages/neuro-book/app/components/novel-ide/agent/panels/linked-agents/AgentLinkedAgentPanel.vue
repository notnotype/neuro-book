<script setup lang="ts">
import {Badge, IconButton} from "@notnotype/nb-ui/components";
import type {AgentLinkedSessionDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    sessionId: number | null;
    ownedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: number): void;
    (e: "refresh"): void;
    (e: "close"): void;
}>();

const totalRelations = computed(() => props.ownedAgents.length + props.linkedByAgents.length);
const {t} = useI18n();

const profileLabel = (profileKey: string) => {
    switch(profileKey) {
        case "leader.default": return t("agent.linkedAgents.mainDispatcher");
        case "leader.assets": return t("agent.linkedAgents.userAssetsAssistant");
        case "writer": return t("agent.linkedAgents.writerAgent");
        case "retrieval": return t("agent.linkedAgents.retrievalAgent");
        default: return profileKey;
    }
};

const statusDotClass = (status: AgentLinkedSessionDto["status"]) => {
    switch (status) {
        case "running": return "animate-pulse bg-[var(--status-info)]";
        case "waiting": return "animate-pulse bg-[var(--status-warning)]";
        case "interrupted": return "bg-[var(--status-danger)]";
        case "archived": return "bg-[var(--text-muted)]";
        default: return "bg-[var(--status-success)]";
    }
};

const statusLabel = (status: AgentLinkedSessionDto["status"]) => {
    switch (status) {
        case "running": return t("agent.linkedAgents.running");
        case "waiting": return t("agent.linkedAgents.waiting");
        case "interrupted": return t("agent.linkedAgents.interrupted");
        case "archived": return t("agent.linkedAgents.archived");
        default: return t("agent.linkedAgents.idle");
    }
};

const profileAvailabilityLabel = (session: AgentLinkedSessionDto): string | null => {
    if (!session.profileAvailability || session.profileAvailability === "loaded") {
        return null;
    }
    return session.profileAvailability === "missing" ? t("agent.session.profileMissing") : t("agent.session.profileUnavailable");
};

const profileAvailabilityTitle = (session: AgentLinkedSessionDto): string => {
    return session.profileIssueMessage
        ? `${session.profileKey}: ${session.profileIssueMessage}`
        : session.profileKey;
};

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        event.stopPropagation();
        emit("close");
    }
}

onMounted(() => {
    window.addEventListener("keydown", handleKeydown, true);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, true);
});
</script>

<template>
    <div class="nb-ui-popover-surface sticky top-0 z-10 flex flex-col gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-[var(--elevation-popover)]">
        <!-- Linked agents 标题栏 -->
        <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs font-semibold tracking-wider text-[var(--accent-text)]">
                <span class="i-lucide-boxes h-4 w-4"></span>
                {{ t("agent.linkedAgents.title") }}
                <Badge v-if="totalRelations" variant="solid" tone="accent" size="sm">{{ totalRelations }}</Badge>
            </span>
            <div class="flex shrink-0 items-center gap-1">
                <IconButton
                    size="sm"
                    variant="default"
                    :disabled="props.loading"
                    :title="t('agent.linkedAgents.refresh')"
                    :aria-label="t('agent.linkedAgents.refresh')"
                    @click="emit('refresh')"
                >
                    <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="props.loading ? 'animate-spin' : ''" />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="default"
                    :title="t('common.close')"
                    :aria-label="t('common.close')"
                    @click="emit('close')"
                >
                    <span class="i-lucide-x h-3.5 w-3.5" />
                </IconButton>
            </div>
        </div>

        <div v-if="totalRelations > 0" class="max-h-[260px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            <!-- 当前 session 绑定出去的 Agent -->
            <section>
                <div class="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span>{{ t("agent.linkedAgents.owned") }}</span>
                    <span>{{ props.ownedAgents.length }}</span>
                </div>
                <div v-if="props.ownedAgents.length > 0" class="space-y-2">
                    <button v-for="item in props.ownedAgents" :key="`owned-${item.sessionId}`" type="button" class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-left transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:shadow-sm" @click="emit('select', item.sessionId)">
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] transition-colors group-hover:border-[var(--accent-main)] group-hover:bg-[var(--accent-bg)]">
                            <span class="i-lucide-arrow-up-right h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]"></span>
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col justify-center">
                            <div class="flex items-center gap-2">
                                <span class="truncate text-xs font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ item.title || `Agent #${item.sessionId}` }}</span>
                                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ profileLabel(item.profileKey) }}</span>
                                <span v-if="profileAvailabilityLabel(item)" class="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]" :title="profileAvailabilityTitle(item)">
                                    <span class="i-lucide-lock h-3 w-3"></span>
                                    {{ profileAvailabilityLabel(item) }}
                                </span>
                            </div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)] opacity-70">sessionId: {{ item.sessionId }}</div>
                        </div>
                        <div class="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 transition-colors group-hover:border-[var(--accent-main)]/30">
                            <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status)"></span>
                            <span class="text-[10px] font-medium text-[var(--text-main)]">{{ statusLabel(item.status) }}</span>
                        </div>
                    </button>
                </div>
                <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] py-4 text-center text-[11px] text-[var(--text-muted)]">
                    {{ t("agent.linkedAgents.noOwned") }}
                </div>
            </section>

            <!-- 绑定当前 session 的上游 Agent -->
            <section>
                <div class="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span>{{ t("agent.linkedAgents.linkedBy") }}</span>
                    <span>{{ props.linkedByAgents.length }}</span>
                </div>
                <div v-if="props.linkedByAgents.length > 0" class="space-y-2">
                    <button v-for="item in props.linkedByAgents" :key="`owner-${item.sessionId}`" type="button" class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-left transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:shadow-sm" @click="emit('select', item.sessionId)">
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] transition-colors group-hover:border-[var(--accent-main)] group-hover:bg-[var(--accent-bg)]">
                            <span class="i-lucide-arrow-down-left h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]"></span>
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col justify-center">
                            <div class="flex items-center gap-2">
                                <span class="truncate text-xs font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ item.title || `Agent #${item.sessionId}` }}</span>
                                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ profileLabel(item.profileKey) }}</span>
                                <span v-if="profileAvailabilityLabel(item)" class="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]" :title="profileAvailabilityTitle(item)">
                                    <span class="i-lucide-lock h-3 w-3"></span>
                                    {{ profileAvailabilityLabel(item) }}
                                </span>
                            </div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)] opacity-70">sessionId: {{ item.sessionId }}</div>
                        </div>
                        <div class="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 transition-colors group-hover:border-[var(--accent-main)]/30">
                            <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status)"></span>
                            <span class="text-[10px] font-medium text-[var(--text-main)]">{{ statusLabel(item.status) }}</span>
                        </div>
                    </button>
                </div>
                <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] py-4 text-center text-[11px] text-[var(--text-muted)]">
                    {{ t("agent.linkedAgents.noLinkedBy") }}
                </div>
            </section>
        </div>

        <!-- 空状态 -->
        <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] py-8 text-center text-xs text-[var(--text-muted)]">
            {{ t("agent.linkedAgents.empty") }}
        </div>
    </div>
</template>
