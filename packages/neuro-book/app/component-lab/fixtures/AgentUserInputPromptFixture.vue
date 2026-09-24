<script setup lang="ts">
/**
 * AgentUserInputPrompt 的 Component Lab 规范夹具。
 *
 * 遵循规范：
 * 1. 数据驱动：从 props.data 响应式读取题目、选项与控件状态，在 Lab 右栏可就地编辑；
 * 2. 状态同步：使用 useLabDataSink 持续同步草稿输出与运行时状态；
 * 3. 事件上报：使用 useLabEventSink 记录 submit / cancel / resync 交互事件；
 * 4. 调试分离：使用 <LabFixtureControls> 将调试控件挂载到底部抽屉栏；
 * 5. 视口直连：w-full 自适应视口，不套多余外层内边距假外壳。
 */
import {computed, ref, watch} from "vue";
import AgentUserInputPrompt from "../../components/novel-ide/agent/composer/AgentUserInputPrompt.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {AgentPendingUserInputSession} from "../../components/novel-ide/agent/agent-message";
import {
    createAgentPendingResolutionDraft,
    type AgentPendingResolutionDraft,
    type AgentPendingSubmissionIssue,
} from "../../components/novel-ide/agent/agent-pending-resolution";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

type FixtureQuestionItem = {
    header?: string;
    question: string;
    options?: Array<{label: string; description?: string}>;
};

type FixtureSceneData = {
    canResolve?: boolean;
    canAbort?: boolean;
    submitting?: boolean;
    blockedMessage?: string;
    submissionIssue?: AgentPendingSubmissionIssue | null;
    questions?: FixtureQuestionItem[];
};

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const overrideSubmitting = ref<boolean | null>(null);
const overrideCanResolve = ref<boolean | null>(null);
const overrideBlocked = ref(false);
const overrideIssue = ref<AgentPendingSubmissionIssue | null>(null);

const parsedData = computed<FixtureSceneData>(() => {
    if (props.data && typeof props.data === "object") {
        return props.data as FixtureSceneData;
    }
    return {};
});

const defaultQuestions = computed<FixtureQuestionItem[]>(() => {
    switch (props.scene) {
        case "open-ended":
            return [
                {
                    header: "核心立意构思",
                    question: "请简述这一章你想表达的核心主题与关键情节转折：",
                    options: [],
                },
            ];
        case "multi-question":
            return [
                {
                    header: "步骤 1 · 暗线处置",
                    question: "你希望反派在何时被主角揭穿？",
                    options: [
                        {label: "本章结尾直接揭穿", description: "迅速释放矛盾高潮"},
                        {label: "下一卷再揭晓", description: "蓄积更长线的情感反差"},
                        {label: "始终不揭穿，留作暗线", description: "作为长期悬念伏笔"},
                    ],
                },
                {
                    header: "步骤 2 · 心境倾向",
                    question: "主角此时的心理状态偏向哪种？",
                    options: [
                        {label: "愤怒与复仇", description: "行动果决暴烈"},
                        {label: "困惑与失望", description: "内心动摇与挣扎"},
                        {label: "平静与释怀", description: "超脱并掌控全局"},
                    ],
                },
            ];
        case "blocked":
            return [
                {
                    header: "权限阻断演示",
                    question: "接下来这一幕你希望以谁的视角展开叙述？",
                    options: [
                        {label: "主角（第一人称感知）", description: "主观视角"},
                        {label: "观察者（第三人称全知）", description: "全景视角"},
                    ],
                },
            ];
        case "single-choice":
        default:
            return [
                {
                    header: "叙事视点选择",
                    question: "接下来这一幕你希望以谁的视角展开叙述？",
                    options: [
                        {label: "主角（第一人称感知）", description: "强化主观沉浸感与情绪张力"},
                        {label: "观察者（第三人称全知）", description: "宏观把控全局线索与多方动态"},
                        {label: "对手（限知视角）", description: "制造信息差与悬念心理压迫"},
                    ],
                },
            ];
    }
});

const activeQuestions = computed<FixtureQuestionItem[]>(() => {
    const custom = parsedData.value.questions;
    return Array.isArray(custom) && custom.length > 0 ? custom : defaultQuestions.value;
});

const sessions = computed<AgentPendingUserInputSession[]>(() => [
    {
        assistantMessageId: `msg-${props.scene}`,
        status: "pending",
        questions: activeQuestions.value.map((q, idx) => ({
            toolNodeId: `node-${props.scene}-${idx}`,
            toolCallId: `call-${props.scene}-${idx}`,
            toolName: "request_user_input",
            questionIndex: idx,
            kind: "question",
            header: q.header,
            question: q.question,
            options: (q.options ?? []).map((opt) => ({
                label: opt.label,
                description: opt.description,
            })),
        })),
    },
]);

const draft = ref<AgentPendingResolutionDraft>(createAgentPendingResolutionDraft(sessions.value));

// 当题目或场景发生本质结构变化时重建草稿
watch(
    () => sessions.value.map((s) => s.questions.map((q) => q.question).join("\n")).join("---"),
    () => {
        draft.value = createAgentPendingResolutionDraft(sessions.value);
    },
);

const submitting = computed(() => {
    if (overrideSubmitting.value !== null) return overrideSubmitting.value;
    if (typeof parsedData.value.submitting === "boolean") return parsedData.value.submitting;
    return props.scene === "submitting";
});

const canResolve = computed(() => {
    if (overrideBlocked.value) return false;
    if (overrideCanResolve.value !== null) return overrideCanResolve.value;
    if (typeof parsedData.value.canResolve === "boolean") return parsedData.value.canResolve;
    return props.scene !== "blocked";
});

const canAbort = computed(() => {
    if (typeof parsedData.value.canAbort === "boolean") return parsedData.value.canAbort;
    return true;
});

const blockedMessage = computed(() => {
    if (overrideBlocked.value) return "已手动模拟阻断：等待前序工作流完成。";
    if (parsedData.value.blockedMessage) return parsedData.value.blockedMessage;
    return props.scene === "blocked" ? "当前正在执行正文生成，请等待当前生成结束或中止后再回答。" : "";
});

const submissionIssue = computed(() => {
    if (overrideIssue.value) return overrideIssue.value;
    return parsedData.value.submissionIssue ?? null;
});

function syncDataToLab(): void {
    try {
        const payload = {
            scene: props.scene,
            questionsCount: activeQuestions.value.length,
            answers: draft.value.answers,
            submitting: submitting.value,
            canResolve: canResolve.value,
            canAbort: canAbort.value,
            blockedMessage: blockedMessage.value,
            submissionIssue: submissionIssue.value,
        };
        syncLabData(JSON.parse(JSON.stringify(payload)));
    } catch {
        // 防御性静默，防止任何复杂原型中断组件渲染
    }
}

// 持续将当前输入与输出状态同步到 Lab
watch(
    [sessions, draft, submitting, canResolve, canAbort, blockedMessage, submissionIssue],
    () => {
        syncDataToLab();
    },
    {immediate: true, deep: true},
);

const resolveMenu = (_context: AgentTriggerMenuContext): AgentTriggerMenuState => ({
    title: "快捷指令",
    prefix: "/",
    sections: [],
});

function handleSubmit(): void {
    emitLabEvent("submit", {draft: draft.value});
}

function handleCancel(): void {
    emitLabEvent("cancel");
}

function handleResync(): void {
    emitLabEvent("resync");
}

function resetDraft(): void {
    draft.value = createAgentPendingResolutionDraft(sessions.value);
    overrideSubmitting.value = null;
    overrideBlocked.value = false;
    overrideIssue.value = null;
    syncDataToLab();
}
</script>

<template>
    <div class="w-full">
        <AgentUserInputPrompt
            data-lab-subject
            class="w-full"
            :sessions="sessions"
            v-model:draft="draft"
            :can-resolve="canResolve"
            :can-abort="canAbort"
            :submitting="submitting"
            :blocked-message="blockedMessage"
            :submission-issue="submissionIssue"
            menu-refresh-key="fixture"
            :resolve-menu="resolveMenu"
            @submit="handleSubmit"
            @cancel="handleCancel"
            @resync="handleResync"
        />
    </div>

    <!-- 交互调试控制条：下放至 Lab 底部抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">用户输入向导 · 交互调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { overrideBlocked = !overrideBlocked; }"
                >
                    {{ overrideBlocked || !canResolve ? "解除阻断" : "模拟阻断" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { overrideSubmitting = !submitting; }"
                >
                    {{ submitting ? "取消提交中" : "切为提交中" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => {
                        overrideIssue = overrideIssue ? null : {kind: 'unknown', message: '提交结果暂时无法确认，需手动同步。'};
                    }"
                >
                    {{ overrideIssue ? "清除异常" : "模拟同步异常" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="resetDraft"
                >
                    重置草稿
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
