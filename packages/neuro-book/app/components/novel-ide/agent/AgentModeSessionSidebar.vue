<script setup lang="ts">
import {computed, ref} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 420;

const props = withDefaults(defineProps<{
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    loading: boolean;
    actionId: number | null;
    pinnedSessionIds?: number[];
    open?: boolean;
    width?: number;
}>(), {
    pinnedSessionIds: () => [],
    open: true,
    width: undefined,
});

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    (e: "update:pinnedSessionIds", value: number[]): void;
    (e: "select", sessionId: number): void;
    (e: "create"): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "rename", session: AgentSessionSummaryDto): void;
    (e: "refresh"): void;
}>();

const searchQuery = ref("");
const resizeHandleRef = ref<HTMLElement | null>(null);
const {t} = useI18n();

const pinnedSet = computed(() => new Set(props.pinnedSessionIds));
const filteredSessions = computed(() => {
    const keyword = searchQuery.value.trim().toLowerCase();
    const source = keyword
        ? props.sessions.filter((session) => {
            return (session.title?.toLowerCase().includes(keyword)
                || session.summary?.toLowerCase().includes(keyword)
                || session.lastMessagePreview?.toLowerCase().includes(keyword)
                || session.profileKey.toLowerCase().includes(keyword)
                || String(session.sessionId).includes(keyword));
        })
        : props.sessions;
    return [...source].sort((left, right) => {
        const leftPinned = pinnedSet.value.has(left.sessionId);
        const rightPinned = pinnedSet.value.has(right.sessionId);
        if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
        }
        return right.updatedAt - left.updatedAt;
    });
});
const hasControlledWidth = computed(() => typeof props.width === "number" && Number.isFinite(props.width));
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width ?? MIN_PANEL_WIDTH),
    minSize: MIN_PANEL_WIDTH,
    maxSize: MAX_PANEL_WIDTH,
    edge: "right",
    enabled: computed(() => props.open && hasControlledWidth.value),
    onResizeEnd: (width) => emit("update:width", width),
});
const sessionPanelStyle = computed(() => {
    if (!props.open) {
        return {width: "0px"};
    }
    return hasControlledWidth.value ? panelStyle.value : undefined;
});

/**
 * 切换 session 在列表中的置顶状态，通过受控事件交由父级持久化。
 */
function togglePin(sessionId: number): void {
    const next = pinnedSet.value.has(sessionId)
        ? props.pinnedSessionIds.filter((id) => id !== sessionId)
        : [sessionId, ...props.pinnedSessionIds];
    emit("update:pinnedSessionIds", next);
}

/**
 * 返回 session 展示标题。
 */
function sessionTitle(session: AgentSessionSummaryDto): string {
    return session.title || `Session #${String(session.sessionId)}`;
}

/**
 * 返回 session 预览文本。
 */
function sessionPreview(session: AgentSessionSummaryDto): string {
    return session.summary || session.lastMessagePreview || t("agent.session.noRecentMessages");
}

/**
 * 判断 session 是否允许归档。
 */
function canArchiveSession(session: AgentSessionSummaryDto): boolean {
    if (session.archived) {
        return false;
    }
    if (session.interaction) {
        return session.interaction.canArchive;
    }
    return session.status !== "running" && session.status !== "waiting";
}

/**
 * 返回 session 状态的中文标签。
 */
function statusLabel(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return t("agent.session.running");
        case "waiting": return t("agent.session.waiting");
        case "interrupted": return t("agent.session.interrupted");
        case "archived": return t("agent.session.archived");
        default: return t("agent.session.idle");
    }
}

/**
 * 返回 session 状态样式。
 */
function statusClass(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
        case "waiting": return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
        case "interrupted": return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
        case "archived": return "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]";
        default: return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
}

/**
 * 返回 profile 不可运行时的短标签。
 */
function profileAvailabilityLabel(session: AgentSessionSummaryDto): string | null {
    if (!session.profileAvailability || session.profileAvailability === "loaded") {
        return null;
    }
    return session.profileAvailability === "missing" ? t("agent.session.profileMissing") : t("agent.session.profileUnavailable");
}

/**
 * 返回 profile 不可运行时的完整说明。
 */
function profileAvailabilityTitle(session: AgentSessionSummaryDto): string {
    return session.profileIssueMessage
        ? `${session.profileKey}: ${session.profileIssueMessage}`
        : session.profileKey;
}
</script>

<template>
    <!-- Agent Mode 左侧 session 导航 -->
    <aside
        class="agent-mode-session-sidebar relative z-10 flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-sidebar)] transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="[
            props.open
                ? (hasControlledWidth ? 'border-r border-[var(--border-color)] opacity-100' : 'w-full rounded-[var(--radius-panel)] border border-[var(--border-color)] opacity-100')
                : 'pointer-events-none border-0 opacity-0',
            isResizing ? 'select-none transition-none' : '',
        ]"
        :style="sessionPanelStyle"
    >
        <div v-if="props.open && hasControlledWidth" ref="resizeHandleRef" class="group absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize">
            <div class="ml-0.5 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-[opacity,box-shadow] duration-150 group-hover:opacity-100" :class="isResizing ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
        </div>

        <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-3">
            <div class="min-w-0">
                <div class="text-sm font-semibold text-[var(--text-main)]">{{ t("agent.session.sidebarTitle") }}</div>
                <div class="text-[11px] text-[var(--text-muted)]">{{ t("agent.session.currentProjectWorkspace") }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <IconButton
                    size="sm"
                    variant="default"
                    :title="t('agent.session.refresh')"
                    :aria-label="t('agent.session.refresh')"
                    :disabled="loading"
                    @click="emit('refresh')"
                >
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </IconButton>
                <IconButton
                    size="sm"
                    variant="accent"
                    :title="t('agent.session.newChat')"
                    :aria-label="t('agent.session.newChat')"
                    :disabled="loading || Boolean(actionId)"
                    @click="emit('create')"
                >
                    <span class="i-lucide-plus h-4 w-4"></span>
                </IconButton>
            </div>
        </div>

        <div class="shrink-0 border-b border-[var(--border-color)] p-3">
            <div class="flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5">
                <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" :placeholder="t('agent.session.searchPlaceholder')" class="nb-ui-native-input min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]">
            </div>
        </div>

        <div class="contain-layout-paint min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar" :class="isResizing ? 'pointer-events-none select-none' : ''">
            <div
                v-for="session in filteredSessions"
                :key="session.sessionId"
                class="group mb-1.5 flex w-full items-start gap-2 rounded-md border px-2.5 py-2.5 transition-colors"
                :class="session.sessionId === activeSessionId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]/55 shadow-[inset_2px_0_0_var(--accent-main)]' : 'border-[var(--border-color)]/45 bg-[var(--bg-panel)]/35 hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                    @click="emit('select', session.sessionId)"
                >
                    <span :class="pinnedSet.has(session.sessionId) ? 'i-lucide-pin text-[var(--accent-text)]' : 'i-lucide-message-square text-[var(--text-muted)]'" class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                    <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-1.5">
                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ sessionTitle(session) }}</span>
                            <span class="shrink-0 rounded border px-1 py-0.5 text-[9px]" :class="statusClass(session.status)">{{ statusLabel(session.status) }}</span>
                            <span v-if="profileAvailabilityLabel(session)" class="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1 py-0.5 text-[9px] text-[var(--status-warning)]" :title="profileAvailabilityTitle(session)">
                                <span class="i-lucide-lock h-3 w-3"></span>
                                {{ profileAvailabilityLabel(session) }}
                            </span>
                        </span>
                        <span class="agent-session-preview mt-1 block text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ sessionPreview(session) }}</span>
                        <span class="mt-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            <span class="font-mono">#{{ session.sessionId }}</span>
                            <span>{{ formatTimestamp(session.updatedAt) }}</span>
                        </span>
                    </span>
                </button>
                <div class="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconButton
                        size="sm"
                        :variant="pinnedSet.has(session.sessionId) ? 'accent' : 'default'"
                        :title="pinnedSet.has(session.sessionId) ? t('agent.session.unpin') : t('agent.session.pin')"
                        :aria-label="pinnedSet.has(session.sessionId) ? t('agent.session.unpin') : t('agent.session.pin')"
                        @click.stop="togglePin(session.sessionId)"
                    >
                        <span class="i-lucide-pin h-3.5 w-3.5"></span>
                    </IconButton>
                    <IconButton
                        size="sm"
                        variant="default"
                        :title="t('agent.session.rename')"
                        :aria-label="t('agent.session.rename')"
                        :disabled="loading || actionId === session.sessionId"
                        @click.stop="emit('rename', session)"
                    >
                        <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                    </IconButton>
                    <IconButton
                        size="sm"
                        variant="danger"
                        :title="t('agent.session.archive')"
                        :aria-label="t('agent.session.archive')"
                        :disabled="loading || actionId === session.sessionId || !canArchiveSession(session)"
                        @click.stop="emit('archive', session)"
                    >
                        <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                        <span v-else class="i-lucide-archive h-3.5 w-3.5"></span>
                    </IconButton>
                </div>
            </div>

            <div v-if="filteredSessions.length === 0" class="mt-6 rounded-md border border-dashed border-[var(--border-color)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                {{ t("agent.session.noMatching") }}
            </div>
        </div>
    </aside>
</template>

<style scoped>
.agent-session-preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
}
</style>
