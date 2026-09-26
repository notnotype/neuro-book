<script setup lang="ts">
import {computed, ref, onMounted, onUnmounted, nextTick, watch} from "vue";
import {SegmentedControl, Slider} from "@notnotype/nb-ui/components";
import type {SegmentedControlOption} from "@notnotype/nb-ui/components";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {
    ModelPickerModelItem,
    ModelPickerRoleItem,
    ModelPickerProviderGroup,
    ModelPickerSelectionValue,
} from "./model-picker.types";

const props = withDefaults(defineProps<{
    /** 当前选中值，支持 `role:<roleId>` 或具体的 `<modelKey>` */
    modelValue: ModelPickerSelectionValue;
    /** 模型角色列表（梯度轴 + 专精轴） */
    roles?: ModelPickerRoleItem[];
    /** 可选的物理模型列表 */
    models: ModelPickerModelItem[];
    /** 是否在选择器中展示专精轴（受控于设置中的偏好） */
    showSpecialistInPicker?: boolean;
    /** 当前会话的思考等级 */
    thinkingLevel?: ThinkingLevelDto | null;
    /** 容器宽度类名或内联样式控制 */
    widthClass?: string;
    /** 容器高度类名（保持完全固定尺寸，避免切换内容时跳动） */
    heightClass?: string;
    /** 是否为独立渲染（独立渲染时自带面板外边框与底色，浮层内嵌时由 .nb-ui-popover-surface 统一托管） */
    standalone?: boolean;
}>(), {
    roles: () => [],
    showSpecialistInPicker: false,
    thinkingLevel: null,
    widthClass: "w-[620px] max-w-[calc(100vw-32px)]",
    heightClass: "h-[440px]",
    standalone: false,
});

const effectiveHeightClass = computed(() => {
    if (props.heightClass && props.heightClass !== "h-[440px]") {
        return props.heightClass;
    }
    return props.showSpecialistInPicker ? (props.heightClass || "h-[440px]") : "h-[330px]";
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:thinkingLevel", value: ThinkingLevelDto | null): void;
    (e: "select", value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void;
    (e: "close"): void;
}>();

const {t} = useI18n();
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchQuery = ref("");
const activeFilter = ref<"roles" | "models">("roles");
const hoveredKey = ref<string | null>(null);
const expandedProviders = ref<Record<string, boolean>>({});

// 思考等级档位定义
const THINKING_LEVELS: Array<{value: ThinkingLevelDto | null; label: string; short: string; desc: string}> = [
    {value: null, label: "跟随设定", short: "跟随", desc: "遵循角色的默认设定"},
    {value: "off", label: "关闭思考", short: "关闭", desc: "不执行推理思考"},
    {value: "minimal", label: "极低强度", short: "极低", desc: "微量推理"},
    {value: "low", label: "低强度", short: "低", desc: "轻度思考与规划"},
    {value: "medium", label: "中等强度", short: "中", desc: "标准分析与推理"},
    {value: "high", label: "高强度", short: "高", desc: "深度逻辑与构思"},
    {value: "xhigh", label: "极高强度", short: "极高", desc: "复杂长篇推演"},
    {value: "max", label: "最大满载", short: "最大", desc: "全算力满载推理"},
];

const localThinkingLevel = ref<ThinkingLevelDto | null>(props.thinkingLevel);

watch(() => props.thinkingLevel, (newVal) => {
    localThinkingLevel.value = newVal;
});

const currentThinkingIndex = computed(() => {
    const idx = THINKING_LEVELS.findIndex((item) => item.value === localThinkingLevel.value);
    return idx >= 0 ? idx : 0;
});

const currentThinkingItem = computed(() => THINKING_LEVELS[currentThinkingIndex.value] ?? THINKING_LEVELS[0]!);

function handleThinkingSliderUpdate(val: number | number[]): void {
    const idx = typeof val === "number" ? val : val[0] ?? 0;
    const chosen = THINKING_LEVELS[idx];
    if (chosen !== undefined) {
        localThinkingLevel.value = chosen.value;
        emit("update:thinkingLevel", chosen.value);
    }
}

function selectThinkingLevel(val: ThinkingLevelDto | null): void {
    localThinkingLevel.value = val;
    emit("update:thinkingLevel", val);
}

// 梯度轴角色（固定 4 档，始终展示）
const gradientRoles = computed(() =>
    props.roles.filter((r) => r.axis === "gradient" && r.enabled !== false));

// 专精轴角色（根据配置展示已启用的角色）
const specialistRoles = computed(() => {
    if (!props.showSpecialistInPicker) return [];
    return props.roles.filter((r) => r.axis === "specialist" && r.enabled !== false);
});

// 解析模型所属的 Provider 标签或名称
function resolveProviderName(model: ModelPickerModelItem): string {
    if (model.providerName) return model.providerName;
    const parts = model.key.split("/");
    if (parts.length > 1 && parts[0]) {
        return parts[0].toUpperCase();
    }
    return model.providerId.toUpperCase();
}

// 格式化 Context window 显示（如 200k, 1M）
function formatContextWindow(tokens?: number | null): string {
    if (!tokens || tokens <= 0) return "-";
    if (tokens >= 1_000_000) {
        const m = tokens / 1_000_000;
        return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}k ctx`;
    }
    return `${tokens} ctx`;
}

// 格式化计费信息
function formatCost(model: ModelPickerModelItem): string {
    if (model.pricing) return model.pricing;
    const cost = model.cost;
    if (!cost || (cost.input === undefined && cost.output === undefined)) {
        return "免费 / 本地";
    }
    const input = cost.input !== undefined ? `$${cost.input}` : "$0";
    const output = cost.output !== undefined ? `$${cost.output}` : "$0";
    return `${input} / ${output}`;
}

// 角色 Tab 不需要搜索框，直接展示所有角色
const filteredGradientRoles = computed(() => gradientRoles.value);
const filteredSpecialistRoles = computed(() => specialistRoles.value);

// 搜索过滤模型
const filteredModels = computed(() => {
    if (!searchQuery.value.trim()) return props.models;
    const query = searchQuery.value.toLowerCase().trim();
    return props.models.filter((model) => {
        const nameMatch = model.label.toLowerCase().includes(query);
        const idMatch = model.modelId.toLowerCase().includes(query) || model.key.toLowerCase().includes(query);
        const providerMatch = model.providerId.toLowerCase().includes(query) || (model.providerName && model.providerName.toLowerCase().includes(query));
        const hasReasoning = query === "reasoning" && Boolean(model.reasoning);
        const hasVision = (query === "vision" || query === "image") && model.input.includes("image");
        return nameMatch || idMatch || providerMatch || hasReasoning || hasVision;
    });
});

// 将过滤后的模型按 Provider 分组
const providerGroups = computed<ModelPickerProviderGroup[]>(() => {
    const groupsMap = new Map<string, {name: string; models: ModelPickerModelItem[]}>();

    for (const model of filteredModels.value) {
        const providerId = model.providerId || "other";
        const providerName = resolveProviderName(model);
        if (!groupsMap.has(providerId)) {
            groupsMap.set(providerId, {name: providerName, models: []});
        }
        groupsMap.get(providerId)!.models.push(model);
    }

    return Array.from(groupsMap.entries()).map(([providerId, data]) => ({
        providerId,
        providerName: data.name,
        models: data.models,
    }));
});

// 判断某个项是否当前激活
function isRoleActive(role: ModelPickerRoleItem): boolean {
    if (props.modelValue === `role:${role.id}`) return true;
    if (role.modelKey && props.modelValue === role.modelKey) return true;
    return false;
}

function isModelActive(model: ModelPickerModelItem): boolean {
    return props.modelValue === model.key || props.modelValue === model.modelId;
}

// 选中某个角色（不自动关闭，方便用户查看绑定模型与调整思考等级）
function selectRole(role: ModelPickerRoleItem): void {
    const value = `role:${role.id}`;
    emit("update:modelValue", value);
    emit("select", value, role);
}

// 选中某个模型
function selectModel(model: ModelPickerModelItem): void {
    emit("update:modelValue", model.key);
    emit("select", model.key, model);
    emit("close");
}

// 折叠/展开 Provider 组
function toggleProvider(providerId: string): void {
    expandedProviders.value[providerId] = !isProviderExpanded(providerId);
}

function isProviderExpanded(providerId: string): boolean {
    if (expandedProviders.value[providerId] !== undefined) {
        return expandedProviders.value[providerId]!;
    }
    // 默认展开所有组
    return true;
}

// 专精角色是否需要横向滚动：当数量大于 4 时启用横向滚动，恰好 <= 4 个时直接采用 4 列等宽网格排布
const isSpecialistScrollable = computed(() => filteredSpecialistRoles.value.length > 4);

let targetScrollLeft = 0;
let wheelRafId: number | null = null;
let currentScrollElement: HTMLElement | null = null;

/**
 * 专精角色横向滚动辅助：
 * 采用 rAF 指数插值缓动，将 Windows 鼠标滚轮离散突兀的 100px 阶梯跳动转化为丝滑流畅的连续滑动；
 * 到达最左/最右边界时自动放行默认行为，使页面或父容器能继续正常纵向滚动。
 */
function handleSpecialistWheel(event: WheelEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) return;

    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;

    // 若当前输入为横向主导（如 MacBook 触控板横向划动），让浏览器原生高频平滑处理
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

    const delta = event.deltaY;
    const canScrollLeft = delta < 0 && el.scrollLeft > 0;
    const canScrollRight = delta > 0 && el.scrollLeft < maxScroll - 1;

    // 边界放行：到达边界不再拦截，交由外层纵向滚动
    if (!canScrollLeft && !canScrollRight) {
        return;
    }

    event.preventDefault();

    currentScrollElement = el;
    if (wheelRafId === null) {
        targetScrollLeft = el.scrollLeft;
    }

    // 累加滚轮目标并限制在 [0, maxScroll] 范围内
    targetScrollLeft = Math.max(0, Math.min(maxScroll, targetScrollLeft + delta * 0.9));

    function step() {
        if (!currentScrollElement) {
            wheelRafId = null;
            return;
        }
        const diff = targetScrollLeft - currentScrollElement.scrollLeft;
        if (Math.abs(diff) < 0.6) {
            currentScrollElement.scrollLeft = targetScrollLeft;
            wheelRafId = null;
            return;
        }
        // 缓动阻尼系数 0.22：兼顾敏捷响应与丝滑制动
        currentScrollElement.scrollLeft += diff * 0.22;
        wheelRafId = requestAnimationFrame(step);
    }

    if (wheelRafId === null) {
        wheelRafId = requestAnimationFrame(step);
    }
}

// 专精角色鼠标直接拖拽滚动（Drag to scroll）
let isDragging = false;
let dragStartX = 0;
let dragInitialScrollLeft = 0;
let hasDraggedDistance = false;

function handleSpecialistPointerDown(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (event.button !== 0) return;

    isDragging = true;
    hasDraggedDistance = false;
    dragStartX = event.clientX;
    dragInitialScrollLeft = el.scrollLeft;
    try {
        el.setPointerCapture(event.pointerId);
    } catch {}
}

function handleSpecialistPointerMove(event: PointerEvent): void {
    if (!isDragging) return;
    const el = event.currentTarget as HTMLElement | null;
    if (!el) return;

    const deltaX = event.clientX - dragStartX;
    if (Math.abs(deltaX) > 4) {
        hasDraggedDistance = true;
    }
    el.scrollLeft = dragInitialScrollLeft - deltaX;
}

function handleSpecialistPointerUp(event: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    const el = event.currentTarget as HTMLElement | null;
    if (el) {
        try {
            el.releasePointerCapture(event.pointerId);
        } catch {}
    }
}

function handleSpecialistCardClick(event: MouseEvent, role: ModelPickerRoleItem): void {
    if (hasDraggedDistance) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    selectRole(role);
}

onUnmounted(() => {
    if (wheelRafId !== null) {
        cancelAnimationFrame(wheelRafId);
        wheelRafId = null;
    }
});

// 顶部共享区域：当前选中模型 / 角色的核心详细展示（占大头）
const activeSelectionDetails = computed(() => {
    const targetKey = props.modelValue;
    if (!targetKey) {
        return {
            type: "none" as const,
            title: "未选择模型",
            badge: "未指定",
            icon: "i-lucide-help-circle",
            detail: "请在下方梯度角色、专精角色或所有模型库中选择",
        };
    }

    if (targetKey.startsWith("role:")) {
        const roleId = targetKey.replace("role:", "");
        const role = props.roles.find((r) => r.id === roleId);
        if (role) {
            const bound = role.modelLabel || role.modelKey || "未配置绑定模型";
            return {
                type: "role" as const,
                title: role.name,
                badge: role.axis === "gradient" ? "梯度角色" : "专精角色",
                icon: role.iconClass || (role.axis === "gradient" ? "i-lucide-star" : "i-lucide-sparkles"),
                detail: `${role.description} · 绑定模型: ${bound}`,
                boundModel: bound,
            };
        }
    }

    const model = props.models.find((m) => m.key === targetKey || m.modelId === targetKey);
    if (model) {
        const capabilities: string[] = [];
        if (model.reasoning) capabilities.push("Reasoning");
        if (model.input.includes("image")) capabilities.push("Vision");
        capabilities.push(formatContextWindow(model.contextWindowTokens));
        capabilities.push(formatCost(model));

        return {
            type: "model" as const,
            title: model.label,
            badge: resolveProviderName(model),
            icon: model.reasoning ? "i-lucide-sparkles" : (model.input.includes("image") ? "i-lucide-eye" : "i-lucide-cpu"),
            detail: `${model.modelId} · ${capabilities.join(" · ")}`,
            boundModel: model.label,
        };
    }

    return {
        type: "custom" as const,
        title: targetKey,
        badge: "模型",
        icon: "i-lucide-cpu",
        detail: "自定义会话指定物理模型",
        boundModel: targetKey,
    };
});

const filterTabOptions: SegmentedControlOption[] = [
    {value: "roles", label: "角色"},
    {value: "models", label: "模型库"},
];

const slideDirection = ref<"left" | "right">("left");
const mainScrollRef = ref<HTMLElement | null>(null);

watch(activeFilter, (newVal, oldVal) => {
    if (newVal === "models" && oldVal === "roles") {
        slideDirection.value = "left";
        void nextTick(() => {
            searchInputRef.value?.focus();
        });
    } else if (newVal === "roles" && oldVal === "models") {
        slideDirection.value = "right";
    }
    if (mainScrollRef.value) {
        mainScrollRef.value.scrollTop = 0;
    }
});

onMounted(() => {
    void nextTick(() => {
        searchInputRef.value?.focus();
    });
});
</script>

<template>
    <div
        class="model-picker-root flex flex-col overflow-hidden text-[var(--text-main)]"
        :class="[
            props.widthClass,
            effectiveHeightClass,
            props.standalone
                ? 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]'
                : 'rounded-[inherit] bg-transparent',
        ]"
    >
        <!-- 1. 顶部共享核心区：当前生效模型 + 思考等级（共享且高度恒定，彻底避免换页抖动） -->
        <header class="flex shrink-0 flex-col gap-2.5 border-b border-[var(--divider,var(--border-color))] p-3">
            <!-- 1.1 顶部栏：标题与 Tab 切换 -->
            <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 text-xs font-semibold tracking-wide text-[var(--text-main)]">会话模型设定</span>
                    <span class="truncate rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        会话独立生效 · 默认设定不受影响
                    </span>
                </div>
                <!-- 切换选项卡：角色 vs 模型库 (复用 nb-ui 官方 SegmentedControl，内置平滑滑动指示块动效) -->
                <SegmentedControl
                    :model-value="activeFilter"
                    :options="filterTabOptions"
                    size="xs"
                    class="w-[124px] shrink-0"
                    @update:model-value="(val) => (activeFilter = val as 'roles' | 'models')"
                />
            </div>

            <!-- 1.2 核心展示卡片：当前生效模型 (共享且占注意力大头) -->
            <div class="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-input))] px-3 py-2">
                <div class="flex min-w-0 flex-1 items-center gap-2.5">
                    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)-2px)] border border-[color:var(--control-outline,var(--border-color))] bg-[var(--bg-panel)] text-[var(--accent-text)]">
                        <span :class="activeSelectionDetails.icon" class="h-4 w-4"></span>
                    </div>
                    <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-xs font-semibold text-[var(--text-main)]">
                                {{ activeSelectionDetails.title }}
                            </span>
                            <span class="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--text-secondary)]">
                                {{ activeSelectionDetails.badge }}
                            </span>
                            <span class="shrink-0 text-[10px] text-[var(--status-success)]">
                                ● 当前生效
                            </span>
                        </div>
                        <div class="truncate text-[10px] text-[var(--text-muted)]">
                            {{ activeSelectionDetails.detail }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- 1.3 核心展示卡片：思考推理等级 (长滑块独占横向空间，纯粹现代，零文字冗余) -->
            <div class="flex items-center gap-3 rounded-[var(--radius-control)] border border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-input))] px-3 py-1.5">
                <!-- 左侧：图标 + 标题 + 当前等级徽标 (固定宽度 64px 防止字长跳变导致滑块抖动) -->
                <div class="flex shrink-0 items-center gap-1.5">
                    <span class="i-lucide-brain h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="shrink-0 text-xs font-medium text-[var(--text-main)]">思考等级</span>
                    <span class="inline-flex w-[64px] shrink-0 justify-center font-mono text-[11px] font-semibold text-[var(--accent-text)]">
                        [{{ currentThinkingItem.label }}]
                    </span>
                </div>

                <!-- 滑块轨道：弹性铺满整行右侧全部空间 -->
                <div class="flex min-w-[140px] flex-1 items-center px-1">
                    <Slider
                        :model-value="currentThinkingIndex"
                        :min="0"
                        :max="THINKING_LEVELS.length - 1"
                        :step="1"
                        size="sm"
                        aria-label="思考推理等级滑块"
                        class="w-full cursor-pointer"
                        @update:model-value="handleThinkingSliderUpdate"
                    />
                </div>
            </div>
        </header>

        <!-- 2. 内容滚动区：角色 Tab 严格禁用竖直滚动 (overflow-hidden)，模型库 Tab 启用 .nb-ui-popover-scroll 纵向滚动 -->
        <main
            ref="mainScrollRef"
            class="relative flex-1 min-h-0 p-3"
            :class="activeFilter === 'models' ? 'nb-ui-popover-scroll overflow-y-auto overflow-x-hidden' : 'overflow-hidden'"
        >
            <Transition :name="slideDirection === 'left' ? 'tab-slide-left' : 'tab-slide-right'">
                <!-- 2.1 角色 Tab (包含梯度轴 + 专精轴) -->
                <div v-if="activeFilter === 'roles'" key="tab-roles" class="tab-pane w-full space-y-2.5">
                    <!-- 角色梯度轴 (固定 4 档) -->
                    <section v-if="filteredGradientRoles.length > 0" class="space-y-1.5">
                        <div class="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-layers h-3 w-3 text-[var(--accent-text)]"></span>
                                模型角色梯度轴 (默认常驻)
                            </span>
                            <span class="text-[10px] text-[var(--text-muted)]">随用途自动调度</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <button
                                v-for="role in filteredGradientRoles"
                                :key="role.id"
                                type="button"
                                class="nb-ui-focus-ring group relative flex h-[78px] flex-col justify-between rounded-[var(--radius-control)] border p-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--bg-hover)]"
                                :class="isRoleActive(role)
                                    ? 'border-[var(--accent-main)] bg-[var(--overlay-item-active,color-mix(in_srgb,var(--accent-main)_10%,transparent))] shadow-[0_0_0_1px_var(--accent-main)]'
                                    : 'border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-panel))]'"
                                @click="selectRole(role)"
                                @mouseenter="hoveredKey = `role:${role.id}`"
                                @mouseleave="hoveredKey = null"
                            >
                                <div class="flex w-full items-center justify-between gap-1">
                                    <span class="flex items-center gap-1.5 font-medium text-xs text-[var(--text-main)] truncate">
                                        <span :class="role.iconClass || 'i-lucide-bot'" class="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                                        <span class="truncate">{{ role.name }}</span>
                                    </span>
                                    <span v-if="isRoleActive(role)" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                                </div>
                                <span class="truncate font-mono text-[10px] text-[var(--text-muted)]" :title="role.modelLabel || role.modelKey || '未配置'">
                                    {{ role.modelLabel || role.modelKey || '未配置' }}
                                </span>
                                <p class="truncate text-[10px] text-[var(--text-secondary)]" :title="role.description">
                                    {{ role.description }}
                                </p>
                            </button>
                        </div>
                    </section>

                    <!-- 2.2 角色专精轴 (<=4 个角色时直接 4 列等宽对齐无滚动条；>4 个时支持鼠标滚轮平滑缓动与直接拖拽) -->
                    <section v-if="filteredSpecialistRoles.length > 0" class="space-y-1.5">
                        <div class="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-sparkles h-3 w-3 text-[var(--accent-text)]"></span>
                                专精角色 (用户已开启展示)
                            </span>
                            <span v-if="isSpecialistScrollable" class="text-[10px] text-[var(--text-muted)]">横向滑动浏览</span>
                        </div>
                        <div
                            :class="[
                                isSpecialistScrollable
                                    ? 'flex gap-2 overflow-x-auto overscroll-x-contain pb-1.5 pt-0.5 [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--text-main)_20%,transparent)_transparent] cursor-grab active:cursor-grabbing select-none'
                                    : 'grid grid-cols-2 gap-2 sm:grid-cols-4',
                            ]"
                            @wheel="handleSpecialistWheel"
                            @pointerdown="handleSpecialistPointerDown"
                            @pointermove="handleSpecialistPointerMove"
                            @pointerup="handleSpecialistPointerUp"
                            @pointercancel="handleSpecialistPointerUp"
                        >
                            <button
                                v-for="role in filteredSpecialistRoles"
                                :key="role.id"
                                type="button"
                                class="nb-ui-focus-ring group relative flex h-[78px] flex-col justify-between rounded-[var(--radius-control)] border p-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--bg-hover)]"
                                :class="[
                                    isSpecialistScrollable ? 'w-[142px] shrink-0' : 'w-full',
                                    isRoleActive(role)
                                        ? 'border-[var(--accent-main)] bg-[var(--overlay-item-active,color-mix(in_srgb,var(--accent-main)_10%,transparent))] shadow-[0_0_0_1px_var(--accent-main)]'
                                        : 'border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-panel))]',
                                ]"
                                @click="handleSpecialistCardClick($event, role)"
                                @mouseenter="hoveredKey = `role:${role.id}`"
                                @mouseleave="hoveredKey = null"
                            >
                                <div class="flex w-full items-center justify-between gap-1">
                                    <span class="flex items-center gap-1.5 font-medium text-xs text-[var(--text-main)] truncate">
                                        <span :class="role.iconClass || 'i-lucide-shapes'" class="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                                        <span class="truncate">{{ role.name }}</span>
                                    </span>
                                    <span v-if="isRoleActive(role)" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                                </div>
                                <span class="truncate font-mono text-[10px] text-[var(--text-muted)]" :title="role.modelLabel || role.modelKey || '未配置'">
                                    {{ role.modelLabel || role.modelKey || '未配置' }}
                                </span>
                                <p class="truncate text-[10px] text-[var(--text-secondary)]" :title="role.description">
                                    {{ role.description }}
                                </p>
                            </button>
                        </div>
                    </section>
                </div>

                <!-- 2.3 所有物理模型库 (按 Provider 分组) -->
                <div v-else key="tab-models" class="tab-pane w-full space-y-2">
                    <!-- 搜索框：置于模型库顶部，输入即时过滤，具备 sticky 吸顶与自适应背景 -->
                    <div class="sticky top-0 z-10 -mx-3 -mt-3 mb-2 bg-[var(--bg-panel)] px-3 pt-3 pb-1 border-b border-[var(--divider,var(--border-color))]">
                        <div class="relative flex items-center">
                            <span class="i-lucide-search pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                            <input
                                ref="searchInputRef"
                                v-model="searchQuery"
                                type="text"
                                placeholder="搜索模型名称、ID、Provider 或 reasoning / vision..."
                                class="nb-ui-control h-8 w-full rounded-[var(--radius-control)] border border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-input))] pl-8 pr-7 text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none"
                                @keydown.esc.stop="emit('close')"
                            />
                            <button
                                v-if="searchQuery"
                                type="button"
                                class="nb-ui-focus-ring absolute right-2 flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-main)]"
                                @click="searchQuery = ''"
                            >
                                <span class="i-lucide-x h-3 w-3"></span>
                            </button>
                        </div>
                    </div>
                    <section class="space-y-2">
                        <div class="flex items-center justify-between text-[11px] font-medium text-[var(--text-muted)]">
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-cpu h-3 w-3 text-[var(--accent-text)]"></span>
                                所有模型库 ({{ filteredModels.length }})
                            </span>
                            <span class="text-[10px] text-[var(--text-muted)]">按 Provider 分类</span>
                        </div>

                        <div v-if="providerGroups.length === 0" class="py-8 text-center text-xs text-[var(--text-muted)]">
                            无匹配模型
                        </div>

                        <div v-for="group in providerGroups" :key="group.providerId" class="overflow-hidden rounded-[var(--radius-control)] border border-[color:var(--control-outline,var(--border-color))] bg-[var(--control-surface,var(--bg-panel))]">
                            <!-- Provider 组标题 -->
                            <button
                                type="button"
                                class="nb-ui-focus-ring flex w-full items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-hover)] px-3 py-1.5 text-left text-xs font-semibold text-[var(--text-main)] outline-none hover:bg-[color-mix(in_srgb,var(--bg-hover)_80%,var(--text-main))]"
                                @click="toggleProvider(group.providerId)"
                            >
                                <div class="flex items-center gap-2">
                                    <span class="i-lucide-server h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                    <span>{{ group.providerName }}</span>
                                    <span class="rounded bg-[var(--bg-panel)] px-1.5 py-0.2 text-[10px] font-normal text-[var(--text-muted)]">
                                        {{ group.models.length }}
                                    </span>
                                </div>
                                <span
                                    class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)]"
                                    :class="isProviderExpanded(group.providerId) ? 'rotate-0' : '-rotate-90'"
                                ></span>
                            </button>

                            <!-- Provider 内部模型列表 -->
                            <div v-if="isProviderExpanded(group.providerId)" class="divide-y divide-[var(--border-color)]">
                                <button
                                    v-for="model in group.models"
                                    :key="model.key"
                                    type="button"
                                    class="nb-ui-focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs outline-none transition-colors hover:bg-[var(--bg-hover)]"
                                    :class="isModelActive(model) ? 'bg-[var(--overlay-item-active,color-mix(in_srgb,var(--accent-main)_10%,transparent))]' : ''"
                                    @click="selectModel(model)"
                                    @mouseenter="hoveredKey = model.key"
                                    @mouseleave="hoveredKey = null"
                                >
                                    <!-- 模型名称与 ID -->
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-1.5">
                                            <span class="truncate font-medium text-[var(--text-main)]">{{ model.label }}</span>
                                            <span v-if="isModelActive(model)" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                                        </div>
                                        <div class="truncate font-mono text-[10px] text-[var(--text-muted)]">
                                            {{ model.modelId }}
                                        </div>
                                    </div>

                                    <!-- 能力徽章与规格（使用语义设计契约变量） -->
                                    <div class="flex shrink-0 items-center gap-2">
                                        <!-- 视觉徽章 -->
                                        <span
                                            v-if="model.input.includes('image')"
                                            class="inline-flex items-center gap-0.5 rounded border border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-success)]"
                                            title="支持图像与多模态视觉理解"
                                        >
                                            <span class="i-lucide-eye h-3 w-3"></span>
                                            Vision
                                        </span>

                                        <!-- 思考/推理徽章 -->
                                        <span
                                            v-if="model.reasoning"
                                            class="inline-flex items-center gap-0.5 rounded border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-text)]"
                                            title="支持深度思考 / Reasoning"
                                        >
                                            <span class="i-lucide-sparkles h-3 w-3"></span>
                                            Reasoning
                                        </span>

                                        <!-- Context Window -->
                                        <span class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                                            {{ formatContextWindow(model.contextWindowTokens) }}
                                        </span>

                                        <!-- 价格 -->
                                        <span class="min-w-[65px] text-right font-mono text-[10px] text-[var(--text-muted)]">
                                            {{ formatCost(model) }}
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </Transition>
        </main>
        <!-- 3. 底部简洁快捷键与辅助栏 -->
        <footer class="flex h-8 shrink-0 items-center justify-between border-t border-[var(--divider,var(--border-color))] px-3 text-[10px] text-[var(--text-muted)]">
            <div class="flex items-center gap-1.5">
                <span class="i-lucide-mouse-pointer-click h-3 w-3 text-[var(--text-muted)]"></span>
                <span>点击下方卡片即可更换生效模型</span>
            </div>
            <div class="flex items-center gap-2 font-mono">
                <span><kbd class="rounded border border-[var(--border-color)] bg-[var(--bg-hover)] px-1 py-0.5 text-[9px]">Esc</kbd> 关闭</span>
            </div>
        </footer>
    </div>
</template>

<style scoped>
/*
 * 丝滑双向同频切换动效（Directional Simultaneous Cross-Slide）：
 * 1. 彻底移除 mode="out-in" 造成的 120ms 黑屏/空白停顿，入场与退场同频并发；
 * 2. 严格服从物理视差与 SegmentedControl 按钮方向：
 *    - 切到右侧「模型库」：新内容从右向左滑入 (translateX 14px -> 0)，旧内容向左滑出 (translateX 0 -> -14px)；
 *    - 切回左侧「角色」：新内容从左向右滑入 (translateX -14px -> 0)，旧内容向右滑出 (translateX 0 -> 14px)；
 * 3. 采用 Apple 标准弹簧阻尼减速曲线 cubic-bezier(0.16, 1, 0.3, 1)，时长 180ms，极致轻盈丝滑。
 */
.tab-pane {
    transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform, opacity;
}

/* 向左滑动（切到模型库） */
.tab-slide-left-enter-from {
    opacity: 0;
    transform: translate3d(14px, 0, 0);
}
.tab-slide-left-leave-active {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    pointer-events: none;
}
.tab-slide-left-leave-to {
    opacity: 0;
    transform: translate3d(-14px, 0, 0);
}

/* 向右滑动（切回角色） */
.tab-slide-right-enter-from {
    opacity: 0;
    transform: translate3d(-14px, 0, 0);
}
.tab-slide-right-leave-active {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    pointer-events: none;
}
.tab-slide-right-leave-to {
    opacity: 0;
    transform: translate3d(14px, 0, 0);
}

@media (prefers-reduced-motion: reduce) {
    .tab-pane,
    .tab-slide-left-enter-from,
    .tab-slide-left-leave-to,
    .tab-slide-right-enter-from,
    .tab-slide-right-leave-to {
        transition: none !important;
        transform: none !important;
    }
}
</style>
