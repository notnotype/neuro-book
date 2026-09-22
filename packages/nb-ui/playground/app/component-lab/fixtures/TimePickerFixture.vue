<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import FormField from "../../../../src/components/form/FormField.vue";
import TimePicker from "../../../../src/components/form/TimePicker.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";

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
    {label: "方案 1: macOS 原生触觉滚轮/胶囊 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平卡片", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 时分独立双段微调", value: "segmented"},
    {label: "方案 5: 实底工控高反差磁块", value: "solid"},
];

const value = ref<string | undefined>("09:30");
const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

const stepMinutes = computed(() => {
    const parsed = Number.parseInt(String(controls.value.step ?? "30"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value.value = props.sceneId === "invalid" ? undefined : "09:30";
}

function report(name: string, payload?: unknown): void {
    if (!props.definition.events.includes(name)) return;
    emit("lab-event", name, payload);
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">TimePicker 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击选择时间体验滚轮与下拉弹层切换</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生触觉滚轮/胶囊（推荐）</strong>——`rounded-[6px]` 超椭圆触发槽；在 macOS 主题下支持 <strong>3D 滚轮拟真滚动手感</strong>，展开磨砂浮层带 75% 高斯虚化与柔光边缘。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平卡片</strong>——纯平浅底触发器；展开大字号极简下拉时间列表。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——`rounded-full` 胶囊输入框；展开浮层扩散 <strong>4px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'segmented'" class="scheme-banner-text">
                        <strong>方案 4：时分独立双段微调</strong>——时与分各自独立为带加减步进的微框，工业精密感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁块</strong>——深色饱满实底，高亮时分反色高对比呈现。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-md pb-24">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-clock h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">每日写作提醒与自动打卡时间</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    时间选择 · TimePicker
                </span>
            </div>

            <FormField
                label="创作灵感提醒时间"
                for="nb-lab-target"
                :error="scene.invalid ? '请选择有效时间' : ''"
                description="切换到 macOS 主题时此处支持 3D 滚轮实现，v-model 契约与值完全一致。"
            >
                <TimePicker
                    id="nb-lab-target"
                    v-model="value"
                    :min="String(controls.min ?? '08:00')"
                    :max="String(controls.max ?? '20:00')"
                    :step="stepMinutes"
                    :invalid="scene.invalid === true"
                    :disabled="scene.disabled === true"
                    @update:model-value="report('update:modelValue', {value: $event})"
                />
            </FormField>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>选定时间: <code class="font-mono text-[var(--accent-main)] font-bold">{{ value || '未选定' }}</code></span>
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
