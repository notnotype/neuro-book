<script setup lang="ts">
/**
 * 任务中心单行（Task 111 PLAN-F）：
 * 行头（kind 图标/标题/状态 chip）+ meta（jobId/发起者/时间/时长）+ preview 摘要；
 * 点击展开详情：ref 观测指针（可复制）、preview/error 全文、completed 时按需拉取 result。
 * 取消动作直接走 job cancel API（与气泡语义一致），终态由共享 SSE 确认。
 */
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentJobDetail, AgentJobSnapshot} from "nbook/shared/dto/agent-job.dto";

const props = defineProps<{
    job: AgentJobSnapshot;
    /** 任务中心唯一秒表的当前时间；仅面板打开且有活跃任务时更新。 */
    now: number;
}>();

const notification = useNotification();
const {t} = useI18n();

const expanded = ref(false);
const cancelling = ref(false);
/** 取消请求已发出（best-effort）；实际翻转到 cancelled 由 SSE 快照确认。 */
const cancelRequested = ref(false);

// AgentJobDetail.result 含递归 JsonValue，整体替换不做深响应展开。
const detail = shallowRef<AgentJobDetail | null>(null);
const detailLoading = ref(false);
/** 404：job 已不在内存（服务重启），结果不可查询且不再重试 */
const detailUnavailable = ref(false);
const detailError = ref("");
let detailFetched = false;

const isActive = computed(() => props.job.status === "running" || props.job.status === "waiting");

const KIND_ICONS: Record<AgentJobSnapshot["kind"], string> = {
    workflow: "i-lucide-workflow",
    bash: "i-lucide-terminal",
    invoke_agent: "i-lucide-bot",
};

/** 状态 chip：口诀色（running=info/waiting=warning/completed=success/failed=danger/cancelled=muted） */
const STATUS_CHIPS: Record<AgentJobSnapshot["status"], {labelKey: string; chipClass: string; icon?: string}> = {
    running: {labelKey: "statusRunning", chipClass: "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]", icon: "i-lucide-loader-2 animate-spin"},
    waiting: {labelKey: "statusWaiting", chipClass: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]"},
    completed: {labelKey: "statusCompleted", chipClass: "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]"},
    failed: {labelKey: "statusFailed", chipClass: "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]"},
    cancelled: {labelKey: "statusCancelled", chipClass: "border-[var(--border-color)] text-[var(--text-muted)]"},
    interrupted: {labelKey: "statusInterrupted", chipClass: "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]"},
};

const statusChip = computed(() => STATUS_CHIPS[props.job.status]);

const DELIVERY_LABELS: Record<AgentJobSnapshot["deliveryStatus"], string> = {
    not_required: "deliveryNotRequired",
    pending: "deliveryPending",
    accepted: "deliveryAccepted",
    failed: "deliveryFailed",
};

const deliveryStatusText = computed(() => t(`ide.agentJobs.${DELIVERY_LABELS[props.job.deliveryStatus]}`));

const ownerLabel = computed(() => props.job.ownerSessionId === null
    ? t("ide.agentJobs.ownerNone")
    : `Agent #${props.job.ownerSessionId}`);

/** 时长：终态用 endedAt；运行中消费任务中心唯一秒表。 */
const durationLabel = computed(() => formatDuration((props.job.endedAt ?? props.now) - props.job.createdAt));

/** ref 观测指针结构化摘要（workflow→runId / bash→command / invoke_agent→sessionId）；解析不出时降级 JSON 文本 */
const refEntries = computed<Array<{key: string; label: string; value: string}>>(() => {
    const raw = props.job.ref;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        const labels: Record<string, string> = {
            runId: t("ide.agentJobs.refRunId"),
            command: t("ide.agentJobs.refCommand"),
            sessionId: t("ide.agentJobs.refSessionId"),
        };
        const entries = Object.entries(labels)
            .filter(([key]) => raw[key] !== undefined && raw[key] !== null)
            .map(([key, label]) => ({key, label, value: String(raw[key])}));
        if (entries.length > 0) return entries;
    }
    if (raw === null || raw === undefined) return [];
    return [{key: "ref", label: "ref", value: JSON.stringify(raw)}];
});

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notification.success(t("ide.agentJobs.copied"));
    } catch {
        notification.error(t("ide.agentJobs.copyFailed"));
    }
}

async function cancel(): Promise<void> {
    if (cancelling.value || cancelRequested.value) return;
    cancelling.value = true;
    try {
        await $fetch(`/api/agent/jobs/${props.job.jobId}/cancel`, {method: "POST"});
        cancelRequested.value = true;
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, t("ide.agentJobs.cancelFailed")));
    } finally {
        cancelling.value = false;
    }
}

/** completed 且展开时才拉一次详情（result 不进列表快照）；非 404 失败允许收起再展开重试 */
async function loadDetail(): Promise<void> {
    if (!expanded.value || props.job.status !== "completed" || detailFetched || detailLoading.value) return;
    detailLoading.value = true;
    try {
        const response = await $fetch(`/api/agent/jobs/${props.job.jobId}`) as unknown as {job: AgentJobDetail};
        detail.value = response.job;
        detailError.value = "";
        detailFetched = true;
    } catch (caught) {
        if (resolveApiErrorStatus(caught) === 404) {
            detailUnavailable.value = true;
            detailFetched = true;
        } else {
            detailError.value = resolveApiErrorMessage(caught, t("ide.agentJobs.loadFailed"));
        }
    } finally {
        detailLoading.value = false;
    }
}

watch([expanded, () => props.job.status], () => {
    if (!isActive.value) cancelRequested.value = false;
    void loadDetail();
});
</script>

<template>
    <!-- 后台任务单行（点击行头展开详情） -->
    <div class="border-b border-[var(--border-color)]">
        <div class="flex cursor-pointer flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]" @click="expanded = !expanded">
            <!-- 行1：kind 图标 + 标题 + 状态 chip -->
            <div class="flex items-center gap-2">
                <span :class="KIND_ICONS[job.kind]" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-main)]" :title="job.title">{{ job.title }}</span>
                <span class="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]" :class="statusChip.chipClass">
                    <span v-if="statusChip.icon" :class="statusChip.icon" class="h-3 w-3"></span>
                    <span>{{ t(`ide.agentJobs.${statusChip.labelKey}`) }}</span>
                </span>
            </div>
            <!-- 行2：meta + 取消 -->
            <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <span class="font-mono">{{ job.jobId }}</span>
                <span>·</span>
                <span>{{ ownerLabel }}</span>
                <span>·</span>
                <span>{{ formatTimestamp(job.createdAt) }}</span>
                <span>·</span>
                <span>{{ durationLabel }}</span>
                <span class="flex-1"></span>
                <button v-if="isActive" type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="cancelling || cancelRequested" @click.stop="void cancel()">{{ cancelling || cancelRequested ? t("ide.agentJobs.cancelling") : t("ide.agentJobs.cancel") }}</button>
            </div>
            <!-- 行3：收起态 preview / error 摘要 -->
            <p v-if="job.preview && !expanded" class="line-clamp-2 text-[12px] text-[var(--text-secondary)]">{{ job.preview }}</p>
            <p v-if="job.error && !expanded" class="truncate text-[12px] text-[var(--status-danger)]">{{ job.error }}</p>
            <p v-if="job.deliveryStatus !== 'not_required'" class="whitespace-pre-wrap break-words text-[12px]"
                :class="{
                    'text-[var(--status-info)]': job.deliveryStatus === 'pending',
                    'text-[var(--status-success)]': job.deliveryStatus === 'accepted',
                    'text-[var(--status-danger)]': job.deliveryStatus === 'failed',
                }">
                ↳ {{ deliveryStatusText }}<span v-if="job.deliveryStatus === 'failed' && job.deliveryError">：{{ job.deliveryError }}</span>
            </p>
            <!-- waiting 指引：应答能力在发起会话的气泡侧，面板只指路 -->
            <p v-if="job.status === 'waiting'" class="text-[12px] text-[var(--status-warning)]">↳ {{ t("ide.agentJobs.waitingHint", {session: ownerLabel}) }}</p>
        </div>

        <!-- 展开详情区 -->
        <div v-if="expanded" class="flex flex-col gap-2 border-t border-dashed border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3">
            <!-- ref 观测指针 + 复制 -->
            <div v-for="entry in refEntries" :key="entry.key" class="flex items-center gap-2 text-[12px]">
                <span class="shrink-0 text-[var(--text-muted)]">{{ entry.label }}</span>
                <code class="min-w-0 flex-1 truncate rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]" :title="entry.value">{{ entry.value }}</code>
                <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="void copyText(entry.value)">
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
            </div>
            <!-- preview 全文（运行中随 SSE 快照刷新） -->
            <p v-if="job.preview" class="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--text-secondary)]">{{ job.preview }}</p>
            <!-- error 全文 + 复制 -->
            <div v-if="job.error" class="flex items-start gap-2">
                <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] text-[var(--status-danger)]">{{ job.error }}</p>
                <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="void copyText(job.error)">
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
            </div>
            <!-- result（completed 展开时按需拉取） -->
            <div v-if="job.status === 'completed'" class="flex flex-col gap-1">
                <span class="text-[11px] tracking-wider text-[var(--text-muted)]">{{ t("ide.agentJobs.resultTitle") }}</span>
                <div v-if="detailLoading" class="flex items-center py-1 text-[var(--text-muted)]">
                    <span class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>
                </div>
                <p v-else-if="detailUnavailable" class="text-[12px] text-[var(--text-muted)]">{{ t("ide.agentJobs.resultUnavailable") }}</p>
                <p v-else-if="detailError" class="text-[12px] text-[var(--status-danger)]">{{ detailError }}</p>
                <JsonViewer v-else-if="detail && detail.result !== undefined" :value="detail.result" :max-height="240" />
                <p v-else-if="detail" class="text-[12px] text-[var(--text-muted)]">—</p>
            </div>
        </div>
    </div>
</template>
