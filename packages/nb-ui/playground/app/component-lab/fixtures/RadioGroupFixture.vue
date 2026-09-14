<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import RadioGroup, {type RadioOption} from "../../../../src/components/form/RadioGroup.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "tile" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生实心同心圆 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平线条", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 独立磁吸选择卡片", value: "tile"},
    {label: "方案 5: 实底工控高反差方圆", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const exportFormat = ref("epub");
const aiModel = ref("claude");

const orientation = computed(() => (controls.value.orientation as any) || "vertical");
const size = computed(() => (controls.value.size as any) || "md");
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const formatOptions: RadioOption[] = [
    {value: "epub", label: "EPUB 电子书", description: "标准电子书格式，适配各大主流移动端阅读器"},
    {value: "pdf", label: "PDF 印刷版式", description: "严格固定版面与字体排版，适合实体装订与打印"},
    {value: "docx", label: "Word 文档 (.docx)", description: "适合与出版社编辑进行批注与审校协作"},
    {value: "txt", label: "纯文本 (.txt)", description: "零格式干净纯文本，体积最小"},
];

const modelOptions: RadioOption[] = [
    {value: "claude", label: "Claude 3.5 Sonnet", description: "长文情节续写与深度人物心理刻画"},
    {value: "gpt4", label: "GPT-4o", description: "快速情节风暴与多语言翻译"},
    {value: "local", label: "本地模型 (Ollama)", description: "100% 离线私密长篇大纲生成"},
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">RadioGroup 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各单选项体验同心圆与卡片式交互反馈</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生实心同心圆（推荐）</strong>——标准同心圆环；按压带有 <code>active:scale-[0.92]</code> 紧凑弹性回弹，选中态为 <strong>纯正品牌实底 + 纯白微圆点弹入</strong>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平线条</strong>——去实底填充；单选圈内仅极细 1.5px 同色细线圆点，手感极轻。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——选中条目整行平滑浮出 <strong>3.5px 品牌柔和弥散光晕</strong> 与磨砂浅底。
                    </span>
                    <span v-else-if="designStyle === 'tile'" class="scheme-banner-text">
                        <strong>方案 4：独立磁吸选择卡片</strong>——将每个单选项封装为独立磨砂卡片，选中时边框与角标高亮。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差方圆</strong>——`rounded-[4px]` 硬质方圆；选中态整项切换为深色饱和实底 + 反色高对比文字。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-check-circle h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品输出与创作辅助引擎选择</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    单选组 · RadioGroup
                </span>
            </div>

            <!-- 导出格式选择 -->
            <div>
                <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-3">作品导出目标文件格式:</span>
                <RadioGroup
                    id="nb-lab-target"
                    v-model="exportFormat"
                    :options="formatOptions"
                    :orientation="orientation"
                    :size="size"
                    :disabled="disabled"
                    @update:model-value="emit('lab-event', 'update:modelValue', $event)"
                />
            </div>

            <!-- AI 创作助手模型选择 -->
            <div class="pt-4 border-t border-[var(--divider)]">
                <span class="block text-xs font-semibold text-[var(--text-secondary)] mb-3">辅助写作大语言模型选择:</span>
                <RadioGroup
                    v-model="aiModel"
                    :options="modelOptions"
                    :size="size"
                    :disabled="disabled"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>选定格式: {{ exportFormat.toUpperCase() }} | 模型: {{ aiModel }}</span>
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
