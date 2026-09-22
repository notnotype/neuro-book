<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Toolbar from "../../../../src/components/controls/Toolbar.vue";
import ToggleGroup from "../../../../src/components/controls/ToggleGroup.vue";
import Button from "../../../../src/components/controls/Button.vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
import Separator from "../../../../src/components/layout/Separator.vue";
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
    {label: "方案 1: macOS 原生浮动胶囊工具栏 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平吸顶条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光岛", value: "crystal"},
    {label: "方案 4: 精工微线框模块组", value: "outlined"},
    {label: "方案 5: 实底工控高反差面板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const textFormatting = ref<string[]>(["bold"]);
const textAlignment = ref<string>("left");

const orientation = computed(() => (controls.value.orientation as any) || "horizontal");

const formatOptions = [
    {value: "bold", label: "B", title: "加粗 (⌘B)"},
    {value: "italic", label: "I", title: "斜体 (⌘I)"},
    {value: "underline", label: "U", title: "下划线 (⌘U)"},
    {value: "strikethrough", label: "S", title: "删除线"},
];

const alignOptions = [
    {value: "left", iconClass: "i-lucide-align-left", title: "左对齐"},
    {value: "center", iconClass: "i-lucide-align-center", title: "居中对齐"},
    {value: "right", iconClass: "i-lucide-align-right", title: "右对齐"},
    {value: "justify", iconClass: "i-lucide-align-justify", title: "两端对齐"},
];

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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Toolbar 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击工具栏按键体验多选与单选组联动</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生浮动胶囊工具栏（推荐）</strong>——`rounded-[10px]` 超椭圆；75% 半透明高斯磨砂底座，按键带有 <code>active:scale-[0.93]</code> 紧凑回弹，激活项带 <strong>14% 饱满底色</strong>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平吸顶条</strong>——去独立外框；通栏纯平纯色底板，按键通过 <strong>15% 纯浓度跃升</strong> 分层。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光岛</strong>——`rounded-full` 正圆胶囊浮岛；激活态按键扩散 <strong>3.5px 品牌弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工微线框模块组</strong>——各功能分组以 1px 精工细线微框独立包裹，模块感极强。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差面板</strong>——深色饱满实底，激活项切换为品牌实色底 + 纯白反色高对比图标。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-2xl">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-wrench h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">长篇小说正文编辑器排版工具条</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    工具栏 · Toolbar
                </span>
            </div>

            <!-- 长篇写作富文本编辑工具栏 -->
            <div class="p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Toolbar id="nb-lab-target" :orientation="orientation">
                    <!-- 撤销 / 重做 -->
                    <div class="flex items-center gap-0.5">
                        <IconButton size="sm" icon-class="i-lucide-undo-2" aria-label="撤销 (⌘Z)" />
                        <IconButton size="sm" icon-class="i-lucide-redo-2" aria-label="重做 (⇧⌘Z)" />
                    </div>

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 字体样式多选组 -->
                    <ToggleGroup
                        v-model="textFormatting"
                        type="multiple"
                        size="sm"
                        :options="formatOptions"
                        @update:model-value="emit('lab-event', 'update:formatting', $event)"
                    />

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 对齐方式单选组 -->
                    <ToggleGroup
                        v-model="textAlignment"
                        type="single"
                        size="sm"
                        :options="alignOptions"
                        @update:model-value="emit('lab-event', 'update:alignment', $event)"
                    />

                    <Separator orientation="vertical" class="h-4 mx-1" />

                    <!-- 写作动作 -->
                    <Button size="sm" variant="ghost" icon-class="i-lucide-sparkles">
                        AI 润色
                    </Button>
                </Toolbar>
            </div>

            <!-- 实时排版效果预览区 -->
            <div class="p-4 rounded-xl border border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md space-y-2">
                <div class="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono border-b border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] pb-1.5">
                    <span>排版效果即时渲染</span>
                    <span>格式: {{ textFormatting.join(' + ') || '常规' }} | 对齐: {{ textAlignment }}</span>
                </div>
                <p
                    class="text-sm text-[var(--text-main)] leading-relaxed"
                    :class="[
                        textFormatting.includes('bold') ? 'font-bold' : 'font-normal',
                        textFormatting.includes('italic') ? 'italic' : '',
                        textFormatting.includes('underline') ? 'underline' : '',
                        textFormatting.includes('strikethrough') ? 'line-through' : '',
                        textAlignment === 'center' ? 'text-center' : textAlignment === 'right' ? 'text-right' : textAlignment === 'justify' ? 'text-justify' : 'text-left',
                    ]"
                >
                    在第七实验室的残骸深处，林澈擦去脑机接口外壳上的冷却液。终端屏幕上跳动着暗红色的幽灵通讯协议——那不是系统故障，而是来自五年前沉睡者的量子回声。
                </p>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>工具条布局: {{ orientation === 'horizontal' ? '横向(Horizontal)' : '纵向(Vertical)' }}</span>
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
