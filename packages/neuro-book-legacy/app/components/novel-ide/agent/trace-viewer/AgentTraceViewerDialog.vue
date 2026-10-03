<script setup lang="ts">
/**
 * Pi 请求 trace 查看器 Dialog（NeuroBook 粘合层）：
 * 负责数据获取（scope 下拉 / index / record）、session 标题 join、错误通知与
 * 「打开会话」事件转发。AgentTraceList / AgentTraceDetail 保持纯展示，
 * 是将来可抽成独立库的核心；本组件承担全部 NeuroBook 耦合。
 *
 * scope 模型：`__recent__`（跨所有 bucket 聚合最近请求）或具体 bucket
 * （数字 sessionId / `_system` 无 session 请求）。缺省打开「最近请求」。
 */
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import AgentTraceDetail from "nbook/app/components/novel-ide/agent/trace-viewer/AgentTraceDetail.vue";
import AgentTraceList from "nbook/app/components/novel-ide/agent/trace-viewer/AgentTraceList.vue";
import {traceEntryKey} from "nbook/app/components/novel-ide/agent/trace-viewer/trace-view-model";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useAgentTraceApi} from "nbook/app/composables/useAgentTraceApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentTraceBucketDto, AgentTraceIndexEntryDto, AgentTraceRecordDto} from "nbook/shared/dto/agent-trace.dto";

/** 「最近请求」的 scope 哨兵值；用了 bucket 白名单外的字符，永不与真实 bucket 冲突。 */
const RECENT_SCOPE = "__recent__";

/** 列表条目：per-bucket 视图无 bucket 字段（scope 隐含），recent 聚合视图带 bucket。 */
type TraceListEntry = AgentTraceIndexEntryDto & {bucket?: string};

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "open-session", sessionId: number): void;
}>();

const traceApi = useAgentTraceApi();
const sessionApi = useAgentSessionApi();
const notification = useNotification();
const {confirm} = useDialog();
const {t} = useI18n();

const buckets = ref<AgentTraceBucketDto[]>([]);
const sessionTitles = ref<Map<number, string>>(new Map());
const selectedScope = ref<string | null>(null);
const entries = ref<TraceListEntry[]>([]);
const selectedKey = ref<string | null>(null);
const record = ref<AgentTraceRecordDto | null>(null);
const loadingList = ref(false);
const loadingRecord = ref(false);

const scopeOptions = computed<SelectOption[]>(() => [
    {value: RECENT_SCOPE, label: t("agent.traceViewer.scopeRecent")},
    ...buckets.value.map((bucket) => ({
        value: bucket.bucket,
        label: bucketLabel(bucket.bucket),
        description: t("agent.traceViewer.bucketCount", {count: bucket.count}),
    })),
]);

/** 「最近请求」模式下给条目补来源徽标文案；per-bucket 模式原样透传。 */
const displayEntries = computed(() => selectedScope.value === RECENT_SCOPE
    ? entries.value.map((entry) => ({...entry, sourceLabel: entry.bucket ? bucketLabel(entry.bucket) : undefined}))
    : entries.value);

/** bucket 显示名：_system 固定文案，session 用标题（session 列表 join），拿不到标题退回编号。 */
function bucketLabel(bucket: string): string {
    if (bucket === "_system") {
        return t("agent.traceViewer.bucketSystem");
    }
    const title = sessionTitles.value.get(Number(bucket));
    return title ? `#${bucket} ${title}` : t("agent.traceViewer.bucketSession", {id: bucket});
}

/**
 * 打开/刷新时初始化：拉 bucket 列表 + session 标题，选中 preferredScope（缺省「最近请求」）。
 * 指定具体 bucket 但列表里没有时补一个 0 条选项（服务清空后停留原位的场景）。
 */
async function initialize(preferredScope?: string): Promise<void> {
    loadingList.value = true;
    try {
        const [bucketList, sessionPage] = await Promise.all([
            traceApi.listBuckets(),
            sessionApi.listSessions({includeArchived: true, includeSystem: true, limit: 200}).catch(() => null),
        ]);
        sessionTitles.value = new Map((sessionPage?.items ?? []).flatMap((item) => item.title ? [[item.sessionId, item.title] as const] : []));
        const list = [...bucketList.buckets];
        const preferred = preferredScope ?? RECENT_SCOPE;
        if (preferred !== RECENT_SCOPE && !list.some((bucket) => bucket.bucket === preferred)) {
            list.unshift({bucket: preferred, count: 0});
        }
        buckets.value = list;
        selectedScope.value = preferred;
    } catch (error) {
        buckets.value = [];
        selectedScope.value = null;
        notification.error(resolveApiErrorMessage(error, t("agent.traceViewer.loadFailed")));
    } finally {
        loadingList.value = false;
    }
    await loadEntries();
}

/** 加载当前 scope 的条目并自动选中最新一条。 */
async function loadEntries(): Promise<void> {
    const scope = selectedScope.value;
    if (!scope) {
        entries.value = [];
        await selectEntry(null);
        return;
    }
    loadingList.value = true;
    try {
        entries.value = scope === RECENT_SCOPE
            ? (await traceApi.listRecent()).entries
            : (await traceApi.listIndex(scope)).entries;
    } catch (error) {
        entries.value = [];
        notification.error(resolveApiErrorMessage(error, t("agent.traceViewer.loadFailed")));
    } finally {
        loadingList.value = false;
    }
    await selectEntry(entries.value[0] ?? null);
}

/** 选中一条记录并加载详情；来源 bucket 优先取条目自带（recent 模式），否则用当前 scope。 */
async function selectEntry(entry: TraceListEntry | null): Promise<void> {
    selectedKey.value = entry ? traceEntryKey(entry) : null;
    const bucket = entry?.bucket ?? (selectedScope.value !== RECENT_SCOPE ? selectedScope.value : null);
    if (!entry || !bucket) {
        record.value = null;
        return;
    }
    loadingRecord.value = true;
    try {
        record.value = await traceApi.getRecord(bucket, entry.id);
    } catch (error) {
        record.value = null;
        notification.error(resolveApiErrorMessage(error, t("agent.traceViewer.recordMissing")));
    } finally {
        loadingRecord.value = false;
    }
}

function selectScope(scope: string): void {
    if (scope === selectedScope.value) {
        return;
    }
    selectedScope.value = scope;
    void loadEntries();
}

/** 清空当前 bucket（确认后执行）；「最近请求」聚合视图没有单一 bucket，不可清空。 */
async function clearCurrentBucket(): Promise<void> {
    const bucket = selectedScope.value;
    if (!bucket || bucket === RECENT_SCOPE) {
        return;
    }
    const confirmed = await confirm(t("agent.traceViewer.clearConfirm", {bucket: bucketLabel(bucket)}), t("agent.traceViewer.clear"));
    if (!confirmed) {
        return;
    }
    try {
        await traceApi.clearBucket(bucket);
        notification.success(t("agent.traceViewer.clearSuccess"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("agent.traceViewer.clearFailed")));
        return;
    }
    await initialize(bucket);
}

/** trace → session 跳转：转发给宿主并关闭查看器。 */
function handleOpenSession(sessionId: number): void {
    emit("open-session", sessionId);
    emit("update:modelValue", false);
}

watch(() => props.modelValue, (open) => {
    if (open) {
        void initialize();
    }
});
</script>

<template>
    <!-- Pi 请求 trace 查看器弹窗 -->
    <Dialog
        :model-value="props.modelValue"
        :title="t('agent.traceViewer.title')"
        size="xl"
        :show-footer="false"
        body-class="!p-0 !overflow-hidden"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header-extra>
            <div class="flex items-center gap-2">
                <div class="w-64">
                    <FormSelect :model-value="selectedScope ?? ''" :options="scopeOptions" @update:model-value="selectScope" />
                </div>
                <button type="button" class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.traceViewer.refresh')" @click="void initialize(selectedScope ?? undefined)">
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </button>
                <button type="button" class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--status-danger)] disabled:cursor-not-allowed disabled:opacity-40" :title="t('agent.traceViewer.clear')" :disabled="!selectedScope || selectedScope === RECENT_SCOPE || loadingList" @click="void clearCurrentBucket()">
                    <span class="i-lucide-trash-2 h-4 w-4"></span>
                </button>
            </div>
        </template>

        <!-- 左列表右详情 -->
        <div class="flex min-h-0 flex-1">
            <aside class="flex w-[360px] shrink-0 flex-col border-r border-[var(--border-color)]">
                <AgentTraceList class="min-h-0 flex-1" :entries="displayEntries" :selected-key="selectedKey" :loading="loadingList" @select="void selectEntry($event)" />
            </aside>
            <section class="flex min-w-0 flex-1 flex-col">
                <AgentTraceDetail class="min-h-0 flex-1" :record="record" :loading="loadingRecord" @open-session="handleOpenSession" />
            </section>
        </div>
    </Dialog>
</template>
