<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import ColorPicker from "../../../../src/components/form/ColorPicker.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "swatches" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 圆盘色块与 Hex 联调 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平圆点", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光色珠", value: "crystal"},
    {label: "方案 4: 预设色板快速点选", value: "swatches"},
    {label: "方案 5: 实底工控高反差色带", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const primaryColor = ref("#6366F1");
const accentColor = ref("#EC4899");
const tagColor = ref("#10B981");

const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    primaryColor.value = "#6366F1";
    accentColor.value = "#EC4899";
    tagColor.value = "#10B981";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">ColorPicker 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击色块展开取色板并实时同步 Hex 色值</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 圆盘色块与 Hex 联调（推荐）</strong>——`rounded-[6px]` 超椭圆色块；按压带 <code>active:scale-[0.92]</code>，展开 <strong>75% 高斯磨砂拾色器浮层</strong>，支持 Hex 与 RGBA 精准联动。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平圆点</strong>——去外边框；纯圆形色块，悬停仅浮现 12% 柔光浅圆底。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光色珠</strong>——色块自身向外扩散 <strong>4px 同色柔和环境弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'swatches'" class="scheme-banner-text">
                        <strong>方案 4：预设色板快速点选</strong>——提供 8 种高频调色盘色板矩阵，一键快速应用。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差色带</strong>——深色饱和实底，硬质方块取色指示。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-sm pb-24">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-palette h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品世界观与主题视觉调色板</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    取色器 · ColorPicker
                </span>
            </div>

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">主题主色 (Primary Accent)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">核心按键与聚焦柔光底色</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <ColorPicker
                            id="nb-lab-target"
                            v-model="primaryColor"
                            :size="size"
                            :disabled="disabled"
                            @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                        />
                        <code class="font-mono text-xs font-bold text-[var(--text-main)]">{{ primaryColor }}</code>
                    </div>
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">强调辅色 (Highlight)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">关键人物与高潮情节标记</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <ColorPicker
                            v-model="accentColor"
                            :size="size"
                            :disabled="disabled"
                        />
                        <code class="font-mono text-xs font-bold text-[var(--text-main)]">{{ accentColor }}</code>
                    </div>
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <span class="block text-xs font-semibold text-[var(--text-main)]">世界观标签色 (Tag Color)</span>
                        <span class="block text-[11px] text-[var(--text-muted)]">势力阵营与专有名词高亮</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <ColorPicker
                            v-model="tagColor"
                            :size="size"
                            :disabled="disabled"
                        />
                        <code class="font-mono text-xs font-bold text-[var(--text-main)]">{{ tagColor }}</code>
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>预览配色: <span class="inline-block w-3 h-3 rounded-full" :style="{backgroundColor: primaryColor}" /> <span class="inline-block w-3 h-3 rounded-full ml-1" :style="{backgroundColor: accentColor}" /> <span class="inline-block w-3 h-3 rounded-full ml-1" :style="{backgroundColor: tagColor}" /></span>
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
