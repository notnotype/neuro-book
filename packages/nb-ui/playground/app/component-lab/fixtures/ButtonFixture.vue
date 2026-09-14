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

// 4 种基于 BH1（浓度跃升平滑渐变）的细分衍生方案
const designStyle = ref<"bh1_a" | "bh1_b" | "bh1_c" | "bh1_d">("bh1_c");
const designOptions = [
    {label: "BH1-A: 纯平阶梯浓度跃升", value: "bh1_a"},
    {label: "BH1-B: 浓度跃升 + 精工微轮廓", value: "bh1_b"},
    {label: "BH1-C: 浓度跃升 + 触觉柔光底影 (推荐)", value: "bh1_c"},
    {label: "BH1-D: 浓度跃升 + 品牌饱和增益", value: "bh1_d"},
];

const clickCount = ref(0);
const lastClicked = ref("");
const isLoading = ref(false);

function handleClick(name: string): void {
    clickCount.value++;
    lastClicked.value = name;
    report("click", {name, count: clickCount.value});
}

function triggerLoading(): void {
    isLoading.value = true;
    setTimeout(() => {
        isLoading.value = false;
    }, 1500);
}

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    clickCount.value = 0;
    lastClicked.value = "";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">BH1 细分方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">基于 BH1 浓度跃升与平滑渐变体系</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">BH1 解析</span>
                    <span v-if="designStyle === 'bh1_a'" class="scheme-banner-text">
                        <strong>方案 BH1-A：纯平阶梯浓度跃升</strong>——常态 6% 浅底 → Hover <strong>16% 饱满实底</strong> → Active <strong>24% 坚实沉淀</strong>。无任何多余投影，纯靠色彩阶梯浓度跃升，极度纯粹。
                    </span>
                    <span v-else-if="designStyle === 'bh1_b'" class="scheme-banner-text">
                        <strong>方案 BH1-B：浓度跃升 + 精工微轮廓</strong>——Hover 时底色跃升至 18%，同时浮现 <strong>0.5px 精细微光轮廓</strong>，轮廓如精密切割般工整扎实。
                    </span>
                    <span v-else-if="designStyle === 'bh1_c'" class="scheme-banner-text">
                        <strong>方案 BH1-C：浓度跃升 + 触觉柔光底影（推荐）</strong>——Hover 时底色跃升至 18%，底部同步平滑淡出 <strong>2.5px 同色/环境柔晕</strong>，触觉反馈饱满扎实。
                    </span>
                    <span v-else-if="designStyle === 'bh1_d'" class="scheme-banner-text">
                        <strong>方案 BH1-D：浓度跃升 + 品牌饱和增益</strong>——Hover 时 Secondary 底色微量融入 4% 主题色，Primary 色彩纯度（Saturate）微调，呈现出与品牌主色相互呼应的高级感。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">操作与动作触发器</h3>
                    <p class="text-xs text-[var(--text-muted)]">按钮宽度绝对锁定（加载态零尺寸抖动），禁用态禁止任何缩放。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    极简按钮 · Button
                </span>
            </div>

            <!-- 按钮展示区 -->
            <div class="stage-box flex flex-col gap-5" :class="`btn-theme-${designStyle}`">
                <!-- 第一组：常用核心变体（Primary / Secondary / Danger / Ghost） -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">标准尺寸 (Medium - 32px):</span>
                    <div class="flex flex-wrap items-center gap-2.5">
                        <button
                            id="nb-lab-target"
                            type="button"
                            class="btn-base btn-primary"
                            @click="handleClick('主要操作')"
                        >
                            <span class="i-lucide-check text-sm" aria-hidden="true"></span>
                            <span>主要操作 (Primary)</span>
                        </button>

                        <button
                            type="button"
                            class="btn-base btn-secondary"
                            @click="handleClick('次要操作')"
                        >
                            <span>次要操作 (Secondary)</span>
                        </button>

                        <button
                            type="button"
                            class="btn-base btn-danger"
                            @click="handleClick('危险删除')"
                        >
                            <span class="i-lucide-trash-2 text-sm" aria-hidden="true"></span>
                            <span>危险操作 (Danger)</span>
                        </button>

                        <button
                            type="button"
                            class="btn-base btn-ghost"
                            @click="handleClick('取消')"
                        >
                            <span>取消 (Ghost)</span>
                        </button>
                    </div>
                </div>

                <!-- 第二组：小尺寸与紧凑操作 (Small - 26px) -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">紧凑小尺寸 (Small - 26px):</span>
                    <div class="flex flex-wrap items-center gap-2.5">
                        <button
                            type="button"
                            class="btn-base btn-sm btn-primary min-w-[76px] justify-center"
                            @click="handleClick('小尺寸主要')"
                        >
                            <span>快速保存</span>
                        </button>

                        <button
                            type="button"
                            class="btn-base btn-sm btn-secondary"
                            @click="handleClick('小尺寸次要')"
                        >
                            <span class="i-lucide-download text-xs" aria-hidden="true"></span>
                            <span>导出数据</span>
                        </button>

                        <button
                            type="button"
                            class="btn-base btn-sm btn-subtle"
                            @click="handleClick('小尺寸弱化')"
                        >
                            <span>重置默认</span>
                        </button>

                        <!-- 锁定宽度的加载按钮：从「点击加载」切换为「同步中...」宽度 0 改变 -->
                        <button
                            type="button"
                            class="btn-base btn-sm btn-secondary min-w-[94px] justify-center"
                            :disabled="isLoading"
                            @click="triggerLoading"
                        >
                            <span v-if="isLoading" class="i-lucide-loader-2 text-xs animate-spin shrink-0" aria-hidden="true"></span>
                            <span v-else class="i-lucide-refresh-cw text-xs shrink-0" aria-hidden="true"></span>
                            <span>{{ isLoading ? '同步中...' : '点击加载' }}</span>
                        </button>

                        <!-- 严格禁用按钮：测试点击绝不发生缩放 -->
                        <button
                            type="button"
                            disabled
                            class="btn-base btn-sm btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                            @click="handleClick('禁用按钮')"
                        >
                            <span>已禁用 (无缩放)</span>
                        </button>
                    </div>
                </div>

                <!-- 第三组：通栏块级按钮 (Block Button) -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">通栏大按钮 (Full Width Block):</span>
                    <button
                        type="button"
                        class="btn-base btn-primary w-full justify-center"
                        @click="handleClick('立即发布作品')"
                    >
                        <span class="i-lucide-send text-sm" aria-hidden="true"></span>
                        <span>立即发布长篇作品</span>
                    </button>
                </div>

                <!-- 交互状态反馈区 -->
                <div v-if="lastClicked" class="flex items-center justify-between p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] border border-[color-mix(in_srgb,var(--accent-main)_20%,transparent)]">
                    <span class="text-xs text-[var(--text-main)]">
                        最后触发：<strong>{{ lastClicked }}</strong>
                    </span>
                    <span class="text-xs font-mono text-[var(--accent-main)]">
                        点击计数: {{ clickCount }}
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

/* 按钮通用基座（盒模型尺寸 100% 绝对锁定，防抖动） */
.btn-base {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    outline: none;
    box-sizing: border-box;
    border: 1px solid transparent;
}

.btn-sm {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    gap: 4px;
}

/* 仅允许非禁用按钮在 active 时缩放，禁用按钮严禁缩放 */
.btn-base:not(:disabled):active {
    transform: scale(0.975);
}
.btn-base:disabled {
    transform: none !important;
}

/* ============================================================
   方案 BH1-A：纯平阶梯浓度跃升（6% -> 16% -> 24% 纯色阶梯，150ms）
   ============================================================ */
.btn-theme-bh1_a .btn-base {
    transition: background-color 150ms cubic-bezier(0.16, 1, 0.3, 1),
                color 150ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-theme-bh1_a .btn-primary {
    color: #ffffff;
    background: var(--accent-main);
}
.btn-theme-bh1_a .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 88%, #000000);
}
.btn-theme-bh1_a .btn-primary:active:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 78%, #000000);
}

.btn-theme-bh1_a .btn-secondary {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}
.btn-theme-bh1_a .btn-secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 16%, transparent);
}
.btn-theme-bh1_a .btn-secondary:active:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 24%, transparent);
}

.btn-theme-bh1_a .btn-danger {
    color: #ffffff;
    background: var(--status-danger);
}
.btn-theme-bh1_a .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 88%, #000000);
}

.btn-theme-bh1_a .btn-subtle {
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}
.btn-theme-bh1_a .btn-subtle:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
}

.btn-theme-bh1_a .btn-ghost {
    color: var(--text-secondary);
    background: transparent;
}
.btn-theme-bh1_a .btn-ghost:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

/* ============================================================
   方案 BH1-B：浓度跃升 + 精工微轮廓（18% 底色 + 0.5px 精细外框）
   ============================================================ */
.btn-theme-bh1_b .btn-base {
    transition: background-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                border-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-theme-bh1_b .btn-primary {
    color: #ffffff;
    background: var(--accent-main);
    border-color: color-mix(in srgb, var(--accent-main) 90%, #000000);
}
.btn-theme-bh1_b .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 86%, #000000);
    border-color: color-mix(in srgb, var(--accent-main) 70%, #000000);
}

.btn-theme-bh1_b .btn-secondary {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
    border-color: color-mix(in srgb, var(--text-main) 10%, transparent);
}
.btn-theme-bh1_b .btn-secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    border-color: color-mix(in srgb, var(--text-main) 22%, transparent);
}

.btn-theme-bh1_b .btn-danger {
    color: #ffffff;
    background: var(--status-danger);
    border-color: color-mix(in srgb, var(--status-danger) 90%, #000000);
}
.btn-theme-bh1_b .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 86%, #000000);
}

.btn-theme-bh1_b .btn-subtle {
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
    border-color: transparent;
}
.btn-theme-bh1_b .btn-subtle:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 14%, transparent);
    border-color: color-mix(in srgb, var(--text-main) 14%, transparent);
}

.btn-theme-bh1_b .btn-ghost {
    color: var(--text-secondary);
    background: transparent;
}
.btn-theme-bh1_b .btn-ghost:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
}

/* ============================================================
   方案 BH1-C：浓度跃升 + 触觉柔光底影（18% 底色 + 2.5px 柔和底晕 · 推荐）
   ============================================================ */
.btn-theme-bh1_c .btn-base {
    transition: background-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 160ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-theme-bh1_c .btn-primary {
    color: #ffffff;
    background: var(--accent-main);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--accent-main) 25%, transparent);
}
.btn-theme-bh1_c .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 86%, #000000);
    box-shadow: 0 2.5px 8px color-mix(in srgb, var(--accent-main) 40%, transparent);
}
.btn-theme-bh1_c .btn-primary:active:not(:disabled) {
    box-shadow: 0 1px 2px color-mix(in srgb, var(--accent-main) 20%, transparent);
}

.btn-theme-bh1_c .btn-secondary {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}
.btn-theme-bh1_c .btn-secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    box-shadow: 0 2px 6px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}

.btn-theme-bh1_c .btn-danger {
    color: #ffffff;
    background: var(--status-danger);
}
.btn-theme-bh1_c .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 86%, #000000);
    box-shadow: 0 2.5px 8px color-mix(in srgb, var(--status-danger) 40%, transparent);
}

.btn-theme-bh1_c .btn-subtle {
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}
.btn-theme-bh1_c .btn-subtle:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 14%, transparent);
}

.btn-theme-bh1_c .btn-ghost {
    color: var(--text-secondary);
    background: transparent;
}
.btn-theme-bh1_c .btn-ghost:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
}

/* ============================================================
   方案 BH1-D：浓度跃升 + 品牌饱和增益（融入 4% 主题色 + 饱和度微调）
   ============================================================ */
.btn-theme-bh1_d .btn-base {
    transition: background-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                filter 160ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-theme-bh1_d .btn-primary {
    color: #ffffff;
    background: var(--accent-main);
}
.btn-theme-bh1_d .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 88%, #000000);
    filter: saturate(1.12);
}

.btn-theme-bh1_d .btn-secondary {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}
.btn-theme-bh1_d .btn-secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 6%, color-mix(in srgb, var(--text-main) 16%, transparent));
}

.btn-theme-bh1_d .btn-danger {
    color: #ffffff;
    background: var(--status-danger);
}
.btn-theme-bh1_d .btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 88%, #000000);
    filter: saturate(1.12);
}

.btn-theme-bh1_d .btn-subtle {
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}
.btn-theme-bh1_d .btn-subtle:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--accent-main) 4%, color-mix(in srgb, var(--text-main) 12%, transparent));
}

.btn-theme-bh1_d .btn-ghost {
    color: var(--text-secondary);
    background: transparent;
}
.btn-theme-bh1_d .btn-ghost:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
}
</style>
