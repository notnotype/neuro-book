<script setup lang="ts">
import {computed, ref} from "vue";
import {onClickOutside, useDebounceFn} from "@vueuse/core";
import {Dialog} from "@notnotype/nb-ui/components";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import type {AgentSessionListQueryDto, AgentSessionRelationFilter, AgentSessionStatusFilter, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";

type SessionProfileFilter = "leader" | "all";
type CreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

const props = defineProps<{
    modelValue: boolean;
    sessions: AgentSessionSummaryDto[];
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
    activeSessionId: number | null;
    loading: boolean;
    running: boolean;
    actionId: number | null;
    createProfileOptions: CreateProfileOption[];
    canChooseCreateProfile: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", sessionId: number): void;
    (e: "create", profileKey?: string): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "restore", session: AgentSessionSummaryDto): void;
    (e: "rename", session: AgentSessionSummaryDto): void;
    (e: "refresh", query: AgentSessionListQueryDto): void;
    (e: "loadMore", query: AgentSessionListQueryDto): void;
}>();

const sessionSearch = ref("");
const profileFilter = ref<SessionProfileFilter>("leader");
const statusFilter = ref<AgentSessionStatusFilter>("active");
const relationFilter = ref<AgentSessionRelationFilter>("all");
const filterPanelOpen = ref(false);
const filterPanelRef = ref<HTMLElement | null>(null);
const filterButtonRef = ref<HTMLButtonElement | null>(null);
const {t} = useI18n();

const profileItems = computed<Array<{value: SessionProfileFilter; label: string}>>(() => [
    {value: "leader", label: t("agent.session.leader")},
    {value: "all", label: t("agent.session.all")},
]);
const statusItems = computed<Array<{value: AgentSessionStatusFilter; label: string}>>(() => [
    {value: "active", label: t("agent.session.unarchived")},
    {value: "all", label: t("agent.session.all")},
    {value: "running", label: t("agent.session.running")},
    {value: "waiting", label: t("agent.session.waitingInput")},
    {value: "idle", label: t("agent.session.idle")},
    {value: "interrupted", label: t("agent.session.interrupted")},
    {value: "archived", label: t("agent.session.archived")},
]);
const relationItems = computed<Array<{value: AgentSessionRelationFilter; label: string}>>(() => [
    {value: "all", label: t("agent.session.all")},
    {value: "top", label: t("agent.session.topLevel")},
    {value: "child", label: t("agent.session.childAgent")},
]);
const createDropdownItems = computed<DropdownItem[]>(() => props.createProfileOptions.map((option) => ({
    label: option.label,
    value: option.profileKey,
    iconClass: option.iconClass,
})));

const query = computed<AgentSessionListQueryDto>(() => ({
    profileGroup: profileFilter.value,
    status: statusFilter.value,
    relation: relationFilter.value,
    includeArchived: statusFilter.value === "archived",
    search: sessionSearch.value.trim() || undefined,
    offset: 0,
    limit: 50,
}));
const listedSessions = computed(() => props.sessions);
const sessionTitle = (session: AgentSessionSummaryDto) => session.title || `Session #${String(session.sessionId)}`;
const sessionPreview = (session: AgentSessionSummaryDto) => session.summary || session.lastMessagePreview || t("agent.session.noRecentMessages");
const canArchiveSession = (session: AgentSessionSummaryDto): boolean => session.interaction?.canArchive === true;
const canRestoreSession = (session: AgentSessionSummaryDto): boolean => session.interaction?.canRestore === true;
const canRenameSession = (session: AgentSessionSummaryDto): boolean => session.interaction?.canChangeRuntime === true;

/**
 * 关闭弹窗。
 */
function close(): void {
    emit("update:modelValue", false);
}

/**
 * 通知父组件用当前筛选条件刷新 session 列表。
 */
function refresh(): void {
    emit("refresh", query.value);
}

const debouncedRefresh = useDebounceFn(refresh, 250);

/**
 * 重置筛选条件到默认 leader 近期会话。
 */
function resetFilters(): void {
    sessionSearch.value = "";
    profileFilter.value = "leader";
    statusFilter.value = "active";
    relationFilter.value = "all";
    refresh();
}

/**
 * 请求下一页 session。
 */
function loadMore(): void {
    if (!props.hasMore || props.nextOffset === null) {
        return;
    }
    emit("loadMore", {
        ...query.value,
        offset: props.nextOffset,
    });
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
 * 返回 session 状态色块样式。
 */
function statusClass(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "border border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
        case "waiting": return "border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
        case "interrupted": return "border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
        case "archived": return "bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-color)]";
        default: return "border border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
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

/**
 * 返回 profile 的中文名。
 */
function profileDisplayName(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return t("agent.profiles.leaderAssets");
        case "rp.leader": return t("agent.profiles.rpLeader");
        case "simulator.leader": return t("agent.profiles.simulatorLeader");
        case "leader.default": return t("agent.profiles.leaderDefault");
        case "writer": return t("agent.profiles.writer");
        case "rp.writer": return t("agent.profiles.rpWriter");
        case "director": return t("agent.profiles.director");
        case "summarizer": return t("agent.profiles.summarizer");
        case "memory.curator": return t("agent.profiles.memoryCurator");
        case "researcher": return t("agent.profiles.researcher");
        case "retrieval": return t("agent.profiles.retrieval");
        case "simulator.actor": return t("agent.profiles.simulatorActor");
        default: return profileKey;
    }
}

watch(query, () => {
    debouncedRefresh();
}, {deep: true});
watch(() => props.modelValue, (open) => {
    if (open) {
        refresh();
    }
});
onClickOutside(filterPanelRef, () => {
    filterPanelOpen.value = false;
}, {ignore: [filterButtonRef]});
</script>

<template>
    <Dialog :model-value="props.modelValue" :title="t('agent.session.title')" teleport-target=".novel-ide-theme" width="min(1040px, calc(100vw - 32px))" height="min(760px, calc(100vh - 32px))" max-height="calc(100vh - 32px)" body-class="overflow-visible" :show-cancel="false" @confirm="emit('create')" @update:model-value="emit('update:modelValue', $event)">
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-base font-semibold leading-snug tracking-wide text-[var(--text-main)]">{{ t("agent.session.title") }}</div>
                </div>
                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="close">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <div class="flex min-h-0 flex-1 flex-col space-y-4 pt-4">
            <!-- Session 搜索和操作 -->
            <div class="relative flex items-center gap-2">
                <div class="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3">
                    <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                    <input v-model="sessionSearch" type="text" :placeholder="t('agent.session.dialogSearchPlaceholder')" class="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]">
                    <button ref="filterButtonRef" type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.session.filter')" @click="filterPanelOpen = !filterPanelOpen">
                        <span class="i-lucide-list-filter h-4 w-4"></span>
                    </button>
                </div>
                <Dropdown v-if="props.canChooseCreateProfile" :items="createDropdownItems" root-class="relative inline-block" menu-class="right-0 top-full mt-1.5 w-44" @select="emit('create', $event)">
                    <button class="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-bg)] px-4 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId">
                        <span class="i-lucide-plus h-4 w-4"></span>
                        {{ t("agent.session.create") }}
                    </button>
                </Dropdown>
                <button v-else class="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-bg)] px-4 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId" @click="emit('create')">
                    <span class="i-lucide-plus h-4 w-4"></span>
                    {{ t("agent.session.create") }}
                </button>

                <transition name="fade">
                    <div v-if="filterPanelOpen" ref="filterPanelRef" class="absolute left-0 top-[calc(100%+8px)] z-40 w-[240px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 shadow-2xl">
                        <div class="flex items-center justify-between">
                            <div class="text-[12px] font-semibold text-[var(--text-main)]">{{ t("agent.session.filter") }}</div>
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" @click="filterPanelOpen = false">
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                            </button>
                        </div>

                        <div class="mt-2.5 space-y-2.5">
                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{{ t("agent.session.profile") }}</div>
                                <div class="grid grid-cols-2 gap-1.5">
                                    <button v-for="item in profileItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="profileFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="profileFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{{ t("agent.session.status") }}</div>
                                <div class="grid grid-cols-2 gap-1.5">
                                    <button v-for="item in statusItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="statusFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="statusFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{{ t("agent.session.relation") }}</div>
                                <div class="grid grid-cols-3 gap-1.5">
                                    <button v-for="item in relationItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="relationFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="relationFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <div class="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                                <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="resetFilters">{{ t("agent.session.resetFilters") }}</button>
                                <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="sessionSearch = ''">{{ t("agent.session.clearSearch") }}</button>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>

            <!-- 近期 Session 列表 -->
            <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-1.5 py-1 custom-scrollbar">
                <div
                    v-for="session in listedSessions"
                    :key="session.sessionId"
                    class="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-all duration-200"
                    :class="session.sessionId === activeSessionId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] shadow-sm' : 'border-[var(--border-color)] bg-transparent hover:bg-[var(--bg-hover)]'"
                    @click="emit('select', session.sessionId)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-3">
                            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200" :class="session.parentSessionId ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">
                                <span :class="session.parentSessionId ? 'i-lucide-bot' : 'i-lucide-crown'" class="h-4.5 w-4.5"></span>
                            </div>
                            <span class="truncate text-sm font-semibold text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ sessionTitle(session) }}</span>
                            <span v-if="session.sessionId === activeSessionId" class="rounded bg-[var(--accent-main)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-inverse)] shadow-sm">{{ t("agent.session.active") }}</span>
                            <span class="rounded px-1.5 py-0.5 text-[10px] font-medium" :class="statusClass(session.status)">{{ statusLabel(session.status) }}</span>
                            <span v-if="profileAvailabilityLabel(session)" class="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-warning)]" :title="profileAvailabilityTitle(session)">
                                <span class="i-lucide-lock h-3 w-3"></span>
                                {{ profileAvailabilityLabel(session) }}
                            </span>
                        </div>
                        <div class="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{{ sessionPreview(session) }}</div>
                        <div class="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 font-mono font-bold text-[var(--text-secondary)]">#{{ session.sessionId }}</span>
                            <span>{{ formatTimestamp(session.updatedAt) }}</span>
                            <span class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--text-secondary)]">{{ profileDisplayName(session.profileKey) }}</span>
                            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">{{ session.profileKey }}</span>
                            <span v-if="session.parentSessionId" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--text-secondary)]">{{ t("agent.session.parentSession", {id: session.parentSessionId}) }}</span>
                        </div>
                    </div>
                    <div class="flex shrink-0 flex-col gap-1">
                        <button class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-50 transition-all hover:bg-[var(--bg-input)] hover:text-[var(--accent-text)] hover:opacity-100 group-hover:opacity-100 disabled:opacity-40" :disabled="actionId === session.sessionId || loading || !canRenameSession(session)" :title="t('agent.session.rename')" @click.stop="emit('rename', session)">
                            <span class="i-lucide-pencil-line h-4 w-4"></span>
                        </button>
                        <button v-if="canRestoreSession(session)" class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-50 transition-all hover:bg-[var(--status-success-bg)] hover:text-[var(--status-success)] hover:opacity-100 group-hover:opacity-100 disabled:opacity-40" :disabled="actionId === session.sessionId || loading" :title="t('agent.session.restore')" @click.stop="emit('restore', session)">
                            <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                            <span v-else class="i-lucide-archive-restore h-4 w-4"></span>
                        </button>
                        <button v-else class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-50 transition-all hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] hover:opacity-100 group-hover:opacity-100 disabled:opacity-40" :disabled="actionId === session.sessionId || loading || !canArchiveSession(session)" :title="t('agent.session.archive')" @click.stop="emit('archive', session)">
                            <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                            <span v-else class="i-lucide-archive h-4 w-4"></span>
                        </button>
                    </div>
                </div>

                <div v-if="props.hasMore" class="flex justify-center py-2">
                    <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.loading" @click="loadMore">
                        <span v-if="props.loading" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                        <span v-else class="i-lucide-list-plus h-3.5 w-3.5"></span>
                        {{ t("agent.session.loadMore") }}
                    </button>
                </div>

                <div v-if="listedSessions.length === 0" class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    {{ t("agent.session.noMatching") }}
                    <div class="mt-3 flex justify-center gap-2">
                        <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="resetFilters">{{ t("agent.session.resetFilters") }}</button>
                        <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="sessionSearch = ''">{{ t("agent.session.clearSearch") }}</button>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex w-full items-center justify-between">
                <div class="text-[11px] text-[var(--text-muted)]">{{ t("agent.session.recentCount", {filtered: listedSessions.length, total: props.total}) }}</div>
                <button class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="close">{{ t("agent.session.close") }}</button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
}
</style>
