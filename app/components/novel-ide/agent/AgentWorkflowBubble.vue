<script setup lang="ts">
import {computed, inject, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import WorkflowMermaid from "nbook/app/components/workflow-preview/WorkflowMermaid.vue";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {useAgentJob} from "nbook/app/composables/useAgentJob";
import {
    parseRunWorkflowArgs,
    parseRunWorkflowDetails,
    resolveWorkflowBubbleError,
    resolveWorkflowBubbleStatus,
    resolveWorkflowDisplaySummary,
    shouldPollWorkflowRun,
    workflowPollDelay,
    type WorkflowBubbleStatus,
    type WorkflowSessionDetails,
} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {WorkflowDemoRunState} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue, PendingAsk} from "nbook/server/vendor/nb-workflow/index";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

type WorkflowCatalogResponse = {
    workflows: Array<{key: string; title: string; description: string}>;
};

const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);
const ideStore = useNovelIdeStore();
const catalogProjectRoot = computed(() => ideStore.workspaceKind === "user-assets" ? "" : ideStore.currentProjectRoot);
const runState = shallowRef<WorkflowDemoRunState | null>(null);
const pollError = ref("");
const runUnavailable = ref(false);
const chartExpanded = ref(true);
const catalogTitle = ref("");
const catalogDescription = ref("");
const nowTick = ref(Date.now());

const parsedArgs = computed(() => parseRunWorkflowArgs(props.toolCall.argsJson ?? props.toolCall.argsText));
const details = computed(() => parseRunWorkflowDetails(props.toolCall.resultData));
const jobId = computed(() => details.value?.jobId ?? null);
const jobEventCursor = computed(() => details.value?.jobEventCursor ?? null);
const {
    job: observedJob,
    error: jobFeedError,
    unavailable: jobUnavailable,
    cancelling: cancelSubmitting,
    cancelRequested,
    canCancel: canCancelJob,
    cancel: cancelJob,
} = useAgentJob(jobId, jobEventCursor);
const matchingJob = computed(() => observedJob.value?.jobId === jobId.value ? observedJob.value : null);
const jobRefRunId = computed(() => {
    const refValue = matchingJob.value?.ref;
    return refValue && typeof refValue === "object" && !Array.isArray(refValue) && typeof refValue.runId === "string"
        ? refValue.runId
        : "";
});
const runId = computed(() => details.value?.runId ?? jobRefRunId.value);
const workflowKey = computed(() => details.value?.workflowKey ?? parsedArgs.value.workflowKey ?? "");
const workflowTitle = computed(() => catalogTitle.value || workflowKey.value || "Inline workflow");

/** 当前 tool 是否正由会话级声明式审批宿主等待用户决策。 */
const pendingApproval = computed(() => {
    return userInputContext?.pendingSessions.value.some((session) => {
        return session.assistantMessageId === props.toolCall.assistantMessageId
            && session.questions.some((question) => {
                return (question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id)
                    && question.kind === "tool_approval";
            });
    }) ?? false;
});

/** 当前 API 快照必须和 details 的 runId 一致，防止 prop 快速切换时混入旧响应。 */
const matchingRunState = computed(() => runState.value?.view.runId === runId.value ? runState.value : null);

const status = computed<WorkflowBubbleStatus>(() => {
    return resolveWorkflowBubbleStatus({
        pendingApproval: pendingApproval.value,
        toolCallStatus: props.toolCall.status,
        detailsStatus: details.value?.status,
        hasBackgroundJob: Boolean(jobId.value),
        jobStatus: matchingJob.value?.status,
        jobUnavailable: jobUnavailable.value,
        runStatus: matchingRunState.value?.view.status,
        runUnavailable: runUnavailable.value,
    });
});

const statusLabel = computed(() => ({
    approval: "等待审批",
    starting: "正在启动",
    running: "运行中",
    waiting: "等待应答",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
    not_started: "未执行",
})[status.value]);

const statusToneClass = computed(() => {
    if (status.value === "approval" || status.value === "waiting") {
        return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
    }
    if (status.value === "running" || status.value === "starting") {
        return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
    }
    if (status.value === "completed") {
        return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
    if (status.value === "failed" || status.value === "cancelled" || status.value === "interrupted") {
        return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
    }
    return "border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-muted)]";
});

const statusIcon = computed(() => {
    if (status.value === "approval" || status.value === "waiting") return "i-lucide-clock";
    if (status.value === "running" || status.value === "starting") return "i-lucide-loader-circle";
    if (status.value === "completed") return "i-lucide-check-circle";
    if (status.value === "failed") return "i-lucide-circle-x";
    if (status.value === "cancelled") return "i-lucide-ban";
    if (status.value === "interrupted") return "i-lucide-unplug";
    return "i-lucide-circle-slash";
});

const effectiveChart = computed(() => matchingRunState.value?.machineMermaid ?? details.value?.chartMermaid ?? "");
const runningNow = computed(() => matchingRunState.value?.runningNow ?? []);
const pendingAsks = computed<PendingAsk[]>(() => matchingRunState.value?.view.pendingAsks ?? []);
const pendingAskTitles = computed(() => pendingAsks.value.length > 0
    ? pendingAsks.value.map((ask) => ask.spec.title)
    : details.value?.pendingAsks ?? []);
const workflowError = computed(() => resolveWorkflowBubbleError({
    runObserved: matchingRunState.value !== null,
    runError: matchingRunState.value?.view.error,
    detailsError: details.value?.error,
    toolCallError: props.toolCall.error,
}));
const effectiveResult = computed<JsonValue | undefined>(() => {
    const view = matchingRunState.value?.view;
    if (view && Object.prototype.hasOwnProperty.call(view, "result")) {
        return view.result;
    }
    return details.value?.result;
});

/** 终态 API summary 优先；旧 details 回退，participants 再补没有 token 的运行中 session。 */
const displaySummary = computed(() => resolveWorkflowDisplaySummary(matchingRunState.value?.summary, details.value));
const sessionRows = computed<WorkflowSessionDetails[]>(() => {
    const rows = [...displaySummary.value.sessions];
    for (const participant of matchingRunState.value?.participants ?? []) {
        if (rows.some((row) => row.sessionId === participant.sessionId)) {
            continue;
        }
        rows.push({
            sessionId: participant.sessionId,
            profileKey: participant.profileKey,
            title: participant.name,
            tokens: null,
        });
    }
    return rows.sort((left, right) => left.sessionId - right.sessionId);
});
const usage = computed(() => displaySummary.value.usage);
const totalTokens = computed(() => usage.value?.totalTokens ?? 0);
const hasMetadata = computed(() => sessionRows.value.length > 0 || Boolean(usage.value));

const elapsed = (startedAt: number): string => {
    const seconds = Math.max(0, nowTick.value - startedAt) / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
};

/** 后台 job 时间戳显示为本地时钟。 */
const formatJobTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString();

/** Catalog 描述仅在审批时补查；失败不阻断审批或 run。 */
let catalogRequestRevision = 0;
watch([workflowKey, pendingApproval, catalogProjectRoot], async ([key, isPending, projectRoot]) => {
    const revision = ++catalogRequestRevision;
    catalogTitle.value = "";
    catalogDescription.value = "";
    if (!key || !isPending) {
        return;
    }
    try {
        const catalog = await $fetch<WorkflowCatalogResponse>("/api/agent/workflow/catalog", {
            query: projectRoot ? {projectRoot} : undefined,
        });
        if (revision !== catalogRequestRevision) {
            return;
        }
        const item = catalog.workflows.find((workflow) => workflow.key === key);
        catalogTitle.value = item?.title ?? "";
        catalogDescription.value = item?.description ?? "";
    } catch {
        // 描述是审批卡的增强信息，workflowKey 与原始参数仍足以完成决策。
    }
}, {immediate: true});

let runPollCursor = 0;
let runPollTimer: ReturnType<typeof setTimeout> | null = null;
let runPollInFlightRevision = -1;
let runPollRevision = 0;
let disposed = false;

/** 清理当前 run 的轮询计时器。 */
function clearRunPollTimer(): void {
    if (runPollTimer) {
        clearTimeout(runPollTimer);
        runPollTimer = null;
    }
}

/** 安排下一次正式 runs API 轮询。 */
function scheduleRunPoll(delay: number): void {
    const observedStatus = matchingRunState.value?.view.status;
    const canPollRun = shouldPollWorkflowRun({
        hasBackgroundJob: Boolean(jobId.value),
        detailsStatus: details.value?.status,
        runStatus: observedStatus,
        runUnavailable: runUnavailable.value,
    });
    if (disposed || runPollTimer || runPollInFlightRevision === runPollRevision || !runId.value || runUnavailable.value
        || !canPollRun) {
        return;
    }
    const revision = runPollRevision;
    const expectedRunId = runId.value;
    runPollTimer = setTimeout(() => {
        runPollTimer = null;
        void pollRun(revision, expectedRunId);
    }, delay);
}

/** 拉取正式 run 快照；RunView 含递归 JsonValue，因此显式断言响应类型。 */
async function pollRun(revision: number, expectedRunId: string): Promise<void> {
    if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
        return;
    }
    runPollInFlightRevision = revision;
    try {
        const next = await $fetch(`/api/agent/workflow/runs/${expectedRunId}`, {
            query: {after: runPollCursor},
        }) as unknown as WorkflowDemoRunState;
        if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
            return;
        }
        runPollCursor = next.nextCursor;
        runState.value = next;
        nowTick.value = Date.now();
        pollError.value = "";
        runUnavailable.value = false;
    } catch (error) {
        if (disposed || revision !== runPollRevision || expectedRunId !== runId.value) {
            return;
        }
        if (resolveApiErrorStatus(error) === 404) {
            runUnavailable.value = true;
            pollError.value = "该 workflow run 已不可查询，可能因服务重启而中断";
        } else {
            pollError.value = resolveApiErrorMessage(error, "读取 workflow 状态失败");
        }
    } finally {
        if (runPollInFlightRevision === revision) {
            runPollInFlightRevision = -1;
        }
        if (revision === runPollRevision && expectedRunId === runId.value) {
            scheduleRunPoll(workflowPollDelay(matchingRunState.value?.view.status));
        }
    }
}

watch(runId, (nextRunId) => {
    runPollRevision++;
    clearRunPollTimer();
    runPollCursor = 0;
    runState.value = null;
    pollError.value = "";
    runUnavailable.value = false;
    if (nextRunId) {
        scheduleRunPoll(0);
    }
}, {immediate: true});

watch(status, (nextStatus, previousStatus) => {
    if (nextStatus !== previousStatus) {
        if (nextStatus === "running" || nextStatus === "waiting") {
            chartExpanded.value = true;
        } else if (["completed", "failed", "cancelled", "interrupted"].includes(nextStatus)) {
            chartExpanded.value = false;
        }
    }
}, {immediate: true});

onBeforeUnmount(() => {
    disposed = true;
    runPollRevision++;
    clearRunPollTimer();
});
</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Workflow 目标与执行参数摘要 -->
        <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="i-lucide-route h-4 w-4 text-[var(--accent-main)]"></span>
                        <span class="break-all font-mono text-sm font-semibold text-[var(--text-main)]">{{ workflowTitle }}</span>
                        <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ parsedArgs.script ? "Inline" : "Catalog" }}</span>
                        <span v-if="parsedArgs.model" class="rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--status-info)]">{{ parsedArgs.model }}</span>
                        <span v-if="parsedArgs.wait" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">wait:true</span>
                        <span v-else-if="jobId" class="rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-info)]">后台任务</span>
                    </div>
                    <p v-if="catalogDescription" class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{{ catalogDescription }}</p>
                    <div v-if="jobId" class="mt-1 break-all font-mono text-[10px] text-[var(--text-muted)]">job {{ jobId }}</div>
                    <div v-if="runId" class="mt-1 break-all font-mono text-[10px] text-[var(--text-muted)]">run {{ runId }}</div>
                </div>
                <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" :class="statusToneClass">
                    <span :class="[statusIcon, status === 'running' || status === 'starting' ? 'animate-spin' : '']" class="h-3.5 w-3.5"></span>
                    {{ statusLabel }}
                </span>
            </div>

            <details v-if="parsedArgs.args !== undefined" class="mt-3">
                <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">运行参数</summary>
                <div class="mt-2"><JsonViewer :value="parsedArgs.args" :max-height="220" /></div>
            </details>
            <details v-if="parsedArgs.script" class="mt-3">
                <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">内联 workflow 脚本</summary>
                <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--border-color)] bg-[var(--bg-input)] p-2 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">{{ parsedArgs.script }}</pre>
            </details>
        </div>

        <!-- 声明式工具审批由会话宿主统一提交，气泡不复制第二套批准接口。 -->
        <div v-if="pendingApproval" class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs leading-5 text-[var(--status-warning)]">
            <div class="flex items-start gap-2">
                <span class="i-lucide-shield-question mt-0.5 h-4 w-4 shrink-0"></span>
                <span>该 workflow 会创建或调用 Agent session。请使用当前会话输入区的审批按钮批准或拒绝；批准后才会真正执行。</span>
            </div>
        </div>

        <!-- PLAN-E 后台 job 观测：tool success 只表示登记成功，真实生命周期以此快照为准。 -->
        <div v-if="jobId" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-briefcase-business h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                    <span class="break-all font-mono text-xs text-[var(--text-main)]">{{ jobId }}</span>
                    <span v-if="matchingJob" class="text-[11px] text-[var(--text-muted)]">{{ matchingJob.title }}</span>
                </div>
                <button v-if="canCancelJob || cancelRequested" type="button" class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1 text-[11px] text-[var(--status-danger)] disabled:cursor-wait disabled:opacity-50" :disabled="cancelSubmitting || cancelRequested" @click="cancelJob">
                    {{ cancelSubmitting ? "请求中…" : cancelRequested ? "等待停止…" : "取消任务" }}
                </button>
            </div>
            <div v-if="matchingJob?.preview" class="mt-2 whitespace-pre-wrap break-all text-xs leading-5 text-[var(--text-secondary)]">{{ matchingJob.preview }}</div>
            <div v-else-if="!jobUnavailable" class="mt-2 text-xs text-[var(--text-muted)]">正在连接后台任务管理器…</div>
            <div v-if="matchingJob?.error" class="mt-2 whitespace-pre-wrap break-all text-xs leading-5 text-[var(--status-danger)]"><span class="font-medium">后台任务错误：</span>{{ matchingJob.error }}</div>
            <div v-if="matchingJob" class="mt-2 flex flex-wrap gap-3 text-[10px] text-[var(--text-muted)]">
                <span>启动 {{ formatJobTime(matchingJob.createdAt) }}</span>
                <span v-if="matchingJob.endedAt">结束 {{ formatJobTime(matchingJob.endedAt) }}</span>
            </div>
        </div>

        <!-- 运行中的 activity：状态图之外保留一行当前动作。 -->
        <div v-if="runningNow.length" class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-[var(--text-muted)]">正在运行</span>
            <span v-for="activity in runningNow" :key="activity.key" class="workflow-running-chip rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-2.5 py-1 text-xs text-[var(--status-info)]">
                {{ activity.label }} · {{ elapsed(activity.startedAt) }}
            </span>
        </div>

        <!-- wf.chart 主视图：终态默认折叠，且限制高度避免撑爆聊天流。 -->
        <div v-if="effectiveChart" class="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)]">
            <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)]" @click="chartExpanded = !chartExpanded">
                <span class="flex items-center gap-2 text-xs font-medium text-[var(--text-main)]">
                    <span class="i-lucide-git-branch h-3.5 w-3.5 text-[var(--accent-main)]"></span>
                    Workflow 状态图
                </span>
                <span :class="chartExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5 text-[var(--text-muted)]"></span>
            </button>
            <div v-if="chartExpanded" class="border-t border-[var(--border-color)] p-2">
                <WorkflowMermaid :code="effectiveChart" :max-height="360" />
            </div>
        </div>
        <div v-else-if="status === 'running' || status === 'starting'" class="flex items-center gap-2 rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-xs text-[var(--status-info)]">
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            等待 workflow 发布首个 wf.chart 状态节点…
        </div>

        <!-- wf.ask waiting：问题在 Composer 区域统一应答，气泡只保留只读状态摘要。 -->
        <div v-if="status === 'waiting'" class="space-y-2">
            <div v-for="ask in pendingAsks" :key="ask.key" class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
                <div class="text-sm font-semibold text-[var(--status-warning)]">{{ ask.spec.title }}</div>
                <AgentMarkdownContent v-if="ask.spec.description" class="mt-2" :content="ask.spec.description" />
                <div v-if="ask.spec.kind === 'select'" class="mt-2 text-xs text-[var(--text-secondary)]">
                    可选：{{ (ask.spec.options ?? []).map((option) => option.label).join("、") }}
                </div>
                <div v-else class="mt-2 text-xs text-[var(--text-secondary)]">
                    {{ ask.spec.kind === "approve" ? "等待批准或拒绝" : "等待文字回答" }}
                </div>
            </div>
            <div v-if="pendingAsks.length === 0 && pendingAskTitles.length" class="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
                等待应答：{{ pendingAskTitles.join("；") }}。正在读取完整应答项…
            </div>
            <div class="rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-xs text-[var(--status-info)]">
                请在底部 Workflow 待处理区应答。
            </div>
        </div>

        <div v-if="workflowError" class="whitespace-pre-wrap break-all rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-xs text-[var(--status-danger)]">{{ workflowError }}</div>
        <div v-if="jobFeedError" class="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ jobFeedError }}</div>
        <div v-if="pollError" class="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ pollError }}；仍保留最近一次可用的 run 状态。</div>

        <!-- Session 与 usage 默认折叠，避免终态卡片过长。 -->
        <details v-if="hasMetadata" class="rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-2">
            <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">
                执行元数据 · {{ sessionRows.length }} sessions<span v-if="usage"> · {{ totalTokens.toLocaleString() }} tokens</span>
            </summary>
            <div v-if="usage" class="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1">输入 {{ usage.inputTokens.toLocaleString() }}</span>
                <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1">输出 {{ usage.outputTokens.toLocaleString() }}</span>
            </div>
            <div v-if="sessionRows.length" class="mt-2 space-y-1.5">
                <div v-for="session in sessionRows" :key="session.sessionId" class="flex flex-wrap items-center gap-2 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[11px]">
                    <span class="font-mono text-[var(--accent-main)]">#{{ session.sessionId }}</span>
                    <span class="text-[var(--text-main)]">{{ session.title || session.profileKey }}</span>
                    <span v-if="session.title && session.profileKey" class="font-mono text-[var(--text-muted)]">{{ session.profileKey }}</span>
                    <span v-if="session.tokens" class="ml-auto text-[var(--text-muted)]">{{ session.tokens.totalTokens.toLocaleString() }} tokens</span>
                </div>
            </div>
        </details>

        <!-- Workflow 自定义返回值独立折叠。 -->
        <details v-if="effectiveResult !== undefined" class="rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-2">
            <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">Workflow 返回值</summary>
            <div class="mt-2"><JsonViewer :value="effectiveResult" :max-height="260" /></div>
        </details>

        <div v-if="status === 'not_started' && props.toolCall.result" class="whitespace-pre-wrap break-all rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 text-xs text-[var(--text-secondary)]">{{ props.toolCall.result }}</div>
    </div>
</template>

<style scoped>
/* 运行中 activity chip 呼吸脉冲。 */
.workflow-running-chip { animation: workflow-bubble-pulse 1.2s ease-in-out infinite; }
@keyframes workflow-bubble-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
</style>
