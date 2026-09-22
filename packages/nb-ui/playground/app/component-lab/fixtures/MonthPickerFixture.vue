<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import MonthPicker from "../../../../src/components/form/MonthPicker.vue";
import MonthRangePicker from "../../../../src/components/form/MonthRangePicker.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "quarter" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 3×4 矩阵胶囊 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平线条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 季度分组精工网格", value: "quarter"},
    {label: "方案 5: 实底工控高反差方块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const selectedMonth = ref();
const monthRange = ref<any>({start: undefined, end: undefined});

const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">MonthPicker 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击月份网格体验月份与跨月区间选择</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 3×4 矩阵胶囊（推荐）</strong>——`rounded-[6px]` 超椭圆网格；选中月份呈现 <strong>纯正品牌实底白字</strong>，单元格点击带 <code>active:scale-[0.93]</code>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平线条</strong>——去外层网格线；悬停浮现 12% 柔光浅圆底，手感轻爽。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——75% 磨砂晶体背板；选中月份向外扩散 <strong>4px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'quarter'" class="scheme-banner-text">
                        <strong>方案 4：季度分组精工网格</strong>——按 Q1~Q4 季度分组排列，带有精工季度小标号。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方块</strong>——深色饱和实底，选中月份反色纯白呈现。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-md">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-calendar-days h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">写作月度产出与季度归档</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    月份选择 · MonthPicker
                </span>
            </div>

            <div class="flex flex-col items-center gap-4">
                <div class="w-full">
                    <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-2 text-center">单月份归档选择:</span>
                    <MonthPicker
                        id="nb-lab-target"
                        v-model="selectedMonth"
                        :disabled="disabled"
                        @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                    />
                </div>

                <div class="w-full pt-4 border-t border-[var(--divider)]">
                    <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-2 text-center">跨月写作冲刺周期 (MonthRangePicker):</span>
                    <MonthRangePicker
                        v-model="monthRange"
                        :disabled="disabled"
                    />
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>选定月份: <code class="font-mono text-[var(--accent-main)] font-bold">{{ selectedMonth ? String(selectedMonth) : '未选定' }}</code></span>
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
