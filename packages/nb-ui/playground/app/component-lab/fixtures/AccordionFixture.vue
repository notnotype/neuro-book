<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Accordion, {type AccordionItemData} from "../../../../src/components/layout/Accordion.vue";
import Collapsible from "../../../../src/components/layout/Collapsible.vue";
import Button from "../../../../src/components/controls/Button.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "index" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 超椭圆独立分段 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平线条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光卡片", value: "crystal"},
    {label: "方案 4: 精工索引大纲卡槽", value: "index"},
    {label: "方案 5: 实底工控高反差磁块", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const activeItem = ref<string | string[]>("ch1");
const collapsibleOpen = ref(false);

const accordionType = computed(() => (controls.value.type as any) || "single");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const items: AccordionItemData[] = [
    {
        value: "ch1",
        title: "第一章：深渊苏醒与神经回响",
        subtitle: "字数：4,230 · 状态：已校对",
        iconClass: "i-lucide-book-open",
        content: "当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息...",
    },
    {
        value: "ch2",
        title: "第二章：赛博黑市与未解密钥",
        subtitle: "字数：3,890 · 状态：草稿",
        iconClass: "i-lucide-cpu",
        content: "地下十三层的通风管发出沉闷的低吼。接头人把一枚带有生物识别锁的微型芯片推过吧台，上面刻着已经绝迹的旧时代企业徽记...",
    },
    {
        value: "ch3",
        title: "第三章：幽灵协议与记忆碎片",
        subtitle: "字数：5,120 · 状态：大纲",
        iconClass: "i-lucide-shield-alert",
        content: "安全巡检无人机在头顶盘旋，红色的扫描光束切过潮湿的水泥墙面。林澈屏住呼吸，手指按在战术终端的紧急格式化物理开关上...",
    },
];

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    activeItem.value = "ch1";
    collapsibleOpen.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Accordion 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各章节面板体验高度展开与箭头旋转</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 超椭圆独立分段（推荐）</strong>——各面板为 `rounded-[10px]` 独立超椭圆磨砂卡片；展开伴随平滑高度过渡与 Chevron <code>active:scale-[0.92]</code> 旋转回弹。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平线条</strong>——去独立卡片外框；面板间以 1px 细线分隔，展开纯文字内容，手感轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光卡片</strong>——激活展开的面板向外扩散 <strong>4px 品牌弥散光晕</strong>，高质感晶体玻璃。
                    </span>
                    <span v-else-if="designStyle === 'index'" class="scheme-banner-text">
                        <strong>方案 4：精工索引大纲卡槽</strong>——带有前缀大字章节标号（01/02/03）与等宽状态标签，工业级条目感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁块</strong>——深色饱和实底，激活项高亮展开。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="space-y-6 max-w-2xl">
            <!-- 手风琴组件 -->
            <div class="macos-compact-card">
                <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3 mb-4">
                    <div class="flex items-center gap-2">
                        <span class="i-lucide-list-collapse h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                        <h3 class="text-sm font-semibold text-[var(--text-main)]">作品分卷大纲与章节正文手风琴</h3>
                    </div>
                    <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                        手风琴 · Accordion
                    </span>
                </div>

                <Accordion
                    id="nb-lab-target"
                    v-model="activeItem"
                    :type="accordionType"
                    :disabled="disabled"
                    :items="items"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- 轻量受控折叠容器 (Collapsible) -->
            <div class="macos-compact-card">
                <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3 mb-4">
                    <div class="flex items-center gap-2">
                        <span class="i-lucide-chevrons-down-up h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                        <h3 class="text-sm font-semibold text-[var(--text-main)]">世界观专有名词设定折叠面板</h3>
                    </div>
                    <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                        折叠面板 · Collapsible
                    </span>
                </div>

                <Collapsible v-model:open="collapsibleOpen">
                    <template #trigger>
                        <div class="flex items-center justify-between p-3 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)] cursor-pointer select-none">
                            <span class="text-xs font-semibold text-[var(--text-main)]">世界观基础设定：脑机接口与神经潜行体系</span>
                            <Button size="sm" variant="ghost">
                                {{ collapsibleOpen ? "收起" : "展开" }}
                            </Button>
                        </div>
                    </template>

                    <div class="mt-2.5 p-3.5 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_6%,transparent)] text-xs text-[var(--text-secondary)] leading-relaxed">
                        <p class="font-medium text-[var(--text-main)] mb-1">【脑机接口与神经网络接入标准】</p>
                        本世界观采用三级神经接入标准：低阶商用接口（仅支持视听HUD）、中阶执法专线（支持运动神经直连）与军规深潜协议（意识完全映射至量子矩阵）。
                    </div>
                </Collapsible>
            </div>

            <!-- 底部状态指示 -->
            <div class="flex items-center justify-between px-2 text-[11px] text-[var(--text-muted)]">
                <span>当前展开项: <code class="font-mono text-[var(--accent-main)] font-bold">{{ Array.isArray(activeItem) ? activeItem.join(', ') : activeItem || '全部折叠' }}</code></span>
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
