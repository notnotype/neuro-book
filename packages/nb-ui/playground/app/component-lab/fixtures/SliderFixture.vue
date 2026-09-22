<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import {
    SliderRange,
    SliderRoot,
    SliderThumb,
    SliderTrack,
} from "reka-ui";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
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
    {label: "方案 1: macOS 原生触觉圆钮 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平细条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光滑球", value: "crystal"},
    {label: "方案 4: 精工步进刻度卡槽", value: "notched"},
    {label: "方案 5: 实底工控高反差方条", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const fontSize = ref(16);
const volumeRange = ref([20, 80]);
const opacity = ref(75);

const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

// 方案样式计算
const rootClass = computed(() => {
    switch (designStyle.value) {
        case "minimal":
            return "relative flex items-center select-none touch-none cursor-pointer w-full h-4 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
        case "crystal":
            return "relative flex items-center select-none touch-none cursor-pointer w-full h-7 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
        case "notched":
            return "relative flex items-center select-none touch-none cursor-pointer w-full h-6 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
        case "solid":
            return "relative flex items-center select-none touch-none cursor-pointer w-full h-5 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
        case "macos":
        default:
            return "relative flex items-center select-none touch-none cursor-pointer w-full h-5 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
    }
});

const trackClass = computed(() => {
    switch (designStyle.value) {
        case "minimal":
            return "relative grow bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] h-0.5 overflow-hidden transition-[height,background-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]";
        case "crystal":
            return "relative grow rounded-full bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] backdrop-blur-md h-2.5 overflow-hidden shadow-inner transition-[height,background-color,border-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]";
        case "notched":
            return "relative grow rounded-[4px] bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_20%,transparent)] h-3 overflow-hidden transition-[height,background-color,border-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]";
        case "solid":
            return "relative grow rounded-[2px] bg-[color-mix(in_srgb,var(--text-main)_22%,transparent)] h-2 overflow-hidden transition-[height,background-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]";
        case "macos":
        default:
            return "relative grow rounded-full bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] h-1.5 overflow-hidden transition-[height,background-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]";
    }
});

const rangeClass = computed(() => {
    switch (designStyle.value) {
        case "minimal":
            return "absolute bg-[var(--accent-main)]";
        case "crystal":
            return "absolute rounded-full bg-[linear-gradient(90deg,var(--accent-main)_0%,color-mix(in_srgb,var(--accent-main)_75%,white)_100%)] shadow-[0_0_8px_color-mix(in_srgb,var(--accent-main)_40%,transparent)]";
        case "notched":
            return "absolute rounded-[3px] bg-[color-mix(in_srgb,var(--accent-main)_80%,transparent)]";
        case "solid":
            return "absolute rounded-[1px] bg-[var(--accent-main)]";
        case "macos":
        default:
            return "absolute rounded-full bg-[var(--accent-main)]";
    }
});

const thumbClass = computed(() => {
    switch (designStyle.value) {
        case "minimal":
            return "block h-3 w-3 rounded-full bg-[var(--accent-main)] border-2 border-[var(--bg-panel)] shadow-none transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-125 not-disabled:active:scale-90 outline-none";
        case "crystal":
            return "block h-5 w-5 rounded-full bg-white shadow-[0_0_10px_var(--accent-main),0_1px_3px_color-mix(in_srgb,var(--shadow-color)_25%,transparent)] transition-[transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-115 hover:shadow-[0_0_16px_var(--accent-main)] not-disabled:active:scale-95 outline-none";
        case "notched":
            return "block h-5 w-3.5 rounded-[3px] bg-[var(--bg-panel)] border border-[color-mix(in_srgb,var(--text-main)_35%,transparent)] shadow-sm flex items-center justify-center after:content-[''] after:w-[1px] after:h-2.5 after:bg-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-110 not-disabled:active:scale-95 outline-none";
        case "solid":
            return "block h-4.5 w-4.5 rounded-[2px] bg-[var(--text-main)] shadow-[0_2px_0_color-mix(in_srgb,var(--shadow-color)_40%,transparent)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-110 not-disabled:active:scale-95 outline-none";
        case "macos":
        default:
            return "block h-4.5 w-4.5 rounded-full bg-[var(--bg-panel)] shadow-[0_2px_6px_color-mix(in_srgb,var(--shadow-color)_25%,transparent),0_0_0_1px_color-mix(in_srgb,var(--text-main)_15%,transparent)] transition-[transform,box-shadow] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:scale-110 not-disabled:active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]";
    }
});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    fontSize.value = 16;
    volumeRange.value = [20, 80];
    opacity.value = 75;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Slider 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">拖拽滑块体验 5 种不同轨型与触感阻尼反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生触觉圆钮（推荐）</strong>——<code>rounded-full</code> 6px 药丸轨道；滑块悬停 <code>hover:scale-110</code>，拖拽按压 <code>active:scale-95</code>，高亮条平滑阻尼填充。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平细条</strong>——超细 2px 紧凑轨道；12px 极简纯平圆点滑块，手感纯粹利落。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光滑球</strong>——毛玻璃胶囊轨道，填充条带渐变光泽；滑块外围扩散 <strong>10px 品牌弥散柔晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'notched'" class="scheme-banner-text">
                        <strong>方案 4：精工步进刻度卡槽</strong>——带有精工卡扣滑块与中心中线刻度，滑块卡位清脆准确。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方条</strong>——<code>rounded-[2px]</code> 硬质工控方块 + 粗轨道，工业级高反差指示。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-sliders-horizontal h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">编辑器视觉与连续排版参数连续调节</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    滑动条 · Slider
                </span>
            </div>

            <div class="space-y-6">
                <!-- 单值滑块: 字号 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>正文排版字号 (Font Size)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">{{ fontSize }}px</span>
                    </div>
                    <SliderRoot
                        id="nb-lab-target"
                        :model-value="[fontSize]"
                        :min="12"
                        :max="32"
                        :step="1"
                        :disabled="disabled"
                        :class="rootClass"
                        @update:model-value="(val) => { if (val?.[0] !== undefined) { fontSize = val[0]; emit('lab-event', 'update:modelValue', val[0]); } }"
                    >
                        <SliderTrack :class="trackClass">
                            <SliderRange :class="rangeClass" />
                        </SliderTrack>
                        <SliderThumb
                            aria-label="正文排版字号"
                            :class="thumbClass"
                        />
                    </SliderRoot>
                </div>

                <!-- 双值范围滑块: 导出章节分卷 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>分卷导出区间范围 (Volume Range)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">第 {{ volumeRange[0] }} ~ {{ volumeRange[1] }} 章</span>
                    </div>
                    <SliderRoot
                        :model-value="volumeRange"
                        :min="1"
                        :max="100"
                        :step="1"
                        :disabled="disabled"
                        :class="rootClass"
                        @update:model-value="(val) => { if (val && val.length === 2) volumeRange = val; }"
                    >
                        <SliderTrack :class="trackClass">
                            <SliderRange :class="rangeClass" />
                        </SliderTrack>
                        <SliderThumb
                            aria-label="起始章节"
                            :class="thumbClass"
                        />
                        <SliderThumb
                            aria-label="结束章节"
                            :class="thumbClass"
                        />
                    </SliderRoot>
                </div>

                <!-- 磨砂透明度 -->
                <div>
                    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
                        <span>毛玻璃底纹磨砂透明度 (Backdrop Opacity)</span>
                        <span class="font-mono font-semibold text-[var(--accent-main)]">{{ opacity }}%</span>
                    </div>
                    <SliderRoot
                        :model-value="[opacity]"
                        :min="0"
                        :max="100"
                        :step="5"
                        :disabled="disabled"
                        :class="rootClass"
                        @update:model-value="(val) => { if (val?.[0] !== undefined) opacity = val[0]; }"
                    >
                        <SliderTrack :class="trackClass">
                            <SliderRange :class="rangeClass" />
                        </SliderTrack>
                        <SliderThumb
                            aria-label="毛玻璃底纹磨砂透明度"
                            :class="thumbClass"
                        />
                    </SliderRoot>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>当前字号预览: <span :style="{fontSize: `${fontSize}px`}" class="text-[var(--text-main)] font-serif leading-none">长篇小说样张</span></span>
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
