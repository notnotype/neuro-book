<script setup lang="ts">
import {computed, ref, watch} from "vue";
import WorkflowMermaid from "nbook/app/components/workflow-preview/WorkflowMermaid.vue";
import WorkflowTimeline from "nbook/app/components/workflow-preview/WorkflowTimeline.vue";
import WorkflowAgentCards from "nbook/app/components/workflow-preview/WorkflowAgentCards.vue";
import type {LiveCardVm, PhaseVm, TimelineLaneVm} from "nbook/server/agent/workflow/workflow-run-vm";

/**
 * Workflow run 可视化区（Task 137）：Phase 步进条 + 视图 tab。
 * preview 面板与 Agent 聊天气泡共用；各 tab 内容懒渲染（只渲染激活 tab），
 * 避免轮询快照刷新时同时重渲染多张 Mermaid 图。
 */
type ViewKey = "machine" | "flow" | "timeline" | "cards" | "relation" | "trace";

const props = withDefaults(defineProps<{
    phases: PhaseVm[];
    /** active phase 上的 done/total 进度文本；无 progress 信息时为空。 */
    progressText?: string;
    /** 状态图（wf.chart）；无 chart 事件为 null，保留 tab 显示占位。 */
    machineMermaid: string | null;
    flowMermaid: string;
    traceMermaid: string;
    relationMermaid: string;
    timeline: TimelineLaneVm[];
    live: LiveCardVm[];
    /** 初始激活视图；变化时（如切换 run）重置。 */
    defaultView?: ViewKey;
    /** demo 只在实际产生 machine 图时显示状态机 tab；正式 run 与气泡恒显示。 */
    alwaysShowMachineTab?: boolean;
    /** Mermaid 图容器最大高度；不传则不限高（preview 页行为）。 */
    mermaidMaxHeight?: number;
}>(), {
    progressText: "",
    defaultView: "machine",
    alwaysShowMachineTab: false,
    mermaidMaxHeight: undefined,
});

const activeView = ref<ViewKey>(props.defaultView);
watch(() => props.defaultView, (next) => {
    activeView.value = next;
});

/** 状态机 tab 是否展示：恒显模式或有图时展示。 */
const showMachineTab = computed(() => props.alwaysShowMachineTab || Boolean(props.machineMermaid));
const viewTabs = computed<{key: ViewKey; label: string}[]>(() => [
    ...(showMachineTab.value ? [{key: "machine" as ViewKey, label: "状态机"}] : []),
    {key: "flow", label: "对话流"},
    {key: "timeline", label: "时间线"},
    {key: "cards", label: "直播卡片"},
    {key: "relation", label: "关系图"},
    {key: "trace", label: "执行图"},
]);

/** 状态机 tab 被隐藏时，激活视图不能停在上面。 */
watch(showMachineTab, (visible) => {
    if (!visible && activeView.value === "machine") {
        activeView.value = "flow";
    }
});
</script>

<template>
    <div>
        <!-- phase 步进条：workflow 走到哪一步、哪里需要人，一眼可见 -->
        <div v-if="phases.length" class="mb-3 flex flex-wrap items-center gap-1.5">
            <template v-for="(phase, i) in phases" :key="phase.key">
                <div class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs"
                    :class="{
                        'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]': phase.status === 'done',
                        'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]': phase.status === 'active',
                        'border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-muted)]': phase.status === 'pending',
                    }">
                    <span>{{ phase.status === 'done' ? '✔' : phase.status === 'active' ? '●' : '○' }}</span>
                    <span>{{ phase.title }}</span>
                    <span v-if="phase.status === 'active' && progressText" class="opacity-80">{{ progressText }}</span>
                    <span v-if="phase.askTitles.length" title="本阶段有用户参与点">🙋</span>
                </div>
                <span v-if="i < phases.length - 1" class="text-[var(--text-muted)]">→</span>
            </template>
        </div>

        <!-- 视图切换 tab：只渲染激活视图，Mermaid 图不随轮询重复渲染 -->
        <div class="mb-2 flex flex-wrap items-center gap-1">
            <button v-for="tab in viewTabs" :key="tab.key" type="button"
                class="rounded-t border-b-2 px-3 py-1 text-xs transition-colors"
                :class="activeView === tab.key
                    ? 'border-[var(--accent-main)] text-[var(--accent-text)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'"
                @click="activeView = tab.key">{{ tab.label }}</button>
        </div>
        <template v-if="activeView === 'machine' && showMachineTab">
            <div class="mb-1 text-xs text-[var(--text-muted)]">状态图（零预置只增不删，随代码执行长出来；边上 ①②③=执行顺序（终图即流程记录），〔名字〕=在此干活的 agent，橙=有执行线停留，绿=走过）</div>
            <WorkflowMermaid v-if="machineMermaid" :code="machineMermaid" :max-height="mermaidMaxHeight" />
            <div v-else class="rounded border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-xs text-[var(--status-info)]">等待 workflow 发布首个 wf.chart 状态节点…</div>
        </template>
        <template v-else-if="activeView === 'flow'">
            <div class="mb-1 text-xs text-[var(--text-muted)]">参与者对话流（编排器 ⇄ 各 agent session ⇄ 用户；writer↔critic 这类循环在这里一目了然）</div>
            <WorkflowMermaid v-if="flowMermaid" :code="flowMermaid" :max-height="mermaidMaxHeight" />
        </template>
        <template v-else-if="activeView === 'timeline'">
            <div class="mb-1 text-xs text-[var(--text-muted)]">泳道时间线（每个 agent 一条泳道，条形=一次调用；并发交错、耗时长短直观可见）</div>
            <WorkflowTimeline :lanes="timeline" />
        </template>
        <template v-else-if="activeView === 'cards'">
            <div class="mb-1 text-xs text-[var(--text-muted)]">直播卡片（每个 agent 的当前状态与最近一问一答，像聊天室成员列表）</div>
            <WorkflowAgentCards :cards="live" />
        </template>
        <template v-else-if="activeView === 'relation'">
            <div class="mb-1 text-xs text-[var(--text-muted)]">实时生长关系图（创建 agent 长节点、每次调用长一条边；橙色虚线=正在进行）</div>
            <WorkflowMermaid v-if="relationMermaid" :code="relationMermaid" :max-height="mermaidMaxHeight" />
        </template>
        <template v-else>
            <div class="mb-1 text-xs text-[var(--text-muted)]">执行图（Activity 级工程视图：虚线橙=进行中，绿=缓存命中，体育场=用户参与点）</div>
            <WorkflowMermaid v-if="traceMermaid" :code="traceMermaid" :max-height="mermaidMaxHeight" />
        </template>
    </div>
</template>
