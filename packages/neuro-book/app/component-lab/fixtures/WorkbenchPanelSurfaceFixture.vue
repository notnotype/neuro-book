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
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const tabs: WorkbenchPanelTabItem[] = [
    {id: "problems", label: "问题", badge: 44, icon: "i-lucide-alert-circle"},
    {id: "output", label: "输出", icon: "i-lucide-file-text"},
    {id: "debug", label: "调试控制台", icon: "i-lucide-terminal"},
    {id: "terminal", label: "终端", icon: "i-lucide-square-terminal"},
    {id: "ports", label: "端口", badge: 2, icon: "i-lucide-radio"},
    {id: "gitlens", label: "GitLens", icon: "i-lucide-git-branch"},
];

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" && value !== "" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

const config = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return {
        activeTab: readString(data.activeTab, props.scene === "output" ? "output" : "problems"),
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

const splitterPanels = computed<SplitterPanelConfig[]>(() => [
    {id: "editor", defaultSize: 55, minSize: 20},
    {id: "panel", defaultSize: 45, minSize: 10, collapsible: true},
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
            <span>底部 Panel 验证台（拖拽由外壳 Splitter 承担，组件自身不拥有手势与尺寸）</span>
            <span class="font-mono">当前激活: {{ activeTab }} · 收起: {{ collapsed ? "是" : "否" }}</span>
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
                            title="问题与输出"
                            data-lab-subject="panel"
                        >
                            <template #tabs>
                                <WorkbenchPanelTab
                                    v-for="tab in tabs"
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

                            <template #content>
                                <!-- 场景内容：问题列表或终端 -->
                                <div v-if="activeTab === 'problems'" class="h-full overflow-auto p-2 font-mono text-xs">
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
