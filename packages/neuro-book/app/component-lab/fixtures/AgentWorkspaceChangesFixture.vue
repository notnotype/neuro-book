<script setup lang="ts">
/**
 * AgentWorkspaceChanges 的 Component Lab 规范夹具。
 *
 * 规范原则：
 * 1. 纯粹交付：一个 Tab 一个组件，不套多余外壳大卡片与假边框；
 * 2. 零件标定：核心被测组件标记 data-lab-subject，供 Lab 探针直接聚焦；
 * 3. 控件下放：所有交互调试控件包裹在 LabFixtureControls 内部挂载到底部抽屉栏；
 * 4. 契约同步：使用 useLabEventSink 记录事件，使用 useLabDataSink 同步状态。
 */
import {computed, onBeforeUnmount, watch} from "vue";
import AgentWorkspaceChanges from "nbook/app/components/novel-ide/agent/panels/workspace-changes/AgentWorkspaceChanges.vue";
import type {WorkspaceHistoryDiffState} from "nbook/app/components/novel-ide/agent/composables/useAgentWorkspaceChanges";
import type {WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleWorkspaceDiffByPath, sampleWorkspaceGroups} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentWorkspaceChanges>(() => props.input, [
    "select-group",
    "accept-group",
    "accept-all",
    "refresh",
    "open-full",
    "open-file",
]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();

const expanded = computed(() => subject.bindings.value.expanded);
const groups = computed(() => subject.bindings.value.groups);
const loading = computed(() => subject.bindings.value.loading);
const error = computed(() => subject.bindings.value.error);
const selectedPath = computed(() => subject.bindings.value.selectedPath);
const busyPath = computed(() => subject.bindings.value.busyPath);
const acceptingAll = computed(() => subject.bindings.value.acceptingAll);

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingInput: LabFixtureProps["input"];

function cancelPending(): void {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    pendingInput = undefined;
}

watch([() => props.scene, () => props.input], ([scene], [prevScene, prevInput]) => {
    if (scene !== prevScene || (props.input !== prevInput && props.input !== pendingInput)) {
        cancelPending();
    }
});
onBeforeUnmount(cancelPending);

watch([() => props.scene, expanded, groups, loading, error, selectedPath, busyPath, acceptingAll], () => {
    syncLabData({
        scene: props.scene,
        expanded: expanded.value,
        groupCount: groups.value.length,
        loading: loading.value,
        error: error.value,
        selectedPath: selectedPath.value,
        busyPath: busyPath.value,
        acceptingAll: acceptingAll.value,
    });
}, {immediate: true});

function diffStateFor(group: WorkspaceHistoryInboxGroupDto): WorkspaceHistoryDiffState {
    return sampleWorkspaceDiffByPath[group.path] ?? {
        loading: false,
        error: null,
        result: null,
    };
}

function handleSelectGroup(group: WorkspaceHistoryInboxGroupDto): void {
    const nextPath = selectedPath.value === group.path ? null : group.path;
    subject.write("props", "selectedPath", nextPath);
}

function handleAcceptGroup(group: WorkspaceHistoryInboxGroupDto): void {
    subject.write("props", "busyPath", group.path);
    cancelPending();
    pendingTimer = setTimeout(() => {
        const remaining = groups.value.filter((item) => item.path !== group.path);
        subject.write("props", "groups", remaining);
        subject.write("props", "busyPath", null);
        if (selectedPath.value === group.path) {
            subject.write("props", "selectedPath", remaining[0]?.path ?? null);
        }
        pendingTimer = undefined;
        pendingInput = undefined;
    }, 350);
    pendingInput = props.input;
}

function handleAcceptAll(): void {
    subject.write("props", "acceptingAll", true);
    cancelPending();
    pendingTimer = setTimeout(() => {
        subject.write("props", "groups", []);
        subject.write("props", "acceptingAll", false);
        subject.write("props", "selectedPath", null);
        pendingTimer = undefined;
        pendingInput = undefined;
    }, 450);
    pendingInput = props.input;
}

function toggleExpandedControl(): void {
    const next = !expanded.value;
    emitLabEvent("update:expanded", next);
    subject.write("model", "expanded", next);
}

function toggleGroupsControl(): void {
    if (groups.value.length > 0) {
        subject.write("props", "groups", []);
        subject.write("props", "selectedPath", null);
    } else {
        subject.write("props", "groups", sampleWorkspaceGroups);
        subject.write("props", "selectedPath", sampleWorkspaceGroups[0]?.path ?? null);
        subject.write("model", "expanded", true);
    }
}

function toggleErrorControl(): void {
    const nextError = error.value ? null : "读取工作区变更差异失败：历史快照索引校验超时";
    subject.write("props", "error", nextError);
    if (nextError) {
        subject.write("model", "expanded", true);
    }
}
</script>

<template>
    <AgentWorkspaceChanges
        data-lab-subject
        class="w-full !mb-0"
        v-bind="subject.bindings.value"
        :diff-state-for="diffStateFor"
        @select-group="handleSelectGroup"
        @accept-group="handleAcceptGroup"
        @accept-all="handleAcceptAll"
    />

    <!-- 无变更自动隐藏状态提示 -->
    <div
        v-if="!loading && !error && groups.length === 0"
        data-lab-subject
        class="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-[var(--border-color)] py-8 text-xs text-[var(--text-muted)]"
    >
        <span class="i-lucide-git-compare mb-2 h-6 w-6 opacity-40"></span>
        <span>当前无工作区文件变更（组件自动隐藏）</span>
        <button
            type="button"
            class="mt-2 text-[var(--accent-text)] hover:underline cursor-pointer"
            @click="toggleGroupsControl"
        >
            点击恢复示例变更
        </button>
    </div>

    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentWorkspaceChanges 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleExpandedControl"
                >
                    {{ expanded ? "收起列表" : "展开列表" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="subject.write('props', 'loading', !loading)"
                >
                    {{ loading ? "停止加载" : "切换加载态" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleErrorControl"
                >
                    {{ error ? "清除错误" : "模拟错误" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="toggleGroupsControl"
                >
                    {{ groups.length > 0 ? "清空变更" : "恢复变更" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
