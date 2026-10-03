<script setup lang="ts">
/**
 * Workspace 文件历史收件箱（Task 95 最小 UI）：
 * 左列待审查文件分组（归因/操作摘要），右侧 Monaco diff（基准 = 上次接受位点，按 path + revision 按需拉全文），
 * 每组提供「接受」与「还原」（还原走 danger 确认）。时间线 / 删除找回面板留给下一任务。
 */
import Dialog from "nbook/app/components/common/Dialog.vue";
import SharedDiffEditor from "nbook/app/components/common/diff/SharedDiffEditor.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useWorkspaceHistoryDiffRequests} from "nbook/app/composables/useWorkspaceHistoryDiffRequests";
import {useWorkspaceHistoryInbox} from "nbook/app/composables/useWorkspaceHistoryInbox";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import type {WorkspaceHistoryDiffRequestIdentity} from "nbook/app/utils/workspace-history-diff-request";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

const props = defineProps<{
    modelValue: boolean;
    /** 当前 Project Path（workspace/<slug>）；为空（user-assets 模式）时不可用 */
    projectRoot: string | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const notification = useNotification();
const {confirm} = useDialog();
const {t} = useI18n();
const projectRootRef = toRef(props, "projectRoot");
const dialogOpenRef = toRef(props, "modelValue");
const {revision, groups, loading, error: inboxError, load: loadInbox} = useWorkspaceHistoryInbox(projectRootRef, dialogOpenRef);
const diffRequests = useWorkspaceHistoryDiffRequests();

const selectedPath = ref<string | null>(null);
/** 面板局部加载错误（可恢复，随刷新清除） */
const actionError = ref<string | null>(null);
/** 正在执行 accept/revert 的组路径（行级操作锁） */
const busyPath = ref<string | null>(null);

const selectedGroup = computed(() => groups.value.find((group) => group.path === selectedPath.value) ?? null);
const error = computed(() => actionError.value ?? inboxError.value);
const selectedDiffState = computed(() => selectedGroup.value
    ? diffRequests.state(diffIdentity(selectedGroup.value))
    : {loading: false, error: null, result: null});
const selectedDiff = computed(() => selectedDiffState.value.result);

/** 拉收件箱分组列表并保持/重置选中项。 */
async function load(): Promise<void> {
    actionError.value = null;
    diffRequests.invalidate();
    await loadInbox();
    const keep = groups.value.find((group) => group.path === selectedPath.value) ?? groups.value[0] ?? null;
    await select(keep);
}

/** 选中一组并通过服务端路径授权接口读取两侧全文。 */
async function select(group: WorkspaceHistoryInboxGroupDto | null): Promise<void> {
    selectedPath.value = group?.path ?? null;
    if (!group || !props.projectRoot) {
        return;
    }
    await diffRequests.load(diffIdentity(group), t("ide.historyInbox.loadFailed"));
}

/** 接受：把该文件的审查位点推进到最新（不改文件内容）。 */
async function acceptGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
    if (!props.projectRoot || busyPath.value) {
        return;
    }
    busyPath.value = group.path;
    try {
        await $fetch("/api/workspace-history/accept", {method: "POST", body: {projectRoot: props.projectRoot, path: group.path, revision: group.revision}});
        notification.success(t("ide.historyInbox.acceptSuccess", {path: group.path}));
        await load();
    } catch (cause) {
        if (await refreshAfterStale(cause)) {
            return;
        }
        notification.error(resolveApiErrorMessage(cause, t("ide.historyInbox.actionFailed")));
    } finally {
        busyPath.value = null;
    }
}

/** 还原：把文件内容退回上次接受的基线（danger 确认；操作本身入账，可再次审查）。 */
async function revertGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
    if (!props.projectRoot || busyPath.value) {
        return;
    }
    const confirmed = await confirm(t("ide.historyInbox.revertConfirm", {path: group.path}), t("ide.historyInbox.revert"));
    if (!confirmed) {
        return;
    }
    busyPath.value = group.path;
    try {
        await $fetch("/api/workspace-history/revert", {method: "POST", body: {projectRoot: props.projectRoot, path: group.path, revision: group.revision}});
        notification.success(t("ide.historyInbox.revertSuccess", {path: group.path}));
        await load();
    } catch (cause) {
        if (await refreshAfterStale(cause)) {
            return;
        }
        notification.error(resolveApiErrorMessage(cause, t("ide.historyInbox.actionFailed")));
    } finally {
        busyPath.value = null;
    }
}

/** 构造完整审查模式下的版本化 diff 身份。 */
function diffIdentity(group: WorkspaceHistoryInboxGroupDto): WorkspaceHistoryDiffRequestIdentity {
    return {
        projectRoot: props.projectRoot ?? "",
        path: group.path,
        revision: group.revision,
        mode: "full",
    };
}

/** 412 表示文件已出现新版本：保留原动作未执行，提示并刷新。 */
async function refreshAfterStale(cause: unknown): Promise<boolean> {
    if (resolveApiErrorStatus(cause) !== 412) {
        return false;
    }
    notification.warning(t("ide.historyInbox.stale"));
    await load();
    return true;
}

/** 组内归因摘要，如「Agent #12、用户」。 */
function actorSummary(group: WorkspaceHistoryInboxGroupDto): string {
    const labels = new Set<string>();
    for (const entry of group.entries) {
        switch (entry.actorKind) {
            case "user":
                labels.add(t("ide.historyInbox.actorUser"));
                break;
            case "agent":
                labels.add(`Agent #${entry.actorDetail ?? "?"}`);
                break;
            case "system":
                labels.add(t("ide.historyInbox.actorSystem", {source: entry.actorDetail ?? ""}));
                break;
            case "external":
                labels.add(t("ide.historyInbox.actorExternal"));
                break;
        }
    }
    return [...labels].join("、");
}

watch(() => props.modelValue, (open) => {
    if (open) {
        void load();
    }
});

watch(() => props.projectRoot, () => {
    diffRequests.invalidate();
    selectedPath.value = null;
});

watch(revision, () => {
    diffRequests.invalidate();
    if (props.modelValue && selectedGroup.value) {
        void diffRequests.load(diffIdentity(selectedGroup.value), t("ide.historyInbox.loadFailed"));
    }
});
</script>

<template>
    <!-- 文件变更收件箱弹窗 -->
    <Dialog :model-value="props.modelValue" :title="t('ide.historyInbox.title')" size="xl" :show-footer="false" body-class="!p-0 !overflow-hidden" @update:model-value="emit('update:modelValue', $event)">
        <template #header-extra>
            <button type="button" class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.historyInbox.refresh')" @click="void load()">
                <span class="i-lucide-refresh-cw h-4 w-4"></span>
            </button>
        </template>

        <!-- 左列待审组列表 / 右侧 diff 预览 -->
        <div class="flex h-[70vh] min-h-0 flex-1">
            <aside class="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-color)]">
                <p v-if="error" class="m-3 rounded border border-[var(--status-danger)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ error }}</p>
                <p v-else-if="loading && groups.length === 0" class="m-3 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.loading") }}</p>
                <p v-else-if="groups.length === 0" class="m-3 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.empty") }}</p>
                <button v-for="group in groups" :key="group.path" type="button" class="flex flex-col gap-1 border-b border-[var(--border-color)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]" :class="group.path === selectedPath ? 'bg-[var(--bg-hover)]' : ''" @click="void select(group)">
                    <span class="flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-main)]" :title="group.path">{{ group.path }}</span>
                        <span v-if="group.endHash === null" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--status-danger)] border border-[var(--status-danger)]">{{ t("ide.historyInbox.deleted") }}</span>
                    </span>
                    <span class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span class="text-[var(--status-info)]">{{ actorSummary(group) }}</span>
                        <span>{{ t("ide.historyInbox.entryCount", {count: group.entries.length}) }}</span>
                    </span>
                    <span class="flex items-center gap-2">
                        <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--status-success)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="busyPath !== null" @click.stop="void acceptGroup(group)">{{ t("ide.historyInbox.accept") }}</button>
                        <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="busyPath !== null" @click.stop="void revertGroup(group)">{{ t("ide.historyInbox.revert") }}</button>
                    </span>
                </button>
            </aside>
            <section class="flex min-w-0 flex-1 flex-col">
                <p v-if="!selectedGroup" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.noSelection") }}</p>
                <p v-else-if="selectedDiffState.loading" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.loading") }}</p>
                <p v-else-if="selectedDiffState.error" class="m-4 text-sm text-[var(--status-danger)]">{{ selectedDiffState.error }}</p>
                <p v-else-if="selectedDiff?.status === 'blocked'" class="m-4 rounded border border-[var(--status-warning)] px-3 py-2 text-sm text-[var(--status-warning)]">{{ t("ide.historyInbox.diffBlocked") }}</p>
                <p v-else-if="selectedDiff && selectedDiff.status !== 'available'" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.diffUnavailable") }}</p>
                <SharedDiffEditor v-else-if="selectedDiff?.status === 'available'" class="min-h-0 flex-1" :model-key="`history-inbox:${selectedGroup.path}:${selectedGroup.revision}`" :original-content="selectedDiff.original" :modified-content="selectedDiff.modified" :original-label="t('ide.historyInbox.baseLabel')" :modified-label="t('ide.historyInbox.currentLabel')" />
            </section>
        </div>
    </Dialog>
</template>
