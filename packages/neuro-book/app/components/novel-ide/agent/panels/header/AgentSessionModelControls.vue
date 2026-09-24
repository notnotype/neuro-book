<script setup lang="ts">
import ModelPickerPopover from "nbook/app/components/novel-ide/model-picker/ModelPickerPopover.vue";
import type {ModelPickerModelItem, ModelPickerRoleItem} from "nbook/app/components/novel-ide/model-picker/model-picker.types";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {EnabledModelOptionDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";

const props = withDefaults(defineProps<{
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel?: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    sessionModelSaving: boolean;
    sessionModelPopoverOpen?: boolean;
    readonly?: boolean;
    running?: boolean;
    loadingSession?: boolean;
    roles?: ModelPickerRoleItem[];
    showSpecialistInPicker?: boolean;
    size?: "default" | "sm";
    dropdownDirection?: "auto" | "down" | "up";
    rootClass?: string;
    popoverClass?: string;
}>(), {
    sessionThinkingResolvedLabel: "",
    sessionModelPopoverOpen: false,
    roles: () => [],
    showSpecialistInPicker: false,
    readonly: false,
    running: false,
    loadingSession: false,
    size: "sm",
    dropdownDirection: "auto",
    rootClass: "w-auto",
    popoverClass: "w-[360px]",
});

const emit = defineEmits<{
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
}>();

const controlsRef = ref<HTMLElement | null>(null);
const {t} = useI18n();

const actionDisabled = computed(() => props.readonly || props.running || props.loadingSession || props.sessionModelSaving);

/**
 * 更新当前 session 模型参数草稿。
 */
function updateSessionModelDraft(patch: Partial<AgentSessionModelDraft>): void {
    emit("update:sessionModelDraft", {
        ...props.sessionModelDraft,
        ...patch,
    });
}

const internalPickerOpen = ref(false);
const modelPickerOpen = computed({
    get: () => props.sessionModelPopoverOpen ?? internalPickerOpen.value,
    set: (val: boolean) => {
        internalPickerOpen.value = val;
        emit("update:sessionModelPopoverOpen", val);
    },
});

const pickerModels = computed<ModelPickerModelItem[]>(() => {
    return props.selectableModels.map((model) => ({
        key: model.key,
        label: model.label,
        providerId: model.providerId,
        modelId: model.modelId,
        input: model.input as ("text" | "image")[],
        contextWindowTokens: model.contextWindowTokens,
        reasoning: model.label.toLowerCase().includes("reason")
            || model.modelId.toLowerCase().includes("r1")
            || model.modelId.toLowerCase().includes("o1")
            || model.modelId.toLowerCase().includes("o3")
            || model.modelId.toLowerCase().includes("thinking")
            || model.modelId.toLowerCase().includes("hybrid"),
    }));
});

const defaultRoles = computed<ModelPickerRoleItem[]>(() => {
    if (props.roles && props.roles.length > 0) {
        return props.roles;
    }
    const m0 = props.selectableModels[0];
    const m1 = props.selectableModels[1] ?? m0;
    const visionModel = props.selectableModels.find((m) => m.input?.includes("image"));
    return [
        {
            id: "tiny",
            axis: "gradient",
            name: "极轻量",
            description: "会话标题、简单打标、轻量检索",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-feather",
            enabled: true,
        },
        {
            id: "fast",
            axis: "gradient",
            name: "快速",
            description: "日常问答、快速搜索、简单改写",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-zap",
            enabled: true,
        },
        {
            id: "main",
            axis: "gradient",
            name: "主力",
            description: "主会话、综合分析、长篇写作",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-star",
            enabled: true,
        },
        {
            id: "deep",
            axis: "gradient",
            name: "深度",
            description: "复杂规划、难点分析、深度推理",
            modelKey: m1?.key ?? null,
            modelLabel: m1?.label,
            iconClass: "i-lucide-brain",
            enabled: true,
        },
        {
            id: "writer",
            axis: "specialist",
            name: "写作",
            description: "小说正文与段落润色",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-pen-line",
            enabled: true,
        },
        {
            id: "narrative",
            axis: "specialist",
            name: "叙事",
            description: "剧情设计与伏笔规划",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-book-open",
            enabled: true,
        },
        {
            id: "plan",
            axis: "specialist",
            name: "计划",
            description: "进入计划模式后切换的模型",
            modelKey: m0?.key ?? null,
            modelLabel: m0?.label,
            iconClass: "i-lucide-map",
            enabled: true,
        },
        {
            id: "vision",
            axis: "specialist",
            name: "视觉",
            description: "图像与多模态插画理解",
            modelKey: visionModel?.key ?? null,
            modelLabel: visionModel?.label,
            iconClass: "i-lucide-eye",
            enabled: true,
        },
    ];
});

function handleModelSelect(value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void {
    if ("modelKey" in item && item.modelKey) {
        emit("update-session-model-selection", item.modelKey);
    } else {
        emit("update-session-model-selection", value);
    }
}

function handleThinkingLevelUpdate(level: ThinkingLevelDto | null): void {
    updateSessionModelDraft({ reasoningEffort: level });
    emit("apply-session-model-settings");
}

const effectivePopoverClass = computed(() => {
    const list: string[] = [];
    if (props.dropdownDirection === "up") {
        list.push("-left-2");
    }
    if (props.popoverClass && props.popoverClass !== "w-[360px]") {
        list.push(props.popoverClass);
    }
    return list.join(" ");
});
</script>

<template>
    <!-- Agent Session 模型选择面板 -->
    <div ref="controlsRef" class="relative flex min-w-0 items-center" :class="props.rootClass">
        <ModelPickerPopover
            v-model:open="modelPickerOpen"
            :model-value="props.sessionModelSelectionValue"
            :roles="defaultRoles"
            :models="pickerModels"
            :show-specialist-in-picker="props.showSpecialistInPicker"
            :disabled="actionDisabled"
            :direction="props.dropdownDirection"
            :thinking-level="props.sessionModelDraft.reasoningEffort"
            trigger-class="w-full"
            :popover-class="effectivePopoverClass"
            @select="handleModelSelect"
            @update:thinking-level="handleThinkingLevelUpdate"
        />
    </div>
</template>
