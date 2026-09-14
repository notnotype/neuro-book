<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Spinner, {type SpinnerSize} from "../../../../src/components/display/Spinner.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "dots" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生 12 辐条渐变微光 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平圆弧环", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光光环", value: "crystal"},
    {label: "方案 4: 赛博脉冲三联呼吸点", value: "dots"},
    {label: "方案 5: 实底工控高反差转轮", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const size = computed<SpinnerSize>(() => (controls.value.size as SpinnerSize) || "md");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Spinner 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">观察加载旋转动效在不同场景下的视觉负载</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生 12 辐条渐变微光（推荐）</strong>——macOS 经典 12 条渐变灰度辐射叶片；装配 GPU <code>transform: rotate</code> 步进旋转，典雅静谧。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平圆弧环</strong>——去辐条；以 2px 超细圆弧环平滑旋转，极简轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光光环</strong>——圆环向外扩散 <strong>4px 品牌弥散光晕</strong>，晶体质感。
                    </span>
                    <span v-else-if="designStyle === 'dots'" class="scheme-banner-text">
                        <strong>方案 4：赛博脉冲三联呼吸点</strong>——3 颗等距圆点波浪跳跃脉冲，科技感十足。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差转轮</strong>——`rounded-[2px]` 硬质方块分段旋转，工业仪器感。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-loader-2 h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">AI 故事生成与全书导出加载状态</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    加载指示器 · Spinner
                </span>
            </div>

            <!-- 加载器展示 -->
            <div class="flex flex-col items-center justify-center gap-4 py-8 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Spinner
                    id="nb-lab-target"
                    :size="size"
                    label="AI 正在深度构思后续情节中..."
                    :show-label="sceneId === 'labeled' || true"
                />
            </div>

            <!-- 各种尺寸一览 -->
            <div class="pt-2">
                <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-2">尺寸阶梯 (SM / MD / LG):</span>
                <div class="flex items-center justify-around p-3 rounded-lg bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] border border-[color-mix(in_srgb,var(--border-color)_30%,transparent)]">
                    <div class="flex flex-col items-center gap-1.5">
                        <Spinner size="sm" />
                        <span class="text-[10px] text-[var(--text-muted)] font-mono">SM (16px)</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Spinner size="md" />
                        <span class="text-[10px] text-[var(--text-muted)] font-mono">MD (24px)</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Spinner size="lg" />
                        <span class="text-[10px] text-[var(--text-muted)] font-mono">LG (32px)</span>
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>GPU 硬件加速: 已启用 (will-change: transform)</span>
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
