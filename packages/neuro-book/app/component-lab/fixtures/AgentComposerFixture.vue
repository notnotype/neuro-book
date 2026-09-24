<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {
    Button,
    FormSelect,
    type FormSelectOption,
    SegmentedControl,
    type SegmentedControlOption,
    Switch,
} from "@notnotype/nb-ui/components";
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
import type {ModelPickerRoleItem} from "../../components/novel-ide/model-picker/model-picker.types";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {PublicTextPreviewDto} from "nbook/shared/dto/agent-public-event.dto";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

/** Lab 附件条目：按当前 DTO 合成，`attachmentId` 与 `target` 用 sha256 形状的稳定标识，不接真实存储。 */
function labAttachmentItem(input: {suffix: string; mimeType: string; bytes: number; name?: string; seenAt: number}): AgentSessionAttachmentItemDto {
    const attachmentId: `sha256:${string}` = `sha256:${input.suffix.padEnd(64, "0").slice(0, 64)}`;
    return {
        attachment: {
            attachmentId,
            mimeType: input.mimeType,
            bytes: input.bytes,
            ...(input.name === undefined ? {} : {name: input.name}),
            dataOmitted: true,
        },
        target: attachmentId,
        locator: {entryId: attachmentId, contentIndex: 0},
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        referenceCount: 1,
    };
}

/** Lab 文本预览：按当前 DTO 给出字节数与截断标记。 */
function labTextPreview(preview: string): PublicTextPreviewDto {
    return {preview, bytes: new TextEncoder().encode(preview).length, omitted: false};
}

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
    modelKey: "claude-3-7-sonnet",
    reasoningEffort: "high",
});

const selectableModels: EnabledModelOptionDto[] = [
    {
        key: "claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet (Hybrid)",
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
        input: ["text", "image"],
        contextWindowTokens: 200000,
    },
    {
        key: "gpt-4o",
        label: "GPT-4o Omnimodal",
        providerId: "openai",
        modelId: "gpt-4o",
        input: ["text", "image"],
        contextWindowTokens: 128000,
    },
    {
        key: "deepseek-reasoner",
        label: "DeepSeek R1 (Reasoning)",
        providerId: "deepseek",
        modelId: "deepseek-reasoner",
        input: ["text"],
        contextWindowTokens: 64000,
    },
];

const showSpecialistInPicker = ref(true);

const modelRoles = ref<ModelPickerRoleItem[]>([
    {
        id: "tiny",
        axis: "gradient",
        name: "极轻量",
        description: "会话标题、简单打标、轻量检索",
        modelKey: "deepseek-reasoner",
        modelLabel: "DeepSeek R1",
        iconClass: "i-lucide-feather",
        enabled: true,
    },
    {
        id: "fast",
        axis: "gradient",
        name: "快速",
        description: "日常问答、快速搜索、简单改写",
        modelKey: "gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-zap",
        enabled: true,
    },
    {
        id: "main",
        axis: "gradient",
        name: "主力",
        description: "主会话、综合分析、长篇写作",
        modelKey: "claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet (Hybrid)",
        iconClass: "i-lucide-star",
        enabled: true,
    },
    {
        id: "deep",
        axis: "gradient",
        name: "深度",
        description: "复杂规划、难点分析、深度推理",
        modelKey: "claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet (Hybrid)",
        iconClass: "i-lucide-brain",
        enabled: true,
    },
    {
        id: "writer",
        axis: "specialist",
        name: "写作",
        description: "小说正文与段落润色",
        modelKey: "claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet (Hybrid)",
        iconClass: "i-lucide-pen-line",
        enabled: true,
    },
    {
        id: "narrative",
        axis: "specialist",
        name: "叙事",
        description: "剧情设计与伏笔规划",
        modelKey: "claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet (Hybrid)",
        iconClass: "i-lucide-book-open",
        enabled: true,
    },
    {
        id: "plan",
        axis: "specialist",
        name: "计划",
        description: "进入计划模式后切换的模型",
        modelKey: "gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-map",
        enabled: true,
    },
    {
        id: "vision",
        axis: "specialist",
        name: "视觉",
        description: "图像与多模态插画理解",
        modelKey: "gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-eye",
        enabled: true,
    },
]);

const pendingResolutionDraft = ref<AgentPendingResolutionDraft>(createAgentPendingResolutionDraft([]));

// 选项配置
const agentModeOptions: SegmentedControlOption[] = [
    {value: "normal", label: "常规 (Normal)"},
    {value: "discuss", label: "讨论 (Discuss)"},
    {value: "plan", label: "规划 (Plan)"},
];

const availabilityOptions: FormSelectOption[] = [
    {value: "ready", label: "就绪可编辑 (ready)", description: "常规正常输入态"},
    {value: "unselected", label: "未选择会话 (unselected)", description: "展示无活动会话提示"},
    {value: "archived", label: "已归档会话 (archived)", description: "会话已锁定，只读"},
    {value: "load-error", label: "加载错误 (load-error)", description: "模拟网络连接中断"},
    {value: "waiting-blocked", label: "等待输入受阻 (waiting-blocked)", description: "等待回答时阻断其他输入"},
];

function syncSink(): void {
    syncLabData({
        scene: props.scene,
        inputText: inputText.value,
        running: running.value,
        agentMode: agentMode.value,
        availabilityStatus: availabilityStatus.value,
        queuedCount: queuedMessages.value.length,
        hasPendingPrompt: pendingSessions.value.length > 0,
        attachmentsCount: sessionAttachments.value.length,
        selectedModel: sessionModelSelectionValue.value,
    });
}

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
        const clocktower = labAttachmentItem({
            suffix: "att-clocktower-01",
            mimeType: "image/png",
            bytes: 1024 * 640,
            name: "clocktower_blueprint.png",
            seenAt: Date.now() - 3600000,
        });
        // 正文里的 destination 必须与条目 target 一致，Composer 才认得出这张图。
        inputText.value = `请参考图中的钟楼建筑构造与夜景氛围，为决战描写提供场景细节。\n\n![钟楼平面图](${clocktower.target})`;
        sessionAttachments.value = [clocktower];
    } else if (scene === "queued") {
        queuedMessages.value = [
            {
                id: "queue-1",
                clientMessageId: "cm-1",
                kind: "steer",
                text: labTextPreview("注意钟摆撞击声在此处作为心跳节拍，需要重复三次渲染紧张感。"),
                images: [],
                omittedImages: 0,
                createdAt: Date.now() - 60000,
            },
            {
                id: "queue-2",
                clientMessageId: "cm-2",
                kind: "followup",
                text: labTextPreview("同时检查配角艾德温的手枪子弹数量，避免出现前文描述的 5 发与此处连续射击 6 次的矛盾。"),
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
        await new Promise((resolve) => setTimeout(resolve, 200));
        return labAttachmentItem({
            suffix: `mock-att-${String(Date.now())}`,
            mimeType: file.type || "image/png",
            bytes: file.size,
            name: file.name,
            seenAt: Date.now(),
        });
    },
    async snapshotSessionAttachment(sessionId: number, input: {sourcePath: string; name?: string}) {
        emitLabEvent("image-snapshot-mock", {sessionId, input});
        return labAttachmentItem({
            suffix: `mock-snap-${String(Date.now())}`,
            mimeType: "image/png",
            bytes: 1024 * 100,
            name: input.name || "snapshot.png",
            seenAt: Date.now(),
        });
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
    if (context.kind === "skill") {
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
    syncSink();
}

function handleStop() {
    emitLabEvent("stop");
    running.value = false;
    syncSink();
}

function handleCycleMode() {
    emitLabEvent("cycle-mode");
    if (agentMode.value === "normal") agentMode.value = "discuss";
    else if (agentMode.value === "discuss") agentMode.value = "plan";
    else agentMode.value = "normal";
    syncSink();
}

function handleAddQueue() {
    const nextIdx = queuedMessages.value.length + 1;
    queuedMessages.value.push({
        id: `queue-${String(Date.now())}`,
        clientMessageId: `cm-${String(Date.now())}`,
        kind: "followup",
        text: labTextPreview(`新增排队指令 #${String(nextIdx)}：补充场景雨声渲染`),
        images: [],
        omittedImages: 0,
        createdAt: Date.now(),
    });
    syncSink();
}

function handleClearQueue() {
    queuedMessages.value = [];
    syncSink();
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
    syncSink();
}
</script>

<template>
    <div class="flex h-full min-h-0 w-full flex-col justify-end p-4">
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
            :model-roles="modelRoles"
            :show-specialist-in-picker="showSpecialistInPicker"
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
            @update-session-model-selection="sessionModelSelectionValue = $event; syncSink()"
        />
    </div>

    <!-- Component Lab 底部可展开调试控制抽屉（消费标准 nb-ui 控件与主题语义变量） -->
    <LabFixtureControls>
            <div class="flex flex-col gap-3 py-1 text-xs select-none">
                <!-- 第一行：状态开关与模式切换 -->
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">运行控制:</span>
                        <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                            <span
                                class="h-2 w-2 rounded-full transition-colors"
                                :class="running ? 'bg-[var(--status-success)] animate-pulse' : 'bg-[var(--text-muted)]'"
                                aria-hidden="true"
                            />
                            <span class="text-[11px] text-[var(--text-main)]">{{ running ? "执行推进中 (running)" : "就绪空闲中 (idle)" }}</span>
                            <Switch
                                :model-value="running"
                                size="sm"
                                aria-label="切换执行推进状态"
                                @update:model-value="running = $event; syncSink()"
                            />
                        </div>
                    </div>

                    <div class="flex items-center gap-3">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">专精角色:</span>
                        <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                            <span class="text-[11px] text-[var(--text-main)]">{{ showSpecialistInPicker ? "显示" : "隐藏" }}</span>
                            <Switch
                                :model-value="showSpecialistInPicker"
                                size="sm"
                                aria-label="切换专精角色显示"
                                @update:model-value="showSpecialistInPicker = $event; syncSink()"
                            />
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Agent 模式:</span>
                        <SegmentedControl
                            :model-value="agentMode"
                            :options="agentModeOptions"
                            size="sm"
                            @update:model-value="(val) => { agentMode = val as AgentMode; syncSink(); }"
                        />
                    </div>
                </div>

                <!-- 第二行：可用性切换与模拟交互操作 -->
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--divider)] pt-2.5">
                    <div class="flex items-center gap-2">
                        <span class="shrink-0 text-xs font-medium text-[var(--text-secondary)]">可用性状态:</span>
                        <div class="w-64">
                            <FormSelect
                                v-model="availabilityStatus"
                                :options="availabilityOptions"
                                size="sm"
                                aria-label="可用性状态"
                                @update:model-value="syncSink()"
                            />
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            @click="handleAddQueue"
                        >
                            <span class="i-lucide-plus mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            追加排队消息
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            :disabled="queuedMessages.length === 0"
                            @click="handleClearQueue"
                        >
                            <span class="i-lucide-trash-2 mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            清空排队 ({{ queuedMessages.length }})
                        </Button>
                        <Button
                            size="sm"
                            :variant="pendingSessions.length > 0 ? 'primary' : 'secondary'"
                            @click="handleTogglePrompt"
                        >
                            <span
                                :class="pendingSessions.length > 0 ? 'i-lucide-x' : 'i-lucide-help-circle'"
                                class="mr-1 h-3.5 w-3.5"
                                aria-hidden="true"
                            />
                            {{ pendingSessions.length > 0 ? "取消提问向导" : "注入 Agent 提问" }}
                        </Button>
                    </div>
                </div>
            </div>
        </LabFixtureControls>
</template>
