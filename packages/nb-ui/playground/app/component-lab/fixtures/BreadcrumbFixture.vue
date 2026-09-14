<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Breadcrumb, {type BreadcrumbItemData} from "../../../../src/components/navigation/Breadcrumb.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "path" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生斜杠/胶囊项 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平箭头", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光胶囊", value: "crystal"},
    {label: "方案 4: UNIX 路径式等宽终端", value: "path"},
    {label: "方案 5: 实底工控高反差磁条", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const lastClicked = ref<string>("");

const items: BreadcrumbItemData[] = [
    {label: "我的书库", href: "#", iconClass: "i-lucide-library"},
    {label: "《赛博夜雨档案》", href: "#", iconClass: "i-lucide-book"},
    {label: "第一卷：深渊苏醒", href: "#"},
    {label: "第03章：幽灵协议.md", current: true, iconClass: "i-lucide-file-text"},
];

function handleClick(item: any): void {
    lastClicked.value = typeof item === "string" ? item : item?.label || "breadcrumb-item";
    emit("lab-event", "click", item);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    lastClicked.value = "";
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Breadcrumb 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击各级路径节点体验导航回溯</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 原生斜杠/胶囊项（推荐）</strong>——`rounded-[5px]` 胶囊悬停项；各级节点悬停带有 <strong>10% 柔光浅底与平滑过渡</strong>，当前末级项高亮加粗。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平箭头</strong>——去胶囊底；以极细 Chevron 箭头分隔，字号轻巧紧凑。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光胶囊</strong>——75% 磨砂晶体底座；当前活跃文件节点向外扩散 <strong>3px 柔和微光</strong>。
                    </span>
                    <span v-else-if="designStyle === 'path'" class="scheme-banner-text">
                        <strong>方案 4：UNIX 路径式等宽终端</strong>——根路径 <code>~/vault/</code> 与等宽字型，极客终端质感。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差磁条</strong>——各级面包屑为独立实心方块瓷贴，层级结构硬朗鲜明。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 max-w-lg">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-chevron-right h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品目录与章节文件层级导航</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    面包屑 · Breadcrumb
                </span>
            </div>

            <div class="p-3.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Breadcrumb
                    id="nb-lab-target"
                    :items="items"
                    @click="handleClick"
                />
            </div>

            <!-- 点击反馈信息条 -->
            <div v-if="lastClicked" class="rounded-lg p-2.5 border border-[color-mix(in_srgb,var(--accent-main)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] flex items-center justify-between text-xs">
                <span class="text-[var(--text-main)]">点击跳转节点: <code class="font-mono text-[var(--accent-main)] font-bold">{{ lastClicked }}</code></span>
                <button type="button" class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer" @click="lastClicked = ''">清除</button>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>路径深度: {{ items.length }} 级</span>
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
