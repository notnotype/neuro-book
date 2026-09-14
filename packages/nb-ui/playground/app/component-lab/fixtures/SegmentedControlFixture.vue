<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
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

// 4 种基于方案 2（macOS 原生蓝底单选/多选）的细分方案
const designStyle = ref<"s2_classic" | "s2_gradient" | "s2_squircle" | "s2_cyan">("s2_classic");
const designOptions = [
    {label: "2-A: macOS 经典系统蓝 (推荐)", value: "s2_classic"},
    {label: "2-B: 微渐变高光蓝 (立体精细)", value: "s2_gradient"},
    {label: "2-C: 超椭圆柔感蓝 (温润大圆角)", value: "s2_squircle"},
    {label: "2-D: 高反差电光蓝 (极客暗调)", value: "s2_cyan"},
];

// 单选分段状态
const mainTab = ref<"doc" | "preview" | "review">("preview");
const alignSingle = ref<"left" | "center" | "right" | "justify">("center");

// 多选分段状态（对齐截图右下角多选场景：粗体、斜体、下划线、删除线）
const multiStyles = ref<Record<string, boolean>>({
    bold: true,
    italic: true,
    underline: true,
    strike: false,
});

function toggleMulti(key: string): void {
    multiStyles.value[key] = !multiStyles.value[key];
    report("update:multi", multiStyles.value);
}

// 主分段选项
const mainTabs = [
    {label: "文稿编辑", value: "doc"},
    {label: "实时预览", value: "preview"},
    {label: "批注审阅", value: "review"},
];

// 对齐单选分段选项
const alignOptions = [
    {label: "左对齐", value: "left", iconClass: "i-lucide-align-left"},
    {label: "居中对齐", value: "center", iconClass: "i-lucide-align-center"},
    {label: "右对齐", value: "right", iconClass: "i-lucide-align-right"},
    {label: "两端对齐", value: "justify", iconClass: "i-lucide-align-justify"},
];

// 多选富文本分段选项
const textStyleOptions = [
    {label: "B", value: "bold", desc: "加粗 (Bold)"},
    {label: "I", value: "italic", desc: "斜体 (Italic)"},
    {label: "U", value: "underline", desc: "下划线 (Underline)"},
    {label: "S", value: "strike", desc: "删除线 (Strikethrough)"},
];

// 滑块滑动动画计算（基于 index 驱动 CSS 平移）
const mainTabIndex = computed(() => mainTabs.findIndex((t) => t.value === mainTab.value));
const alignIndex = computed(() => alignOptions.findIndex((a) => a.value === alignSingle.value));

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    mainTab.value = "preview";
    alignSingle.value = "center";
    multiStyles.value = {bold: true, italic: true, underline: true, strike: false};
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
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">方案 2 细分:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">动画已调整为舒缓优雅的 300ms 物理阻尼曲线</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">动效解析</span>
                    <span v-if="designStyle === 's2_classic'" class="scheme-banner-text">
                        <strong>方案 2-A：macOS 经典系统蓝（推荐 · 纯正原生）</strong>——`rounded-[8px]`，纯正 Apple 蓝滑块，<strong>300ms 舒缓平滑物理滑动曲线</strong>（`cubic-bezier(0.22, 1, 0.36, 1)`），单选带自动消隐细分隔线，多选支持独立组合。
                    </span>
                    <span v-else-if="designStyle === 's2_gradient'" class="scheme-banner-text">
                        <strong>方案 2-B：微渐变高光蓝（立体精细）</strong>——滑块带有 180° 微渐变蓝 + 顶部 0.5px 极细微高光反光边 + 底部立体轻阴影，质感细腻丰富。
                    </span>
                    <span v-else-if="designStyle === 's2_squircle'" class="scheme-banner-text">
                        <strong>方案 2-C：超椭圆柔感蓝（温润大圆角）</strong>——`rounded-[11px]` 外槽配合 `rounded-[8px]` 饱满超椭圆胶囊，4px 扩散同色柔晕，320ms 丝滑滑动。
                    </span>
                    <span v-else-if="designStyle === 's2_cyan'" class="scheme-banner-text">
                        <strong>方案 2-D：高反差电光蓝（极客暗调）</strong>——深沉暗色底槽 + 高对比电光蓝滑块 + 双层径向外发光圈，高反差醒目。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">分段选择与模式控制</h3>
                    <p class="text-xs text-[var(--text-muted)]">动画放缓至 300ms，滑动如丝般顺滑自然，支持单选与多选组合。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    分段控件 · SegmentedControl
                </span>
            </div>

            <!-- 展示区 -->
            <div class="stage-box flex flex-col gap-6" :class="`seg-style-${designStyle}`">
                <!-- 第一组：主标签分段（带 300ms 舒缓平滑滑块动画） -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">主要视图切换 (300ms 舒缓平滑滑动):</span>
                    <div id="nb-lab-target" class="relative seg-slider-track p-1 inline-flex rounded-[9px] w-full select-none">
                        <!-- 连续平滑滑动的背景指示器 -->
                        <div
                            class="absolute top-1 bottom-1 seg-sliding-indicator rounded-[6.5px] pointer-events-none"
                            :style="{
                                width: `calc((100% - 8px) / ${mainTabs.length})`,
                                transform: `translateX(calc(${mainTabIndex} * 100%))`,
                            }"
                        ></div>

                        <!-- 选项按钮 -->
                        <button
                            v-for="tab in mainTabs"
                            :key="tab.value"
                            type="button"
                            class="relative z-10 flex-1 inline-flex items-center justify-center py-1.5 px-3 text-xs font-medium rounded-[6.5px] cursor-pointer transition-colors duration-200"
                            :class="mainTab === tab.value ? 'text-white font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                            @click="mainTab = tab.value as any; report('update:modelValue', {mainTab: tab.value})"
                        >
                            <span>{{ tab.label }}</span>
                        </button>
                    </div>
                </div>

                <!-- 第二组：单选分段（对齐截图左下方 · 带竖向细分隔线与滑动动画） -->
                <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">单选分段 (Single Selection · 对齐截图左下):</span>
                        <span class="text-[11px] font-mono text-[var(--text-muted)]">当前: {{ alignOptions[alignIndex]?.label }}</span>
                    </div>
                    <div class="relative seg-align-track p-1 inline-flex rounded-[8px] w-full select-none">
                        <!-- 滑动蓝块 -->
                        <div
                            class="absolute top-1 bottom-1 seg-blue-indicator rounded-[6px] pointer-events-none"
                            :style="{
                                width: `calc((100% - 8px) / ${alignOptions.length})`,
                                transform: `translateX(calc(${alignIndex} * 100%))`,
                            }"
                        ></div>

                        <button
                            v-for="(opt, idx) in alignOptions"
                            :key="opt.value"
                            type="button"
                            class="relative z-10 flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-[6px] cursor-pointer transition-colors duration-200"
                            :class="alignSingle === opt.value ? 'text-white font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                            @click="alignSingle = opt.value as any; report('update:modelValue', {align: opt.value})"
                        >
                            <!-- 选项间细分隔线（选中项两侧自动隐去） -->
                            <span
                                v-if="idx > 0 && alignIndex !== idx && alignIndex !== idx - 1"
                                class="absolute left-0 top-1.5 bottom-1.5 w-[1px] bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] pointer-events-none"
                            ></span>
                            <span :class="opt.iconClass" class="text-sm" aria-hidden="true"></span>
                            <span class="hidden sm:inline">{{ opt.label }}</span>
                        </button>
                    </div>
                </div>

                <!-- 第三组：多选分段（对齐截图右下方 · 富文本多项独立开合） -->
                <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">多选分段 (Multi Selection · 对齐截图右下):</span>
                        <span class="text-[11px] font-mono text-[var(--text-muted)]">支持 B/I/U/S 独立多选组合</span>
                    </div>
                    <div class="seg-multi-track p-1 inline-flex rounded-[8px] w-full select-none gap-0.5">
                        <button
                            v-for="(styleOpt, idx) in textStyleOptions"
                            :key="styleOpt.value"
                            type="button"
                            :title="styleOpt.desc"
                            class="relative flex-1 inline-flex items-center justify-center py-1.5 px-3 text-xs font-bold rounded-[6px] cursor-pointer transition-all duration-200"
                            :class="multiStyles[styleOpt.value] ? 'seg-multi-item-active font-semibold' : 'seg-multi-item-inactive'"
                            @click="toggleMulti(styleOpt.value)"
                        >
                            <span :class="styleOpt.value === 'italic' ? 'italic' : styleOpt.value === 'underline' ? 'underline' : styleOpt.value === 'strike' ? 'line-through' : ''">
                                {{ styleOpt.label }}
                            </span>
                        </button>
                    </div>
                </div>

                <!-- 交互状态反馈区 -->
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] border border-[color-mix(in_srgb,var(--accent-main)_20%,transparent)]">
                    <span class="text-xs text-[var(--text-main)]">
                        主视图：<strong>{{ mainTabs.find(t => t.value === mainTab)?.label }}</strong> · 对齐：<strong>{{ alignOptions.find(a => a.value === alignSingle)?.label }}</strong>
                    </span>
                    <span class="text-xs font-mono text-[var(--accent-main)]">
                        样式: [{{ Object.entries(multiStyles).filter(([_, v]) => v).map(([k]) => k.toUpperCase()).join('+') || 'NORMAL' }}]
                    </span>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.scheme-banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}
.scheme-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
    color: #ffffff;
    flex-shrink: 0;
}
.scheme-banner-text {
    font-size: var(--text-xs);
    color: var(--text-main);
    line-height: 1.4;
}

/* 紧凑 macOS 卡片容器 */
.macos-compact-card {
    width: 100%;
    max-width: 520px;
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

.stage-box {
    position: relative;
    width: 100%;
    margin-top: var(--space-2);
}

/* 基础外槽通用样式 */
.seg-slider-track,
.seg-align-track,
.seg-multi-track {
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
}

/* ============================================================
   方案 2-A：macOS 经典系统蓝（300ms 舒缓平滑物理滑动 · 推荐）
   ============================================================ */
.seg-style-s2_classic .seg-sliding-indicator,
.seg-style-s2_classic .seg-blue-indicator {
    background: var(--accent-main);
    box-shadow: 0 1.5px 4px color-mix(in srgb, var(--accent-main) 35%, transparent);
    transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1),
                width 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

.seg-style-s2_classic .seg-multi-item-active {
    background: var(--accent-main);
    color: #ffffff;
    box-shadow: 0 1.5px 4px color-mix(in srgb, var(--accent-main) 35%, transparent);
}
.seg-style-s2_classic .seg-multi-item-inactive {
    background: transparent;
    color: var(--text-muted);
}
.seg-style-s2_classic .seg-multi-item-inactive:hover {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

/* ============================================================
   方案 2-B：微渐变高光蓝（180° 微渐变 + 0.5px 顶部反光）
   ============================================================ */
.seg-style-s2_gradient .seg-sliding-indicator,
.seg-style-s2_gradient .seg-blue-indicator {
    background: linear-gradient(180deg, var(--accent-main) 0%, color-mix(in srgb, var(--accent-main) 88%, #000000) 100%);
    border: 0.5px solid color-mix(in srgb, var(--accent-main) 90%, #000000);
    box-shadow: inset 0 1px 0.5px rgba(255, 255, 255, 0.38),
                0 2px 6px color-mix(in srgb, var(--accent-main) 38%, transparent);
    transition: transform 300ms cubic-bezier(0.2, 0.95, 0.3, 1),
                width 300ms cubic-bezier(0.2, 0.95, 0.3, 1);
}

.seg-style-s2_gradient .seg-multi-item-active {
    background: linear-gradient(180deg, var(--accent-main) 0%, color-mix(in srgb, var(--accent-main) 88%, #000000) 100%);
    color: #ffffff;
    box-shadow: inset 0 1px 0.5px rgba(255, 255, 255, 0.38),
                0 2px 6px color-mix(in srgb, var(--accent-main) 38%, transparent);
}
.seg-style-s2_gradient .seg-multi-item-inactive {
    background: transparent;
    color: var(--text-muted);
}
.seg-style-s2_gradient .seg-multi-item-inactive:hover {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

/* ============================================================
   方案 2-C：超椭圆柔感蓝（11px 外槽 + 8px 超椭圆 + 4px 扩散柔晕）
   ============================================================ */
.seg-style-s2_squircle .seg-slider-track,
.seg-style-s2_squircle .seg-align-track,
.seg-style-s2_squircle .seg-multi-track {
    border-radius: 11px;
}

.seg-style-s2_squircle .seg-sliding-indicator,
.seg-style-s2_squircle .seg-blue-indicator {
    border-radius: 8px;
    background: var(--accent-main);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent-main) 40%, transparent);
    transition: transform 320ms cubic-bezier(0.18, 0.9, 0.2, 1),
                width 320ms cubic-bezier(0.18, 0.9, 0.2, 1);
}

.seg-style-s2_squircle .seg-multi-item-active {
    border-radius: 8px;
    background: var(--accent-main);
    color: #ffffff;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent-main) 40%, transparent);
}
.seg-style-s2_squircle .seg-multi-item-inactive {
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
}
.seg-style-s2_squircle .seg-multi-item-inactive:hover {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

/* ============================================================
   方案 2-D：高反差电光蓝（深沉暗槽 + 高对比双层发光）
   ============================================================ */
.seg-style-s2_cyan .seg-slider-track,
.seg-style-s2_cyan .seg-align-track,
.seg-style-s2_cyan .seg-multi-track {
    background: color-mix(in srgb, var(--text-main) 16%, transparent);
    border-color: color-mix(in srgb, var(--border-color) 60%, transparent);
}

.seg-style-s2_cyan .seg-sliding-indicator,
.seg-style-s2_cyan .seg-blue-indicator {
    background: var(--accent-main);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-main) 55%, transparent),
                0 0 2px #ffffff;
    transition: transform 280ms cubic-bezier(0.25, 1, 0.35, 1),
                width 280ms cubic-bezier(0.25, 1, 0.35, 1);
}

.seg-style-s2_cyan .seg-multi-item-active {
    background: var(--accent-main);
    color: #ffffff;
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-main) 55%, transparent);
}
.seg-style-s2_cyan .seg-multi-item-inactive {
    background: transparent;
    color: var(--text-muted);
}
.seg-style-s2_cyan .seg-multi-item-inactive:hover {
    color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
}
</style>
