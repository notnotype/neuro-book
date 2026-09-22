<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Switch, {type SwitchSize} from "../../../../src/components/controls/Switch.vue";
import SwitchField from "../../../../src/components/controls/SwitchField.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "crystal" | "notched" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 经典弹簧滑球 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平内嵌块", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 精工双态微刻度槽", value: "notched"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const autoSave = ref(true);
const cloudSync = ref(false);
const focusMode = ref(true);
const aiRealtimeAssist = ref(true);

const size = computed<SwitchSize>(() => (controls.value.size as SwitchSize) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    autoSave.value = true;
    cloudSync.value = false;
    focusMode.value = true;
    aiRealtimeAssist.value = true;
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Switch 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击开关体验滑球物理位移与拉伸阻尼</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 经典弹簧滑球（推荐）</strong>——`rounded-full` 极简椭圆；滑球装配 GPU <code>transform: translateX</code> 硬件加速，按压时伴随 <strong>横向微弹性拉伸</strong> 与丝滑阻尼回弹。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平内嵌块</strong>——`rounded-[6px]` 纯平矩形凹槽；滑块为超椭圆方块，无多余光影，纯靠 <strong>16% 阶梯浓度跃升</strong>。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——75% 半透明高斯磨砂底槽；开启态整体扩散 <strong>4px 品牌弥散光晕</strong>，滑球如晶体般通透。
                    </span>
                    <span v-else-if="designStyle === 'notched'" class="scheme-banner-text">
                        <strong>方案 4：精工双态微刻度槽</strong>——两端带有 <code>[0]</code> 与 <code>[1]</code> 极细微刻度微指示，滑块卡位精密清脆。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——`rounded-[4px]` 硬质工控方块；关闭态深灰实底，开启态饱满品牌色 + 反色白块。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-toggle-left h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作引擎工作区偏好开关</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    开关控件 · Switch
                </span>
            </div>

            <!-- 纯 Switch 控件演示 -->
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">实时自动保存 (Auto Save)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">键入停顿 800ms 后自动将章节段落写入本地 SQLite</span>
                    </div>
                    <Switch
                        id="nb-lab-target"
                        v-model="autoSave"
                        :size="size"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">AI 实时灵感补全提示</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">在行末停留时光标处浮现灰色幽灵续写词条</span>
                    </div>
                    <Switch
                        v-model="aiRealtimeAssist"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">云端加密多端同步</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">端到端零知识加密同步至个人云存储节点</span>
                    </div>
                    <Switch
                        v-model="cloudSync"
                        :size="size"
                        :disabled="disabled"
                    />
                </div>
            </div>

            <!-- SwitchField 表单字段演示 -->
            <div class="pt-4 border-t border-[var(--divider)]">
                <SwitchField
                    v-model="focusMode"
                    label="全屏沉浸无干扰专注模式"
                    hint="自动隐藏侧栏目录与底部状态条，仅保留纯粹稿纸与柔和背光"
                    :disabled="disabled"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>专注模式: {{ focusMode ? "已开启" : "已关闭" }}</span>
                <span>当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
    margin: var(--space-3) auto 0;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 75%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 26%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}

.scheme-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}

.scheme-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    background: var(--accent-main);
    color: var(--text-inverse);
    letter-spacing: 0.02em;
    flex-shrink: 0;
}

.scheme-banner-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
</style>
