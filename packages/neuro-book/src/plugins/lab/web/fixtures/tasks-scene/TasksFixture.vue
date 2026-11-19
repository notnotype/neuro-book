<script setup lang="ts">
/**
 * “后台任务”视图与状态栏悬停内容的 Lab 场景。两个零件都只读 `TasksStore`：这里在内存里建一份同接口的仓库（清单固定，取消、
 * 重试、移除只把调用记进事件 tab），翻译端口另建、登记 `nbook.tasks` 的目录（Lab 窗口的端口没有它）。
 * 场景 id 以 `hover` 开头的画悬停内容；带 `empty` 的清单为空；带 `narrow` 的按默认布局的宽度摆；以 `english` 结尾的用英文界面。
 */
import {computed, ref, shallowRef} from "vue";

import TasksHover from "nbook/plugins/tasks/web/components/TasksHover.vue";
import TasksView from "nbook/plugins/tasks/web/components/TasksView.vue";
import type {TaskItem} from "nbook/plugins/tasks/shared/contracts";
import type {TasksStore} from "nbook/plugins/tasks/web/store";
import {tasksCatalogs} from "nbook/plugins/tasks/web/text";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {useLabEventSink} from "../../lab-event-sink";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();

const engine = createHostTextEngine({locale: props.scene.endsWith("english") ? "en-US" : "zh-CN"});
engine.register("nbook.tasks", tasksCatalogs.catalogs, tasksCatalogs.source);
provideHostText(engine.port);

const today = new Date();
const at = (daysAgo: number, hour: number, minute: number): string => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).toISOString();
const base = {message: null, progress: null, cancellable: false, cancelRequested: false, retryable: false, hasDetail: false, endedAt: null} as const;

const SAMPLE: readonly TaskItem[] = [
    {...base, id: "t1", state: "running", title: "初始化 Skill epub-export", message: "正在安装 23 个包", cancellable: true, startedAt: at(0, 10, 42)},
    {...base, id: "t2", state: "running", title: "导出《雾港》为 EPUB", message: "第 12 章，共 30 章", progress: 40, cancellable: true, cancelRequested: props.scene.includes("cancelling"), startedAt: at(0, 10, 40)},
    {...base, id: "t3", state: "failed", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", retryable: true, hasDetail: true, startedAt: at(0, 10, 30), endedAt: at(0, 10, 31)},
    {...base, id: "t4", state: "succeeded", title: "初始化 Skill epub-check", message: "完成，用时 1 分 12 秒", startedAt: at(0, 10, 19), endedAt: at(0, 10, 20)},
    {...base, id: "t5", state: "cancelled", title: "导出《雾港》为 PDF", startedAt: at(0, 9, 50), endedAt: at(0, 9, 58)},
    {...base, id: "t6", state: "interrupted", title: "初始化 Skill docx", startedAt: at(1, 22, 0), endedAt: at(1, 22, 10)},
];

const items = shallowRef<readonly TaskItem[]>(props.scene.includes("empty") ? [] : SAMPLE);
const store: TasksStore = {
    items,
    running: computed(() => items.value.filter((item) => item.state === "running")),
    finished: computed(() => items.value.filter((item) => item.state !== "running")),
    unseenFailure: computed(() => false),
    setViewVisible: () => undefined,
    cancel: async (id) => record("cancel", {id}),
    retry: async (id) => record("retry", {id}),
    remove: async (id) => record("remove", {id}),
    clearFinished: async () => record("clearFinished"),
    detail: async () => ({text: "bun install v1.4.4\nerror: GET https://registry.npmjs.org/pdf-lib - ETIMEDOUT", truncated: false}),
    start: async () => undefined,
};
const context: ViewContext = {id: "nbook.tasks.list", generation: 1, visible: ref(false), location: ref("panel")};
</script>

<template>
    <div v-if="scene.startsWith('hover')" class="tasks-fixture__hover nb-ui-tooltip-surface">
        <TasksHover :store="store" data-lab-subject />
    </div>
    <div v-else class="tasks-fixture__panel" :style="{width: scene.includes('narrow') ? 'min(648px, 100%)' : 'min(1040px, 100%)'}">
        <TasksView :context="context" :store="store" data-lab-subject />
    </div>
</template>

<style scoped>
/* 底部面板在 1440×900 的默认布局里约 196px 高（扣掉 32px 的面板头）。 */
.tasks-fixture__panel {
    height: 164px;
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
}

/* 同 nb-ui 提示框的面，只为在 Lab 里看清悬停内容。 */
.tasks-fixture__hover {
    display: inline-block;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
}
</style>
