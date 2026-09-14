<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Stepper, {type StepperStepData} from "../../../../src/components/controls/Stepper.vue";
import Button from "../../../../src/components/controls/Button.vue";
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
    {label: "方案 1: macOS 经典分段胶囊向导 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平进度条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光节点", value: "crystal"},
    {label: "方案 4: 精工工控数字标签", value: "notched"},
    {label: "方案 5: 实底高反差瓷片分段", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const currentStep = ref(2);

const orientation = computed(() => (controls.value.orientation as any) || "horizontal");
const linear = computed(() => Boolean(controls.value.linear));

const steps: StepperStepData[] = [
    {step: 1, title: "创建作品档案", description: "设定书名与作者", iconClass: "i-lucide-book-open"},
    {step: 2, title: "世界观与大纲", description: "规划主线分卷", iconClass: "i-lucide-network"},
    {step: 3, title: "正文连载排版", description: "设定集与校对", iconClass: "i-lucide-pen-tool"},
    {step: 4, title: "导出与发布", description: "EPUB/PDF 生成", iconClass: "i-lucide-check-circle"},
];

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    currentStep.value = 2;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Stepper 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击步骤节点或“下一步”体验向导过渡</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 经典分段胶囊向导（推荐）</strong>——步骤圆环带 <code>active:scale-[0.98]</code> 弹性触觉；完成态对勾平滑缩放入场，连接线平滑渐变填充，沉静典雅。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平进度条</strong>——去大圆环；以顶部一体化平滑进度填充条 + 下方微型文字节点呈现，手感极简。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光节点</strong>——75% 磨砂晶体背板；当前进行中步骤节点外圈扩散 <strong>4px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'notched'" class="scheme-banner-text">
                        <strong>方案 4：精工工控数字标签</strong>——`rounded-[4px]` 精工方框；步骤编号与刻度线分段清晰，工业精密感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底高反差瓷片分段</strong>——每个步骤以独立实心卡片分段呈现，当前激活项高亮突起。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 !max-w-[760px]">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-route h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品全生命周期创作发布向导</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    向导步骤 · Stepper
                </span>
            </div>

            <div class="p-4 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Stepper
                    id="nb-lab-target"
                    v-model="currentStep"
                    :steps="steps"
                    :orientation="orientation"
                    :linear="linear"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- 底部导航与步进控制 -->
            <div class="flex items-center justify-between pt-2">
                <Button
                    size="sm"
                    variant="secondary"
                    :disabled="currentStep <= 1"
                    @click="currentStep = Math.max(1, currentStep - 1)"
                >
                    上一步
                </Button>
                <span class="text-xs text-[var(--text-muted)] font-mono">当前进度: 第 {{ currentStep }} 步 / 共 {{ steps.length }} 步 ({{ steps[currentStep - 1]?.title }})</span>
                <Button
                    size="sm"
                    variant="primary"
                    :disabled="currentStep >= steps.length"
                    @click="currentStep = Math.min(steps.length, currentStep + 1)"
                >
                    下一步
                </Button>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>线性约束模式: {{ linear ? "已开启(严格顺序)" : "未开启(自由跳转)" }}</span>
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
