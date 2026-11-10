<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {attemptNeedsAttention, HERDR_STATUS_LABEL, relativeTime, shortSession, taskLabel, workLabel} from "../host/format.js";
import type {NotifyAttempt, NotifyCandidate, NotifyJob} from "../host/types.js";

/** 通知任务与尝试的状态行（t11）；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    jobs: NotifyJob[];
    attempts: NotifyAttempt[];
    showTask?: boolean;
    pending?: boolean;
    dismissed?: string[];
    emptyText?: string | null;
}>(), {showTask: false, pending: false, dismissed: () => [], emptyText: null});
const emit = defineEmits<{
    send: [job: NotifyJob, target: {paneId: string; sessionKey: string}];
    skip: [job: NotifyJob];
    replaced: [job: NotifyJob];
    dismiss: [attemptId: string];
}>();

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
const TONE_CLASS: Record<Tone, string> = {neutral: "nbdev-empty", accent: "nbdev-accent", success: "nbdev-ok", warning: "nbdev-warn", danger: "nbdev-danger"};
const TONE_ICON: Record<Tone, string> = {neutral: "i-lucide-circle-dot", accent: "i-lucide-clock", success: "i-lucide-check", warning: "i-lucide-triangle-alert", danger: "i-lucide-octagon-alert"};

const who = (paneId: string | null, sessionKey: string, agent: string | null = null) => `${paneId ? `${paneId}（${shortSession(sessionKey)}）` : shortSession(sessionKey)}${agent && !sessionKey.startsWith(`${agent}:`) ? ` ${agent}` : ""}`;
const prefix = (entry: {workId: string; taskId: string}) => (props.showTask ? `${workLabel(entry.workId)}/${taskLabel(entry.taskId)} ` : "");

function jobLine(job: NotifyJob): {tone: Tone; text: string} {
    const asker = who(job.paneId, job.sessionKey, job.agent);
    const count = `${job.questions > 0 ? job.questions : job.legacy.length} 题`;
    switch (job.state) {
    case "audit_unavailable": return {tone: "warning", text: `${count}答复没有通知 ${shortSession(job.sessionKey)}：审计不可用（没初始化就运行 bun run --cwd packages/dev-panel audit-init）`};
    case "legacy": return {tone: "neutral", text: `旧答复（早于启用通知）没有自动通知 ${shortSession(job.sessionKey)}，可以手动发`};
    case "waiting_herdr": return {tone: "warning", text: `已排队：herdr 不可用，等它回来再通知 ${shortSession(job.sessionKey)}`};
    case "no_target": return {tone: "warning", text: `答复已保存，没有可通知的会话（提问的 ${shortSession(job.sessionKey)} 不在 herdr 里）`};
    case "replaced": return {tone: "warning", text: `会话已更换：${job.askerPaneId ?? "原来的窗格"} 上现在是 ${shortSession(job.replacedBy!.sessionKey)}，不是提问的 ${shortSession(job.sessionKey)}`};
    case "not_in_repository": return {tone: "warning", text: `${asker} 已不在本仓库的目录里，不自动通知`};
    case "manual_only": return {tone: "neutral", text: `这个 herdr 版本不自动投递；可以手动通知 ${asker}`};
    case "waiting_idle": return {tone: "accent", text: `已排队：${asker} 这一轮结束后通知`};
    case "waiting_blocked": return {tone: "warning", text: `已排队：${asker} 在等确认，排着`};
    case "unknown_status": return {tone: "warning", text: `已排队：${asker} 的状态未知，空闲之后自动判定`};
    case "waiting_input": return {tone: "warning", text: `已排队：等 ${asker} 的输入框清空（${job.waitReason ?? "认不出输入框"}）`};
    case "waiting_takeover": return {tone: "accent", text: `已排队：你正在面板里接管 ${asker} 的键盘，释放之后再通知`};
    case "ready": return {tone: "accent", text: `${asker} 空闲，几秒内通知`};
    }
}

/** 这一行可以手动发给谁：提问者本人（不自动投的几种）、持有租约的会话。会话已更换的走小窗。 */
function targets(job: NotifyJob): NotifyCandidate[] {
    // 状态未知不给按钮：手动发送同样要求空闲，按了一定是 409（t11 实现审查第 8 条）。
    const asker: NotifyCandidate[] = job.paneId && ["legacy", "manual_only", "waiting_input"].includes(job.state)
        ? [{sessionKey: job.sessionKey, paneId: job.paneId, agent: job.agent, status: "", asker: true}]
        : [];
    const others = ["no_target", "legacy", "not_in_repository"].includes(job.state) ? job.alternatives : [];
    return [...asker, ...others];
}

const canSkip = (job: NotifyJob) => !["waiting_idle", "waiting_blocked", "ready", "audit_unavailable", "waiting_herdr"].includes(job.state);

function attemptLine(attempt: NotifyAttempt): {tone: Tone; text: string; attention: boolean} {
    const line = attemptText(attempt);
    return {...line, attention: attemptNeedsAttention(attempt)};
}

function attemptText(attempt: NotifyAttempt): {tone: Tone; text: string} {
    const target = who(attempt.paneId, attempt.sessionKey);
    const via = attempt.askerKey !== attempt.sessionKey ? `（替 ${shortSession(attempt.askerKey)}）` : "";
    const when = relativeTime(attempt.at);
    if (attempt.intentOnly) return {tone: "warning", text: `面板在投递途中退出，不知道 ${target} 收到没有，请看终端 · ${when}`};
    switch (attempt.result) {
    // 没核对确认界面：与会话页发送后的提示一样用 warning。
    case "delivered": return attempt.code === "unwatched"
        ? {tone: "warning", text: `已通知 ${target}${via}，但面板这时没订阅到它的状态事件，没核对回车前后有没有弹出过确认界面 · ${when}`}
        : {tone: "success", text: `已通知 ${target}${via} · ${when}`};
    case "delivered_into_blocked":
        if (attempt.code === "state_jumped") return {tone: "neutral", text: `已通知 ${target}${via}；当时的旧判据说状态序号跳了不止一格，可能是误报，看一眼终端 · ${when}`};
        return {tone: "danger", text: attempt.code === "passed_blocked" ? `投递后 ${target} 经过了确认界面，回车可能确认了它，请马上看终端 · ${when}` : `投递时 ${target} 弹出了确认界面，回车可能确认了它，请马上看终端 · ${when}`};
    case "delivered_maybe_wrong_session": return {tone: "warning", text: `投递的瞬间 ${attempt.paneId ?? ""} 上换了会话，消息可能进了别的会话，请看终端 · ${when}`};
    case "uncertain": return {tone: "warning", text: `已写入 ${target}，但没看到它开始工作；请看终端，不要重发 · ${when}`};
    case "skipped": return {tone: "neutral", text: `选了不通知 ${shortSession(attempt.askerKey)} · ${when}`};
    default: return {tone: "neutral", text: `没发出去（${attempt.code ?? attempt.result}），还在排队 · ${when}`};
    }
}

const rows = computed(() => props.jobs.map((job) => ({job, ...jobLine(job), targets: targets(job), skip: canSkip(job)})));
const attemptRows = computed(() => props.attempts.map((attempt) => {
    const line = attemptLine(attempt);
    const dismissed = props.dismissed.includes(attempt.attemptId);
    return {attempt, ...line, tone: line.attention && dismissed ? "neutral" as Tone : line.tone, attention: line.attention && !dismissed};
}));
</script>

<template>
    <p class="nbdev-empty nbdev-small" v-if="rows.length === 0 && attemptRows.length === 0 && emptyText">{{ emptyText }}</p>
    <ul v-else-if="rows.length > 0 || attemptRows.length > 0" class="flex flex-col gap-2 nbdev-small">
        <li v-for="row in rows" :key="`${row.job.workId}/${row.job.taskId}/${row.job.sessionKey}`" class="flex flex-col gap-1.5">
            <div class="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <span class="flex min-w-0 flex-1 basis-60 items-start gap-1.5">
                    <span :class="[TONE_ICON[row.tone], TONE_CLASS[row.tone]]" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 break-words">{{ prefix(row.job) }}{{ row.text }}</span>
                </span>
                <span class="flex flex-wrap gap-1.5">
                    <Button v-if="row.job.state === 'replaced'" size="sm" variant="secondary" :disabled="pending" @click="emit('replaced', row.job)">处理</Button>
                    <Button v-for="target in row.targets" :key="target.paneId" size="sm" variant="secondary" :disabled="pending" @click="emit('send', row.job, {paneId: target.paneId, sessionKey: target.sessionKey})">
                        通知 {{ target.paneId }}<template v-if="!target.asker">（{{ shortSession(target.sessionKey) }}，{{ HERDR_STATUS_LABEL[target.status] ?? target.status }}）</template>
                    </Button>
                    <Button v-if="row.skip && row.job.state !== 'replaced'" size="sm" variant="ghost" :disabled="pending" @click="emit('skip', row.job)">不通知</Button>
                </span>
            </div>
            <p v-if="row.job.state === 'no_target' && row.targets.length === 0" class="pl-5 nbdev-empty">会话下次读答复时会看到</p>
            <pre v-if="row.job.state === 'waiting_input' && row.job.screen" class="ml-5 max-h-48 overflow-auto rounded-[var(--radius-control)] p-2 nbdev-pre">{{ row.job.screen }}</pre>
        </li>
        <li v-for="row in attemptRows" :key="row.attempt.attemptId" class="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <span class="flex min-w-0 flex-1 basis-60 items-start gap-1.5">
                <span :class="[TONE_ICON[row.tone], TONE_CLASS[row.tone]]" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 break-words" :class="{'font-medium': row.attention}">{{ prefix(row.attempt) }}{{ row.text }}</span>
            </span>
            <Button v-if="row.attention" size="sm" variant="ghost" @click="emit('dismiss', row.attempt.attemptId)">知道了</Button>
        </li>
    </ul>
</template>
