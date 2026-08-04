<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import WorkflowSessionTree from "nbook/app/components/workflow-preview/WorkflowSessionTree.vue";
import WorkflowRunVisuals from "nbook/app/components/workflow-preview/WorkflowRunVisuals.vue";
import {useAgentJob} from "nbook/app/composables/useAgentJob";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {shouldPollWorkflowRun} from "nbook/app/components/novel-ide/agent/workflow-bubble";
import type {WorkflowDemoRunState} from "nbook/server/agent/workflow/workflow-demo-service";
import type {JsonValue, WorkflowEvent} from "nbook/server/vendor/nb-workflow/index";
import type {AgentJobEventCursor} from "nbook/shared/dto/agent-job.dto";

/**
 * 单个 run 的实时面板：轮询服务端观测 VM（人话标签 / phase 进度 / session 序列图），
 * 前端只负责组装展示——「用户 ↔ 前端 ↔ workflow」中的前端包装层。
 */
const props = withDefaults(defineProps<{
    runId: string;
    /** demo 的场景 key；正式 Catalog run 可不传。 */
    scenarioKey?: string;
    /** 正式入口与 Task 110 demo 共用展示件，但 API 命名空间和动作能力不同。 */
    mode?: "demo" | "formal";
    /** 正式后台 run 的 AgentJobManager 身份；demo 无 job。 */
    jobId?: string;
    /** 新启动使用创建游标；列表恢复使用该原子快照的事件游标。 */
    jobEventCursor?: AgentJobEventCursor | null;
}>(), {
    scenarioKey: "",
    mode: "demo",
    jobId: "",
    jobEventCursor: null,
});
const runApiBase = computed(() => props.mode === "formal" ? "/api/agent/workflow" : "/api/agent/workflow-demo");
const jobIdRef = computed(() => props.jobId || null);
const jobEventCursorRef = computed(() => props.jobEventCursor);
const {
    job,
    error: jobError,
    unavailable: jobUnavailable,
    cancelling: jobCancelling,
    cancelRequested: jobCancelRequested,
    canCancel: canCancelJob,
    cancel: cancelJob,
} = useAgentJob(jobIdRef, jobEventCursorRef);

/** ask 应答草稿值：只会是文本 / 多选 id 列表 / approve 布尔（递归 JsonValue 进 ref 的 UnwrapRef 会类型爆栈） */
type AskDraftValue = string | string[] | boolean;

// state 用 shallowRef：整对象每次轮询替换；同时规避 RunView 递归类型的深展开
const state = shallowRef<WorkflowDemoRunState | null>(null);
const error = ref("");
const logs = ref<{text: string; cls: string}[]>([]);
const expandedSessions = ref<number[]>([]);
const styleModeInput = ref("工笔细描");
/** ask 应答草稿：key → 值 */
const askDrafts = ref<Record<string, AskDraftValue>>({});
/** 可视化区默认视图：正式 run 以状态图为主；demo 以对话流为主（machine tab 有图时才显示）。 */
const defaultVisualView = computed<"machine" | "flow">(() => props.mode === "formal" ? "machine" : "flow");
/** 轮询打点的"现在"（算运行中 activity 已耗时用；不能在模板里直接 Date.now()——不响应） */
const nowTick = ref(Date.now());
/** 正在被调用的 session id 集合（参与者 chip 脉冲高亮） */
const busySessionIds = computed(() => new Set((state.value?.runningNow ?? []).map((r) => r.sessionId).filter((id) => id !== undefined)));
const elapsed = (startedAt: number) => `${Math.max(0, (nowTick.value - startedAt) / 1000).toFixed(1)}s`;

let cursor = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;
let runUnavailable = false;
let pollRevision = 0;

const STATUS_CN: Record<string, string> = {running: "运行中", waiting: "等待你的应答", completed: "已完成", failed: "失败", cancelled: "已取消"};
const JOB_STATUS_CN: Record<string, string> = {running: "后台运行中", waiting: "后台等待应答", completed: "后台任务完成", failed: "后台任务失败", cancelled: "后台任务已取消", interrupted: "后台任务已中断"};
const statusText = computed(() => STATUS_CN[state.value?.view.status ?? ""] ?? "…");
const jobStatusText = computed(() => jobUnavailable.value ? "后台任务已清除或不可查询" : JOB_STATUS_CN[job.value?.status ?? ""] ?? "正在连接后台任务");
const progressText = computed(() => {
    const progress = state.value?.view.progress;
    if (!progress?.total) return "";
    return `${progress.done ?? 0}/${progress.total}`;
});

/** 事件 → 人话日志行（标签查同一响应里的 labels 表） */
function pushLog(event: WorkflowEvent, labels: Record<string, string>) {
    if (event.type === "log") logs.value.unshift({text: `📋 ${event.message}`, cls: "log"});
    else if (event.type === "activity_started") logs.value.unshift({text: `▶ ${labels[event.key] ?? event.kind}`, cls: "act"});
    else if (event.type === "activity") logs.value.unshift({text: event.cached ? `⚡ 命中缓存 · ${labels[event.record.key] ?? event.record.kind}` : `✔ ${labels[event.record.key] ?? event.record.kind}`, cls: event.cached ? "hit" : "done"});
    else if (event.type === "ask_pending") logs.value.unshift({text: `🙋 等待用户：${event.ask.spec.title}`, cls: "ask"});
    else if (event.type === "status") logs.value.unshift({text: `◆ ${STATUS_CN[event.status] ?? event.status}`, cls: "log"});
    if (logs.value.length > 200) logs.value.length = 200;
}

async function poll(expectedRevision: number, expectedRunId: string, expectedApiBase: string) {
    if (disposed || runUnavailable || expectedRevision !== pollRevision || expectedRunId !== props.runId || expectedApiBase !== runApiBase.value) return;
    try {
        // 不走 $fetch 泛型：RunView 含递归 JsonValue，Nuxt Serialize 类型展开会 TS2589 爆栈，改为显式断言
        const next = await $fetch(`${expectedApiBase}/runs/${expectedRunId}`, {query: {after: cursor}}) as unknown as WorkflowDemoRunState;
        if (disposed || expectedRevision !== pollRevision || expectedRunId !== props.runId || expectedApiBase !== runApiBase.value) return;
        cursor = next.nextCursor;
        for (const event of next.events) pushLog(event, next.labels);
        state.value = next;
        nowTick.value = Date.now();
        error.value = "";
    } catch (e) {
        if (disposed || expectedRevision !== pollRevision || expectedRunId !== props.runId || expectedApiBase !== runApiBase.value) return;
        if (resolveApiErrorStatus(e) === 404) {
            runUnavailable = true;
            error.value = "该 workflow run 已不可查询，可能因服务重启而中断";
        } else {
            error.value = resolveApiErrorMessage(e, "轮询 run 状态失败");
        }
    }
    const status = state.value?.view.status;
    const canPollRun = shouldPollWorkflowRun({
        hasBackgroundJob: Boolean(props.jobId),
        runStatus: status,
        runUnavailable,
    });
    // running 快轮询；waiting 慢轮询（等人）；终态停（rerun 后由动作重启）
    if (!canPollRun) timer = null;
    else if (status === "running" || !status) timer = setTimeout(() => void poll(expectedRevision, expectedRunId, expectedApiBase), 500);
    else if (status === "waiting") timer = setTimeout(() => void poll(expectedRevision, expectedRunId, expectedApiBase), 2500);
    else timer = null;
}

function restartPolling() {
    pollRevision++;
    if (timer) clearTimeout(timer);
    runUnavailable = false;
    const expectedRevision = pollRevision;
    const expectedRunId = props.runId;
    const expectedApiBase = runApiBase.value;
    timer = setTimeout(() => void poll(expectedRevision, expectedRunId, expectedApiBase), 200);
}

async function submitAsks() {
    const view = state.value?.view;
    if (!view) return;
    const answers: Record<string, JsonValue> = {};
    for (const ask of view.pendingAsks) {
        const draft = askDrafts.value[ask.key];
        const missing = draft === undefined
            || (typeof draft === "string" && !draft.trim())
            || (Array.isArray(draft) && draft.length === 0);
        if (missing) {
            error.value = `请先完成应答：${ask.spec.title}`;
            return;
        }
        answers[ask.key] = draft;
    }
    const expectedRevision = pollRevision;
    const expectedRunId = props.runId;
    const expectedApiBase = runApiBase.value;
    try {
        await $fetch(`${expectedApiBase}/runs/${expectedRunId}/resume`, {method: "POST", body: {answers}});
        if (disposed || expectedRevision !== pollRevision || expectedRunId !== props.runId || expectedApiBase !== runApiBase.value) return;
        askDrafts.value = {};
        restartPolling();
    } catch (e) {
        if (disposed || expectedRevision !== pollRevision || expectedRunId !== props.runId || expectedApiBase !== runApiBase.value) return;
        error.value = resolveApiErrorMessage(e, "resume 失败");
    }
}

function toggleSelect(askKey: string, optionId: string, multi: boolean | undefined) {
    if (!multi) {
        askDrafts.value[askKey] = optionId;
        return;
    }
    const current = Array.isArray(askDrafts.value[askKey]) ? [...askDrafts.value[askKey] as string[]] : [];
    const index = current.indexOf(optionId);
    if (index >= 0) current.splice(index, 1);
    else current.push(optionId);
    askDrafts.value[askKey] = current;
}

function isSelected(askKey: string, optionId: string): boolean {
    const draft = askDrafts.value[askKey];
    return Array.isArray(draft) ? (draft as string[]).includes(optionId) : draft === optionId;
}

async function rerun(withStyleMode: boolean) {
    if (props.mode !== "demo") {
        return;
    }
    try {
        await $fetch(`${runApiBase.value}/runs/${props.runId}/rerun`, {
            method: "POST",
            body: withStyleMode ? {styleMode: styleModeInput.value} : {},
        });
        restartPolling();
    } catch (e) {
        error.value = resolveApiErrorMessage(e, "rerun 失败");
    }
}

function toggleSession(sessionId: number) {
    const index = expandedSessions.value.indexOf(sessionId);
    if (index >= 0) expandedSessions.value.splice(index, 1);
    else expandedSessions.value.push(sessionId);
}

watch([() => props.runId, runApiBase], () => {
    pollRevision++;
    if (timer) clearTimeout(timer);
    timer = null;
    cursor = 0;
    logs.value = [];
    state.value = null;
    askDrafts.value = {};
    expandedSessions.value = [];
    runUnavailable = false;
    const expectedRevision = pollRevision;
    const expectedRunId = props.runId;
    const expectedApiBase = runApiBase.value;
    timer = setTimeout(() => void poll(expectedRevision, expectedRunId, expectedApiBase), 0);
}, {immediate: true});

onBeforeUnmount(() => {
    disposed = true;
    pollRevision++;
    if (timer) clearTimeout(timer);
});
</script>

<template>
    <!-- run 实时面板 -->
    <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
        <!-- 状态行 -->
        <div class="mb-3 flex flex-wrap items-center gap-3">
            <span class="text-sm font-semibold text-[var(--text-main)]">{{ runId }}</span>
            <span class="rounded-full border px-3 py-0.5 text-xs"
                :class="{
                    'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]': state?.view.status === 'running',
                    'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]': state?.view.status === 'waiting',
                    'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]': state?.view.status === 'completed',
                    'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]': state?.view.status === 'failed' || state?.view.status === 'cancelled',
                }">{{ statusText }}</span>
            <span v-if="props.jobId" class="rounded-full border px-3 py-0.5 text-xs"
                :class="{
                    'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]': !job && !jobUnavailable || job?.status === 'running',
                    'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]': job?.status === 'waiting',
                    'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]': job?.status === 'completed',
                    'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]': jobUnavailable || job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'interrupted',
                }">{{ jobStatusText }}</span>
            <button v-if="props.jobId && (canCancelJob || jobCancelRequested)" type="button" class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1 text-[11px] text-[var(--status-danger)] disabled:cursor-wait disabled:opacity-50" :disabled="jobCancelling || jobCancelRequested" @click="cancelJob">
                {{ jobCancelling ? "请求中…" : jobCancelRequested ? "等待停止…" : "取消任务" }}
            </button>
            <span v-if="error" class="text-xs text-[var(--status-danger)]">{{ error }}</span>
        </div>

        <!-- 正式后台 job 的有界预览与观测错误。 -->
        <div v-if="props.jobId && (job?.preview || jobError)" class="mb-3 rounded border px-3 py-2 text-xs"
            :class="jobError
                ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'
                : 'border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-secondary)]'">
            {{ jobError || job?.preview }}
        </div>

        <!-- phase 步进条与视图 tab 已抽入 WorkflowRunVisuals（Task 137，气泡共用）。 -->

        <!-- 正在运行的 activity：脉冲高亮 + 已耗时 -->
        <div v-if="state?.runningNow.length" class="mb-3 flex flex-wrap items-center gap-2">
            <span class="text-xs text-[var(--text-muted)]">⏳ 正在运行</span>
            <span v-for="r in state.runningNow" :key="r.key"
                class="wf-running-chip rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-0.5 text-xs text-[var(--status-info)]">
                {{ r.label }} · {{ elapsed(r.startedAt) }}
            </span>
        </div>

        <!-- run 失败信息 -->
        <div v-if="state?.view.error" class="mb-3 rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ state.view.error }}</div>

        <!-- ask 应答卡片：用户参与点 -->
        <div v-for="ask in state?.view.pendingAsks ?? []" :key="ask.key" class="mb-3 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
            <div class="mb-2 text-sm font-semibold text-[var(--status-warning)]">🙋 轮到你了：{{ ask.spec.title }}</div>
            <div v-if="ask.spec.kind === 'select'" class="flex flex-wrap gap-2">
                <button v-for="option in ask.spec.options ?? []" :key="option.id"
                    class="rounded-full border px-3 py-1 text-xs transition-colors"
                    :class="isSelected(ask.key, option.id)
                        ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)]'"
                    @click="toggleSelect(ask.key, option.id, ask.spec.multi)">{{ option.label }}</button>
            </div>
            <input v-else-if="ask.spec.kind === 'text'" class="w-full rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1 text-sm text-[var(--text-main)]"
                placeholder="输入应答…" @input="askDrafts[ask.key] = ($event.target as HTMLInputElement).value">
            <div v-else class="flex gap-2">
                <button class="rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1 text-xs text-[var(--status-success)]" @click="askDrafts[ask.key] = true">同意</button>
                <button class="rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-1 text-xs text-[var(--status-danger)]" @click="askDrafts[ask.key] = false">否决</button>
                <span class="text-xs text-[var(--text-muted)]">当前：{{ askDrafts[ask.key] === undefined ? "未选" : askDrafts[ask.key] ? "同意" : "否决" }}</span>
            </div>
            <button class="mt-2 rounded border border-[var(--accent-main)] bg-[var(--accent-bg)] px-4 py-1 text-xs text-[var(--accent-text)]" @click="submitAsks">应答并继续</button>
        </div>

        <!-- 主体：可切换的可视化视图（共享组件）+ 人话事件流 -->
        <div class="flex flex-wrap gap-4">
            <div class="min-w-0 flex-1 basis-[460px]">
                <!-- key=runId：切换 run 时重挂载，tab 回到默认视图（对齐旧版 runId watcher 的重置行为）。 -->
                <WorkflowRunVisuals
                    :key="props.runId"
                    :phases="state?.phases ?? []"
                    :progress-text="progressText"
                    :machine-mermaid="state?.machineMermaid ?? null"
                    :flow-mermaid="state?.flowMermaid ?? ''"
                    :trace-mermaid="state?.traceMermaid ?? ''"
                    :relation-mermaid="state?.relationMermaid ?? ''"
                    :timeline="state?.timeline ?? []"
                    :live="state?.live ?? []"
                    :default-view="defaultVisualView"
                    :always-show-machine-tab="props.mode === 'formal'"
                />
            </div>
            <div class="min-w-0 flex-1 basis-[320px]">
                <div class="mb-1 text-xs text-[var(--text-muted)]">正在发生什么（{{ logs.length }}）</div>
                <ul class="max-h-[360px] overflow-y-auto rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 text-xs">
                    <li v-for="(line, i) in logs" :key="logs.length - i" class="border-b border-dashed border-[var(--border-color)] py-0.5 last:border-0"
                        :class="{
                            'text-[var(--text-secondary)]': line.cls === 'log',
                            'text-[var(--text-muted)]': line.cls === 'act',
                            'text-[var(--text-main)]': line.cls === 'done',
                            'text-[var(--status-success)]': line.cls === 'hit',
                            'text-[var(--status-warning)]': line.cls === 'ask',
                        }">{{ line.text }}</li>
                </ul>
            </div>
        </div>

        <!-- 完成后的动作区 -->
        <div v-if="props.mode === 'demo' && state && (state.view.status === 'completed' || state.view.status === 'failed')" class="mt-3 flex flex-wrap items-center gap-2">
            <button class="rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="rerun(false)">↺ 重放恢复（应全部命中缓存）</button>
            <template v-if="scenarioKey === 'split-book' && state.view.status === 'completed'">
                <input v-model="styleModeInput" class="w-32 rounded border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1 text-xs text-[var(--text-main)]">
                <button class="rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1 text-xs text-[var(--status-warning)]" @click="rerun(true)">改文风参数并重跑（看局部失效）</button>
            </template>
        </div>

        <!-- 结果 -->
        <details v-if="state?.view.result !== undefined" class="mt-3">
            <summary class="cursor-pointer text-xs text-[var(--text-secondary)]">run 结果 JSON</summary>
            <pre class="mt-1 max-h-64 overflow-auto rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 text-[11px] text-[var(--text-secondary)]">{{ JSON.stringify(state.view.result, null, 2) }}</pre>
        </details>

        <!-- 参与者 session（真实 JSONL） -->
        <div v-if="state?.participants.length" class="mt-3">
            <div class="mb-1 text-xs text-[var(--text-muted)]">参与者（每个都是真实 JSONL session，点开看树：蓝=workflow 写入，黄=用户直聊，绿=真实 harness）</div>
            <div class="mb-2 flex flex-wrap gap-2">
                <button v-for="p in state.participants" :key="p.sessionId"
                    class="rounded-full border px-3 py-1 text-xs"
                    :class="[
                        expandedSessions.includes(p.sessionId)
                            ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-secondary)]',
                        busySessionIds.has(p.sessionId) ? 'wf-busy-chip' : '',
                    ]"
                    @click="toggleSession(p.sessionId)">{{ busySessionIds.has(p.sessionId) ? "💭 " : "" }}{{ p.name }}<span v-if="p.tag" class="opacity-70">·{{ p.tag }}</span></button>
            </div>
            <div class="flex flex-col gap-3">
                <WorkflowSessionTree v-for="sessionId in expandedSessions" :key="sessionId" :session-id="sessionId" />
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 运行中 activity chip / 忙碌参与者 chip 呼吸脉冲 */
.wf-running-chip { animation: wf-pulse 1.2s ease-in-out infinite; }
.wf-busy-chip { border-color: var(--status-warning-border) !important; animation: wf-pulse 1.2s ease-in-out infinite; }
@keyframes wf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
