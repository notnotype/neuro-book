<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Popover from "../../../../src/components/feedback/Popover.vue";
import HoverCard from "../../../../src/components/feedback/HoverCard.vue";
import Button from "../../../../src/components/controls/Button.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "tooltip" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生触觉气泡 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平卡片", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光气泡", value: "crystal"},
    {label: "方案 4: 精工黑色紧凑刻度", value: "tooltip"},
    {label: "方案 5: 实底工控高反差面板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const popoverOpen = ref(false);
const quickNote = ref("");

const side = computed(() => (controls.value.side as any) || "bottom");
const arrow = computed(() => Boolean(controls.value.arrow) || designStyle.value === "macos");

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    popoverOpen.value = false;
    quickNote.value = "";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Popover 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击按钮或悬停高亮专有名词体验气泡弹层</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生触觉气泡（推荐）</strong>——`rounded-[10px]` 超椭圆；75% 高斯磨砂背板 + 1px 环境反光微边框，微箭头无缝咬合，展开带 <code>scale-[0.96]->1</code> 平滑阻尼缩放。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平卡片</strong>——去箭头；纯平浅底与大字号极简排版，手感轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光气泡</strong>——75% 磨砂晶体气泡，外圈扩散 <strong>4px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'tooltip'" class="scheme-banner-text">
                        <strong>方案 4：精工黑色紧凑刻度</strong>——深黑实底 + 超小字号等宽提示框，工业级精密感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差面板</strong>——深色饱和实底，高反差黑白对比。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg pb-32">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-message-square text-[var(--accent-main)] h-4 w-4" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">行内批注气泡与设定集划词卡片</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    气泡浮层 · Popover
                </span>
            </div>

            <!-- Popover 示例 -->
            <div class="flex items-center gap-4 flex-wrap">
                <Popover
                    id="nb-lab-target"
                    v-model:open="popoverOpen"
                    :side="side"
                    :arrow="arrow"
                    @update:open="emit('lab-event', 'update:open', $event)"
                >
                    <template #trigger>
                        <Button variant="secondary" icon-class="i-lucide-bookmark-plus">
                            添加行内批注 (Popover)
                        </Button>
                    </template>

                    <div class="w-64 space-y-3 p-1">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-[var(--text-main)]">快速批注卡片</span>
                            <Badge size="sm" tone="accent" variant="soft">第 14 行</Badge>
                        </div>
                        <FormInput
                            v-model="quickNote"
                            placeholder="输入批注内容..."
                        />
                        <div class="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" @click="popoverOpen = false">取消</Button>
                            <Button size="sm" variant="primary" @click="popoverOpen = false">保存批注</Button>
                        </div>
                    </div>
                </Popover>
            </div>

            <!-- HoverCard 长篇写作设定集词条划词预览示例 -->
            <div class="p-4 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <p class="text-sm leading-relaxed text-[var(--text-secondary)]">
                    在《赛博夜雨》正文中，主角装备了军规级
                    <HoverCard :side="side" :arrow="arrow">
                        <template #trigger>
                            <span class="inline-flex items-center font-semibold text-[var(--accent-main)] underline decoration-dotted underline-offset-4 cursor-pointer hover:opacity-80">
                                「深潜神经义眼 Mk-IV」
                            </span>
                        </template>

                        <div class="space-y-2 p-1">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-xs font-bold text-[var(--text-main)]">深潜神经义眼 Mk-IV</span>
                                <Badge size="sm" tone="warning" variant="solid">绝密军规</Badge>
                            </div>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                由荒坂科技第七生化实验室研制的特种战术义体，支持全频段电磁波谱感知与量子加密视网膜直连。
                            </p>
                            <div class="flex items-center gap-2 pt-1 text-[11px] text-[var(--text-muted)] border-t border-[var(--divider)]">
                                <span>出场：第1卷第3章</span>
                                <span>·</span>
                                <span>关联人物：林澈</span>
                            </div>
                        </div>
                    </HoverCard>
                    ，在暴雨如注的下城区街头追踪幽灵协议的信号源。
                </p>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>浮层方位: {{ side.toUpperCase() }} | 气泡微箭头: {{ arrow ? '显示' : '隐藏' }}</span>
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
