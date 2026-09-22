<script lang="ts">
/**
 * 骨架 fixture 的**纯空白 View**：只有名称、实例序号与内存状态。
 *
 * 它不是产品里的任何一个 View：没有文件树、没有 Agent、没有终端与输出，也不 import 任何业务模块。
 * 四个 Lab 视图（`lab.primary` / `lab.secondary` / `lab.panel-a` / `lab.panel-b`）共用这一个组件，
 * 由 fixture 的 factory 解析器把自己那组身份 prop 绑上去——实例的唯一性因此可以指着**同一个 DOM 节点**
 * 验证（换位置、最大化和隐藏往返都不重挂）。
 *
 * 两条对外合同按切片 4 的口径：
 * - `actions-change(states)`：这一**个实例**此刻每个动作能不能跑（`resolveViewTitleActions` 的输入）；
 * - `action-handle-ready(handle | null)`：把「执行我这个实例的这个动作」的句柄交给宿主，
 *   命令经 `{viewId, generation}` 命中它；View 自己不读注册表、不执行 `commandId`。
 *
 * 探针计数放在**模块级**：组件重挂会再记一次，于是「搬 DOM 不得重挂实例」这条验收有可观察的证据
 * （计在组件内部的话，重挂会把计数清零，反而看不出来）。fixture 换场景时调用 `resetSkeletonProbes()`。
 */
import {computed, onBeforeUnmount, onMounted, reactive, ref, watch} from "vue";
import type {CommandResult} from "nbook/app/utils/workbench/commands";
import type {ViewTitleActionState, WorkbenchViewActionHandle} from "nbook/app/utils/workbench/view-title-actions";

/** 这个实例声明的演示动作组：`counter`（panel-a）/ `flag`（panel-b）/ `none`（左右栏的空视图）。 */
export type SkeletonViewActionKind = "counter" | "flag" | "none";

export type SkeletonProbeRecord = {mounts: number; releases: number};

/** 每个视图的挂载 / 释放计数；模块级，跨实例累计（见文件头的理由）。 */
const probeRecords = reactive<Record<string, SkeletonProbeRecord>>({});

/** 挂载计数：View 挂上时 +1（重挂会再 +1，因此它同时是「有没有重挂」的证据）。 */
function recordMount(viewId: string): void {
    const record = probeRecords[viewId] ?? {mounts: 0, releases: 0};
    record.mounts += 1;
    probeRecords[viewId] = record;
}

function recordRelease(viewId: string): void {
    const record = probeRecords[viewId] ?? {mounts: 0, releases: 0};
    record.releases += 1;
    probeRecords[viewId] = record;
}

/** 换场景（或 fixture 重建）时清计数，让「初值可重建」这条验收成立。 */
export function resetSkeletonProbes(): void {
    for (const viewId of Object.keys(probeRecords)) {
        delete probeRecords[viewId];
    }
}

/** 当前计数快照（JSON 安全）：`syncLabData` 与测试读它。 */
export function skeletonProbeSnapshot(): Record<string, SkeletonProbeRecord> {
    return Object.fromEntries(Object.entries(probeRecords).map(([viewId, record]) => [viewId, {...record}]));
}

/** 演示禁用动作的原因：Lab 要看的正是「按钮还在、点了不执行、原因看得见」。 */
export const SKELETON_DISABLED_REASON = "演示：这条动作按设计不可用（原因在 aria-label 与菜单里可见）";
</script>

<script setup lang="ts">
const props = withDefaults(defineProps<{
    /** 视图 id（`lab.panel-a` 等）：身份在实例内部只用于文案与句柄回执。 */
    viewId: string;
    /** 已解析的视图标题（Lab 里给字面量，产品里给 `t(titleKey)`）。 */
    title: string;
    /** 实例序号：同一实例跨容器搬动时不变，用来证明「没有被换成另一个实例」。 */
    instanceIndex: number;
    /** 这个实例声明的演示动作；`none` 表示不贡献任何标题动作。 */
    actionKind?: SkeletonViewActionKind;
    /** `lifetime` 场景的验收探针（输入、滚动盒、计数）；默认关闭，其他场景不显示。 */
    probes?: boolean;
}>(), {
    actionKind: "none",
    probes: false,
});

const emit = defineEmits<{
    (e: "actions-change", states: readonly ViewTitleActionState[]): void;
    (e: "action-handle-ready", handle: WorkbenchViewActionHandle | null): void;
}>();

/** 演示计数（panel-a）与演示标记（panel-b）：只在这个空白实例的内存里。 */
const count = ref(0);
const flagged = ref(false);

const probe = computed<SkeletonProbeRecord>(() => probeRecords[props.viewId] ?? {mounts: 0, releases: 0});

const actionStates = computed<readonly ViewTitleActionState[]>(() => {
    switch (props.actionKind) {
        case "counter":
            return [
                {id: "increment", enabled: true},
                {id: "reset", enabled: true},
            ];
        case "flag":
            return [
                {id: "toggle", enabled: true, checked: flagged.value},
                {id: "disabled", enabled: false, reason: SKELETON_DISABLED_REASON},
            ];
        default:
            return [];
    }
});

/**
 * 执行句柄：只改这个实例自己的内存状态，并回一份结构化结果（谁执行的、执行完是什么值）。
 * 未登记的动作返回 `unknown-command`，禁用的动作返回 `unavailable`——两者都不静默成功。
 */
const handle: WorkbenchViewActionHandle = {
    runAction(actionId: string): Promise<CommandResult<unknown>> {
        switch (actionId) {
            case "increment":
                count.value += 1;
                break;
            case "reset":
                count.value = 0;
                break;
            case "toggle":
                flagged.value = !flagged.value;
                break;
            case "disabled":
                return Promise.resolve({ok: false, code: "unavailable", reason: SKELETON_DISABLED_REASON});
            default:
                return Promise.resolve({
                    ok: false,
                    code: "unknown-command",
                    reason: `空白实例 ${props.viewId} 没有动作 ${actionId}`,
                });
        }
        return Promise.resolve({
            ok: true,
            value: {actionId, viewId: props.viewId, instanceIndex: props.instanceIndex, count: count.value, flagged: flagged.value},
        });
    },
};

onMounted(() => {
    recordMount(props.viewId);
    emit("action-handle-ready", handle);
    emit("actions-change", actionStates.value);
});

onBeforeUnmount(() => {
    recordRelease(props.viewId);
    emit("action-handle-ready", null);
});

watch(actionStates, (states) => {
    emit("actions-change", states);
});
</script>

<template>
    <div
        class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--bg-main)]"
        :data-lab-skeleton-view="viewId"
    >
        <header class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-2)]">
            <span class="i-lucide-square-dashed h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
            <span class="truncate text-[var(--text-sm)] text-[var(--text-main)]">{{ title }}</span>
            <span class="shrink-0 rounded-[var(--radius-pill)] bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]" data-lab-instance>
                实例 {{ instanceIndex }}
            </span>
            <span class="truncate font-mono text-[10px] text-[var(--text-muted)]">{{ viewId }}</span>
        </header>

        <div class="flex min-h-0 flex-1 items-center justify-center p-[var(--panel-p)]">
            <p class="max-w-[36ch] text-center text-[var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
                空白演示内容：这个 View 不加载文件树 / Agent / 终端 / 输出，也不发任何产品请求。
            </p>
        </div>

        <p v-if="actionKind === 'counter'" class="shrink-0 border-t border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-secondary)]" data-lab-demo="counter">
            演示计数：<strong class="font-mono text-[var(--text-main)]" data-lab-demo-value="counter">{{ count }}</strong>
            <span class="text-[var(--text-muted)]">（标题条上的「增加演示计数 / 重置演示计数」改的就是它）</span>
        </p>

        <p v-if="actionKind === 'flag'" class="shrink-0 border-t border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-secondary)]" data-lab-demo="marker">
            演示标记：<strong class="font-mono text-[var(--text-main)]" data-lab-demo-value="marker">{{ flagged ? "已标记" : "未标记" }}</strong>
            <span class="text-[var(--text-muted)]">（「切换演示标记」改的就是它；「演示禁用动作」不可执行）</span>
        </p>

        <div v-if="probes" class="shrink-0 border-t border-[var(--divider)] px-[var(--panel-p)] py-[var(--space-2)]" data-lab-probe="box">
            <label class="flex items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-secondary)]">
                <span class="shrink-0">输入探针</span>
                <input
                    type="text"
                    class="min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-main)] px-[var(--space-2)] py-0.5 text-[var(--text-xs)] text-[var(--text-main)]"
                    data-lab-probe="input"
                    placeholder="换位置 / 最大化往返后这里的内容与焦点都不该丢"
                >
            </label>

            <div class="mt-[var(--space-2)] h-[72px] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-main)]" data-lab-probe="scroll">
                <p v-for="row in 24" :key="row" class="px-[var(--space-2)] py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                    滚动第 {{ row }} 行（换位置后应停在原处）
                </p>
            </div>

            <p class="mt-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-secondary)]" data-lab-probe="mounts">
                挂载 {{ probe.mounts }} / 释放 {{ probe.releases }}
            </p>
        </div>
    </div>
</template>
