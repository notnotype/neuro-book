<script setup lang="ts">
/** “后台任务”视图（同名 .md）：所有窗口同一份清单；“看过”按窗口记，由这里在可见时上报给仓库。 */
import {Button, DetailDialog, IconButton, Progress} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, ref, useId} from "vue";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {fullTime, shortTime} from "nbook/shared/short-time";
import {useForegroundVisibility} from "nbook/ui/foreground-visibility";

import type {TaskItem, TaskState} from "../../shared/contracts";
import {tasksText} from "../../shared/text";
import type {TasksStore} from "../store";

defineOptions({name: "TasksView"});

const props = defineProps<{
    context: ViewContext;
    store: TasksStore;
}>();

const port = useText();

const STATE_ICON: Readonly<Record<Exclude<TaskState, "running">, string>> = {
    succeeded: "i-lucide-circle-check",
    failed: "i-lucide-circle-x",
    cancelled: "i-lucide-circle-slash",
    interrupted: "i-lucide-circle-pause",
};

// 输出 13：视图有效可见、并且页面在前台才算看过；卸载时报不可见。
useForegroundVisibility(props.context.visible, (visible) => props.store.setViewVisible(visible));

/** 每行标题的 id 前缀：行里的按钮用 `aria-describedby` 指向标题，同名的“重试”“移除”读屏分得出是哪一件。 */
const idPrefix = useId();
const titleId = (item: TaskItem): string => `${idPrefix}-${item.id}`;

/** 输出 10 的进展一列。 */
function statusOf(item: TaskItem): string {
    switch (item.state) {
        case "running":
        case "failed":
            return item.message === null ? "" : port.t(item.message);
        case "succeeded":
            return port.t(item.message ?? tasksText("outcome.succeeded"));
        case "cancelled":
            return port.t(item.message ?? tasksText("outcome.cancelled"));
        case "interrupted":
            return port.t(tasksText("outcome.interrupted"));
    }
}

function timeOf(item: TaskItem): {readonly short: string; readonly full: string} {
    const at = Date.parse(item.endedAt ?? item.startedAt);
    const full = fullTime(at, port.locale.value);
    return {
        short: shortTime(at, Date.now(), port.locale.value, port.t(tasksText("time.yesterday"))),
        full: port.t(tasksText(item.endedAt === null ? "list.startedAt" : "list.endedAt", {time: full})),
    };
}

/** 每行要显示的东西一次算好，清单变了才重算；时间按重算那一刻写，清单不变时不更新（不另开计时器）。 */
const rows = computed(() => [...props.store.running.value, ...props.store.finished.value].map((item) => ({item, status: statusOf(item), time: timeOf(item)})));

const detail = ref<{readonly title: string; readonly text: string; readonly truncated: boolean} | null>(null);
const detailOpen = ref(false);

async function openDetail(item: TaskItem): Promise<void> {
    const found = await props.store.detail(item.id);
    if (found === null) return;
    detail.value = {title: port.t(tasksText("list.detailTitle", {title: port.t(item.title)})), text: found.text, truncated: found.truncated};
    detailOpen.value = true;
}
</script>

<template>
    <div class="tasks-view" data-tasks-view>
        <p v-if="rows.length === 0" class="tasks-view__empty">{{ port.t(tasksText("list.empty")) }}</p>
        <ul v-else class="tasks-view__list" :aria-label="port.t(tasksText('views.list.title'))">
            <li v-for="{item, status, time} in rows" :key="item.id" class="tasks-view__row" :data-state="item.state" :data-task="item.id">
                <span class="tasks-view__icon">
                    <span v-if="item.state === 'running'" class="i-lucide-loader-circle tasks-view__spin" role="img" :aria-label="port.t(tasksText('list.running'))"></span>
                    <span v-else :class="STATE_ICON[item.state]" aria-hidden="true"></span>
                </span>
                <span :id="titleId(item)" class="tasks-view__title" :title="port.t(item.title)">{{ port.t(item.title) }}</span>
                <span class="tasks-view__status" :title="status" data-task-status>{{ status }}</span>
                <span class="tasks-view__progress">
                    <template v-if="item.state === 'running'">
                        <Progress v-if="item.progress !== null" :model-value="item.progress" size="sm" />
                        <span v-else class="tasks-view__indeterminate" role="progressbar" :aria-valuetext="port.t(tasksText('list.running'))"><span class="nb-ui-indeterminate-runner"></span></span>
                    </template>
                </span>
                <span class="tasks-view__time" :title="time.full">{{ time.short }}</span>
                <span class="tasks-view__actions">
                    <Button v-if="item.state === 'running' && item.cancellable" size="sm" variant="ghost" focus-ring="inset" :disabled="item.cancelRequested" :aria-describedby="titleId(item)" data-task-cancel @click="store.cancel(item.id)">{{ port.t(tasksText(item.cancelRequested ? "list.cancelling" : "list.cancel")) }}</Button>
                    <Button v-if="item.retryable" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(item)" data-task-retry @click="store.retry(item.id)">{{ port.t(tasksText("list.retry")) }}</Button>
                    <Button v-if="item.hasDetail" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(item)" data-task-detail @click="openDetail(item)">{{ port.t(tasksText("list.detail")) }}</Button>
                </span>
                <span class="tasks-view__remove">
                    <IconButton v-if="item.state !== 'running'" size="xs" focus-ring="inset" icon-class="i-lucide-x" :aria-label="port.t(tasksText('list.remove'))" :title="port.t(tasksText('list.remove'))" :aria-describedby="titleId(item)" data-task-remove @click="store.remove(item.id)" />
                </span>
            </li>
        </ul>
        <DetailDialog v-if="detail !== null" v-model:open="detailOpen" :title="detail.title" :detail="detail.text" :truncated="detail.truncated" @closed="detail = null" />
    </div>
</template>

<style scoped>
.tasks-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: var(--space-1) var(--space-2);
    /* 窄时换排法看的是视图自己的宽度（底部面板可以很窄），不是窗口宽度。 */
    container-type: inline-size;
}

/* 空的时候说明居中（输出 10）。 */
.tasks-view__empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
}

/* 整个列表共用几列；标题与进展按 2 比 3 分剩下的宽度，标题至少 8 个字宽，窄时两列都截断。不到 600px 宽的排法在文件末尾。 */
.tasks-view__list {
    display: grid;
    grid-template-columns: 16px minmax(8em, 2fr) minmax(0, 3fr) 96px minmax(3.5em, max-content) max-content 24px;
    column-gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
}

.tasks-view__row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    min-height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
}

.tasks-view__row:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}

.tasks-view__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
}

.tasks-view__icon > span {
    width: 14px;
    height: 14px;
}

[data-state="succeeded"] .tasks-view__icon { color: var(--status-success, var(--text-secondary)); }
[data-state="failed"] .tasks-view__icon { color: var(--status-danger); }
[data-state="interrupted"] .tasks-view__icon { color: var(--status-warning); }

.tasks-view__spin {
    animation: tasks-view-spin 1s linear infinite;
}

@keyframes tasks-view-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .tasks-view__spin {
        animation: none;
    }
}

.tasks-view__title,
.tasks-view__status {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tasks-view__title {
    color: var(--text-main);
}

.tasks-view__status {
    color: var(--text-secondary);
}

[data-state="failed"] .tasks-view__status {
    color: var(--status-danger);
}

.tasks-view__progress {
    display: flex;
    align-items: center;
}

.tasks-view__indeterminate {
    display: block;
    overflow: hidden;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
}

.tasks-view__indeterminate > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--accent-main);
}

.tasks-view__time {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
}

.tasks-view__actions {
    display: flex;
    gap: var(--space-1);
}

.tasks-view__remove {
    display: flex;
    justify-content: center;
}

/*
 * 视图不到 600px 宽（例如 390 宽的窗口）：一行放不下七列，进展会被挤成零宽、按钮伸出视图。每件改排两行：第一行图标、标题、
 * 时间、按钮、移除，第二行在标题下面放进展，进度条在它右边。
 */
@container (max-width: 600px) {
    .tasks-view__list {
        grid-template-columns: 16px minmax(0, 1fr) minmax(3.5em, max-content) max-content 24px;
        column-gap: var(--space-2);
    }

    .tasks-view__row {
        padding-block: 2px;
    }

    .tasks-view__icon { grid-area: 1 / 1; }
    .tasks-view__title { grid-area: 1 / 2; }
    .tasks-view__time { grid-area: 1 / 3; }
    .tasks-view__actions { grid-area: 1 / 4; }
    .tasks-view__remove { grid-area: 1 / 5; }
    .tasks-view__status { grid-area: 2 / 2 / 3 / 4; }
    .tasks-view__progress { grid-area: 2 / 4 / 3 / 6; }
}
</style>
