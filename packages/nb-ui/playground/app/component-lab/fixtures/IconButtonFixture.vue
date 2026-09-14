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

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "crystal" | "outlined" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 工具栏微拟物 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简平滑 (BH1 继承)", value: "minimal"},
    {label: "方案 3: 圆润悬浮微晶胶囊", value: "crystal"},
    {label: "方案 4: 精工微线框与呼吸光圈", value: "outlined"},
    {label: "方案 5: 实底微瓷片高对比", value: "solid"},
];

const clickCount = ref(0);
const lastClicked = ref("");
const isToggled = ref(false);

function handleClick(name: string): void {
    clickCount.value++;
    lastClicked.value = name;
    report("click", {name, count: clickCount.value});
}

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    clickCount.value = 0;
    lastClicked.value = "";
    isToggled.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">IconButton 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击任意图标按钮体验真实反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 工具栏微拟物（推荐）</strong>——`rounded-[7px]` 超椭圆；常态纯净镂空，Hover 时平滑淡出 <strong>12% 柔光底板</strong> 与高亮图标，Active 带有 `scale(0.94)` 紧凑回弹与 20% 扎实底色。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简平滑（BH1 继承）</strong>——`rounded-[8px]` 现代大圆角；纯粹的浓度跃升（Hover 15%，Active 24%），无多余阴影干扰，手感极度丝滑。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：圆润悬浮微晶胶囊</strong>——`rounded-full` 正圆形胶囊；Hover 时轻微上浮 1px（`translateY(-1px)`）并淡出 3px 柔和环境扩散阴影。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工微线框与呼吸光圈</strong>——带 1px 浅灰极细线框，Hover 时边框变亮并扩散出 3px 呼吸光晕，结构感极强。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底微瓷片高对比</strong>——常态自带 6% 浅色实底，Hover 跃升至 18%，Accent 变体直接切换为品牌实色底 + 纯白反色图标。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">图标操作与工具栏</h3>
                    <p class="text-xs text-[var(--text-muted)]">支持默认（Default）、强调（Accent）、危险（Danger）、选中与禁用状态。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    图标按钮 · IconButton
                </span>
            </div>

            <!-- 图标按钮展示区 -->
            <div class="stage-box flex flex-col gap-5" :class="`icon-btn-theme-${designStyle}`">
                <!-- 第一组：常用动作工具条 (Medium - 32px) -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">标准工具条 (Medium - 32px):</span>
                    <div class="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--border-color)_50%,transparent)]">
                        <button
                            type="button"
                            title="刷新"
                            class="icon-btn-base icon-btn-md icon-btn-default"
                            @click="handleClick('刷新')"
                        >
                            <span class="i-lucide-refresh-cw" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="复制内容"
                            class="icon-btn-base icon-btn-md icon-btn-default"
                            @click="handleClick('复制')"
                        >
                            <span class="i-lucide-copy" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="编辑"
                            class="icon-btn-base icon-btn-md icon-btn-default"
                            @click="handleClick('编辑')"
                        >
                            <span class="i-lucide-edit-3" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="搜索"
                            class="icon-btn-base icon-btn-md icon-btn-default"
                            @click="handleClick('搜索')"
                        >
                            <span class="i-lucide-search" aria-hidden="true"></span>
                        </button>

                        <div class="h-4 w-[1px] bg-[color-mix(in_srgb,var(--border-color)_80%,transparent)] mx-1"></div>

                        <!-- 强调动作 (Accent) -->
                        <button
                            type="button"
                            title="收藏 / 重点标记"
                            class="icon-btn-base icon-btn-md icon-btn-accent"
                            :class="isToggled ? 'icon-btn-toggled' : ''"
                            @click="isToggled = !isToggled; handleClick(isToggled ? '已收藏' : '取消收藏')"
                        >
                            <span class="i-lucide-star" aria-hidden="true"></span>
                        </button>

                        <!-- 危险删除 (Danger) -->
                        <button
                            type="button"
                            title="删除所选项目"
                            class="icon-btn-base icon-btn-md icon-btn-danger"
                            @click="handleClick('删除')"
                        >
                            <span class="i-lucide-trash-2" aria-hidden="true"></span>
                        </button>

                        <!-- 禁用态 -->
                        <button
                            type="button"
                            title="暂不可用"
                            disabled
                            class="icon-btn-base icon-btn-md icon-btn-default disabled:opacity-35 disabled:cursor-not-allowed"
                            @click="handleClick('禁用项')"
                        >
                            <span class="i-lucide-lock" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>

                <!-- 第二组：紧凑内嵌工具栏 (Small - 26px) -->
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-semibold text-[var(--text-muted)]">紧凑内嵌条 (Small - 26px):</span>
                    <div class="flex items-center gap-1.5 p-1.5 rounded-lg bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] w-fit">
                        <button
                            type="button"
                            title="加粗"
                            class="icon-btn-base icon-btn-sm icon-btn-default"
                            @click="handleClick('加粗')"
                        >
                            <span class="i-lucide-bold text-xs" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="斜体"
                            class="icon-btn-base icon-btn-sm icon-btn-default"
                            @click="handleClick('斜体')"
                        >
                            <span class="i-lucide-italic text-xs" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="插入链接"
                            class="icon-btn-base icon-btn-sm icon-btn-default"
                            @click="handleClick('链接')"
                        >
                            <span class="i-lucide-link text-xs" aria-hidden="true"></span>
                        </button>

                        <button
                            type="button"
                            title="插入代码块"
                            class="icon-btn-base icon-btn-sm icon-btn-default"
                            @click="handleClick('代码块')"
                        >
                            <span class="i-lucide-code text-xs" aria-hidden="true"></span>
                        </button>
                    </div>
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

/* 图标按钮通用基座（盒模型尺寸 100% 绝对稳定） */
.icon-btn-base {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
    outline: none;
    box-sizing: border-box;
    border: 1px solid transparent;
}

.icon-btn-md {
    width: 32px;
    height: 32px;
    font-size: 15px;
}

.icon-btn-sm {
    width: 26px;
    height: 26px;
    font-size: 13px;
}

/* 仅允许非禁用按钮 active 缩放 */
.icon-btn-base:not(:disabled):active {
    transform: scale(0.93);
}
.icon-btn-base:disabled {
    transform: none !important;
}

/* ============================================================
   方案 1：macOS 工具栏微拟物（7px 超椭圆 + 12% 柔光浮现 + 20% 扎实底色 · 推荐）
   ============================================================ */
.icon-btn-theme-macos .icon-btn-base {
    border-radius: 7px;
    transition: background-color 140ms cubic-bezier(0.16, 1, 0.3, 1),
                color 140ms cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 140ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.icon-btn-theme-macos .icon-btn-default {
    color: var(--text-muted);
    background: transparent;
}
.icon-btn-theme-macos .icon-btn-default:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
}
.icon-btn-theme-macos .icon-btn-default:active:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 20%, transparent);
}

.icon-btn-theme-macos .icon-btn-accent {
    color: var(--accent-text);
    background: transparent;
}
.icon-btn-theme-macos .icon-btn-accent:hover:not(:disabled),
.icon-btn-theme-macos .icon-btn-toggled {
    color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
}
.icon-btn-theme-macos .icon-btn-accent:active:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 22%, transparent);
}

.icon-btn-theme-macos .icon-btn-danger {
    color: var(--text-muted);
    background: transparent;
}
.icon-btn-theme-macos .icon-btn-danger:hover:not(:disabled) {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
}
.icon-btn-theme-macos .icon-btn-danger:active:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 22%, transparent);
}

/* ============================================================
   方案 2：现代极简平滑（8px 现代大圆角 + 浓度跃升体系）
   ============================================================ */
.icon-btn-theme-minimal .icon-btn-base {
    border-radius: 8px;
    transition: background-color 150ms cubic-bezier(0.16, 1, 0.3, 1),
                color 150ms cubic-bezier(0.16, 1, 0.3, 1),
                transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
}

.icon-btn-theme-minimal .icon-btn-default {
    color: var(--text-secondary);
    background: transparent;
}
.icon-btn-theme-minimal .icon-btn-default:hover:not(:disabled) {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 15%, transparent);
}
.icon-btn-theme-minimal .icon-btn-default:active:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 24%, transparent);
}

.icon-btn-theme-minimal .icon-btn-accent {
    color: var(--accent-text);
    background: transparent;
}
.icon-btn-theme-minimal .icon-btn-accent:hover:not(:disabled),
.icon-btn-theme-minimal .icon-btn-toggled {
    color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 16%, transparent);
}

.icon-btn-theme-minimal .icon-btn-danger {
    color: var(--text-muted);
    background: transparent;
}
.icon-btn-theme-minimal .icon-btn-danger:hover:not(:disabled) {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 16%, transparent);
}

/* ============================================================
   方案 3：圆润悬浮微晶胶囊（rounded-full 正圆 + translateY(-1px) 柔影）
   ============================================================ */
.icon-btn-theme-crystal .icon-btn-base {
    border-radius: 999px;
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
                background-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
                color 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.icon-btn-theme-crystal .icon-btn-default {
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}
.icon-btn-theme-crystal .icon-btn-default:hover:not(:disabled) {
    color: var(--text-main);
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--text-main) 14%, transparent);
    box-shadow: 0 3px 8px color-mix(in srgb, var(--shadow-color) 14%, transparent);
}
.icon-btn-theme-crystal .icon-btn-default:active:not(:disabled) {
    transform: translateY(0) scale(0.93);
}

.icon-btn-theme-crystal .icon-btn-accent {
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent-main) 6%, transparent);
}
.icon-btn-theme-crystal .icon-btn-accent:hover:not(:disabled),
.icon-btn-theme-crystal .icon-btn-toggled {
    color: var(--accent-main);
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--accent-main) 16%, transparent);
    box-shadow: 0 3px 8px color-mix(in srgb, var(--accent-main) 25%, transparent);
}

.icon-btn-theme-crystal .icon-btn-danger {
    color: var(--text-muted);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
}
.icon-btn-theme-crystal .icon-btn-danger:hover:not(:disabled) {
    color: var(--status-danger);
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--status-danger) 16%, transparent);
    box-shadow: 0 3px 8px color-mix(in srgb, var(--status-danger) 25%, transparent);
}

/* ============================================================
   方案 4：精工微线框与呼吸光圈（1px 线框 + 3px 呼吸光圈）
   ============================================================ */
.icon-btn-theme-outlined .icon-btn-base {
    border-radius: 7px;
    border-color: color-mix(in srgb, var(--text-main) 14%, transparent);
    transition: box-shadow 160ms cubic-bezier(0.16, 1, 0.3, 1),
                border-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                background-color 160ms cubic-bezier(0.16, 1, 0.3, 1),
                color 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.icon-btn-theme-outlined .icon-btn-default {
    color: var(--text-secondary);
    background: transparent;
}
.icon-btn-theme-outlined .icon-btn-default:hover:not(:disabled) {
    color: var(--text-main);
    border-color: color-mix(in srgb, var(--text-main) 30%, transparent);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-main) 10%, transparent);
}

.icon-btn-theme-outlined .icon-btn-accent {
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent-main) 25%, transparent);
    background: transparent;
}
.icon-btn-theme-outlined .icon-btn-accent:hover:not(:disabled),
.icon-btn-theme-outlined .icon-btn-toggled {
    color: var(--accent-main);
    border-color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-main) 20%, transparent);
}

.icon-btn-theme-outlined .icon-btn-danger {
    color: var(--text-muted);
    border-color: color-mix(in srgb, var(--status-danger) 25%, transparent);
}
.icon-btn-theme-outlined .icon-btn-danger:hover:not(:disabled) {
    color: var(--status-danger);
    border-color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 12%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-danger) 20%, transparent);
}

/* ============================================================
   方案 5：实底微瓷片高对比（常态 6% 浅底，Accent 实色反白）
   ============================================================ */
.icon-btn-theme-solid .icon-btn-base {
    border-radius: 7px;
    transition: background-color 150ms ease,
                color 150ms ease,
                transform 120ms ease;
}

.icon-btn-theme-solid .icon-btn-default {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 7%, transparent);
}
.icon-btn-theme-solid .icon-btn-default:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
}

.icon-btn-theme-solid .icon-btn-accent {
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
}
.icon-btn-theme-solid .icon-btn-accent:hover:not(:disabled),
.icon-btn-theme-solid .icon-btn-toggled {
    color: #ffffff;
    background: var(--accent-main);
}

.icon-btn-theme-solid .icon-btn-danger {
    color: var(--status-danger);
    background: color-mix(in srgb, var(--status-danger) 10%, transparent);
}
.icon-btn-theme-solid .icon-btn-danger:hover:not(:disabled) {
    color: #ffffff;
    background: var(--status-danger);
}
</style>
