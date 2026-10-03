<script setup lang="ts">
/**
 * AgentSessionDialog 的 Component Lab 规范夹具。
 */
import {computed, watch} from "vue";
import AgentSessionDialog from "nbook/app/components/novel-ide/agent/dialogs/session-list/AgentSessionDialog.vue";
import type {AgentSessionListQueryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleSessionList} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionDialog>(() => props.input, [
    "select",
    "create",
    "archive",
    "restore",
    "rename",
    "refresh",
    "loadMore",
]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();

const open = computed(() => subject.bindings.value.modelValue);
const sessions = computed(() => subject.bindings.value.sessions);
const activeSessionId = computed(() => subject.bindings.value.activeSessionId);
const loading = computed(() => subject.bindings.value.loading);
const hasMore = computed(() => subject.bindings.value.hasMore);

watch([() => props.scene, open, sessions, activeSessionId, loading, hasMore], () => {
    syncLabData({
        scene: props.scene,
        open: open.value,
        sessionCount: sessions.value.length,
        activeSessionId: activeSessionId.value,
        loading: loading.value,
        hasMore: hasMore.value,
    });
}, {immediate: true});

function filterSessions(query: AgentSessionListQueryDto): AgentSessionSummaryDto[] {
    const keyword = query.search?.trim().toLowerCase() ?? "";
    return sampleSessionList.filter((item) => {
        if (query.profileGroup === "leader" && !item.profileKey.includes("leader")) {
            return false;
        }
        if (query.relation === "top" && item.parentSessionId) {
            return false;
        }
        if (query.relation === "child" && !item.parentSessionId) {
            return false;
        }
        if (query.status && query.status !== "all") {
            if (query.status === "active" && item.archived) return false;
            if (query.status !== "active" && item.status !== query.status) return false;
        }
        if (keyword) {
            const matchTitle = item.title?.toLowerCase().includes(keyword);
            const matchSummary = item.summary?.toLowerCase().includes(keyword);
            const matchPreview = item.lastMessagePreview?.toLowerCase().includes(keyword);
            const matchProfile = item.profileKey.toLowerCase().includes(keyword);
            return Boolean(matchTitle || matchSummary || matchPreview || matchProfile);
        }
        return true;
    });
}

function handleSelect(sessionId: number): void {
    subject.write("props", "activeSessionId", sessionId);
}

function handleRefresh(query: AgentSessionListQueryDto): void {
    if (props.scene === "empty" && !query.search && query.profileGroup === "leader" && query.status === "active" && query.relation === "all") {
        return;
    }
    const filtered = filterSessions(query);
    subject.write("props", "sessions", filtered);
    subject.write("props", "total", filtered.length);
}

function handleArchive(session: AgentSessionSummaryDto): void {
    const updated = sessions.value.map((item) => item.sessionId === session.sessionId
        ? {
            ...item,
            status: "archived" as const,
            archived: true,
            interaction: {
                canInvoke: false,
                canResolveUserInput: false,
                canRegisterAttachment: false,
                canInsertAttachment: false,
                canMutateHistory: false,
                canChangeRuntime: false,
                canArchive: false,
                canRestore: true,
                canAbort: false,
            },
        }
        : item);
    subject.write("props", "sessions", updated);
}

function handleRestore(session: AgentSessionSummaryDto): void {
    const updated = sessions.value.map((item) => item.sessionId === session.sessionId
        ? {
            ...item,
            status: "idle" as const,
            archived: false,
            interaction: {
                canInvoke: true,
                canResolveUserInput: true,
                canRegisterAttachment: true,
                canInsertAttachment: true,
                canMutateHistory: true,
                canChangeRuntime: true,
                canArchive: true,
                canRestore: false,
                canAbort: false,
            },
        }
        : item);
    subject.write("props", "sessions", updated);
}

function toggleOpenControl(): void {
    const next = !open.value;
    emitLabEvent("update:modelValue", next);
    subject.write("model", "modelValue", next);
}

function toggleSessionsControl(): void {
    const next = sessions.value.length > 0 ? [] : sampleSessionList;
    subject.write("props", "sessions", next);
    subject.write("props", "total", next.length);
}
</script>

<template>
    <div class="novel-ide-theme relative flex h-full w-full items-center justify-center [transform:translateZ(0)]" data-lab-subject>
        <div v-if="!open" class="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--border-color)] px-8 py-8 text-xs text-[var(--text-muted)]">
            <span class="i-lucide-messages-square mb-2 h-6 w-6 opacity-40"></span>
            <span>会话管理弹窗已关闭</span>
            <button
                type="button"
                class="mt-2 text-[var(--accent-text)] hover:underline cursor-pointer"
                @click="toggleOpenControl"
            >
                点击打开弹窗
            </button>
        </div>

        <AgentSessionDialog
            v-bind="subject.bindings.value"
            @select="handleSelect"
            @refresh="handleRefresh"
            @archive="handleArchive"
            @restore="handleRestore"
        />
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentSessionDialog 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleOpenControl"
                >
                    {{ open ? "关闭弹窗" : "打开弹窗" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="subject.write('props', 'loading', !loading)"
                >
                    {{ loading ? "停止加载" : "切换加载态" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleSessionsControl"
                >
                    {{ sessions.length > 0 ? "清空会话" : "恢复会话" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
