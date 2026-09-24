<script setup lang="ts">
/**
 * AgentRequestUserInputCard 的 Component Lab 规范夹具。
 *
 * 遵循规范：
 * 1. 舞台直连：卡片类组件直接声明 class="w-full"，由 ViewportCanvas 充当视口盒子，绝不嵌套外层多余内边距；
 * 2. 数据驱动：从 props.data 响应式读取题目、选项与作答留痕，支持在 Lab 右栏 JSON 编辑器就地热改；
 * 3. 纯只读卡片：组件本身作为历史留痕卡片，绝不绑定点击选择事件；
 * 4. 上下文注入：通过 provide(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY) 注入拟真 pending 状态；
 * 5. 控件下放：通过 <LabFixtureControls> 在底部抽屉提供调试按钮；
 * 6. 契约同步：使用 useLabDataSink 与 useLabEventSink 记录并同步状态。
 */
import {computed, provide, ref, watch} from "vue";
import AgentRequestUserInputCard from "../../components/novel-ide/agent/bubbles/interactive/AgentRequestUserInputCard.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import type {AgentToolCall, AgentPendingUserInputSession, ToolCallStatus} from "../../components/novel-ide/agent/agent-message";
import {
    AGENT_REQUEST_USER_INPUT_CONTEXT_KEY,
    type AgentRequestUserInputContext,
} from "../../components/novel-ide/agent/bubbles/interactive/request-user-input-context";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

export type RequestUserInputFixtureData = {
    status?: ToolCallStatus;
    isPending?: boolean;
    error?: string;
    streamingArgs?: string;
    questions?: Array<{
        id?: string;
        header?: string;
        question: string;
        options?: Array<{label: string; description?: string}>;
    }>;
    answers?: Array<{
        questionIndex?: number;
        selectedOptionIndex?: number;
        selectedLabel?: string;
        text?: string;
        note?: string;
        ignored?: boolean;
    }>;
};

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

// 内部交互受控覆盖状态
const overrideSelectionIndex = ref<number | null>(null);
const overrideNote = ref<string | null>(null);
const overridePending = ref<boolean | null>(null);
const overrideFailed = ref<boolean | null>(null);

watch(
    () => props.scene,
    () => {
        overrideSelectionIndex.value = null;
        overrideNote.value = null;
        overridePending.value = null;
        overrideFailed.value = null;
    },
);

/** 默认场景预设数据 */
const sceneDefaults = computed<RequestUserInputFixtureData>(() => {
    switch (props.scene) {
        case "pending":
            return {
                status: "running",
                isPending: true,
                questions: [
                    {
                        id: "q1",
                        header: "角色动机",
                        question: "是否确认将反派角色‘罗恩’的背叛动机从单纯的金钱诱惑改为家族契约逼迫？",
                        options: [
                            {label: "确认修改（增加家族契约悲剧色彩）", description: "赋予角色更深层的身不由己动机"},
                            {label: "保持原状（维持利益驱使的纯粹恶人设定）", description: "凸显人性的纯粹自私与残酷贪婪"},
                        ],
                    },
                ],
                answers: [],
            };
        case "answered-custom":
            return {
                status: "success",
                isPending: false,
                questions: [
                    {
                        id: "q1",
                        header: "角色动机",
                        question: "是否确认将反派角色‘罗恩’的背叛动机从单纯的金钱诱惑改为家族契约逼迫？",
                        options: [
                            {label: "确认修改（增加家族契约悲剧色彩）", description: "赋予角色更深层的身不由己动机"},
                            {label: "保持原状（维持利益驱使的纯粹恶人设定）", description: "凸显人性的纯粹自私与残酷贪婪"},
                        ],
                    },
                ],
                answers: [
                    {
                        questionIndex: 0,
                        selectedOptionIndex: 0,
                        note: "建议将家族契约与第三卷的古神祭坛暗中关联起来，预埋伏笔",
                    },
                ],
            };
        case "tool-approval":
            return {
                status: "success",
                isPending: false,
                questions: [
                    {
                        id: "q-approval",
                        header: "审批",
                        question: "Agent 请求执行文件更新：将主角觉醒章节写入 src/chapters/ch03.md，是否批准？",
                        options: [
                            {label: "批准执行", description: "允许 Agent 覆盖写入目标章节文件"},
                            {label: "拒绝操作", description: "阻止文件改动，由作者手动接管后续操作"},
                        ],
                    },
                ],
                answers: [
                    {
                        questionIndex: 0,
                        selectedOptionIndex: 0,
                        note: "已通过大纲审查，允许更新",
                    },
                ],
            };
        case "multi-questions":
            return {
                status: "success",
                isPending: false,
                questions: [
                    {
                        id: "q1",
                        header: "冲突走向",
                        question: "情节走向决策：如何处理反派罗恩与主角在钟楼的对决？",
                        options: [
                            {label: "正面交锋并揭穿背叛真相", description: "迅速推动矛盾高潮"},
                            {label: "表面虚与委蛇，暗中留下逃生退路", description: "强化悬疑与智斗氛围"},
                        ],
                    },
                    {
                        id: "q2",
                        header: "篇幅控制",
                        question: "章节篇幅规划：本场对决预期字数与节奏控制？",
                        options: [
                            {label: "快节奏短章（约 3000 字）", description: "紧凑推进，不拖泥带水"},
                            {label: "多视角大章（约 6000 字）", description: "细致刻画配角心理与环境氛围"},
                        ],
                    },
                ],
                answers: [
                    {
                        questionIndex: 0,
                        selectedOptionIndex: 0,
                        note: "",
                    },
                    {
                        questionIndex: 1,
                        selectedOptionIndex: 1,
                        note: "需重点描写钟楼暴风雨的声音与光影细节",
                    },
                ],
            };
        case "streaming":
            return {
                status: "running",
                isPending: false,
                streamingArgs: "{\"questions\":[{\"id\":\"q1\",\"question\":\"是否确认调整角色动机",
            };
        case "answered-open":
            return {
                status: "success",
                isPending: false,
                questions: [
                    {
                        id: "q-open",
                        header: "设定讨论",
                        question: "请详细描述第三卷登场的古神祭坛的建筑风格与周边生态环境。",
                        options: [],
                    },
                ],
                answers: [
                    {
                        questionIndex: 0,
                        text: "祭坛由黑曜石与风化玄武岩筑成，四周环绕着发光的荧光苔藓与深不见底的静水深潭。",
                    },
                ],
            };
        case "answered-choice":
        default:
            return {
                status: "success",
                isPending: false,
                questions: [
                    {
                        id: "q1",
                        header: "角色动机",
                        question: "是否确认将反派角色‘罗恩’的背叛动机从单纯的金钱诱惑改为家族契约逼迫？",
                        options: [
                            {label: "确认修改（增加家族契约悲剧色彩）", description: "赋予角色更深层的身不由己动机"},
                            {label: "保持原状（维持利益驱使的纯粹恶人设定）", description: "凸显人性的纯粹自私与残酷贪婪"},
                        ],
                    },
                ],
                answers: [
                    {
                        questionIndex: 0,
                        selectedOptionIndex: 0,
                        note: "",
                    },
                ],
            };
    }
});

/** 响应式合并 props.data 与预设 */
const effectiveData = computed<RequestUserInputFixtureData>(() => {
    const raw = props.data;
    const base = sceneDefaults.value;
    if (raw && typeof raw === "object") {
        const patch = raw as Partial<RequestUserInputFixtureData>;
        return {
            status: patch.status ?? base.status,
            isPending: patch.isPending !== undefined ? patch.isPending : base.isPending,
            error: patch.error ?? base.error,
            streamingArgs: patch.streamingArgs ?? base.streamingArgs,
            questions: Array.isArray(patch.questions) ? patch.questions : base.questions,
            answers: Array.isArray(patch.answers) ? patch.answers : base.answers,
        };
    }
    return base;
});

const isCurrentlyPending = computed(() => {
    if (overridePending.value !== null) {
        return overridePending.value;
    }
    return Boolean(effectiveData.value.isPending);
});

const isCurrentlyFailed = computed(() => {
    if (overrideFailed.value !== null) {
        return overrideFailed.value;
    }
    return effectiveData.value.status === "error";
});

/** 动态计算 ToolCall */
const currentToolCall = computed<AgentToolCall>(() => {
    const data = effectiveData.value;
    const isStreaming = (props.scene === "streaming" || data.status === "running") && Boolean(data.streamingArgs) && !data.questions?.length;

    if (isStreaming) {
        return {
            id: "tc-stream-input",
            index: 0,
            name: "request_user_input",
            argsText: data.streamingArgs ?? "{\"questions\":[{\"id\":\"q1\",\"question\":\"是否确认调整角色动机",
            status: "running",
        };
    }

    const questions = data.questions ?? [];
    const argsJson = JSON.stringify({questions});

    // 计算答案列表，合并抽屉覆盖状态
    const baseAnswers = data.answers ?? [];
    const resolvedAnswers = baseAnswers.map((ans, idx) => {
        if (idx === 0 && overrideSelectionIndex.value !== null) {
            return {
                ...ans,
                selectedOptionIndex: overrideSelectionIndex.value,
                note: overrideNote.value ?? ans.note,
            };
        }
        if (idx === 0 && overrideNote.value !== null) {
            return {
                ...ans,
                note: overrideNote.value,
            };
        }
        return ans;
    });

    if (resolvedAnswers.length === 0 && overrideSelectionIndex.value !== null) {
        resolvedAnswers.push({
            questionIndex: 0,
            selectedOptionIndex: overrideSelectionIndex.value,
            note: overrideNote.value ?? "",
        });
    }

    return {
        id: "tc-req-input",
        assistantMessageId: "msg-assistant-1",
        index: 0,
        name: "request_user_input",
        argsText: argsJson,
        argsJson,
        status: isCurrentlyFailed.value ? "error" : (isCurrentlyPending.value ? "running" : (data.status ?? "success")),
        error: isCurrentlyFailed.value ? (data.error || "用户取消了本次决策流程或已超时") : undefined,
        resultData: isCurrentlyPending.value || isCurrentlyFailed.value ? undefined : {
            answers: resolvedAnswers,
        },
    };
});

/** 动态注入权威 pending 会话 */
const pendingSessionsList = computed<AgentPendingUserInputSession[]>(() => {
    if (!isCurrentlyPending.value) {
        return [];
    }
    const questions = effectiveData.value.questions ?? [];
    return [
        {
            assistantMessageId: currentToolCall.value.assistantMessageId ?? "msg-assistant-1",
            status: "pending",
            questions: questions.map((q, idx) => ({
                id: q.id ?? `q-${idx}`,
                toolNodeId: currentToolCall.value.id,
                toolCallId: currentToolCall.value.id,
                questionIndex: idx,
                toolName: "request_user_input",
                kind: (q.header === "审批" || /批准|审批|tool_approval/u.test(q.question)) ? "tool_approval" : "question",
                header: q.header,
                question: q.question,
                options: q.options ?? [],
            })),
        },
    ];
});

provide<AgentRequestUserInputContext>(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {
    pendingSessions: computed(() => pendingSessionsList.value),
});

// 同步 Lab 数据面板（保持完整的假数据结构，避免被元数据覆盖）
watch(
    [effectiveData, isCurrentlyPending, isCurrentlyFailed],
    () => {
        try {
            syncLabData(JSON.parse(JSON.stringify({
                ...effectiveData.value,
                isPending: isCurrentlyPending.value,
                status: isCurrentlyFailed.value ? "error" : (isCurrentlyPending.value ? "running" : effectiveData.value.status),
            })));
        } catch {
            // 防御性静默
        }
    },
    {immediate: true},
);

function handleSelectChoice(choiceIndex: number): void {
    overridePending.value = false;
    overrideFailed.value = false;
    overrideSelectionIndex.value = choiceIndex;
    emitLabEvent("user-select-choice", {choiceIndex});
}

function handleAddCustomNote(): void {
    overridePending.value = false;
    overrideFailed.value = false;
    overrideNote.value = "在第三章末尾预留钟楼线索的伏笔备忘录";
    emitLabEvent("user-add-note", {note: overrideNote.value});
}

function handleResetPending(): void {
    overridePending.value = true;
    overrideFailed.value = false;
    emitLabEvent("reset-to-pending", {});
}

function handleSetFailed(): void {
    overrideFailed.value = true;
    overridePending.value = false;
    emitLabEvent("set-to-failed", {});
}
</script>

<template>
    <!-- ViewportCanvas 即视口盒子，根组件直连 -->
    <AgentRequestUserInputCard
        data-lab-subject
        class="w-full"
        :tool-call="currentToolCall"
    />

    <!-- 底部交互控制抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <div class="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span class="i-lucide-sparkles h-3.5 w-3.5 text-[var(--accent)]" />
                <span>只读留痕卡片 · 交互调试</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleSelectChoice(0)"
                >
                    <span class="i-lucide-check h-3 w-3 text-[var(--status-success)]" />
                    <span>选选项 1</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleSelectChoice(1)"
                >
                    <span class="i-lucide-check h-3 w-3 text-[var(--status-success)]" />
                    <span>选选项 2</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleAddCustomNote"
                >
                    <span class="i-lucide-pen-line h-3 w-3 text-[var(--accent)]" />
                    <span>追加备注说明</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 text-[11px] text-[var(--status-warning)] hover:brightness-95 cursor-pointer"
                    @click="handleResetPending"
                >
                    <span class="i-lucide-clock h-3 w-3" />
                    <span>设为等待作答</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 text-[11px] text-[var(--status-danger)] hover:brightness-95 cursor-pointer"
                    @click="handleSetFailed"
                >
                    <span class="i-lucide-circle-alert h-3 w-3" />
                    <span>设为执行失败</span>
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
