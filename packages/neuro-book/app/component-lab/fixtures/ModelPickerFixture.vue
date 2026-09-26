<script setup lang="ts">
import {ref, computed, watch} from "vue";
import {Switch, SegmentedControl} from "@notnotype/nb-ui/components";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import ModelPickerContent from "../../components/novel-ide/model-picker/ModelPickerContent.vue";
import ModelPickerPopover from "../../components/novel-ide/model-picker/ModelPickerPopover.vue";
import type {
    ModelPickerModelItem,
    ModelPickerRoleItem,
} from "../../components/novel-ide/model-picker/model-picker.types";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

// 模拟梯度轴角色 (固定 4 档)
const GRADIENT_ROLES: ModelPickerRoleItem[] = [
    {
        id: "tiny",
        axis: "gradient",
        name: "极轻量",
        description: "会话标题、简单打标、轻量检索",
        modelKey: "deepseek/deepseek-chat",
        modelLabel: "DeepSeek V3",
        iconClass: "i-lucide-feather",
        enabled: true,
    },
    {
        id: "fast",
        axis: "gradient",
        name: "快速",
        description: "日常问答、快速搜索、简单改写",
        modelKey: "openai/gpt-4o-mini",
        modelLabel: "GPT-4o mini",
        iconClass: "i-lucide-zap",
        enabled: true,
    },
    {
        id: "main",
        axis: "gradient",
        name: "主力",
        description: "主会话、综合分析、长篇写作",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet (Hybrid)",
        iconClass: "i-lucide-star",
        enabled: true,
    },
    {
        id: "deep",
        axis: "gradient",
        name: "深度",
        description: "复杂规划、难点分析、深度推理",
        modelKey: "deepseek/deepseek-reasoner",
        modelLabel: "DeepSeek R1 (Reasoning)",
        iconClass: "i-lucide-brain",
        enabled: true,
    },
];

// 恰好 4 个专精角色（验证 <=4 时直接采用网格无滚动条）
const DEFAULT_SPECIALIST_ROLES: ModelPickerRoleItem[] = [
    {
        id: "writer",
        axis: "specialist",
        name: "写作",
        description: "小说正文与段落润色",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet",
        iconClass: "i-lucide-pen-line",
        enabled: true,
    },
    {
        id: "narrative",
        axis: "specialist",
        name: "叙事",
        description: "剧情设计与伏笔规划",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet",
        iconClass: "i-lucide-book-open",
        enabled: true,
    },
    {
        id: "plan",
        axis: "specialist",
        name: "计划",
        description: "进入计划模式后自动切换",
        modelKey: "openai/gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-map",
        enabled: true,
    },
    {
        id: "vision",
        axis: "specialist",
        name: "视觉",
        description: "图像与多模态插画理解",
        modelKey: "openai/gpt-4o",
        modelLabel: "GPT-4o Omnimodal",
        iconClass: "i-lucide-eye",
        enabled: true,
    },
];

// 扩充专精角色 (6 个，验证 >4 时的横向滑动浏览)
const EXTENDED_SPECIALIST_ROLES: ModelPickerRoleItem[] = [
    ...DEFAULT_SPECIALIST_ROLES,
    {
        id: "polish",
        axis: "specialist",
        name: "润色",
        description: "词句精修与文风调和",
        modelKey: "anthropic/claude-3-7-sonnet",
        modelLabel: "Claude 3.7 Sonnet",
        iconClass: "i-lucide-wand-sparkles",
        enabled: true,
    },
    {
        id: "lore",
        axis: "specialist",
        name: "设定",
        description: "世界观与人物小传一致性校验",
        modelKey: "deepseek/deepseek-chat",
        modelLabel: "DeepSeek V3",
        iconClass: "i-lucide-scroll",
        enabled: true,
    },
];

const mockRoles = ref<ModelPickerRoleItem[]>([
    ...GRADIENT_ROLES,
    ...DEFAULT_SPECIALIST_ROLES,
]);

// 模拟物理模型列表
const mockModels = ref<ModelPickerModelItem[]>([
    {
        key: "anthropic/claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet (Hybrid)",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-3-7-sonnet",
        input: ["text", "image"],
        contextWindowTokens: 200000,
        pricing: "$3.00 / $15.00",
        reasoning: true,
    },
    {
        key: "anthropic/claude-3-5-haiku",
        label: "Claude 3.5 Haiku",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-3-5-haiku",
        input: ["text"],
        contextWindowTokens: 200000,
        pricing: "$0.80 / $4.00",
    },
    {
        key: "openai/gpt-4o",
        label: "GPT-4o Omnimodal",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-4o",
        input: ["text", "image"],
        contextWindowTokens: 128000,
        pricing: "$2.50 / $10.00",
    },
    {
        key: "openai/gpt-4o-mini",
        label: "GPT-4o mini",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-4o-mini",
        input: ["text", "image"],
        contextWindowTokens: 128000,
        pricing: "$0.15 / $0.60",
    },
    {
        key: "openai/o3-mini",
        label: "o3-mini (High Reasoning)",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "o3-mini",
        input: ["text"],
        contextWindowTokens: 200000,
        pricing: "$1.10 / $4.40",
        reasoning: true,
    },
    {
        key: "deepseek/deepseek-chat",
        label: "DeepSeek V3",
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-chat",
        input: ["text"],
        contextWindowTokens: 64000,
        pricing: "$0.14 / $0.28",
    },
    {
        key: "deepseek/deepseek-reasoner",
        label: "DeepSeek R1 (Reasoning)",
        providerId: "deepseek",
        providerName: "DeepSeek",
        modelId: "deepseek-reasoner",
        input: ["text"],
        contextWindowTokens: 64000,
        pricing: "$0.55 / $2.19",
        reasoning: true,
    },
]);

export interface ModelPickerFixtureData {
    selectedValue?: string;
    thinkingLevel?: ThinkingLevelDto | null;
    showSpecialist?: boolean;
    popoverOpen?: boolean;
    roles?: ModelPickerRoleItem[];
    models?: ModelPickerModelItem[];
}

const popoverOpen = ref(true);
const selectedValue = ref<string>("role:main");
const selectedThinkingLevel = ref<ThinkingLevelDto | null>(null);
const showSpecialist = ref(true);
const viewMode = ref<"popover" | "content">("popover");

function applySceneAndData(scene: string, rawData: unknown): void {
    const data = (rawData && typeof rawData === "object" ? rawData : {}) as ModelPickerFixtureData;

    // 1. 视口展示模式同步
    if (scene === "content-only") {
        viewMode.value = "content";
    } else {
        viewMode.value = "popover";
    }

    // 2. 字段响应式同步（优先从 props.data 读取并热更新，缺省回退场景预设）
    if (data.selectedValue !== undefined) {
        selectedValue.value = data.selectedValue;
    } else if (scene === "specialist-enabled") {
        selectedValue.value = "role:writer";
    } else if (scene === "gradient-only") {
        selectedValue.value = "role:fast";
    } else {
        selectedValue.value = "role:main";
    }

    if (data.thinkingLevel !== undefined) {
        selectedThinkingLevel.value = data.thinkingLevel;
    } else if (scene === "content-only") {
        selectedThinkingLevel.value = "medium";
    } else if (scene === "specialist-enabled") {
        selectedThinkingLevel.value = "high";
    } else if (scene === "gradient-only") {
        selectedThinkingLevel.value = "off";
    } else {
        selectedThinkingLevel.value = null;
    }

    if (data.showSpecialist !== undefined) {
        showSpecialist.value = data.showSpecialist;
    } else if (scene === "gradient-only") {
        showSpecialist.value = false;
    } else {
        showSpecialist.value = true;
    }

    if (data.popoverOpen !== undefined) {
        popoverOpen.value = data.popoverOpen;
    } else {
        popoverOpen.value = true;
    }

    if (Array.isArray(data.roles) && data.roles.length > 0) {
        mockRoles.value = data.roles;
    } else if (scene === "specialist-enabled" || scene === "content-only") {
        mockRoles.value = [...GRADIENT_ROLES, ...EXTENDED_SPECIALIST_ROLES];
    } else {
        mockRoles.value = [...GRADIENT_ROLES, ...DEFAULT_SPECIALIST_ROLES];
    }
    if (Array.isArray(data.models) && data.models.length > 0) {
        mockModels.value = data.models;
    }
}

watch(
    [() => props.scene, () => props.data],
    ([scene, data]) => {
        applySceneAndData(scene, data);
    },
    {immediate: true, deep: true},
);

function handleSelect(val: string, item: unknown) {
    selectedValue.value = val;
    emitLabEvent("select", {val, item});
    const isRole = val.startsWith("role:") || (typeof item === "object" && item !== null && "axis" in item);
    if (!isRole && viewMode.value === "popover") {
        popoverOpen.value = false;
    }
}

function handleThinkingLevelUpdate(level: ThinkingLevelDto | null) {
    selectedThinkingLevel.value = level;
    emitLabEvent("update:thinkingLevel", level);
}
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-1">
        <!-- 模式一：嵌入式直接展示 ModelPickerContent -->
        <div
            v-if="viewMode === 'content'"
            data-lab-subject
            class="flex flex-col items-center shadow-xl w-full"
        >
            <ModelPickerContent
                v-model:model-value="selectedValue"
                v-model:thinking-level="selectedThinkingLevel"
                :roles="mockRoles"
                :models="mockModels"
                :show-specialist-in-picker="showSpecialist"
                :standalone="true"
                width-class="w-full"
                @update:model-value="emitLabEvent('update:modelValue', $event)"
                @update:thinking-level="handleThinkingLevelUpdate"
                @select="handleSelect"
                @close="emitLabEvent('close')"
            />
        </div>

        <!-- 模式二：Popover 弹出式形态展示 -->
        <div
            v-else
            data-lab-subject
            class="flex flex-col items-center gap-4 min-h-[500px] w-full"
        >
            <div class="text-xs text-[var(--text-secondary)]">
                当前选中: <code class="rounded bg-[var(--bg-code)] px-1.5 py-0.5 font-mono text-[var(--text-main)]">{{ selectedValue }}</code>
                <span class="mx-2 text-[var(--border-color)]">|</span>
                思考等级: <code class="rounded bg-[var(--bg-code)] px-1.5 py-0.5 font-mono text-[var(--text-main)]">{{ selectedThinkingLevel ?? "跟随设定 (null)" }}</code>
            </div>

            <ModelPickerPopover
                v-model:open="popoverOpen"
                v-model:model-value="selectedValue"
                v-model:thinking-level="selectedThinkingLevel"
                :roles="mockRoles"
                :models="mockModels"
                :show-specialist-in-picker="showSpecialist"
                direction="down"
                align="center"
                trigger-class="w-[280px]"
                picker-width-class="w-[620px] max-w-[calc(100vw-32px)]"
                @update:model-value="emitLabEvent('update:modelValue', $event)"
                @update:thinking-level="handleThinkingLevelUpdate"
                @select="handleSelect"
            />
        </div>
    </div>

    <!-- 底部控制抽屉 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-4 py-1 text-xs select-none">
            <div class="flex items-center gap-3">
                <span class="font-medium text-[var(--text-secondary)]">展示形态:</span>
                <SegmentedControl
                    :model-value="viewMode"
                    :options="[
                        {value: 'popover', label: 'Popover 弹出层'},
                        {value: 'content', label: '直接嵌入 Content'},
                    ]"
                    size="sm"
                    @update:model-value="(val) => viewMode = val as any"
                />
            </div>

            <div class="flex items-center gap-3">
                <span class="font-medium text-[var(--text-secondary)]">专精轴角色:</span>
                <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                    <span class="text-[11px] text-[var(--text-main)]">{{ showSpecialist ? "显示" : "隐藏" }}</span>
                    <Switch
                        :model-value="showSpecialist"
                        size="sm"
                        aria-label="切换专精轴角色"
                        @update:model-value="showSpecialist = $event"
                    />
                </div>
            </div>

            <div v-if="viewMode === 'popover'" class="flex items-center gap-3">
                <span class="font-medium text-[var(--text-secondary)]">弹层开关:</span>
                <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                    <span class="text-[11px] text-[var(--text-main)]">{{ popoverOpen ? "打开" : "关闭" }}</span>
                    <Switch
                        :model-value="popoverOpen"
                        size="sm"
                        aria-label="切换弹层打开状态"
                        @update:model-value="popoverOpen = $event"
                    />
                </div>
            </div>
        </div>
    </LabFixtureControls>
</template>
