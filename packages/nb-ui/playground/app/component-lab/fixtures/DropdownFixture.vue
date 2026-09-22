<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Dropdown from "../../../../src/components/controls/Dropdown.vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
import type {DropdownItem} from "../../../../src/components/controls/dropdown.types";
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

// 4 个黄金磨砂参数实时调节滑块（最新规范：65% 面色、8px 模糊、130% 饱和、1.0 亮度）
const customOpacity = ref(65);
const customBlur = ref(8);
const customSaturate = ref(130);
const customBrightness = ref(100);

function resetSliders(): void {
    customOpacity.value = 65;
    customBlur.value = 8;
    customSaturate.value = 130;
    customBrightness.value = 100;
}

const dynamicPopoverStyle = computed(() => ({
    backgroundColor: `color-mix(in srgb, var(--bg-panel) ${customOpacity.value}%, transparent)`,
    backdropFilter: `blur(${customBlur.value}px) saturate(${customSaturate.value}%) brightness(${customBrightness.value / 100})`,
    WebkitBackdropFilter: `blur(${customBlur.value}px) saturate(${customSaturate.value}%) brightness(${customBrightness.value / 100})`,
}));

const lastAction = ref<string>("");
const actionCount = ref(0);

// 标准动作菜单项
const standardItems: DropdownItem[] = [
    {label: "拷贝副本", value: "duplicate", iconClass: "i-lucide-copy"},
    {label: "重命名文档", value: "rename", iconClass: "i-lucide-pencil"},
    {label: "分享给协作者", value: "share", iconClass: "i-lucide-share-2"},
    {label: "导出为 Markdown...", value: "export", iconClass: "i-lucide-download"},
    {label: "锁定历史版本（不可用）", value: "lock", iconClass: "i-lucide-lock", disabled: true},
    {label: "", value: "sep-1", separator: true},
    {label: "移至废纸篓", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger"},
];

// 长列表菜单项（用于展示自适应双向渐隐与 4px 悬浮 macOS 滚动条）
const longItems: DropdownItem[] = [
    {label: "正文段落 (Paragraph)", value: "p", iconClass: "i-lucide-pilcrow"},
    {label: "一级标题 (Heading 1)", value: "h1", iconClass: "i-lucide-heading-1"},
    {label: "二级标题 (Heading 2)", value: "h2", iconClass: "i-lucide-heading-2"},
    {label: "三级标题 (Heading 3)", value: "h3", iconClass: "i-lucide-heading-3"},
    {label: "有序列表 (Ordered List)", value: "ol", iconClass: "i-lucide-list-ordered"},
    {label: "无序列表 (Bullet List)", value: "ul", iconClass: "i-lucide-list"},
    {label: "任务清单 (Task List)", value: "task", iconClass: "i-lucide-check-square"},
    {label: "代码块 (Code Block)", value: "code", iconClass: "i-lucide-code"},
    {label: "引用块 (Blockquote)", value: "quote", iconClass: "i-lucide-quote"},
    {label: "数学公式 (KaTeX)", value: "math", iconClass: "i-lucide-sigma"},
    {label: "折叠面板 (Accordion)", value: "fold", iconClass: "i-lucide-chevron-right"},
    {label: "", value: "sep-long", separator: true},
    {label: "清除全部格式", value: "clear", iconClass: "i-lucide-eraser", tone: "danger"},
];

const controls = ref<Record<string, string | boolean>>({});

// 一层子菜单：父项只展开不执行，子项里受控 radio 的勾选完全来自下面这两个 ref
const panelPosition = ref("bottom");
const panelAlignment = ref("align-center");

const submenuItems = computed<DropdownItem[]>(() => [
    {
        label: "面板位置",
        value: "panel-position",
        iconClass: "i-lucide-panel-bottom",
        children: [
            {label: "底部", value: "bottom", type: "radio", group: "panel-position", checked: panelPosition.value === "bottom"},
            {label: "顶部", value: "top", type: "radio", group: "panel-position", checked: panelPosition.value === "top"},
            {label: "左侧", value: "left", type: "radio", group: "panel-position", checked: panelPosition.value === "left"},
            {label: "右侧", value: "right", type: "radio", group: "panel-position", checked: panelPosition.value === "right"},
        ],
    },
    {
        label: "面板对齐",
        value: "panel-alignment",
        iconClass: "i-lucide-align-start-vertical",
        children: [
            {label: "居中", value: "align-center", type: "radio", group: "panel-alignment", checked: panelAlignment.value === "align-center"},
            {label: "左对齐", value: "align-left", type: "radio", group: "panel-alignment", checked: panelAlignment.value === "align-left"},
            {label: "右对齐", value: "align-right", type: "radio", group: "panel-alignment", checked: panelAlignment.value === "align-right"},
            {label: "两端对齐", value: "justify", type: "radio", group: "panel-alignment", checked: panelAlignment.value === "justify"},
        ],
    },
    {label: "", value: "sep-submenu", separator: true},
    {label: "隐藏面板", value: "hide-panel", iconClass: "i-lucide-eye-off"},
]);

// 受控勾选：勾选态由下面两个 ref 持有，组件只把选中的 value 发回来
const gridSnap = ref(true);
const rulerVisible = ref(false);

const checkedItems = computed<DropdownItem[]>(() => [
    {label: "网格吸附", value: "grid-snap", type: "checkbox", checked: gridSnap.value},
    {label: "显示标尺", value: "ruler", type: "checkbox", checked: rulerVisible.value},
    {label: "", value: "sep-checked", separator: true},
    {label: "居中", value: "align-center", type: "radio", group: "alignment", checked: panelAlignment.value === "align-center"},
    {label: "左对齐", value: "align-left", type: "radio", group: "alignment", checked: panelAlignment.value === "align-left"},
    {label: "右对齐（不可用）", value: "align-right", type: "radio", group: "alignment", checked: panelAlignment.value === "align-right", disabled: true},
]);

/** 子菜单与受控场景的 value 归属：菜单只发 value，写回哪个 ref 由宿主查表。 */
const panelValueTargets: Record<string, "position" | "alignment"> = {
    bottom: "position",
    top: "position",
    left: "position",
    right: "position",
    "align-center": "alignment",
    "align-left": "alignment",
    "align-right": "alignment",
    justify: "alignment",
};

// 受控展开：菜单开没开由宿主说了算，触发器只上报 update:open
const controlledOpen = ref(false);

const controlledItems: DropdownItem[] = [
    {label: "重命名章节", value: "rename", iconClass: "i-lucide-pencil"},
    {label: "导出为纯文本", value: "export", iconClass: "i-lucide-file-down"},
    {label: "", value: "sep-controlled", separator: true},
    {label: "删除章节", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger"},
];

function handleSelect(val: string): void {
    lastAction.value = val;
    actionCount.value++;
    report("select", {value: val, count: actionCount.value});
}

function selectPanelValue(value: string): void {
    const target = panelValueTargets[value];
    if (target === "position") panelPosition.value = value;
    if (target === "alignment") panelAlignment.value = value;
    handleSelect(value);
}

function selectCheckedValue(value: string): void {
    if (value === "grid-snap") gridSnap.value = !gridSnap.value;
    if (value === "ruler") rulerVisible.value = !rulerVisible.value;
    if (panelValueTargets[value] === "alignment") panelAlignment.value = value;
    handleSelect(value);
}

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    lastAction.value = "";
    actionCount.value = 0;
    panelPosition.value = "bottom";
    panelAlignment.value = "align-center";
    gridSnap.value = true;
    rulerVisible.value = false;
    controlledOpen.value = false;
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
        <!-- 顶层 4 个磨砂参数调节滑块控制面板 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="rounded-xl p-4 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-semibold text-[var(--text-main)]">磨砂玻璃参数实时微调:</span>
                    <button
                        type="button"
                        class="text-[11px] text-[var(--accent-main)] hover:underline cursor-pointer"
                        @click="resetSliders"
                    >
                        重置为默认值 (55% / 10px / 130% / 1.1x)
                    </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <!-- 滑块 1：面色透明度 -->
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-[var(--text-secondary)]">底色不透明度</span>
                            <span class="font-mono font-semibold text-[var(--accent-main)]">{{ customOpacity }}%</span>
                        </div>
                        <input
                            v-model.number="customOpacity"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            class="slider-input"
                        />
                    </div>

                    <!-- 滑块 2：高斯模糊 -->
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-[var(--text-secondary)]">高斯模糊</span>
                            <span class="font-mono font-semibold text-[var(--accent-main)]">{{ customBlur }}px</span>
                        </div>
                        <input
                            v-model.number="customBlur"
                            type="range"
                            min="0"
                            max="30"
                            step="1"
                            class="slider-input"
                        />
                    </div>

                    <!-- 滑块 3：色彩饱和度 -->
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-[var(--text-secondary)]">色彩饱和度</span>
                            <span class="font-mono font-semibold text-[var(--accent-main)]">{{ customSaturate }}%</span>
                        </div>
                        <input
                            v-model.number="customSaturate"
                            type="range"
                            min="100"
                            max="300"
                            step="5"
                            class="slider-input"
                        />
                    </div>

                    <!-- 滑块 4：亮度提升 -->
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-[var(--text-secondary)]">亮度增益</span>
                            <span class="font-mono font-semibold text-[var(--accent-main)]">{{ (customBrightness / 100).toFixed(2) }}x</span>
                        </div>
                        <input
                            v-model.number="customBrightness"
                            type="range"
                            min="80"
                            max="180"
                            step="5"
                            class="slider-input"
                        />
                    </div>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">下拉菜单与动作浮层</h3>
                    <p class="text-xs text-[var(--text-muted)]">基于 FormSelect 磨砂浮层规范，支持双向渐隐与 4px 悬浮 macOS 滚动条。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    {{ customOpacity }}% 面色 · {{ customSaturate }}% 饱和 · {{ (customBrightness / 100).toFixed(2) }}x 提亮
                </span>
            </div>

            <!-- 下拉菜单展示区 -->
            <div class="stage-box flex flex-col gap-6">
                <!-- 场景一：平面项（标准动作 / 长列表滚动） -->
                <template v-if="sceneId === 'default'">
                    <!-- 第一组：标准操作菜单（触发器使用 Secondary 按钮） -->
                    <div class="flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">标准操作菜单 (带图标、分隔线与危险项):</span>
                        <div class="flex items-center gap-3">
                            <Dropdown
                                id="nb-lab-target"
                                :items="standardItems"
                                :compact="Boolean(controls.compact)"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[200px]"
                                @select="handleSelect"
                            >
                                <Button variant="secondary" size="md">
                                    <span class="i-lucide-more-horizontal" aria-hidden="true"></span>
                                    操作菜单
                                    <span class="i-lucide-chevron-down text-xs opacity-60" aria-hidden="true"></span>
                                </Button>
                            </Dropdown>

                            <!-- 图标按钮触发器 -->
                            <Dropdown
                                :items="standardItems"
                                :compact="Boolean(controls.compact)"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[200px]"
                                @select="handleSelect"
                            >
                                <IconButton title="更多选项" variant="default" size="md">
                                    <span class="i-lucide-more-vertical" aria-hidden="true"></span>
                                </IconButton>
                            </Dropdown>
                        </div>
                    </div>

                    <!-- 第二组：长列表滚动菜单（展示齐腰截半与 4px 悬浮 macOS 滚动条） -->
                    <div class="flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">长列表格式菜单 (自适应双向渐隐 + 4px 悬浮滚动条):</span>
                        <div>
                            <Dropdown
                                :items="longItems"
                                :compact="Boolean(controls.compact)"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[220px]"
                                @select="handleSelect"
                            >
                                <Button variant="primary" size="md">
                                    <span class="i-lucide-type" aria-hidden="true"></span>
                                    插入格式块...
                                    <span class="i-lucide-chevron-down text-xs opacity-75" aria-hidden="true"></span>
                                </Button>
                            </Dropdown>
                        </div>
                    </div>
                </template>

                <!-- 场景二：一层子菜单（父项只展开不执行，子项 radio 受控） -->
                <template v-else-if="sceneId === 'submenu'">
                    <div class="flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">子菜单菜单 (父项只展开、子项 radio 勾选来自宿主):</span>
                        <div>
                            <Dropdown
                                id="nb-lab-target"
                                :items="submenuItems"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[200px]"
                                @select="selectPanelValue"
                            >
                                <Button variant="secondary" size="md">
                                    <span class="i-lucide-panel-bottom" aria-hidden="true"></span>
                                    面板操作
                                    <span class="i-lucide-chevron-down text-xs opacity-60" aria-hidden="true"></span>
                                </Button>
                            </Dropdown>
                        </div>
                        <p class="text-xs text-[var(--text-muted)]">
                            当前面板位置：<strong class="text-[var(--text-main)]">{{ panelPosition }}</strong>
                            · 对齐：<strong class="text-[var(--text-main)]">{{ panelAlignment }}</strong>
                            （父项不产生 select，只有子项值会改这里）
                        </p>
                    </div>
                </template>

                <!-- 场景三：受控 radio / checkbox（勾选态只读宿主状态） -->
                <template v-else-if="sceneId === 'checked'">
                    <div class="flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">受控勾选菜单 (组件只发 value，勾选由宿主改):</span>
                        <div>
                            <Dropdown
                                id="nb-lab-target"
                                :items="checkedItems"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[200px]"
                                @select="selectCheckedValue"
                            >
                                <Button variant="secondary" size="md">
                                    <span class="i-lucide-settings-2" aria-hidden="true"></span>
                                    视图选项
                                    <span class="i-lucide-chevron-down text-xs opacity-60" aria-hidden="true"></span>
                                </Button>
                            </Dropdown>
                        </div>
                        <p class="text-xs text-[var(--text-muted)]">
                            网格吸附：<strong class="text-[var(--text-main)]">{{ gridSnap ? "开" : "关" }}</strong>
                            · 标尺：<strong class="text-[var(--text-main)]">{{ rulerVisible ? "开" : "关" }}</strong>
                            · 对齐：<strong class="text-[var(--text-main)]">{{ panelAlignment }}</strong>
                            （右对齐项禁用，点了不会有任何变化）
                        </p>
                    </div>
                </template>

                <!-- 场景四：受控 open（宿主决定开与关） -->
                <template v-else-if="sceneId === 'controlled-open'">
                    <div class="flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-muted)]">受控展开菜单 (open 由宿主给，触发器只上报 update:open):</span>
                        <div class="flex items-center gap-3">
                            <Dropdown
                                id="nb-lab-target"
                                :items="controlledItems"
                                :open="controlledOpen"
                                :popover-style="dynamicPopoverStyle"
                                menu-class="min-w-[200px]"
                                @update:open="controlledOpen = $event"
                                @select="handleSelect"
                            >
                                <Button variant="secondary" size="md">
                                    <span class="i-lucide-list" aria-hidden="true"></span>
                                    章节操作
                                    <span class="i-lucide-chevron-down text-xs opacity-60" aria-hidden="true"></span>
                                </Button>
                            </Dropdown>
                            <Button variant="ghost" size="md" @click="controlledOpen = !controlledOpen">
                                外部{{ controlledOpen ? "关闭" : "打开" }}
                            </Button>
                        </div>
                        <p class="text-xs text-[var(--text-muted)]">
                            菜单状态：<strong class="text-[var(--text-main)]">{{ controlledOpen ? "展开" : "收起" }}</strong>
                            （左边按钮的点击只会发 update:open，真正改变状态的始终是宿主）
                        </p>
                    </div>
                </template>

                <!-- 交互状态反馈区 -->
                <div v-if="lastAction" class="flex items-center justify-between p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] border border-[color-mix(in_srgb,var(--accent-main)_20%,transparent)]">
                    <span class="text-xs text-[var(--text-main)]">
                        最后触发动作：<strong>{{ lastAction }}</strong>
                    </span>
                    <span class="text-xs font-mono text-[var(--accent-main)]">
                        触发总数: {{ actionCount }}
                    </span>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
/* 4 个滑块样式 */
.slider-input {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text-main) 15%, transparent);
    accent-color: var(--accent-main);
    cursor: pointer;
}

/* 紧凑 macOS 卡片容器 */
.macos-compact-card {
    width: 100%;
    max-width: 520px;
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

.stage-box {
    position: relative;
    width: 100%;
    margin-top: var(--space-2);
}
</style>
