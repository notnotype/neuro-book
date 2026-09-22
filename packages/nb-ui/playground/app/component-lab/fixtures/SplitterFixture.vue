<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Splitter, {type SplitterPanelConfig} from "../../../../src/components/layout/Splitter.vue";
import type {SashCollapsePolicy} from "../../../../src/components/layout/grid-types";
import type {
    SplitterGestureCancellation,
    SplitterGestureState,
} from "../../../../src/components/layout/splitter-gesture";
import FileTree from "../../../../src/components/navigation/FileTree.vue";
import type {FileTreeNode} from "../../../../src/components/navigation/file-tree.types";
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
const designStyle = ref<"macos" | "minimal" | "crystal" | "industrial" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 原生自隐分割线 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简无缝纯平", value: "minimal"},
    {label: "方案 3: 悬浮微晶发光握柄", value: "crystal"},
    {label: "方案 4: 精工工控凹槽刻度", value: "industrial"},
    {label: "方案 5: 实底工控高反差隔条", value: "solid"},
];

const controls = ref<Record<string, string | boolean>>({});
const direction = computed(() => (controls.value.direction as "horizontal" | "vertical") || "horizontal");
const disabled = computed(() => controls.value.disabled === true);
const zeroSecondSash = computed(() => controls.value.zeroSecondSash === true);

// 几何一律 CSS px：defaultSizePx 是未受控时的初始主轴意图（容器测量为 0 时按声明合计分配）。
// 收起状态属于宿主意图（`collapse.collapsed`），因此最近一次提交的尺寸与收起都由本 fixture 回发布。
type PanelPreset = {
    id: string;
    defaultSizePx: number;
    minSizePx?: number;
    maxSizePx?: number;
    collapse?: SashCollapsePolicy;
};

// 最小尺寸只约束「还能不能继续缩」：窄画布（1280×720 下 target 约 604px、390×844 下约 314px）
// 三栏全贴住最小值时，任何方向的拖动都会被判成 no-change（几何上确实无处可让），演示与验收都失去意义。
// 因此下界按最窄画布留出余量：合计 270px + 8px 接缝 < 314px。默认尺寸与上限不变。
const PANEL_PRESETS: PanelPreset[] = [
    {
        id: "outline",
        defaultSizePx: 240,
        minSizePx: 80,
        maxSizePx: 380,
        collapse: {collapsedSize: 0, restoreSize: 240, collapseThreshold: 24, expandThreshold: 24},
    },
    {id: "editor", defaultSizePx: 450, minSizePx: 110},
    {
        id: "inspector",
        defaultSizePx: 180,
        minSizePx: 80,
        maxSizePx: 300,
        collapse: {collapsedSize: 0, restoreSize: 180, collapseThreshold: 24, expandThreshold: 24},
    },
];

// 静态声明只当初始值；提交后以用户调整过的 px 为下界意图，避免再分配把几何打回声明比例。
const panelPose = ref<{sizes: number[] | null; collapsed: Record<string, boolean>}>({sizes: null, collapsed: {}});

const panels = computed<SplitterPanelConfig[]>(() => PANEL_PRESETS.map((panel, index) => ({
    ...panel,
    defaultSizePx: panelPose.value.sizes?.[index] ?? panel.defaultSizePx,
    collapse: panel.collapse === undefined
        ? undefined
        : {...panel.collapse, collapsed: panelPose.value.collapsed[panel.id] === true},
})));

const sashSizes = computed(() => zeroSecondSash.value ? [7, 0] as const : [7, 1] as const);

const treeData: FileTreeNode[] = [
    {
        id: "v1",
        label: "第一卷：深渊苏醒",
        kind: "directory",
        children: [
            {id: "c1", label: "01. 神经连接.md", kind: "file"},
            {id: "c2", label: "02. 赛博黑市.md", kind: "file"},
            {id: "c3", label: "03. 幽灵协议.md", kind: "file"},
        ],
    },
    {
        id: "v2",
        label: "设定集与人物资料",
        kind: "directory",
        children: [
            {id: "w1", label: "世界观设定.md", kind: "file"},
            {id: "w2", label: "林澈（主角档案）.md", kind: "file"},
        ],
    },
];

const selectedTreeId = ref<string | null>("c1");
const expandedTreeIds = ref<string[]>(["v1", "v2"]);

// 手势提交是宿主要保存的那份意图：主动调整的面板与兄弟补偿分开，空操作不出现提交
const lastGesture = ref("尚无用户调整提交");
const lastGesturePayload = ref("");
const gestureState = ref<"none" | "commit" | "cancel">("none");

function formatList(values: readonly (string | number)[]): string {
    return `[${values.join(", ")}]`;
}

function onGestureStart(state: SplitterGestureState): void {
    emit("lab-event", "gesture-start", state);
}

function onGestureUpdate(state: SplitterGestureState): void {
    emit("lab-event", "gesture-update", state);
}

function onGestureEnd(state: SplitterGestureState): void {
    emit("lab-event", "gesture-end", state);
    gestureState.value = "commit";
    lastGesturePayload.value = JSON.stringify(state);
    lastGesture.value = `提交 · ${state.source} · ${state.sash} · 主动 ${formatList(state.active)} · 补偿 ${formatList(state.compensated)} · 尺寸 ${formatList(state.sizesPx)}`;
    // 宿主回发布：提交后的 px 成为下一次分配的下界意图，收起位交给面板策略（组件不持有第二份记忆）。
    panelPose.value = {
        sizes: [...state.sizesPx],
        collapsed: {...panelPose.value.collapsed, ...state.collapsed},
    };
}

function onGestureCancel(info: SplitterGestureCancellation): void {
    emit("lab-event", "gesture-cancel", info);
    gestureState.value = "cancel";
    lastGesturePayload.value = "";
    lastGesture.value = `未提交 · ${info.reason} · ${info.sash}`;
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    panelPose.value = {sizes: null, collapsed: {}};
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
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)] shrink-0">Splitter 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                        class="min-w-0 max-w-full"
                    />
                </div>
                <span class="min-w-0 text-xs text-[var(--text-muted)]">拖动栏间分隔条调整宽度</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex min-w-0 items-start gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>macOS 自隐分隔线</strong>——常态 1px，悬停时显示品牌色握柄。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>现代极简</strong>——常态无可见隔条，悬停时显示调整光标。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>悬浮微晶</strong>——常驻磨砂握柄，悬停时显示光晕。
                    </span>
                    <span v-else-if="designStyle === 'industrial'" class="scheme-banner-text">
                        <strong>精工工控</strong>——分隔条显示防滑刻线。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>实底工控</strong>——高反差实体隔条。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card min-w-0 p-0 overflow-hidden h-[450px] flex flex-col !max-w-[880px]">
            <!-- 顶栏标题 -->
            <div class="flex min-w-0 items-center justify-between gap-2 px-4 py-2.5 bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)]">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-columns-3 text-[var(--accent-main)] h-4 w-4 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 truncate text-xs font-bold text-[var(--text-main)]">三栏写作工作区</span>
                </div>
                <span class="shrink-0 text-[11px] text-[var(--text-muted)]">拖动分隔条</span>
            </div>

            <!-- 分割工作区 -->
            <div id="nb-lab-target" class="flex-1 min-h-0">
                <Splitter
                    :direction="direction"
                    :disabled="disabled"
                    :panels="panels"
                    :sash-sizes="sashSizes"
                    @layout="emit('lab-event', 'layout', $event)"
                    @gesture-start="onGestureStart"
                    @gesture-update="onGestureUpdate"
                    @gesture-end="onGestureEnd"
                    @gesture-cancel="onGestureCancel"
                >
                    <!-- 左侧大纲栏 -->
                    <template #panel-outline>
                        <div class="p-3 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--text-main)_2%,transparent)]">
                            <div class="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">章节大纲</div>
                            <FileTree
                                :nodes="treeData"
                                :selected-id="selectedTreeId"
                                :expanded-ids="expandedTreeIds"
                                @select="selectedTreeId = $event.id"
                                @toggle-expand="expandedTreeIds = $event ? [...expandedTreeIds, $event.node.id] : expandedTreeIds"
                            />
                        </div>
                    </template>

                    <!-- 中间编辑器正文 -->
                    <template #panel-editor>
                        <div class="p-5 h-full overflow-y-auto bg-[var(--bg-main)]">
                            <h2 class="text-base font-bold text-[var(--text-main)] mb-3">第一章：深渊苏醒</h2>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
                                当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息。
                            </p>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
                                墙上的时钟停在 03:42。他撑起沉重的右臂——那是上周在黑市刚完成调试的军规级潜行臂，散热阀依然散发着刺鼻的臭氧与合成机油味道。
                            </p>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                终端的光标跳动着，像一记无声的警钟：【警告：未授权的幽灵协议正在尝试劫持第404号神经节点...】
                            </p>
                        </div>
                    </template>

                    <!-- 右侧检查器 -->
                    <template #panel-inspector>
                        <div class="p-3 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--text-main)_2%,transparent)] space-y-3 text-xs">
                            <div class="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">章节属性</div>
                            <div class="space-y-2">
                                <div class="p-2 rounded bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]">
                                    <span class="block text-[10px] text-[var(--text-muted)]">字数统计</span>
                                    <span class="font-mono font-bold text-[var(--text-main)]">4,820 字</span>
                                </div>
                                <div class="p-2 rounded bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)]">
                                    <span class="block text-[10px] text-[var(--text-muted)]">预计阅读</span>
                                    <span class="font-mono font-bold text-[var(--text-main)]">12 分钟</span>
                                </div>
                            </div>
                        </div>
                    </template>
                </Splitter>
            </div>

            <!-- 底部状态栏 -->
            <div class="flex min-w-0 items-center justify-between gap-2 px-4 py-2 border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_80%,transparent)] text-[11px] text-[var(--text-muted)]">
                <span class="min-w-0 truncate">{{ direction === 'horizontal' ? '横向三栏' : '纵向多层' }}</span>
                <span
                    class="min-w-0 flex-1 truncate font-mono"
                    data-lab-gesture
                    :data-lab-gesture-state="gestureState"
                    :data-lab-gesture-payload="lastGesturePayload"
                    :title="lastGesture"
                >
                    用户调整: {{ lastGesture }}
                </span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
    margin: var(--space-3) auto 0;
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
