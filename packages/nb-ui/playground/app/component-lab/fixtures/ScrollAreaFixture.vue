<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import ScrollArea from "../../../../src/components/layout/ScrollArea.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "progress" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生自隐平滑滑块 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简 2px 细微指示线", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光滑条", value: "crystal"},
    {label: "方案 4: 阅读进度联动长篇指示", value: "progress"},
    {label: "方案 5: 实底工控高反差滑道", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});

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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">ScrollArea 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">在容器内上下滚动体验滑条的出现与拖拽阻尼</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生自隐平滑滑块（推荐）</strong>——常态透明隐藏；滚动时 6px 超椭圆药丸滑块平滑淡入，停止滚动后延迟 800ms 丝滑淡出，支持惯性与弹性回弹。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简 2px 细微指示线</strong>——常驻超细 2px 线条；低对比度，不打扰阅读视线。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光滑条</strong>——75% 磨砂晶体滑条；拖拽时向外扩散 <strong>3px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'progress'" class="scheme-banner-text">
                        <strong>方案 4：阅读进度联动长篇指示</strong>——滑块附带阅读百分比数字（如 45%），长篇小说专用。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差滑道</strong>——深色粗滑道 + 高反差高亮滑块，工控级视觉。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-scroll text-[var(--accent-main)] h-4 w-4" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">长篇小说正文阅读器滚动视口</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    滚动视口 · ScrollArea
                </span>
            </div>

            <div class="h-64 rounded-[var(--radius-panel)] border border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md p-1">
                <ScrollArea id="nb-lab-target" class="h-full">
                    <div class="p-4 space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                        <h4 class="font-bold text-[var(--text-main)] text-sm">《赛博夜雨》卷首语与世界观白皮书</h4>
                        <p>在新东京的阴雨之下，意识与代码的界限早已模糊。每一次神经连接的火花，都是人类向数字神明献祭的微光。</p>
                        <p>我们在此记录那些在霓虹暗巷中穿梭的影子：被遗弃的赛博格、私自调试军规义体的地下医者，以及在量子暗网中追寻自由的幽灵协议。</p>
                        <p>世界不是由钢铁构成的，而是由流动的数据与不可磨灭的记忆交织而成。当你深潜入意识的奇点，请记住唯一的安全法则：永远不要相信没有经过本地加密的视网膜投影。</p>
                        <p>第七生化实验室的遗迹依然在地下散发着危险的热辐射，那些关于永生与升维的狂热誓言，终将沦为新时代街头流浪者的醉后谈资。</p>
                        <p>在这个由量子巨头垄断的纪元，纯文本是最后的自留地。每一行字符都是未被篡改的真实脉搏。</p>
                    </div>
                </ScrollArea>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>视口尺寸: 100% × 256px</span>
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
