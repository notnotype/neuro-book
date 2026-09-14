<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
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

// 当前选中的方案模式
const selectedScheme = ref<"all" | "scheme1" | "scheme2" | "scheme3" | "scheme4" | "scheme5">("all");
const schemeOptions = [
    {label: "全部 5 种方案对比", value: "all"},
    {label: "方案 1: macOS 原生平滑下划线", value: "scheme1"},
    {label: "方案 2: macOS 经典平移胶囊", value: "scheme2"},
    {label: "方案 3: 沉浸式多文档页签 (Safari/VSCode)", value: "scheme3"},
    {label: "方案 4: Linear 极简呼吸微光", value: "scheme4"},
    {label: "方案 5: VisionOS 悬浮玻璃岛屿", value: "scheme5"},
];

// 各方案的选中状态
const tab1 = ref("outline");
const tab2 = ref("outline");
const tab3 = ref("doc1");
const tab4 = ref("outline");
const tab5 = ref("outline");

// 标准 Tab 项数据（含图标与 Count Badge）
const standardTabs = [
    {value: "outline", label: "大纲架构", icon: "i-lucide-list-tree", count: "12"},
    {value: "characters", label: "角色图谱", icon: "i-lucide-users", count: "8"},
    {value: "timeline", label: "故事时间线", icon: "i-lucide-clock", count: "24"},
    {value: "references", label: "设定资料库", icon: "i-lucide-book-open", count: "5"},
    {value: "archive", label: "已归档草稿", icon: "i-lucide-archive", disabled: true},
];

// 多文档 Tab 数据（用于方案 3）
const docTabs = [
    {value: "doc1", label: "第一章：神经连接.md", dirty: false, icon: "i-lucide-file-text"},
    {value: "doc2", label: "第二章：深渊回响.md", dirty: true, icon: "i-lucide-file-text"},
    {value: "doc3", label: "世界观设定集.nb", dirty: false, icon: "i-lucide-book-bookmark"},
    {value: "doc4", label: "登场人物档案.json", dirty: false, icon: "i-lucide-user-check"},
];

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    tab1.value = "outline";
    tab2.value = "outline";
    tab3.value = "doc1";
    tab4.value = "outline";
    tab5.value = "outline";
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
        <!-- 顶层实心控制容器 -->
        <div class="macos-compact-card mb-6">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <span class="text-xs font-semibold text-[var(--text-muted)] shrink-0">方案切换：</span>
                    <SegmentedControl
                        v-model="selectedScheme"
                        :options="schemeOptions"
                        size="sm"
                    />
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)] shrink-0">
                    Tabs 标签页工坊 · 5 种方案
                </span>
            </div>
        </div>

        <div class="flex flex-col gap-6">
            <!-- ================= 方案 1: macOS 原生平滑指示线 (Underline Indicator) ================= -->
            <div
                v-if="selectedScheme === 'all' || selectedScheme === 'scheme1'"
                class="macos-compact-card"
            >
                <div class="scheme-header">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2">
                            <span class="scheme-tag">方案 1</span>
                            macOS 原生平滑下划线（Underline Indicator · 经典自适应滑动）
                        </h4>
                        <p class="text-xs text-[var(--text-muted)] mt-1">
                            经典 Apple 开发者控制台与 Xcode 风格。底部带 1px 细基准线，选中的 2.5px Apple 蓝指示条具有平滑弹簧阻尼横移。
                        </p>
                    </div>
                    <span class="text-xs font-mono text-[var(--accent-main)]">选中: {{ tab1 }}</span>
                </div>

                <!-- 实底演示画布 -->
                <div class="stage-canvas">
                    <!-- 默认方案（方案 1）的页签条是检查器的取样目标：整个 fixture 只此一处 id，多方案同屏也不会重号 -->
                    <div
                        id="nb-lab-target"
                        class="relative flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] px-3 bg-[var(--bg-main)] rounded-t-lg"
                    >
                        <button
                            v-for="item in standardTabs"
                            :key="item.value"
                            type="button"
                            :disabled="item.disabled"
                            class="relative flex items-center gap-2 py-3 px-3.5 text-[13px] font-medium transition-colors cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                            :class="[
                                tab1 === item.value
                                    ? 'text-[var(--accent-main)] font-semibold'
                                    : 'text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] rounded-t-[6px]'
                            ]"
                            @click="tab1 = item.value"
                        >
                            <span :class="[item.icon, 'h-4 w-4 shrink-0']"></span>
                            <span>{{ item.label }}</span>
                            <span
                                v-if="item.count"
                                class="px-1.5 py-0.2 rounded-full text-[10px] font-mono"
                                :class="tab1 === item.value ? 'bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)] font-semibold' : 'bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] text-[var(--text-muted)]'"
                            >{{ item.count }}</span>

                            <!-- 底部 2.5px 蓝指示条 -->
                            <span
                                v-if="tab1 === item.value"
                                class="absolute bottom-[-1px] left-0 right-0 h-[2.5px] rounded-full bg-[var(--accent-main)] shadow-[0_1px_4px_color-mix(in_srgb,var(--accent-main)_40%,transparent)]"
                            ></span>
                        </button>
                    </div>

                    <!-- 联动内容预览区 -->
                    <div class="p-4 bg-[var(--bg-main)] rounded-b-lg border-x border-b border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] text-xs text-[var(--text-secondary)] flex items-center justify-between">
                        <span>当前查看视图：<strong>{{ standardTabs.find(t => t.value === tab1)?.label }}</strong></span>
                        <span class="text-[var(--text-muted)]">适用场景：页面级/模块级主导航</span>
                    </div>
                </div>
            </div>

            <!-- ================= 方案 2: macOS 经典平移胶囊 (Capsule / Pill Bar) ================= -->
            <div
                v-if="selectedScheme === 'all' || selectedScheme === 'scheme2'"
                class="macos-compact-card"
            >
                <div class="scheme-header">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2">
                            <span class="scheme-tag">方案 2</span>
                            macOS 经典平移胶囊（Capsule / Pill · 紧凑悬浮卡片）
                        </h4>
                        <p class="text-xs text-[var(--text-muted)] mt-1">
                            macOS 系统偏好设置与 Finder 工具栏风格。整栏嵌入磨砂底座中，选中项为立体高光白底微胶囊，层次分明。
                        </p>
                    </div>
                    <span class="text-xs font-mono text-[var(--accent-main)]">选中: {{ tab2 }}</span>
                </div>

                <!-- 实底演示画布 -->
                <div class="stage-canvas flex flex-col gap-3">
                    <div class="inline-flex items-center gap-1 p-1 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] border border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] shadow-sm">
                        <button
                            v-for="item in standardTabs"
                            :key="item.value"
                            type="button"
                            :disabled="item.disabled"
                            class="relative flex items-center gap-2 px-3.5 py-1.5 rounded-[7px] text-[13px] font-medium transition-all duration-200 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                            :class="[
                                tab2 === item.value
                                    ? 'bg-[var(--bg-main)] text-[var(--text-main)] shadow-[0_2px_8px_color-mix(in_srgb,var(--shadow-color)_20%,transparent),0_0_0_1px_color-mix(in_srgb,var(--text-main)_10%,transparent)] font-semibold'
                                    : 'text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)]'
                            ]"
                            @click="tab2 = item.value"
                        >
                            <span :class="[item.icon, 'h-4 w-4 shrink-0', tab2 === item.value ? 'text-[var(--accent-main)]' : '']"></span>
                            <span>{{ item.label }}</span>
                            <span
                                v-if="item.count"
                                class="px-1.5 py-0.2 rounded-full text-[10px] font-mono"
                                :class="tab2 === item.value ? 'bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] text-[var(--accent-main)]' : 'bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] text-[var(--text-muted)]'"
                            >{{ item.count }}</span>
                        </button>
                    </div>

                    <!-- 联动内容预览区 -->
                    <div class="p-4 bg-[var(--bg-main)] rounded-lg border border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] text-xs text-[var(--text-secondary)] flex items-center justify-between">
                        <span>当前激活分段：<strong>{{ standardTabs.find(t => t.value === tab2)?.label }}</strong></span>
                        <span class="text-[var(--text-muted)]">适用场景：属性面板 Inspector、二级过滤分类</span>
                    </div>
                </div>
            </div>

            <!-- ================= 方案 3: 沉浸式多文档页签 (Safari / VS Code Modern) ================= -->
            <div
                v-if="selectedScheme === 'all' || selectedScheme === 'scheme3'"
                class="macos-compact-card"
            >
                <div class="scheme-header">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2">
                            <span class="scheme-tag">方案 3</span>
                            沉浸式多文档页签（Document File Tabs · Safari / VSCode 顶接融合）
                        </h4>
                        <p class="text-xs text-[var(--text-muted)] mt-1">
                            专业长篇写作与多文件编辑器专享。激活标签与下方面板 100% 无缝融合贯通，支持未保存脏标记（●）与关闭按钮（×）。
                        </p>
                    </div>
                    <span class="text-xs font-mono text-[var(--accent-main)]">编辑: {{ tab3 }}</span>
                </div>

                <!-- 实底演示画布 -->
                <div class="stage-canvas">
                    <div class="w-full flex items-end gap-1 border-b border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] px-2 bg-[color-mix(in_srgb,var(--bg-panel)_80%,transparent)] pt-2 rounded-t-xl">
                        <div
                            v-for="doc in docTabs"
                            :key="doc.value"
                            class="group relative flex items-center gap-2 px-3.5 py-2 rounded-t-[9px] text-[13px] font-medium transition-all duration-150 cursor-pointer select-none border-t border-x"
                            :class="[
                                tab3 === doc.value
                                    ? 'bg-[var(--bg-main)] text-[var(--text-main)] border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] -mb-[1px] pb-[9px] shadow-sm font-semibold'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--bg-panel)_90%,transparent)]'
                            ]"
                            @click="tab3 = doc.value"
                        >
                            <span :class="[doc.icon, 'h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]', tab3 === doc.value ? 'text-[var(--accent-main)]' : '']"></span>
                            <span class="max-w-[140px] truncate">{{ doc.label }}</span>

                            <!-- 未保存脏标记点 or 关闭按钮 -->
                            <div class="flex items-center justify-center w-4 h-4 ml-1">
                                <span
                                    v-if="doc.dirty && tab3 !== doc.value"
                                    class="w-2 h-2 rounded-full bg-[var(--accent-main)]"
                                    title="有未保存改动"
                                ></span>
                                <button
                                    type="button"
                                    class="opacity-0 group-hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--text-main)_15%,transparent)] rounded-full p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-opacity"
                                    title="关闭标签页"
                                    @click.stop
                                >
                                    <span class="i-lucide-x h-3 w-3"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <!-- 模拟下方贯通的内容工作区 -->
                    <div class="p-4 bg-[var(--bg-main)] border-x border-b border-[color-mix(in_srgb,var(--border-color)_80%,transparent)] rounded-b-xl text-xs text-[var(--text-muted)] flex items-center justify-between">
                        <span>正在编辑文档内容区：<strong>{{ docTabs.find(d => d.value === tab3)?.label }}</strong></span>
                        <span class="font-mono text-[var(--accent-main)]">1,420 字 · UTF-8 · 自动保存已开启</span>
                    </div>
                </div>
            </div>

            <!-- ================= 方案 4: Linear 极简呼吸微光 (Minimalist Ghost Glow) ================= -->
            <div
                v-if="selectedScheme === 'all' || selectedScheme === 'scheme4'"
                class="macos-compact-card"
            >
                <div class="scheme-header">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2">
                            <span class="scheme-tag">方案 4</span>
                            Linear 极简呼吸微光（Minimalist Ghost · 无边框纯净流）
                        </h4>
                        <p class="text-xs text-[var(--text-muted)] mt-1">
                            现代极简生产力软件（Linear/Raycast）风尚。无多余大边框，未选态沉浸低调，选中态以柔和的文字反差与微光徽标精准聚焦。
                        </p>
                    </div>
                    <span class="text-xs font-mono text-[var(--accent-main)]">选中: {{ tab4 }}</span>
                </div>

                <!-- 实底演示画布 -->
                <div class="stage-canvas flex flex-col gap-3">
                    <div class="flex items-center gap-1.5 p-2 bg-[var(--bg-main)] rounded-lg border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)]">
                        <button
                            v-for="item in standardTabs"
                            :key="item.value"
                            type="button"
                            :disabled="item.disabled"
                            class="relative flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-[13px] transition-all duration-200 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40"
                            :class="[
                                tab4 === item.value
                                    ? 'bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] text-[var(--text-main)] font-semibold shadow-sm'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]'
                            ]"
                            @click="tab4 = item.value"
                        >
                            <span :class="[item.icon, 'h-4 w-4 shrink-0']"></span>
                            <span>{{ item.label }}</span>
                            <span
                                v-if="item.count"
                                class="px-1.5 py-0.2 rounded-full text-[10px] font-mono"
                                :class="tab4 === item.value ? 'bg-[var(--accent-main)] text-white' : 'bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] text-[var(--text-muted)]'"
                            >{{ item.count }}</span>
                        </button>
                    </div>

                    <!-- 联动内容预览区 -->
                    <div class="p-4 bg-[var(--bg-main)] rounded-lg border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] text-xs text-[var(--text-secondary)] flex items-center justify-between">
                        <span>当前聚焦分区：<strong>{{ standardTabs.find(t => t.value === tab4)?.label }}</strong></span>
                        <span class="text-[var(--text-muted)]">适用场景：沉浸式全屏写作、窄侧边栏、状态栏快捷切换</span>
                    </div>
                </div>
            </div>

            <!-- ================= 方案 5: VisionOS 悬浮玻璃岛屿 (Floating Glass Islands) ================= -->
            <div
                v-if="selectedScheme === 'all' || selectedScheme === 'scheme5'"
                class="macos-compact-card"
            >
                <div class="scheme-header">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)] flex items-center gap-2">
                            <span class="scheme-tag">方案 5</span>
                            VisionOS 悬浮玻璃岛屿（Floating Glass Islands · 55% 磨砂立体微岛）
                        </h4>
                        <p class="text-xs text-[var(--text-muted)] mt-1">
                            下一代空间计算风格。每个 Tab 为独立悬浮微岛屿，选中项点亮 55% 黄金磨砂高光（10px 模糊 + 130% 饱和）与 Apple 蓝环绕底光。
                        </p>
                    </div>
                    <span class="text-xs font-mono text-[var(--accent-main)]">选中: {{ tab5 }}</span>
                </div>

                <!-- 实底演示画布 -->
                <div class="stage-canvas flex flex-col gap-3">
                    <div class="flex items-center gap-2 flex-wrap p-2.5 bg-[var(--bg-main)] rounded-lg border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)]">
                        <button
                            v-for="item in standardTabs"
                            :key="item.value"
                            type="button"
                            :disabled="item.disabled"
                            class="relative flex items-center gap-2 px-3.5 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-200 cursor-pointer select-none active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
                            :class="[
                                tab5 === item.value
                                    ? 'bg-[color-mix(in_srgb,var(--accent-main)_14%,var(--bg-panel))] text-[var(--accent-main)] border border-[color-mix(in_srgb,var(--accent-main)_35%,transparent)] shadow-[0_4px_16px_color-mix(in_srgb,var(--accent-main)_20%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-main)_20%,transparent)] font-semibold backdrop-blur-md'
                                    : 'bg-[color-mix(in_srgb,var(--bg-panel)_70%,transparent)] text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[color-mix(in_srgb,var(--bg-panel)_95%,transparent)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] hover:border-[color-mix(in_srgb,var(--text-main)_18%,transparent)] shadow-sm'
                            ]"
                            @click="tab5 = item.value"
                        >
                            <span :class="[item.icon, 'h-4 w-4 shrink-0', tab5 === item.value ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)]']"></span>
                            <span>{{ item.label }}</span>
                            <span
                                v-if="item.count"
                                class="px-1.5 py-0.2 rounded-full text-[10px] font-mono"
                                :class="tab5 === item.value ? 'bg-[var(--accent-main)] text-white' : 'bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] text-[var(--text-muted)]'"
                            >{{ item.count }}</span>
                        </button>
                    </div>

                    <!-- 联动内容预览区 -->
                    <div class="p-4 bg-[var(--bg-main)] rounded-lg border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] text-xs text-[var(--text-secondary)] flex items-center justify-between">
                        <span>当前悬浮空间：<strong>{{ standardTabs.find(t => t.value === tab5)?.label }}</strong></span>
                        <span class="text-[var(--text-muted)]">适用场景：浮动快捷工具箱、画中画辅助面板</span>
                    </div>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
/* 紧凑 macOS 容器卡片 */
.macos-compact-card {
    width: 100%;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 24%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}

.scheme-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
}

.scheme-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    background: color-mix(in srgb, var(--accent-main) 16%, transparent);
    color: var(--accent-main);
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, transparent);
}

.stage-canvas {
    width: 100%;
}
</style>
