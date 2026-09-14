<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Tree, {type GenericTreeNode} from "../../../../src/components/navigation/Tree.vue";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "guideline" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS Finder 经典侧栏树 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简纯平缩进", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光树", value: "crystal"},
    {label: "方案 4: 精工连接辅助线树", value: "guideline"},
    {label: "方案 5: 实底工控高反差卡槽", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const selectedNode = ref("ch-2");
const expandedNodes = ref(["vol-1", "vol-2"]);

const multiple = computed(() => Boolean(controls.value.multiple));
const disabled = computed(() => Boolean(controls.value.disabled) || props.sceneId === "disabled");

const treeData: GenericTreeNode[] = [
    {
        id: "vol-1",
        title: "第一卷：深潜意识海",
        children: [
            {id: "ch-1", title: "第01章：第404号神经节点", iconClass: "i-lucide-file-text"},
            {id: "ch-2", title: "第02章：赛博空间的不速之客", iconClass: "i-lucide-file-text"},
            {id: "ch-3", title: "第03章：幽灵协议与量子密钥", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "vol-2",
        title: "第二卷：地下反抗军",
        children: [
            {id: "ch-4", title: "第04章：下城区霓虹与雨夜", iconClass: "i-lucide-file-text"},
            {id: "ch-5", title: "第05章：荒坂财阀的悬赏令", iconClass: "i-lucide-file-text"},
        ],
    },
    {
        id: "vol-3",
        title: "第三卷：终极觉醒",
        children: [
            {id: "ch-6", title: "第06章：机械与灵魂的终章", iconClass: "i-lucide-file-text"},
        ],
    },
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Tree 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击展开箭头与章节节点体验层级导航</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS Finder 经典侧栏树（推荐）</strong>——`rounded-[6px]` 超椭圆行高亮；选中行呈现 <strong>14% 饱满品牌底色</strong>，折叠箭头装配 GPU 旋转动画与 <code>active:scale-[0.93]</code>。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简纯平缩进</strong>——去条目实底；仅靠 12% 纯文字高亮 + 极简层级缩进，界面干净。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 3：悬浮微晶发光树</strong>——75% 磨砂晶体背板；选中章节整行扩散 <strong>3.5px 柔和环境弥散光晕</strong>。
                    </span>
                    <span v-else-if="designStyle === 'guideline'" class="scheme-banner-text">
                        <strong>方案 4：精工连接辅助线树</strong>——节点左侧带有 1px 精工细微虚线引导连线，分支关系清晰。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底工控高反差卡槽</strong>——深色饱满实底，选中章节呈现反色高亮实体卡槽。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card space-y-6 !max-w-[520px]">
            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-folder-tree h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">长篇小说全书分卷与章节大纲树</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    大纲树 · Tree
                </span>
            </div>

            <div class="p-3 rounded-[var(--radius-panel)] bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border border-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
                <Tree
                    id="nb-lab-target"
                    v-model="selectedNode"
                    v-model:expanded="expandedNodes"
                    :items="treeData"
                    :multiple="multiple"
                    :disabled="disabled"
                    @select="emit('lab-event', 'select', $event)"
                />
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-4 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span>选定节点 ID: <code class="font-mono text-[var(--accent-main)] font-bold">{{ selectedNode || '未选定' }}</code></span>
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
