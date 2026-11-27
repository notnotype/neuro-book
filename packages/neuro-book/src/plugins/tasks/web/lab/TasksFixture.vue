<script setup lang="ts">
/**
 * “后台任务”视图与状态栏悬停内容的 Lab 场景。视图读两份仓库（自己的任务、分组行），悬停内容读自己的任务的 `background`：这里在内存
 * 里各建一份同接口的仓库（数据固定；取消、重试、移除、打开只把调用记进事件 tab；收起箭头真的切换；“停止”记下调用并拿掉那一行，
 * 组空了整组拿掉，用来看行与组离开的动效），翻译端口另建、登记
 * `nbook.tasks` 的目录（Lab 窗口的端口没有它）。
 * 场景 id 以 `hover` 开头的画悬停内容；带 `empty` 的清单为空、带 `elsewhere` 的只有别的项目在跑；带 `narrow` 的按默认布局的宽度摆、带 `phone` 的按 390 宽摆；带 `tall`
 * 的面板拉高看全、带 `long` 的再拉长到能看到末尾的应用组；带 `all` 的是全部项目；以 `english` 结尾的用英文界面。
 */
import {computed, ref, shallowRef} from "vue";

import TasksHover from "nbook/plugins/tasks/web/components/TasksHover.vue";
import TasksView from "nbook/plugins/tasks/web/components/TasksView.vue";
import type {BackgroundSummary, ListedRow, RowGroup, RowsPayload, TaskItem} from "nbook/plugins/tasks/shared/contracts";
import type {RowsStore} from "nbook/plugins/tasks/web/rows";
import type {TasksStore} from "nbook/plugins/tasks/web/store";
import {tasksCatalogs} from "nbook/plugins/tasks/web/text";
import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
/** 场景 id 按“-”分的词里有没有它（`tall` 里有 `all`，不能按子串找）。 */
const has = (part: string): boolean => props.scene.split("-").includes(part);

const engine = createHostTextEngine({locale: has("english") ? "en-US" : "zh-CN"});
engine.register("nbook.tasks", tasksCatalogs.catalogs, tasksCatalogs.source);
provideHostText(engine.port);

const today = new Date();
const at = (daysAgo: number, hour: number, minute: number): string => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).toISOString();
const base = {message: null, progress: null, cancellable: false, cancelRequested: false, retryable: false, hasDetail: false, endedAt: null, owner: {kind: "app"}} as const;

const OWN: readonly TaskItem[] = [
    {...base, id: "t1", state: "running", title: "初始化 Skill epub-export", message: "正在安装 23 个包", cancellable: true, startedAt: at(0, 10, 42)},
    {...base, id: "t2", state: "running", title: "导出《雾港》为 EPUB", message: "第 12 章，共 30 章", progress: 40, cancellable: true, cancelRequested: has("cancelling"), startedAt: at(0, 10, 40), owner: {kind: "project", project: "p-fog", title: "雾港"}},
    {...base, id: "t3", state: "failed", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", retryable: true, hasDetail: true, startedAt: at(0, 10, 30), endedAt: at(0, 10, 31)},
    {...base, id: "t4", state: "succeeded", title: "初始化 Skill epub-check", message: "完成，用时 1 分 12 秒", startedAt: at(0, 10, 19), endedAt: at(0, 10, 20)},
    {...base, id: "t5", state: "cancelled", title: "导出《雾港》为 PDF", startedAt: at(0, 9, 50), endedAt: at(0, 9, 58), owner: {kind: "project", project: "p-fog", title: "雾港"}},
    {...base, id: "t6", state: "interrupted", title: "初始化 Skill docx", startedAt: at(1, 22, 0), endedAt: at(1, 22, 10)},
    {...base, id: "t7", state: "running", title: "导出《长夜》为 PDF", message: "第 20 章，共 26 章", progress: 75, cancellable: true, startedAt: at(0, 10, 12), owner: {kind: "project", project: "p-night", title: "长夜"}},
];

const ownRow = (task: TaskItem): ListedRow => ({key: `own:${task.id}`, source: {kind: "own", id: task.id}, kind: "nbook.tasks.task", kindLabel: null, title: task.title, message: task.message, state: task.state, progress: task.progress, startedAt: task.startedAt, endedAt: task.endedAt, foreground: false, stoppable: false, open: null, own: {id: task.id, cancellable: task.cancellable, cancelRequested: task.cancelRequested, retryable: task.retryable, hasDetail: task.hasDetail}});
const agentRow = (id: string, over: Omit<Partial<ListedRow>, "source" | "own">): ListedRow => ({key: `p:nbook.agent:1:${id}`, source: {kind: "provider", plugin: "nbook.agent"}, kind: "nbook.agent.shell", kindLabel: "命令", title: id, message: null, state: "running", progress: null, startedAt: at(0, 10, 40), endedAt: null, foreground: false, stoppable: true, open: null, own: null, ...over});
const open = (session: string) => ({command: "nbook.agent.focus-session", args: {sessionId: session}});
const own = (id: string): ListedRow => ownRow(OWN.find((task) => task.id === id)!);
const groupOpen = (session: string) => ({plugin: "nbook.agent", target: open(session)});

const SESSIONS: RowGroup[] = [
    {kind: "session", session: "s1", title: "第十二章修订", open: groupOpen("s1"), waiting: true, head: agentRow("head-s1", {kind: "nbook.agent.session", kindLabel: "会话", title: "第十二章修订", message: "等你批准", state: "waiting", startedAt: at(0, 10, 44), foreground: true, open: open("s1")}), rows: [
        agentRow("bun run build:epub", {message: "[3/5] 打包章节", startedAt: at(0, 10, 41)}),
        agentRow("校对第十二章", {kind: "nbook.agent.agent", kindLabel: "子代理", message: "读到第 4 节", startedAt: at(0, 10, 39), open: open("child-1")}),
    ]},
    {kind: "session", session: "s2", title: "整理人物表", open: groupOpen("s2"), waiting: false, head: agentRow("head-s2", {kind: "nbook.agent.session", kindLabel: "会话", title: "整理人物表", message: "正在回复", startedAt: at(0, 10, 30), foreground: true, open: open("s2")}), rows: [
        agentRow("整理大纲", {kind: "nbook.agent.plugin", kindLabel: "Workflow", message: "第 3 步，共 7 步", progress: 43, startedAt: at(0, 10, 31)}),
        agentRow("查资料：清末邮政", {kind: "nbook.agent.subsession", kindLabel: "子会话", message: "正在回复", startedAt: at(0, 10, 36), foreground: true, open: open("child-2")}),
    ]},
    {kind: "session", session: "s3", title: "检查伏笔", open: groupOpen("s3"), waiting: false, head: null, rows: [
        agentRow("bun test", {message: "已运行 214 条", startedAt: at(0, 10, 45)}),
    ]},
];

const payload = computed<RowsPayload>(() => {
    if (has("empty")) return {version: 1, groups: [], more: 0, elsewhere: 0};
    if (has("elsewhere")) return {version: 1, groups: [], more: 0, elsewhere: 3};
    const projects: RowGroup[] = [{kind: "project", project: "p-fog", title: "雾港", current: true, rows: [own("t2"), own("t5")]}];
    if (has("all")) projects.push({kind: "project", project: "p-night", title: "长夜", current: false, rows: [own("t7")]});
    const app: RowGroup = {kind: "app", rows: [own("t1"), own("t3"), own("t4"), own("t6")]};
    return {version: 1, groups: [...SESSIONS, ...projects, app], more: has("more") ? 12 : 0, elsewhere: has("all") ? 0 : 1};
});

const items = shallowRef<readonly TaskItem[]>(has("empty") ? [] : OWN);
const background = shallowRef<BackgroundSummary>(has("empty") ? {count: 0, items: []} : {count: 5, items: [
    {title: "bun run build:epub", message: "[3/5] 打包章节", progress: null},
    {title: "初始化 Skill epub-export", message: "正在安装 23 个包", progress: null},
    {title: "导出《雾港》为 EPUB", message: "第 12 章，共 30 章", progress: 40},
]});
const store: TasksStore = {
    items,
    background,
    running: computed(() => items.value.filter((item) => item.state === "running")),
    finished: computed(() => items.value.filter((item) => item.state !== "running")),
    unseenFailure: computed(() => false),
    setViewVisible: () => undefined,
    setShown: () => undefined,
    cancel: async (id) => record("cancel", {id}),
    retry: async (id) => record("retry", {id}),
    remove: async (id) => record("remove", {id}),
    clearFinished: async () => record("clearFinished"),
    detail: async () => ({text: "bun install v1.4.4\nerror: GET https://registry.npmjs.org/pdf-lib - ETIMEDOUT", truncated: false}),
    start: async () => undefined,
};
const collapsed = shallowRef<ReadonlySet<string>>(new Set(has("collapsed") ? ["session:s2"] : []));
const rows: RowsStore = {
    payload: shallowRef(payload.value),
    all: shallowRef(has("all")),
    collapsed,
    stopping: shallowRef(new Set(has("stopping") ? ["p:nbook.agent:1:bun run build:epub"] : [])),
    hasProject: computed(() => true),
    setVisible: () => undefined,
    setAll: (value) => record("setAll", {value}),
    toggleGroup(key) {
        const next = new Set(collapsed.value);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        collapsed.value = next;
    },
    stop: async (key) => {
        record("stop", {key});
        const current = rows.payload.value;
        if (current === null) return;
        const groups = current.groups.flatMap((group): RowGroup[] => {
            if (group.kind !== "session") return [{...group, rows: group.rows.filter((row) => row.key !== key)}].filter((next) => next.rows.length > 0);
            const head = group.head?.key === key ? null : group.head;
            const rest = group.rows.filter((row) => row.key !== key);
            return head === null && rest.length === 0 ? [] : [{...group, head, rows: rest}];
        });
        rows.payload.value = {...current, version: current.version + 1, groups};
    },
    open: async (target) => record("open", {command: target.command}),
    start: () => undefined,
};
const context: ViewContext = {id: "nbook.tasks.list", generation: 1, visible: ref(false), location: ref("panel")};
const width = has("phone") ? "min(390px, 100%)" : has("narrow") ? "min(648px, 100%)" : "min(1040px, 100%)";
</script>

<template>
    <div v-if="has('hover')" class="tasks-fixture__hover nb-ui-tooltip-surface">
        <TasksHover :store="store" data-lab-subject />
    </div>
    <div v-else class="tasks-fixture__panel" :data-tall="has('tall') || undefined" :data-long="has('long') || undefined" :style="{width}">
        <TasksView :context="context" :store="store" :rows="rows" data-lab-subject />
    </div>
</template>

<style scoped>
/* 底部面板在 1440×900 的默认布局里约 196px 高（扣掉 32px 的面板头）。 */
.tasks-fixture__panel {
    height: 164px;
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
}

.tasks-fixture__panel[data-tall] {
    height: 460px;
}

.tasks-fixture__panel[data-long] {
    height: 1000px;
}

/* 同 nb-ui 提示框的面，只为在 Lab 里看清悬停内容。 */
.tasks-fixture__hover {
    display: inline-block;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
}
</style>
