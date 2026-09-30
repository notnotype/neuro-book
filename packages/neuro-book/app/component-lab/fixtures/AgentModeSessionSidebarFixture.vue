<script setup lang="ts">
/**
 * AgentModeSessionSidebar 的 Component Lab 规范夹具。
 */
import {computed, watch} from "vue";
import AgentModeSessionSidebar from "nbook/app/components/novel-ide/agent/AgentModeSessionSidebar.vue";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleSessionList} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentModeSessionSidebar>(() => props.input, [
    "select",
    "create",
    "archive",
    "rename",
    "refresh",
]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();

const open = computed(() => subject.bindings.value.open);
const width = computed(() => subject.bindings.value.width);
const sessions = computed(() => subject.bindings.value.sessions);
const activeSessionId = computed(() => subject.bindings.value.activeSessionId);
const pinnedSessionIds = computed(() => subject.bindings.value.pinnedSessionIds ?? []);
const loading = computed(() => subject.bindings.value.loading);

watch([() => props.scene, open, width, sessions, activeSessionId, pinnedSessionIds, loading], () => {
    syncLabData({
        scene: props.scene,
        open: open.value,
        width: width.value,
        sessionCount: sessions.value.length,
        activeSessionId: activeSessionId.value,
        pinnedSessionIds: pinnedSessionIds.value,
        loading: loading.value,
    });
}, {immediate: true});

function handleSelect(sessionId: number): void {
    subject.write("props", "activeSessionId", sessionId);
}

function handleArchive(session: AgentSessionSummaryDto): void {
    const remaining = sessions.value.filter((item) => item.sessionId !== session.sessionId);
    subject.write("props", "sessions", remaining);
    if (activeSessionId.value === session.sessionId) {
        subject.write("props", "activeSessionId", remaining[0]?.sessionId ?? null);
    }
}

function toggleOpenControl(): void {
    const next = !open.value;
    emitLabEvent("toggle-open", next);
    subject.write("props", "open", next);
}

function toggleSessionsControl(): void {
    const next = sessions.value.length > 0 ? [] : sampleSessionList;
    subject.write("props", "sessions", next);
    subject.write("props", "activeSessionId", next[0]?.sessionId ?? null);
}
</script>

<template>
    <AgentModeSessionSidebar
        v-if="open"
        data-lab-subject
        class="h-full w-full"
        v-bind="subject.bindings.value"
        @select="handleSelect"
        @archive="handleArchive"
    />

    <!-- 侧栏收起状态提示 -->
    <div
        v-else
        data-lab-subject
        class="flex h-full w-full flex-col items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-[var(--border-color)] px-8 py-8 text-xs text-[var(--text-muted)]"
    >
        <span class="i-lucide-panel-left-close mb-2 h-6 w-6 opacity-40"></span>
        <span>Agent Mode 会话侧栏已收起</span>
        <button
            type="button"
            class="mt-2 text-[var(--accent-text)] hover:underline cursor-pointer"
            @click="toggleOpenControl"
        >
            点击展开侧栏
        </button>
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentModeSessionSidebar 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleOpenControl"
                >
                    {{ open ? "收起侧栏" : "展开侧栏" }}
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
