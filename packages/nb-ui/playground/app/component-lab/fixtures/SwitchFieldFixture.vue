<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "outlined" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生表单项 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平线条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 精工微线框表单槽", value: "outlined"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const value1 = ref(true);
const value2 = ref(true);
const value3 = ref(false);
const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    value1.value = true;
    value2.value = true;
    value3.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">SwitchField 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击开关行体验标签与开关联动反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生表单项（推荐）</strong>——`rounded-[8px]` 超椭圆整行卡片；开关滑球装配 GPU 硬件加速位移与 <code>active:scale-[0.93]</code>，右侧开关 + 左侧标题描述层级分明。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平线条</strong>——去外围背景卡片；纯文字排版与极简内嵌开关，手感轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——75% 磨砂晶体整行卡片，开启时整行向外扩散 <strong>3.5px 柔和光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工微线框表单槽</strong>——1px 精工细线微框 + 开关两端精密刻度。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——深色饱和实底，开启后高亮反色显示。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-sliders h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品环境与自动化配置字段</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    开关表单字段 · SwitchField
                </span>
            </div>

            <div class="space-y-4">
                <SwitchField
                    id="nb-lab-target"
                    v-model="value1"
                    label="自动同步本地快照至 SQLite"
                    hint="每隔 5 分钟自动创建一次章节内容增量快照"
                    :disabled="sceneId === 'disabled'"
                    @update:model-value="report('update:modelValue', {value: $event})"
                />

                <SwitchField
                    v-model="value2"
                    label="AI 设定集知识库自动注入"
                    hint="在续写时自动挂载人物档案与科技树设定"
                    :disabled="sceneId === 'disabled'"
                />

                <SwitchField
                    v-model="value3"
                    label="自动去除段首全角缩进"
                    hint="在导出为 Markdown 或 Web 发布时自动清洗段落格式"
                    :disabled="sceneId === 'disabled'"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>开启项数: {{ [value1, value2, value3].filter(Boolean).length }} / 3 项</span>
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
