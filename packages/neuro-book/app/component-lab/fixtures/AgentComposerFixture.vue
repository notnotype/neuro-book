<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentComposer from "../../components/novel-ide/agent/composer/AgentComposer.vue";
import type {ComposerImageTransactionApi} from "../../components/novel-ide/agent/composables/useComposerImageTransaction";
import type {AgentPendingUserInputSession} from "../../components/novel-ide/agent/agent-message";
import {
    createAgentPendingResolutionDraft,
    type AgentPendingResolutionDraft,
    type AgentPendingSubmissionIssue,
} from "../../components/novel-ide/agent/agent-pending-resolution";
import type {
    AgentComposerAvailability,
    AgentComposerAvailabilityAction,
} from "../../components/novel-ide/agent/agent-chat-surface-state";
import type {AgentSessionModelDraft} from "../../components/novel-ide/agent/agent-session-model-controls";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

// 基础受控响应式状态
const inputText = ref("");
const running = ref(false);
const agentMode = ref<AgentMode>("normal");
const availabilityStatus = ref<AgentComposerAvailability["status"]>("ready");
const availabilityMessage = ref("");
const queuedMessages = ref<AgentQueuedMessageDto[]>([]);
const pendingSessions = ref<AgentPendingUserInputSession[]>([]);
const sessionAttachments = ref<AgentSessionAttachmentItemDto[]>([]);
const sessionModelPopoverOpen = ref(false);
const sessionModelSelectionValue = ref<string | null>("claude-3-7-sonnet");
const sessionModelSaving = ref(false);
const submittingUserInput = ref(false);
const pendingSubmissionIssue = ref<AgentPendingSubmissionIssue | null>(null);

const sessionModelDraft = ref<AgentSessionModelDraft>({
    model: "claude-3-7-sonnet",
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
    reasoningEffort: "high",
});

const selectableModels: EnabledModelOptionDto[] = [
    {
        model: "claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet (Hybrid)",
        provider: "anthropic",
        contextWindow: 200000,
        maxOutputTokens: 64000,
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalls: true,
        supportsReasoningEffort: true,
    },
    {
        model: "gpt-4o",
        label: "GPT-4o Omnimodal",
        provider: "openai",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsStreaming: true,
        supportsVision: true,
        supportsToolCalls: true,
        supportsReasoningEffort: false,
    },
    {
        model: "deepseek-reasoner",
        label: "DeepSeek R1 (Reasoning)",
        provider: "deepseek",
        contextWindow: 64000,
        maxOutputTokens: 8192,
        supportsStreaming: true,
        supportsVision: false,
        supportsToolCalls: true,
        supportsReasoningEffort: false,
    },
];

const pendingResolutionDraft = ref<AgentPendingResolutionDraft>(createAgentPendingResolutionDraft([]));

// 场景初始数据映射
watch(() => props.scene, (scene) => {
    // 默认恢复基础空闲态
    inputText.value = "";
    running.value = false;
    agentMode.value = "normal";
    availabilityStatus.value = "ready";
    availabilityMessage.value = "";
    queuedMessages.value = [];
    pendingSessions.value = [];
    sessionAttachments.value = [];
    sessionModelPopoverOpen.value = false;
    submittingUserInput.value = false;
    pendingSubmissionIssue.value = null;
    pendingResolutionDraft.value = createAgentPendingResolutionDraft([]);

    if (scene === "with-text") {
        inputText.value = "请根据第三幕大纲推演钟楼决战的心理细节，强调暴雨和钟摆声的隐喻。";
    } else if (scene === "with-images") {
        inputText.value = "请参考图中的钟楼建筑构造与夜景氛围，为决战描写提供场景细节。\n\n![钟楼平面图](session-attachment://att-clocktower-01)";
        sessionAttachments.value = [
            {
                attachment: {
                    attachmentId: "att-clocktower-01",
                    fileName: "clocktower_blueprint.png",
                    mimeType: "image/png",
                    byteSize: 1024 * 640,
                    sha256: "0000000000000000000000000000000000000000000000000000000000000001",
                    createdAt: Date.now() - 3600000,
                },
                source: "user_upload",
                label: "钟楼平面图.png",
                target: "session-attachment://att-clocktower-01",
                lastSeenAt: Date.now() - 3600000,
            },
        ];
    } else if (scene === "queued") {
        queuedMessages.value = [
            {
                id: "queue-1",
                clientMessageId: "cm-1",
                kind: "steer",
                text: {preview: "注意钟摆撞击声在此处作为心跳节拍，需要重复三次渲染紧张感。"},
                images: [],
                omittedImages: 0,
                createdAt: Date.now() - 60000,
            },
            {
                id: "queue-2",
                clientMessageId: "cm-2",
                kind: "followup",
                text: {preview: "同时检查配角艾德温的手枪子弹数量，避免出现前文描述的 5 发与此处连续射击 6 次的矛盾。"},
                images: [],
                omittedImages: 0,
                createdAt: Date.now() - 30000,
            },
        ];
    } else if (scene === "user-input-prompt") {
        const mockPromptSession: AgentPendingUserInputSession = {
            assistantMessageId: "msg-prompt-1",
            status: "pending",
            questions: [
                {
                    toolNodeId: "node-user-prompt-1",
                    questionIndex: 0,
                    toolCallId: "call-user-prompt-1",
                    toolName: "request_user_input",
                    kind: "question",
                    question: "主角在钟楼顶层发现神秘遗留物，剧情应走向哪种分支？",
                    options: [
                        {label: "发现导师生前暗藏的怀表信件（强化悬疑）", description: "推迟正面冲突，转向揭露二十年前真相"},
                        {label: "直接撞破反派正在启动仪式装置（直接冲突）", description: "立即展开正面拔枪决战，节奏紧凑"},
                    ],
                },
            ],
        };
        pendingSessions.value = [mockPromptSession];
        pendingResolutionDraft.value = createAgentPendingResolutionDraft([mockPromptSession]);
    } else if (scene === "running") {
        running.value = true;
    } else if (scene === "readonly-unselected") {
        availabilityStatus.value = "unselected";
    } else if (scene === "readonly-archived") {
        availabilityStatus.value = "archived";
    } else if (scene === "discuss-mode") {
        agentMode.value = "discuss";
    } else if (scene === "plan-mode") {
        agentMode.value = "plan";
    }
}, {immediate: true});

// 可用性计算属性
const availability = computed<AgentComposerAvailability>(() => {
    switch (availabilityStatus.value) {
        case "unselected":
            return {status: "unselected", readonly: true, canStop: false};
        case "empty":
            return {status: "empty", readonly: true, canStop: false};
        case "archived":
            return {status: "archived", readonly: true, canRestore: true, canStop: false};
        case "load-error":
            return {status: "load-error", readonly: true, message: "同步会话记录超时，网络连接已中断。", canStop: false};
        case "waiting-blocked":
            return {status: "waiting-blocked", readonly: true, canStop: false};
        case "ready":
        default:
            return {status: "ready", readonly: false, canStop: false};
    }
});

// 模拟纯内存图片 API（无网络 IO）
const mockImageApi: ComposerImageTransactionApi = {
    async uploadSessionAttachment(sessionId: number, file: File) {
        emitLabEvent("image-upload-mock", {sessionId, name: file.name, size: file.size});
        // 模拟 200ms 延时
        await new Promise((resolve) => setTimeout(resolve, 200));
        const id = `mock-att-${Date.now()}`;
        return {
            attachment: {
                attachmentId: id,
                fileName: file.name,
                mimeType: file.type || "image/png",
                byteSize: file.size,
                sha256: "0000000000000000000000000000000000000000000000000000000000000000",
                createdAt: Date.now(),
            },
            source: "user_upload",
            label: file.name,
            target: `session-attachment://${id}`,
            lastSeenAt: Date.now(),
        };
    },
    async snapshotSessionAttachment(sessionId: number, input: {sourcePath: string; name?: string}) {
        emitLabEvent("image-snapshot-mock", {sessionId, input});
        const id = `mock-snap-${Date.now()}`;
        return {
            attachment: {
                attachmentId: id,
                fileName: input.name || "snapshot.png",
                mimeType: "image/png",
                byteSize: 1024 * 100,
                sha256: "0000000000000000000000000000000000000000000000000000000000000000",
                createdAt: Date.now(),
            },
            source: "project_snapshot",
            label: input.name || "snapshot.png",
            target: `session-attachment://${id}`,
            lastSeenAt: Date.now(),
        };
    },
    async resolveSessionAttachments(_sessionId: number, attachmentIds: string[]) {
        return {
            items: sessionAttachments.value.filter((item) => attachmentIds.includes(item.attachment.attachmentId)),
        };
    },
    async getSessionAttachments(_sessionId: number) {
        return {
            items: sessionAttachments.value,
            total: sessionAttachments.value.length,
            offset: 0,
            limit: 20,
            hasMore: false,
        };
    },
};

const resolveMenu = (context: AgentTriggerMenuContext): AgentTriggerMenuState => {
    if (context.triggerChar === "/") {
        return {
            title: "写作技能指令",
            prefix: "/",
            sections: [
                {
                    id: "skills",
                    title: "智能技能",
                    items: [
                        {id: "lint", label: "风格润色", description: "优化句式节奏与修辞手法", iconClass: "i-lucide-sparkles"},
                        {id: "expand", label: "情节推演", description: "结合世界观展开下一幕推演", iconClass: "i-lucide-git-branch"},
                        {id: "critique", label: "剧情审计", description: "检查伏笔逻辑与人物动机一致性", iconClass: "i-lucide-shield-alert"},
                    ],
                },
            ],
        };
    }
    return {
        title: "上下文引用",
        prefix: "@",
        sections: [
            {
                id: "context",
                title: "作品上下文",
                items: [
                    {id: "ch3", label: "第三幕：暴风雨前夕", description: "正文文件", iconClass: "i-lucide-file-text"},
                    {id: "char-edwin", label: "人物卡：艾德温·凡客", description: "人物档案", iconClass: "i-lucide-user"},
                ],
            },
        ],
    };
};

function handleSend() {
    emitLabEvent("send", {inputText: inputText.value, mode: agentMode.value});
    if (inputText.value.trim()) {
        running.value = true;
        inputText.value = "";
    }
}

function handleStop() {
    emitLabEvent("stop");
    running.value = false;
}

function handleCycleMode() {
    emitLabEvent("cycle-mode");
    if (agentMode.value === "normal") agentMode.value = "discuss";
    else if (agentMode.value === "discuss") agentMode.value = "plan";
    else agentMode.value = "normal";
}

function handleAddQueue() {
    const nextIdx = queuedMessages.value.length + 1;
    queuedMessages.value.push({
        id: `queue-${String(Date.now())}`,
        clientMessageId: `cm-${String(Date.now())}`,
        kind: "followup",
        text: {preview: `新增排队指令 #${String(nextIdx)}：补充场景雨声渲染`},
        images: [],
        omittedImages: 0,
        createdAt: Date.now(),
    });
}

function handleClearQueue() {
    queuedMessages.value = [];
}

function handleTogglePrompt() {
    if (pendingSessions.value.length > 0) {
        pendingSessions.value = [];
        pendingResolutionDraft.value = createAgentPendingResolutionDraft([]);
    } else {
        const mockPromptSession: AgentPendingUserInputSession = {
            assistantMessageId: "msg-prompt-toggle",
            status: "pending",
            questions: [
                {
                    toolNodeId: `node-${String(Date.now())}`,
                    questionIndex: 0,
                    toolCallId: `call-${String(Date.now())}`,
                    toolName: "request_user_input",
                    kind: "question",
                    question: "模拟 Agent 提问：是否允许配角艾德温提前暴露身份？",
                    options: [
                        {label: "允许（加速情节爆点）"},
                        {label: "隐藏（保留后续反转空间）"},
                    ],
                },
            ],
        };
        pendingSessions.value = [mockPromptSession];
        pendingResolutionDraft.value = createAgentPendingResolutionDraft([mockPromptSession]);
    }
}
</script>

<template>
    <div class="flex w-full flex-col justify-end p-4">
        <AgentComposer
            data-lab-subject
            class="w-full"
            v-model:input-text="inputText"
            v-model:pending-resolution-draft="pendingResolutionDraft"
            v-model:session-model-popover-open="sessionModelPopoverOpen"
            v-model:session-model-draft="sessionModelDraft"
            :pending-sessions="pendingSessions"
            :submitting-user-input="submittingUserInput"
            :can-resolve-user-input="true"
            :can-abort="true"
            :pending-submission-issue="pendingSubmissionIssue"
            :running="running"
            :availability="availability"
            :can-register-attachments="!availability.readonly"
            :can-insert-attachments="!availability.readonly"
            :loading-session="false"
            :session-model-saving="sessionModelSaving"
            :session-model-selection-value="sessionModelSelectionValue"
            session-thinking-resolved-label="思考耗时 1.8s"
            :selectable-models="selectableModels"
            :agent-mode="agentMode"
            :can-continue-without-input="false"
            :queued-messages="queuedMessages"
            menu-refresh-key="composer-fixture-menu"
            project-root="/demo-novel"
            :session-id="101"
            :session-attachments="sessionAttachments"
            :model-supports-images="true"
            :image-api="mockImageApi"
            :resolve-menu="resolveMenu"
            @send="handleSend"
            @steer="emitLabEvent('steer')"
            @followup="emitLabEvent('followup')"
            @stop="handleStop"
            @cycle-mode="handleCycleMode"
            @submit-user-input="emitLabEvent('submit-user-input')"
            @cancel-user-input="pendingSessions = []; emitLabEvent('cancel-user-input')"
            @resync-user-input="emitLabEvent('resync-user-input')"
            @toggle-session-model-popover="sessionModelPopoverOpen = !sessionModelPopoverOpen"
            @apply-session-model-settings="sessionModelPopoverOpen = false; emitLabEvent('apply-session-model-settings')"
            @reset-session-model-settings="emitLabEvent('reset-session-model-settings')"
            @availability-action="emitLabEvent('availability-action', $event)"
        />

        <!-- Component Lab 底部可展开调试控制抽屉 -->
        <LabFixtureControls>
            <div class="space-y-4 text-xs">
                <div>
                    <span class="mb-1.5 block font-semibold text-[var(--text-primary)]">运行与模式控制</span>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-2 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                            <input type="checkbox" v-model="running" class="rounded accent-[var(--theme-accent)]">
                            <span>正在运行 (running)</span>
                        </label>
                        <select
                            v-model="agentMode"
                            class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[var(--text-primary)]"
                        >
                            <option value="normal">模式: 常规 (Normal)</option>
                            <option value="discuss">模式: 讨论 (Discuss)</option>
                            <option value="plan">模式: 规划 (Plan)</option>
                        </select>
                    </div>
                </div>

                <div>
                    <span class="mb-1.5 block font-semibold text-[var(--text-primary)]">可用性状态 (Availability)</span>
                    <select
                        v-model="availabilityStatus"
                        class="w-full rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[var(--text-primary)]"
                    >
                        <option value="ready">就绪可编辑 (ready)</option>
                        <option value="unselected">未选择会话 (unselected)</option>
                        <option value="archived">已归档会话 (archived)</option>
                        <option value="load-error">加载错误 (load-error)</option>
                        <option value="waiting-blocked">等待回答受阻 (waiting-blocked)</option>
                    </select>
                </div>

                <div>
                    <span class="mb-1.5 block font-semibold text-[var(--text-primary)]">模拟动态交互</span>
                    <div class="flex flex-wrap gap-2">
                        <button
                            type="button"
                            class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            @click="handleAddQueue"
                        >
                            + 追加排队消息
                        </button>
                        <button
                            type="button"
                            class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            @click="handleClearQueue"
                        >
                            清空排队消息
                        </button>
                        <button
                            type="button"
                            class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                            @click="handleTogglePrompt"
                        >
                            {{ pendingSessions.length > 0 ? "取消提问弹窗" : "注入 Agent 提问" }}
                        </button>
                    </div>
                </div>
            </div>
        </LabFixtureControls>
    </div>
</template>
