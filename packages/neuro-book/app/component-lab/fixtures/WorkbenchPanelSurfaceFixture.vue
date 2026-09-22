<script setup lang="ts">
/**
 * WorkbenchPanelSurface 的 Lab 场景。
 *
 * 演示重点：
 * 1. 顶部标签条：多项、当前项高亮、角标数字（例如“问题 44”）、图标；
 * 2. 交互动作区：清空、收起/展开切换、关闭；
 * 3. 拖拽改变高度演示：外壳契约标明「拖拽由外壳拥有，fixture 只是演示」——这里用 nb-ui Splitter
 *    包一层垂直可拖的分隔线（上方模拟编辑器区，下方为面板卡片），验证内容区随高度自适应；
 * 4. 收起态：collapsed 为 true 时内容区隐藏，面板折叠收起；
 * 5. fill 与 scroll 两种内容呈现合同。
 */
import {computed, ref, watch} from "vue";
import {Splitter, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import WorkbenchPanelSurface, {type WorkbenchPanelTabItem} from "nbook/app/components/workbench/WorkbenchPanelSurface.vue";
import WorkbenchPanelTab from "nbook/app/components/workbench/WorkbenchPanelTab.vue";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import type {WorkbenchTitleActionItem} from "nbook/app/utils/workbench/view-title-actions";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

/** `empty-actions` / `view-actions`：标题区里两组动作的摆法（见各自的场景说明）。 */
const isEmptyActionsScene = computed(() => props.scene === "empty-actions");
const isViewActionsScene = computed(() => props.scene === "view-actions");

/** 活动 View 的动作：两个 primary 直接成按钮，一个进「更多」（含一层子菜单）。 */
const viewActions: readonly WorkbenchTitleActionItem[] = [
    {id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"},
    {id: "pin", label: "固定", icon: "i-lucide-star"},
];
const viewMoreActions: readonly WorkbenchTitleActionItem[] = [
    {
        id: "move",
        label: "移动到",
        icon: "i-lucide-move",
        children: [
            {id: "move:left", label: "主侧边栏"},
            {id: "move:panel", label: "面板"},
        ],
    },
];

/** 框架动作：更多 → 最大化 → 隐藏（`moreFirst` 就是这条顺序）。 */
const panelActions: readonly WorkbenchTitleActionItem[] = [
    {id: "maximize", label: "最大化面板", icon: "i-lucide-maximize-2"},
    {id: "hide", label: "隐藏面板", icon: "i-lucide-eye-off"},
];
const panelMoreActions: readonly WorkbenchTitleActionItem[] = [
    {
        id: "position",
        label: "面板位置",
        icon: "i-lucide-move-vertical",
        children: [
            {id: "position:bottom", label: "底部", type: "radio", group: "position", checked: true},
            {id: "position:top", label: "顶部", type: "radio", group: "position", checked: false},
        ],
    },
    {id: "collapse", label: "收起为标题头", icon: "i-lucide-chevron-down"},
];

const lastInvoked = ref("");

/** 点击只回传 id（动作部件不执行命令）：这里只把结果记进事件面板。 */
function onTitleAction(scope: "view" | "panel", id: string): void {
    lastInvoked.value = `${scope}:${id}`;
    emitLabEvent("panel-title-action", {scope, id});
}

const tabs: WorkbenchPanelTabItem[] = [
    {id: "problems", label: "问题", badge: 44, icon: "i-lucide-alert-circle"},
    {id: "output", label: "输出", icon: "i-lucide-file-text"},
    {id: "debug", label: "调试控制台", icon: "i-lucide-terminal"},
    {id: "terminal", label: "终端", icon: "i-lucide-square-terminal"},
    {id: "ports", label: "端口", badge: 2, icon: "i-lucide-radio"},
    {id: "gitlens", label: "GitLens", icon: "i-lucide-git-branch"},
];

/** `empty-actions` 场景没有标签：标题区只剩框架动作区。 */
const displayTabs = computed(() => (isEmptyActionsScene.value ? [] : tabs));

/** 面标题只是无障碍名称与场景说明：动作场景不叫「问题与输出」。 */
const surfaceTitle = computed(() => (isEmptyActionsScene.value ? "空面板（没有标签）" : "问题与输出"));

const SCENE_NOTES: Record<string, string> = {
    "empty-actions": "空面板：没有标签、没有 View 动作，标题区只剩框架动作区（位置 / 最大化 / 还原 / 隐藏仍然可到达）。",
    "view-actions": "标题区右侧是真实的动作部件：活动 View 的 primary +「更多」，分隔线后是框架动作；点击只回传 id。",
};
const stageNote = computed(() => SCENE_NOTES[props.scene] ?? "底部 Panel 验证台（拖拽由外壳 Splitter 承担，组件自身不拥有手势与尺寸）");

watch(() => props.scene, () => {
    lastInvoked.value = "";
}, {immediate: true});

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

const config = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        activeTab: readString(data.activeTab, props.scene === "empty-actions" ? "" : (props.scene === "output" ? "output" : "problems")),
        collapsed: readBoolean(data.collapsed, props.scene === "collapsed"),
        layout: (data.layout === "scroll" || props.scene === "scroll") ? ("scroll" as const) : ("fill" as const),
        rows: typeof data.rows === "number" ? data.rows : 30,
    };
});

const activeTab = ref(config.value.activeTab);
const collapsed = ref(config.value.collapsed);

watch(() => config.value.activeTab, (val) => {
    activeTab.value = val;
});

watch(() => config.value.collapsed, (val) => {
    collapsed.value = val;
});

/**
 * 面板配置一律 CSS px（不再有百分比往返）：验证台高约 520px，给 editor 320 + panel 200。
 * panel 带收起策略：从展开最小继续向内 24px 吸附到 0，向外 24px 回到记忆的 200px；
 * 展开最小必须大于 collapsedSize（0），阈值与外壳/Section 用的是同一份参数。
 */
const splitterPanels = computed<SplitterPanelConfig[]>(() => [
    {id: "editor", defaultSizePx: 320, minSizePx: 140},
    {
        id: "panel",
        defaultSizePx: 200,
        minSizePx: 96,
        collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
    },
]);

function onTabClick(tabId: string): void {
    activeTab.value = tabId;
    emitLabEvent("panel-tab-click", tabId);
}

function onTabClose(tabId: string): void {
    emitLabEvent("panel-tab-close", tabId);
}

function onToggleCollapse(): void {
    collapsed.value = !collapsed.value;
    emitLabEvent("panel-toggle-collapse", {collapsed: collapsed.value});
}

function onClear(): void {
    emitLabEvent("panel-action-clear", activeTab.value);
}

const problemRows = Array.from({length: 44}, (_, i) => ({
    id: i + 1,
    severity: i % 5 === 0 ? "error" : (i % 3 === 0 ? "warning" : "info"),
    file: `src/components/novel-ide/ChapterEditor.vue:${10 + i}:${2 + (i % 8)}`,
    message: i % 2 === 0
        ? `TS2322: Type 'string' is not assignable to type 'number'. [line ${10 + i}]`
        : `ESLint: Unexpected any. Specify a different type. (@typescript-eslint/no-explicit-any)`,
}));
</script>

<template>
    <div class="workbench-panel-stage flex h-[520px] w-full flex-col overflow-hidden bg-[var(--bg-main)] p-2">
        <!-- 顶部提示区：标明外壳与拖拽归属 -->
        <div class="mb-2 flex shrink-0 items-center justify-between text-xs text-[var(--text-muted)]">
            <span>{{ stageNote }}</span>
            <span class="font-mono">当前激活: {{ activeTab || "（无标签）" }} · 收起: {{ collapsed ? "是" : "否" }}</span>
        </div>
        <!-- 垂直 Splitter：模拟上方编辑器叶 + 下方底部 Panel 叶 -->
        <div class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-outline)]">
            <Splitter direction="vertical" :panels="splitterPanels">
                <template #panel-editor>
                    <div class="flex h-full w-full flex-col justify-center items-center bg-[var(--panel-surface)] p-4 text-[var(--text-muted)]" data-testid="mock-editor">
                        <span class="i-lucide-code-2 mb-2 h-8 w-8 opacity-40" />
                        <p class="text-xs">上方模拟编辑器区（拖动下方分界线可改变 Panel 高度）</p>
                    </div>
                </template>

                <template #panel-panel>
                    <div class="h-full w-full overflow-hidden p-1 box-sizing: border-box;">
                        <WorkbenchPanelSurface
                            v-model:active-tab="activeTab"
                            v-model:collapsed="collapsed"
                            :layout="config.layout"
                            :title="surfaceTitle"
                            data-lab-subject="panel"
                        >
                            <template #tabs>
                                <WorkbenchPanelTab
                                    v-for="tab in displayTabs"
                                    :key="tab.id"
                                    :id="tab.id"
                                    :label="tab.label"
                                    :icon="tab.icon"
                                    :badge="tab.badge"
                                    :active="tab.id === activeTab"
                                    @click="onTabClick"
                                    @close="onTabClose"
                                />
                            </template>

                            <template #actions>
                                <!-- view-actions：标题区里真实的两组动作（活动 View 的 + 框架的），顺序与产品一致。 -->
                                <template v-if="isViewActionsScene">
                                    <WorkbenchTitleActions
                                        scope="view"
                                        :primary="viewActions"
                                        :secondary="viewMoreActions"
                                        context-key="lab.panel-surface.view-actions"
                                        label="视图操作"
                                        @invoke="onTitleAction('view', $event)"
                                    />
                                    <span class="mx-[var(--space-1)] h-4 w-px shrink-0 bg-[var(--divider)]" aria-hidden="true"></span>
                                    <WorkbenchTitleActions
                                        scope="panel"
                                        more-first
                                        :primary="panelActions"
                                        :secondary="panelMoreActions"
                                        context-key="lab.panel-surface.view-actions.panel"
                                        label="面板操作"
                                        @invoke="onTitleAction('panel', $event)"
                                    />
                                </template>

                                <!-- empty-actions：没有标签也没有 View 动作，标题区只剩框架动作区。 -->
                                <template v-else-if="isEmptyActionsScene">
                                    <WorkbenchTitleActions
                                        scope="panel"
                                        more-first
                                        :primary="panelActions"
                                        :secondary="panelMoreActions"
                                        context-key="lab.panel-surface.empty-actions"
                                        label="面板操作"
                                        @invoke="onTitleAction('panel', $event)"
                                    />
                                </template>

                                <template v-else>
                                    <button
                                        type="button"
                                        class="nb-ui-focus-ring flex h-6 w-6 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                        title="清空输出"
                                        aria-label="清空"
                                        data-action="clear"
                                        @click="onClear"
                                    >
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        class="nb-ui-focus-ring flex h-6 w-6 cursor-pointer items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                        :title="collapsed ? '展开面板' : '收起面板'"
                                        :aria-label="collapsed ? '展开面板' : '收起面板'"
                                        data-action="toggle-collapse"
                                        @click="onToggleCollapse"
                                    >
                                        <span :class="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                </template>
                            </template>

                            <template #content>
                                <!-- 动作场景：内容区不重要，说明摆在它上面。 -->
                                <div v-if="isViewActionsScene || isEmptyActionsScene" class="flex h-full flex-col items-center justify-center gap-[var(--space-2)] p-[var(--space-3)] text-center text-xs text-[var(--text-muted)]">
                                    <p v-if="isViewActionsScene" data-lab-note>
                                        标题区右侧是真实的动作部件：活动 View 的两个 primary 按钮 +「更多」（含移动到子菜单），
                                        分隔线后是框架动作（更多 → 最大化 → 隐藏）。点任意一项只在事件里留下 panel-title-action。
                                    </p>
                                    <p v-else data-lab-note>
                                        空面板：没有标签、没有 View 动作，标题区只剩框架动作区——位置 / 最大化 / 隐藏仍然可到达。
                                    </p>
                                    <p>最近一次点击：<span class="font-mono text-[var(--text-main)]" data-lab-last-invoke>{{ lastInvoked || "（无）" }}</span></p>
                                </div>

                                <!-- 场景内容：问题列表或终端 -->
                                <div v-else-if="activeTab === 'problems'" class="h-full overflow-auto p-2 font-mono text-xs">
                                    <div
                                        v-for="row in problemRows"
                                        :key="row.id"
                                        class="flex items-center gap-2 border-b border-[var(--divider)] py-1 hover:bg-[var(--bg-hover)]"
                                    >
                                        <span
                                            v-if="row.severity === 'error'"
                                            class="i-lucide-x-circle shrink-0 text-[var(--status-danger)]"
                                        />
                                        <span
                                            v-else-if="row.severity === 'warning'"
                                            class="i-lucide-alert-triangle shrink-0 text-[var(--status-warning)]"
                                        />
                                        <span
                                            v-else
                                            class="i-lucide-info shrink-0 text-[var(--status-info)]"
                                        />
                                        <span class="truncate text-[var(--text-main)]">{{ row.message }}</span>
                                        <span class="ml-auto shrink-0 text-[var(--text-muted)]">{{ row.file }}</span>
                                    </div>
                                </div>

                                <div v-else-if="activeTab === 'terminal'" class="flex h-full flex-col bg-[var(--bg-subtle)] p-3 font-mono text-xs text-[var(--text-main)]">
                                    <p class="text-[var(--text-muted)]">NeuroBook Integrated Terminal (v2.1)</p>
                                    <p class="mt-2 text-[var(--status-success)]">$ bun test</p>
                                    <p class="mt-1">6 test files passed (22 tests)</p>
                                    <p class="mt-2 text-[var(--accent-main)]">Ready for interaction_</p>
                                </div>

                                <div v-else class="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
                                    <span>{{ activeTab }} 视图内容区（占满剩余高度）</span>
                                </div>
                            </template>
                        </WorkbenchPanelSurface>
                    </div>
                </template>
            </Splitter>
        </div>
    </div>
</template>
