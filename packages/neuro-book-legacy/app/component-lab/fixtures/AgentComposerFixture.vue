<script setup lang="ts">
import AgentComposer from "../../components/novel-ide/agent/composer/AgentComposer.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {computed} from "vue";
import {Button, FormSelect, type FormSelectOption, SegmentedControl, type SegmentedControlOption, Switch} from "@notnotype/nb-ui/components";
import type {ComposerImageTransactionApi} from "../../components/novel-ide/agent/composables/useComposerImageTransaction";
import type {AgentPendingUserInputSession} from "../../components/novel-ide/agent/agent-message";
import {createAgentPendingResolutionDraft} from "../../components/novel-ide/agent/agent-pending-resolution";
import type {AgentComposerAvailability} from "../../components/novel-ide/agent/agent-chat-surface-state";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
import type {AgentQueuedMessageDto, AgentMode, AgentSessionAttachmentItemDto} from "nbook/shared/dto/agent-session.dto";
import type {PublicTextPreviewDto} from "nbook/shared/dto/agent-public-event.dto";
import LabFixtureControls from "../LabFixtureControls.vue";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentComposer>(() => props.input, ["send","steer","followup","stop","cycle-mode","submit-user-input","cancel-user-input","resync-user-input","toggle-session-model-popover","apply-session-model-settings","reset-session-model-settings","availability-action","update-session-model-selection"]);
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


const bindings = computed(() => subject.bindings.value);
const inputText = computed({get: () => bindings.value.inputText, set: value => subject.write("model", "inputText", value)});
const pendingResolutionDraft = computed({get: () => bindings.value.pendingResolutionDraft, set: value => subject.write("model", "pendingResolutionDraft", value)});
const sessionModelPopoverOpen = computed({get: () => bindings.value.sessionModelPopoverOpen, set: value => subject.write("model", "sessionModelPopoverOpen", value)});
const sessionModelDraft = computed({get: () => bindings.value.sessionModelDraft, set: value => subject.write("model", "sessionModelDraft", value)});
const running = computed({get: () => bindings.value.running, set: value => subject.write("props", "running", value)});
const agentMode = computed({get: () => bindings.value.agentMode, set: value => subject.write("props", "agentMode", value)});
const queuedMessages = computed({get: () => bindings.value.queuedMessages, set: value => subject.write("props", "queuedMessages", value)});
const pendingSessions = computed({get: () => bindings.value.pendingSessions, set: value => subject.write("props", "pendingSessions", value)});
const sessionAttachments = computed(() => bindings.value.sessionAttachments);
const showSpecialistInPicker = computed({get: () => bindings.value.showSpecialistInPicker ?? true, set: value => subject.write("props", "showSpecialistInPicker", value)});
const availabilityStatus = computed({get: () => bindings.value.availability.status, set: value => updateAvailability(value)});
function updateAvailability(status: AgentComposerAvailability["status"]): void {
    const availability: AgentComposerAvailability = status === "archived" ? {status, readonly: true, canRestore: true, canStop: false}
        : status === "load-error" || status === "profile-unavailable" ? {status, readonly: true, message: "同步会话记录超时，网络连接已中断。", canStop: false}
            : status === "ready" ? {status, readonly: false, canStop: false}
                : {status, readonly: true, canStop: false};
    subject.write("props", "availability", availability);
    subject.write("props", "canRegisterAttachments", !availability.readonly);
    subject.write("props", "canInsertAttachments", !availability.readonly);
}
// 模拟纯内存图片 API（无网络 IO）
const mockImageApi: ComposerImageTransactionApi = {
    async uploadSessionAttachment(sessionId: number, file: File) {
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


function handleSend(): void {
    if (inputText.value.trim()) {running.value = true; inputText.value = "";}
}
function handleStop(): void {running.value = false;}
function handleCycleMode(): void {agentMode.value = agentMode.value === "normal" ? "discuss" : agentMode.value === "discuss" ? "plan" : "normal";}
function handleAddQueue(): void {
    const nextIdx = queuedMessages.value.length + 1;
    queuedMessages.value = [...queuedMessages.value, {id: `queue-${Date.now()}`, clientMessageId: `cm-${Date.now()}`, kind: "followup", text: labTextPreview(`新增排队指令 #${nextIdx}：补充场景雨声渲染`), images: [], omittedImages: 0, createdAt: Date.now()}];
}
function handleClearQueue(): void {queuedMessages.value = [];}
function handleTogglePrompt(): void {
    if (pendingSessions.value.length) {pendingSessions.value = []; pendingResolutionDraft.value = createAgentPendingResolutionDraft([]); return;}
    const session: AgentPendingUserInputSession = {assistantMessageId: "msg-prompt-toggle", status: "pending", questions: [{toolNodeId: `node-${Date.now()}`, questionIndex: 0, toolCallId: `call-${Date.now()}`, toolName: "request_user_input", kind: "question", question: "模拟 Agent 提问：是否允许配角艾德温提前暴露身份？", options: [{label: "允许（加速情节爆点）"}, {label: "隐藏（保留后续反转空间）"}]}]};
    pendingSessions.value = [session]; pendingResolutionDraft.value = createAgentPendingResolutionDraft([session]);
}
</script>
<template>
    <div class="flex h-full min-h-0 w-full flex-col justify-end p-4">
        <AgentComposer data-lab-subject class="w-full" v-bind="subject.bindings.value" :queued-messages="subject.bindings.value.queuedMessages as AgentQueuedMessageDto[]" :image-api="mockImageApi" :resolve-menu="resolveMenu"
            @send="handleSend" @stop="handleStop" @cycle-mode="handleCycleMode"
            @cancel-user-input="pendingSessions = []"
            @toggle-session-model-popover="sessionModelPopoverOpen = !sessionModelPopoverOpen"
            @apply-session-model-settings="sessionModelPopoverOpen = false"
            @update-session-model-selection="subject.write('props', 'sessionModelSelectionValue', $event)" />
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
                                @update:model-value="running = $event"
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
                                @update:model-value="showSpecialistInPicker = $event"
                            />
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Agent 模式:</span>
                        <SegmentedControl
                            :model-value="agentMode"
                            :options="agentModeOptions"
                            size="sm"
                            @update:model-value="(val) => { agentMode = val as AgentMode; }"
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
