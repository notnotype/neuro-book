<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Menubar, {type MenubarMenuData} from "../../../../src/components/controls/Menubar.vue";
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
    {label: "方案 1: macOS 原生应用菜单 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平顶栏", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光岛", value: "crystal"},
    {label: "方案 4: 精工微线框菜单", value: "outlined"},
    {label: "方案 5: 实底工控高反差磁条", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const size = computed(() => (controls.value.size as any) || "md");
const lastAction = ref<string>("");

const menus: MenubarMenuData[] = [
    {
        id: "file",
        label: "文件 (File)",
        items: [
            {label: "新建章节", value: "new-chapter", shortcut: "⌘N", iconClass: "i-lucide-file-plus"},
            {label: "快速保存", value: "save", shortcut: "⌘S", iconClass: "i-lucide-save"},
            {
                label: "导出作品",
                value: "export",
                iconClass: "i-lucide-download",
                children: [
                    {label: "EPUB 电子书", value: "export-epub", iconClass: "i-lucide-book"},
                    {label: "PDF 文档", value: "export-pdf", iconClass: "i-lucide-file-text"},
                    {label: "Markdown 纯文本", value: "export-md"},
                ],
            },
            {label: "", value: "sep-1", separator: true},
            {label: "删除章节", value: "delete", shortcut: "⌫", iconClass: "i-lucide-trash-2", tone: "danger"},
        ],
    },
    {
        id: "edit",
        label: "编辑 (Edit)",
        items: [
            {label: "撤销", value: "undo", shortcut: "⌘Z", iconClass: "i-lucide-undo-2"},
            {label: "重做", value: "redo", shortcut: "⇧⌘Z", iconClass: "i-lucide-redo-2"},
            {label: "", value: "sep-2", separator: true},
            {label: "剪切", value: "cut", shortcut: "⌘X"},
            {label: "复制", value: "copy", shortcut: "⌘C"},
            {label: "粘贴", value: "paste", shortcut: "⌘V"},
        ],
    },
    {
        id: "write",
        label: "写作 (Write)",
        items: [
            {label: "AI 智能情节续写", value: "ai-continue", shortcut: "⌥Space", iconClass: "i-lucide-sparkles"},
            {label: "全屏沉浸专注模式", value: "focus-mode", shortcut: "⌃⌘F", iconClass: "i-lucide-maximize"},
            {label: "字数与阅读时长统计", value: "word-count", iconClass: "i-lucide-bar-chart-2"},
        ],
    },
    {
        id: "help",
        label: "帮助 (Help)",
        items: [
            {label: "快捷键指南", value: "shortcuts", shortcut: "⌘/", iconClass: "i-lucide-keyboard"},
            {label: "关于 NeuroBook", value: "about", iconClass: "i-lucide-info"},
        ],
    },
];

function handleSelect(item: any): void {
    lastAction.value = typeof item === "string" ? item : item?.label || item?.value || "menu-item";
    emit("lab-event", "select", item);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    lastAction.value = "";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Menubar 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各菜单项体验下拉弹层与级联子菜单</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生应用菜单（推荐）</strong>——`rounded-[6px]` 触发项；展开下拉菜单带 <strong>75% 高斯磨砂 + 柔光反光边缘</strong>，支持键盘左右横向穿梭与二级子菜单级联。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平顶栏</strong>——去边框底板；菜单项常态纯文字，悬停仅 <strong>12% 柔和底色高亮</strong>，手感轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光岛</strong>——胶囊形磨砂顶栏；下拉弹层带 <strong>4px 柔和环境弥散光晕</strong>，高质感晶体玻璃。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 4：精工微线框菜单</strong>——1px 精工细微线框 + 快捷键等宽硬质 Kbd 键帽，工业精密感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁条</strong>——深色饱满实底，激活项切换为品牌实色底 + 纯白反色高对比条目。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-2xl pb-24">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-menu h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">NeuroBook 桌面端主视窗应用菜单</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    应用菜单栏 · Menubar
                </span>
            </div>

            <!-- 菜单栏展示 -->
            <div class="flex items-center justify-between p-2 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Menubar
                    id="nb-lab-target"
                    :menus="menus"
                    :size="size"
                    @select="handleSelect"
                />
            </div>

            <!-- 交互反馈信息条 -->
            <div v-if="lastAction" class="rounded-lg p-2.5 border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] flex items-center justify-between text-xs">
                <span class="text-[var(--text-main)]">触发菜单动作: <code class="font-mono text-[var(--accent-main)] font-bold">{{ lastAction }}</code></span>
                <button type="button" class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer" @click="lastAction = ''">清除</button>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>包含菜单根组: {{ menus.length }} 组</span>
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
