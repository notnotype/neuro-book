<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import NavigationMenu, {type NavigationMenuItemData} from "../../../../src/components/navigation/NavigationMenu.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "megamenu" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生形变浮层 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平吸顶", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光岛", value: "crystal"},
    {label: "方案 4: 精工大看板平铺网格", value: "megamenu"},
    {label: "方案 5: 实底工控高反差磁板", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const selectedLink = ref<string>("");

const items: NavigationMenuItemData[] = [
    {
        id: "workspace",
        label: "写作工作区",
        links: [
            {title: "长篇卷章大纲", description: "多层级主支线情节大纲规划", iconClass: "i-lucide-network"},
            {title: "沉浸专注编辑器", description: "字数统计与全屏双栏排版", iconClass: "i-lucide-pen-tool"},
            {title: "世界观设定集", description: "角色档案、势力与科技树", iconClass: "i-lucide-database"},
            {title: "AI 续写实验室", description: "上下文感知与多模型诊断", iconClass: "i-lucide-sparkles"},
        ],
    },
    {
        id: "export",
        label: "发布与排版",
        links: [
            {title: "EPUB 电子书导出", description: "支持封面插图与标准目录", iconClass: "i-lucide-book"},
            {title: "PDF 印刷级排版", description: "字号、行距与版心精细调整", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "community",
        label: "扩展与主题",
        href: "#",
    },
];

function handleSelect(payload: any): void {
    selectedLink.value = typeof payload === "string" ? payload : payload?.title || payload?.label || "menu-item";
    emit("lab-event", "select", payload);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    selectedLink.value = "";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">NavigationMenu 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">在菜单项间滑动体验视口动态尺寸形变与位移</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生形变浮层（推荐）</strong>——触发项为 `rounded-[6px]` 磨砂胶囊；悬停滑动时视口容器装配 GPU 平滑位置与尺寸形变过渡，带 <strong>75% 高斯磨砂 + 柔光反光边缘</strong>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平吸顶</strong>——去视口外框；以纯平 10% 浅底卡片与高对比纯文字排版呈现，手感轻巧。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光岛</strong>——胶囊浮岛设计；展开视口向外扩散 <strong>4px 柔和弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'megamenu'" class="scheme-banner-text">
                        <strong>方案 4：精工大看板平铺网格</strong>——四列精工等宽卡片网格，带有分类小标签与 1px 细线边框。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁板</strong>——深色饱满实底，激活项为纯白反色高对比条目。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 !max-w-[680px] pb-32">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-compass h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">NeuroBook 模块全景与创作工作区导航</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    形变导航 · NavigationMenu
                </span>
            </div>

            <div class="flex justify-center">
                <NavigationMenu
                    id="nb-lab-target"
                    :items="items"
                    @select="handleSelect"
                />
            </div>

            <!-- 点击反馈信息条 -->
            <div v-if="selectedLink" class="rounded-lg p-2.5 border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] flex items-center justify-between text-xs">
                <span class="text-[var(--text-main)]">进入功能模块: <code class="font-mono text-[var(--accent-main)] font-bold">{{ selectedLink }}</code></span>
                <button type="button" class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer" @click="selectedLink = ''">清除</button>
            </div>

            <p class="text-xs text-[var(--text-muted)] text-center">
                提示：鼠标在「写作工作区」与「发布与排版」之间滑动时，下方浮层视口会自适应进行平滑位移与形变动画。
            </p>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>导航菜单项数: {{ items.length }} 组</span>
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
