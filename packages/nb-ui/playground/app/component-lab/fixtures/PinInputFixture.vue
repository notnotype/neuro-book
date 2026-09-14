<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import PinInput from "../../../../src/components/form/PinInput.vue";
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
    {label: "方案 1: macOS 独立沉浸方块 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平下划线", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光矩阵", value: "crystal"},
    {label: "方案 4: 连通分段一体卡槽", value: "segmented"},
    {label: "方案 5: 实底工控高反差瓷片", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const pinValue = ref<string[]>(["7", "2", "9", "4"]);
const isCompleted = ref(false);

const mask = computed(() => Boolean(controls.value.mask));
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

function handleComplete(val: string[]): void {
    isCompleted.value = true;
    emit("lab-event", "complete", val);
}

function handleUpdate(val: string[]): void {
    if (val.length < 6) isCompleted.value = false;
    emit("lab-event", "update:modelValue", val);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    pinValue.value = ["7", "2", "9", "4"];
    isCompleted.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">PinInput 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">输入 6 位口令验证自动完成派发</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 独立沉浸方块（推荐）</strong>——`rounded-[6px]` 独立超椭圆实底方格；聚焦时平滑放大 <code>scale(1.04)</code> 并扩散 <strong>2.5px 品牌光晕</strong>，键入数字平滑弹入。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平下划线</strong>——无外围方框；单个数字下方带 2px 品牌下划线光标跳动，手感极简。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光矩阵</strong>——`rounded-xl` 75% 磨砂晶体方块；输入后圆点发光扩散，带 <strong>4px 环境柔光</strong>。
                    </span>
                    <span v-else-if="designStyle === 'segmented'" class="scheme-banner-text">
                        <strong>方案 4：连通分段一体卡槽</strong>——单条通栏输入槽；中间以 1px 细微垂直分割线均分 6 格，如实体银行卡槽。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差瓷片</strong>——`rounded-[4px]` 14% 深底硬质方块；填满后触发绿色微反光。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-md">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-shield-check h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品发布签署与加密 PIN 验证</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    PIN 码 · PinInput
                </span>
            </div>

            <div class="space-y-4">
                <div class="space-y-2 flex flex-col items-center">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">请输入 6 位手稿机密访问口令:</span>
                    <PinInput
                        id="nb-lab-target"
                        v-model="pinValue"
                        :length="6"
                        :mask="mask"
                        :disabled="disabled"
                        @update:model-value="handleUpdate"
                        @complete="handleComplete"
                    />
                </div>

                <div v-if="isCompleted" class="rounded-lg p-2.5 text-center border border-[var(--status-success)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-xs font-medium text-[var(--status-success)] flex items-center justify-center gap-2">
                    <span class="i-lucide-check-circle-2 h-4 w-4" />
                    <span>口令验证通过，已解锁大纲访问权限！</span>
                </div>
                <div v-else class="text-center text-[11px] text-[var(--text-muted)]">
                    已输入 {{ pinValue.length }} / 6 位字符（支持数字键盘与退格键）
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>掩码状态: {{ mask ? "已开启(●)" : "未开启(明文)" }}</span>
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
