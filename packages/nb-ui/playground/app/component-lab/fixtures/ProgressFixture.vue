<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Progress, {type ProgressSize, type ProgressTone} from "../../../../src/components/display/Progress.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "segmented" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 经典平滑胶囊条 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平细线", value: "minimal"},
    {label: "方案 3: 悬浮微晶流光脉冲", value: "crystal"},
    {label: "方案 4: 精工 10 段分格刻度", value: "segmented"},
    {label: "方案 5: 实底工控高反差面板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const progressValue = ref(68);

const size = computed<ProgressSize>(() => (controls.value.size as ProgressSize) || "md");
const tone = computed<ProgressTone>(() => (controls.value.tone as ProgressTone) || "accent");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    progressValue.value = 68;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Progress 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击 +/- 调节进度体验填充阻尼与流光过渡</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 经典平滑胶囊条（推荐）</strong>——`rounded-full` 极简椭圆轨道；填充条装配 GPU 平滑阻尼过渡，带有浅色高光微反射。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平细线</strong>——超细 2px 紧凑轨道；去多余立体感，纯色填充。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶流光脉冲</strong>——75% 磨砂晶体背板；进度条前锋扩散 <strong>4px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'segmented'" class="scheme-banner-text">
                        <strong>方案 4：精工 10 段分格刻度</strong>——将进度条分解为 10 个独立等距小方格，精密工业感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差面板</strong>——深色饱和实底，高反差黑白对比粗条。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-activity h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品创作篇幅与发布进度指示</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    进度指示 · Progress
                </span>
            </div>

            <!-- 动态受控进度 -->
            <div class="p-3.5 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                    <span>全书创作目标字数完成度 (Target)</span>
                    <span class="font-mono font-bold text-[var(--accent-main)]">{{ progressValue }}% (68,000 / 100,000 字)</span>
                </div>
                <Progress
                    id="nb-lab-target"
                    :model-value="progressValue"
                    :tone="tone"
                    :size="size"
                />
            </div>

            <!-- 四种状态语调进度展示 -->
            <div class="space-y-3 pt-2">
                <span class="block text-xs font-semibold text-[var(--text-secondary)]">多语调状态矩阵一览:</span>
                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>主要创作目标 (Accent)</span>
                        <span class="font-mono">80%</span>
                    </div>
                    <Progress :model-value="80" tone="accent" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>本地 SQLite 备份同步完成 (Success)</span>
                        <span class="font-mono">100%</span>
                    </div>
                    <Progress :model-value="100" tone="success" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>云端同步存储预警 (Warning)</span>
                        <span class="font-mono">85%</span>
                    </div>
                    <Progress :model-value="85" tone="warning" size="sm" />
                </div>

                <div>
                    <div class="flex justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span>字数超出本卷规划上限 (Danger)</span>
                        <span class="font-mono">95%</span>
                    </div>
                    <Progress :model-value="95" tone="danger" size="sm" />
                </div>
            </div>

            <!-- 步进调节控制 -->
            <div class="flex items-center justify-between pt-2 border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)]">
                <div class="flex items-center gap-2">
                    <Button size="sm" variant="secondary" @click="progressValue = Math.max(0, progressValue - 10)">-10%</Button>
                    <Button size="sm" variant="secondary" @click="progressValue = Math.min(100, progressValue + 10)">+10%</Button>
                </div>
                <span class="text-xs text-[var(--text-muted)]">当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
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
