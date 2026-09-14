<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Dropdown from "../../../../src/components/controls/Dropdown.vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormCheckbox from "../../../../src/components/form/FormCheckbox.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
import FormNumberInput from "../../../../src/components/form/FormNumberInput.vue";
import FormSelect from "../../../../src/components/form/FormSelect.vue";
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
    {label: "方案 1: macOS 超椭圆微胶囊 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平圆点", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: 精工细线微边框", value: "outlined"},
    {label: "方案 5: 实底高反差色块", value: "solid"},
];

// 表单联动数据
const chapterTitle = ref("第一章：神经连接与意识潜流");
const targetWordCount = ref("6000");
const selectedVolume = ref("vol1");
const volumeOptions = [
    {label: "第一卷：深渊苏醒", value: "vol1", iconClass: "i-lucide-book-open", description: "连载中"},
    {label: "第二卷：机械黎明", value: "vol2", iconClass: "i-lucide-book", description: "大纲草案"},
    {label: "外传：赛博夜雨档案", value: "vol3", iconClass: "i-lucide-file-text", description: "番外篇"},
];

const publishStatus = ref("draft");
const publishOptions = [
    {label: "私密草稿", value: "draft", iconClass: "i-lucide-lock"},
    {label: "协同审阅", value: "review", iconClass: "i-lucide-users"},
    {label: "公开发布", value: "published", iconClass: "i-lucide-globe"},
];

const autoBackup = ref(true);
const aiAssist = ref(true);
const branchPlot = ref(false);

const isSaving = ref(false);
const saveFeedback = ref("");

function handleSave(): void {
    isSaving.value = true;
    saveFeedback.value = "";
    setTimeout(() => {
        isSaving.value = false;
        saveFeedback.value = "全部更改已同步！";
        setTimeout(() => { saveFeedback.value = ""; }, 3000);
    }, 600);
}

// 更多操作下拉菜单项
const dropdownItems = [
    {label: "创建历史快照版本", value: "snapshot", iconClass: "i-lucide-history"},
    {label: "导出为 Markdown...", value: "export", iconClass: "i-lucide-download"},
    {label: "锁定当前章节", value: "lock", iconClass: "i-lucide-lock"},
    {label: "", value: "sep-1", separator: true},
    {label: "移入废纸篓", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Badge 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">在作品属性卡片中预览徽章的层级与视觉融合度</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 超椭圆微胶囊（推荐）</strong>——`rounded-[4.5px]` Squircle；14% 饱满柔和浅底 + 纯正字体色 + 1px 细微环境边框，非刺眼色块，与界面沉静融合。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平圆点</strong>——去背景框；仅由 6px 纯色呼吸实心圆点 + 紧凑文字组成，手感极简。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——半透明高斯磨砂晶体，向外扩散 <strong>3px 同色柔和弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工细线微边框</strong>——1px 锐利单色线框，工业级精密感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底高反差色块</strong>——饱和纯色实底 + 纯白高对比反色文字。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑高质感 macOS 工作区卡片 -->
        <div class="macos-compact-card">
            <!-- 卡片顶部工具栏：标题、徽章与操作按钮 -->
            <div class="flex items-center justify-between gap-3 pb-3.5 mb-4 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                <div class="flex items-center gap-2.5 flex-wrap">
                    <h3 class="text-sm font-bold text-[var(--text-main)]">章节属性与设定</h3>
                    <Badge
                        id="nb-lab-target"
                        tone="accent"
                        icon-class="i-lucide-git-branch"
                    >
                        正文主线
                    </Badge>
                    <Badge tone="warning" icon-class="i-lucide-clock">连载中</Badge>
                    <Badge tone="success" icon-class="i-lucide-shield-check">已校对</Badge>
                    <Badge tone="neutral">v1.4</Badge>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                    <Dropdown
                        :items="dropdownItems"
                        @select="emit('lab-event', 'dropdown-select', $event)"
                    >
                        <template #trigger>
                            <IconButton
                                size="sm"
                                variant="default"
                                icon-class="i-lucide-more-horizontal"
                                aria-label="更多操作"
                            />
                        </template>
                    </Dropdown>

                    <Button
                        size="sm"
                        variant="primary"
                        icon-class="i-lucide-check"
                        :loading="isSaving"
                        @click="handleSave"
                    >
                        保存
                    </Button>
                </div>
            </div>

            <!-- 表单内容网格 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                <div class="md:col-span-2">
                    <FormInput
                        v-model="chapterTitle"
                        label="章节大纲主标题"
                        placeholder="请输入章节名称..."
                        hint="对应目录中的对外展示名称"
                    />
                </div>

                <div>
                    <FormSelect
                        v-model="selectedVolume"
                        :options="volumeOptions"
                        label="所属分卷"
                    />
                </div>

                <div>
                    <FormSelect
                        v-model="publishStatus"
                        :options="publishOptions"
                        label="发布状态"
                    />
                </div>

                <div>
                    <FormNumberInput
                        v-model="targetWordCount"
                        label="计划目标字数"
                        step="500"
                        min="1000"
                        max="50000"
                    />
                </div>

                <div class="flex flex-col justify-end">
                    <div class="p-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)] flex items-center justify-between">
                        <span class="text-[var(--text-muted)]">当前统计:</span>
                        <span class="font-mono font-bold text-[var(--text-main)]">4,820 字 / 80.3%</span>
                    </div>
                </div>

                <div class="md:col-span-2 pt-2 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)]">
                    <div class="flex flex-wrap items-center gap-5">
                        <FormCheckbox v-model="autoBackup" label="实时本地快照备份" />
                        <FormCheckbox v-model="aiAssist" label="AI 续写感知注入" />
                        <FormCheckbox v-model="branchPlot" label="开启支线平行世界" />
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>{{ saveFeedback || "提示：Badge 徽章广泛应用于章节状态、标签分类与版本指示。" }}</span>
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
