<script setup lang="ts">
/** “后台任务”视图（同名 .md）：按归属分组；分组行来自 `RowsStore`，自己的任务的通知与“看过”来自 `TasksStore`。 */
import {Badge, Button, Collapsible, DetailDialog, IconButton, Progress} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, ref, Transition, TransitionGroup, useId, watch} from "vue";

import type {ViewContext} from "nbook/plugins/workbench/web/contracts";
import {fullTime, shortTime} from "nbook/shared/short-time";
import {useForegroundVisibility} from "nbook/ui/foreground-visibility";

import type {GroupOpen, ListedRow, RowGroup, RowState} from "../../shared/contracts";
import {tasksText} from "../../shared/text";
import {groupKey, shownOwnTasks} from "../rows";
import type {RowsStore} from "../rows";
import type {TasksStore} from "../store";

defineOptions({name: "TasksView"});

const props = defineProps<{
    context: ViewContext;
    store: TasksStore;
    rows: RowsStore;
}>();

const port = useText();

const STATE_ICON: Readonly<Record<Exclude<RowState, "running" | "waiting">, string>> = {
    succeeded: "i-lucide-circle-check",
    failed: "i-lucide-circle-x",
    cancelled: "i-lucide-circle-slash",
    interrupted: "i-lucide-circle-pause",
};

// 输出 13、28：视图有效可见、并且页面在前台才算看得见；不可见时也不订阅分组行。
useForegroundVisibility(props.context.visible, (visible) => {
    props.store.setViewVisible(visible);
    props.rows.setVisible(visible);
});

/**
 * 每行标题的 id：行里的按钮用 `aria-describedby` 指向标题，同名的“停止”“移除”读屏分得出是哪一件。行键里可能有空格（提供方的行 id
 * 不限字符），`aria-describedby` 按空白拆成几个 id，所以字母、数字、`-`、`_` 以外的字符换成 `_` 加码点。
 */
const idPrefix = useId();
const titleId = (key: string): string => `${idPrefix}-${key.replace(/[^A-Za-z0-9_-]/gu, (char) => `_${char.codePointAt(0)!.toString(16)}_`)}`;

const isLive = (state: RowState): boolean => state === "running" || state === "waiting";

/** 去掉列表符号的 `ul` 在部分读屏里不再读作列表，写明 `role`。`TransitionGroup` 的类型不收这两个属性，运行时照样落在它渲染的元素上。 */
const LIST_ROLE = {role: "list"} as const;

/** 进展一列（输出 10、26）：在跑的写进展；结束的写原因或结果。 */
function statusOf(row: ListedRow): string {
    if (row.state === "running" || row.state === "waiting" || row.state === "failed") return row.message === null ? "" : port.t(row.message);
    if (row.state === "succeeded") return port.t(row.message ?? tasksText("outcome.succeeded"));
    if (row.state === "cancelled") return port.t(row.message ?? tasksText("outcome.cancelled"));
    // 自己的任务中断时一律写“已中断”（输出 10：最后的进展是中断之前的，不是结果）；提供方的行按它给的写。
    return port.t(row.own === null ? (row.message ?? tasksText("outcome.interrupted")) : tasksText("outcome.interrupted"));
}

function timeOf(row: ListedRow): {readonly short: string; readonly full: string} {
    const at = Date.parse(row.endedAt ?? row.startedAt);
    const full = fullTime(at, port.locale.value);
    return {
        short: shortTime(at, Date.now(), port.locale.value, port.t(tasksText("time.yesterday"))),
        full: port.t(tasksText(row.endedAt === null ? "list.startedAt" : "list.endedAt", {time: full})),
    };
}

interface DisplayRow {
    readonly row: ListedRow;
    readonly title: string;
    readonly kind: string | null;
    readonly status: string;
    readonly time: {readonly short: string; readonly full: string};
}

interface DisplayGroup {
    readonly key: string;
    readonly kind: RowGroup["kind"];
    readonly title: string;
    readonly count: number;
    readonly waiting: boolean;
    readonly head: DisplayRow | null;
    readonly open: GroupOpen | null;
    readonly rows: readonly DisplayRow[];
    readonly collapsed: boolean;
}

const display = (row: ListedRow): DisplayRow => ({row, title: port.t(row.title), kind: row.kindLabel === null ? null : port.t(row.kindLabel), status: statusOf(row), time: timeOf(row)});

/** 分好的组，各行要显示的东西一次算好；时间按重算那一刻写，行不变时不更新（不另开计时器）。 */
const groups = computed<readonly DisplayGroup[]>(() => {
    const payload = props.rows.payload.value;
    if (payload === null) return [];
    const collapsed = props.rows.collapsed.value;
    const built = payload.groups.map((group): DisplayGroup => {
        const key = groupKey(group);
        const rows = group.rows.map(display);
        if (group.kind === "session") {
            return {key, kind: "session", title: port.t(group.title), count: group.rows.length, waiting: group.waiting, head: group.head === null ? null : display(group.head), open: group.open, rows, collapsed: collapsed.has(key)};
        }
        const title = group.kind === "project" ? port.t(tasksText("groups.project", {title: port.t(group.title)})) : port.t(tasksText("groups.app"));
        return {key, kind: group.kind, title, count: group.rows.length, waiting: false, head: null, open: null, rows, collapsed: collapsed.has(key)};
    });
    // 项目组：当前项目在前（服务端已排），其余按翻译后的名字排（输出 26）。
    const current = payload.groups.filter((group) => group.kind === "project" && group.current).length;
    const firstProject = built.findIndex((group) => group.kind === "project");
    if (firstProject === -1) return built;
    const projects = built.filter((group) => group.kind === "project");
    const others = projects.slice(current).sort((a, b) => a.title.localeCompare(b.title, port.locale.value));
    return [...built.slice(0, firstProject), ...projects.slice(0, current), ...others, ...built.filter((group) => group.kind === "app")];
});

const more = computed(() => props.rows.payload.value?.more ?? 0);
const elsewhere = computed(() => (props.rows.all.value ? 0 : (props.rows.payload.value?.elsewhere ?? 0)));
const nothingListed = computed(() => props.rows.payload.value !== null && groups.value.length === 0 && more.value === 0);
const empty = computed(() => nothingListed.value && elsewhere.value === 0);
// 范围里什么都没有、别的项目却有在跑的：不写“没有后台任务”，把“其他项目还有 N 件在运行”放在空状态的位置（输出 26）。
const onlyElsewhere = computed(() => nothingListed.value && elsewhere.value > 0);

// 输出 28：此刻画成终态、所在组展开的自己的任务，交给 `TasksStore` 记看过。
const shown = computed(() => shownOwnTasks(props.rows.payload.value, props.rows.collapsed.value));
watch(() => [...shown.value].join("\u0000"), () => props.store.setShown(shown.value), {immediate: true});

const stateLabel = (row: ListedRow): string => port.t(tasksText(row.state === "waiting" ? "list.waiting" : "list.running"));
const stopping = (row: ListedRow): boolean => props.rows.stopping.value.has(row.key);

const detail = ref<{readonly title: string; readonly text: string; readonly truncated: boolean} | null>(null);
const detailOpen = ref(false);

async function openDetail(row: ListedRow): Promise<void> {
    if (row.own === null) return;
    const found = await props.store.detail(row.own.id);
    if (found === null) return;
    detail.value = {title: port.t(tasksText("list.detailTitle", {title: port.t(row.title)})), text: found.text, truncated: found.truncated};
    detailOpen.value = true;
}

const stopRow = (row: ListedRow): void => void props.rows.stop(row.key, row.title);
function openRow(row: ListedRow): void {
    if (row.open !== null && row.source.kind === "provider") void props.rows.open(row.open, row.source.plugin, row.title);
}
function openGroup(group: DisplayGroup): void {
    if (group.open !== null) void props.rows.open(group.open.target, group.open.plugin, group.title);
}
const toggleLabel = (group: DisplayGroup): string => port.t(tasksText(group.collapsed ? "groups.expand" : "groups.collapse", {title: group.title}));
</script>

<template>
    <div class="tasks-view" data-tasks-view>
        <p v-if="empty" class="tasks-view__empty">{{ port.t(tasksText("list.empty")) }}</p>
        <p v-else-if="onlyElsewhere" class="tasks-view__empty" data-rows-elsewhere>{{ port.t(tasksText("list.elsewhere", {count: elsewhere})) }}</p>
        <template v-else>
            <TransitionGroup tag="div" name="tasks-motion" class="tasks-view__groups" v-bind="{role: 'list', 'aria-label': port.t(tasksText('views.list.title'))}">
                <section v-for="group in groups" :key="group.key" class="tasks-group" :data-kind="group.kind" :data-waiting="group.waiting || undefined" :data-group="group.key" role="listitem">
                    <div class="tasks-view__grid tasks-group__head" :data-head-kind="group.kind === 'session' ? 'session' : 'caption'">
                        <span class="tasks-view__lead">
                            <IconButton size="xs" focus-ring="inset" :icon-class="'i-lucide-chevron-down tasks-group__chevron'" :data-collapsed="group.collapsed || undefined" :aria-expanded="!group.collapsed" :aria-label="toggleLabel(group)" :title="toggleLabel(group)" data-group-toggle @click="rows.toggleGroup(group.key)" />
                        </span>
                        <span class="tasks-view__icon">
                            <template v-if="group.kind === 'session'">
                                <span v-if="group.waiting" class="i-lucide-message-circle-warning tasks-group__waiting-icon" role="img" :aria-label="port.t(tasksText('list.waiting'))"></span>
                                <span v-else-if="group.head !== null" class="i-lucide-loader-circle tasks-view__spin" role="img" :aria-label="port.t(tasksText('list.running'))"></span>
                                <span v-else class="i-lucide-messages-square" aria-hidden="true"></span>
                            </template>
                            <span v-else :class="group.kind === 'project' ? 'i-lucide-book-open' : 'i-lucide-app-window'" aria-hidden="true"></span>
                        </span>
                        <span :id="titleId(group.key)" class="tasks-group__title" :title="group.title">
                            <span class="tasks-group__name">{{ group.title }}</span>
                            <Transition name="tasks-fade"><Badge v-if="group.waiting" size="sm" variant="soft" tone="warning">{{ port.t(tasksText("list.waiting")) }}</Badge></Transition>
                            <span v-if="group.kind !== 'session' || group.collapsed" class="tasks-group__count">{{ group.count }}</span>
                        </span>
                        <span class="tasks-view__status" :title="group.head?.status" data-group-status>{{ group.head?.status }}</span>
                        <span class="tasks-view__progress"></span>
                        <span class="tasks-view__time" :title="group.head?.time.full">{{ group.head?.time.short }}</span>
                        <span class="tasks-view__actions">
                            <Button v-if="group.open !== null" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(group.key)" data-group-open @click="openGroup(group)">{{ port.t(tasksText("list.open")) }}</Button>
                            <Button v-if="group.head?.row.stoppable" class="tasks-view__steady" size="sm" variant="ghost" focus-ring="inset" :disabled="stopping(group.head.row)" :aria-describedby="titleId(group.key)" data-group-stop @click="stopRow(group.head.row)">{{ port.t(tasksText(stopping(group.head.row) ? "list.stopping" : "list.stop")) }}</Button>
                        </span>
                        <span class="tasks-view__remove"></span>
                    </div>
                    <Collapsible :open="!group.collapsed">
                        <TransitionGroup tag="ul" name="tasks-motion" class="tasks-group__rows" v-bind="LIST_ROLE">
                            <li v-for="{row, title, kind, status, time} in group.rows" :key="row.key" class="tasks-view__grid tasks-view__row" :data-state="row.state" :data-row="row.key">
                                <span class="tasks-view__lead"><span class="tasks-view__guide" aria-hidden="true"></span></span>
                                <span class="tasks-view__icon">
                                    <span v-if="row.state === 'running'" class="i-lucide-loader-circle tasks-view__spin" role="img" :aria-label="stateLabel(row)"></span>
                                    <span v-else-if="row.state === 'waiting'" class="i-lucide-message-circle-warning tasks-group__waiting-icon" role="img" :aria-label="stateLabel(row)"></span>
                                    <span v-else :class="STATE_ICON[row.state]" aria-hidden="true"></span>
                                </span>
                                <span :id="titleId(row.key)" class="tasks-view__title" :title="kind === null ? title : `${kind} ${title}`"><span v-if="kind !== null" class="tasks-view__kind">{{ kind }}</span>{{ title }}</span>
                                <span class="tasks-view__status" :title="status" data-task-status>{{ status }}</span>
                                <span class="tasks-view__progress">
                                    <template v-if="isLive(row.state)">
                                        <Progress v-if="row.progress !== null" :model-value="row.progress" size="sm" />
                                        <span v-else class="tasks-view__indeterminate" role="progressbar" :aria-valuetext="stateLabel(row)"><span class="nb-ui-indeterminate-runner"></span></span>
                                    </template>
                                </span>
                                <span class="tasks-view__time" :title="time.full">{{ time.short }}</span>
                                <span class="tasks-view__actions">
                                    <template v-if="row.own !== null">
                                        <Button v-if="row.state === 'running' && row.own.cancellable" class="tasks-view__steady" size="sm" variant="ghost" focus-ring="inset" :disabled="row.own.cancelRequested" :aria-describedby="titleId(row.key)" data-task-cancel @click="store.cancel(row.own.id)">{{ port.t(tasksText(row.own.cancelRequested ? "list.cancelling" : "list.cancel")) }}</Button>
                                        <Button v-if="row.own.retryable" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(row.key)" data-task-retry @click="store.retry(row.own.id)">{{ port.t(tasksText("list.retry")) }}</Button>
                                        <Button v-if="row.own.hasDetail" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(row.key)" data-task-detail @click="openDetail(row)">{{ port.t(tasksText("list.detail")) }}</Button>
                                    </template>
                                    <template v-else>
                                        <Button v-if="row.open !== null" size="sm" variant="ghost" focus-ring="inset" :aria-describedby="titleId(row.key)" data-row-open @click="openRow(row)">{{ port.t(tasksText("list.open")) }}</Button>
                                        <Button v-if="row.stoppable" class="tasks-view__steady" size="sm" variant="ghost" focus-ring="inset" :disabled="stopping(row)" :aria-describedby="titleId(row.key)" data-row-stop @click="stopRow(row)">{{ port.t(tasksText(stopping(row) ? "list.stopping" : "list.stop")) }}</Button>
                                    </template>
                                </span>
                                <span class="tasks-view__remove">
                                    <IconButton v-if="row.own !== null && row.state !== 'running'" size="xs" focus-ring="inset" icon-class="i-lucide-x" :aria-label="port.t(tasksText('list.remove'))" :title="port.t(tasksText('list.remove'))" :aria-describedby="titleId(row.key)" data-task-remove @click="store.remove(row.own.id)" />
                                </span>
                            </li>
                        </TransitionGroup>
                    </Collapsible>
                </section>
            </TransitionGroup>
            <p v-if="more > 0" class="tasks-view__note" data-rows-more>{{ port.t(tasksText("list.more", {count: more})) }}</p>
            <p v-if="elsewhere > 0" class="tasks-view__note" data-rows-elsewhere>{{ port.t(tasksText("list.elsewhere", {count: elsewhere})) }}</p>
        </template>
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

/* 块级排列，不用 flex：离开的组与行改成 absolute 时，块级里它停在原处淡出；flex 里会跳到容器顶部。 */
.tasks-view__groups {
    position: relative;
}

.tasks-group + .tasks-group {
    margin-top: 2px;
}


/* 每组一个网格，各组同一套列（时间与按钮定宽），所以组与组之间各列对齐；标题与进展按 2 比 3 分剩下的宽度，标题至少 8 个字宽。不到 600px 宽的排法在文件末尾。 */
.tasks-view__grid {
    display: grid;
    grid-template-columns: 20px 16px minmax(8em, 2fr) minmax(0, 3fr) 96px 4.5em 10.5em 24px;
    column-gap: var(--space-3);
    align-items: center;
    min-height: 28px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
}

.tasks-view__row:hover,
.tasks-group[data-kind="session"] > .tasks-group__head:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}

/* 会话块：一块浅底的圆角块；块里有等你处理的行时是浅警示色底（决定 5）。 */
.tasks-group[data-kind="session"] {
    padding-block: 2px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
    transition: background-color var(--motion-base) var(--ease-layout);
}

.tasks-group[data-kind="session"][data-waiting] {
    background: color-mix(in srgb, var(--status-warning) 9%, transparent);
}

.tasks-group[data-kind="project"],
.tasks-group[data-kind="app"] {
    margin-top: var(--space-1);
}

.tasks-group__rows {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
}

.tasks-view__lead {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
}

.tasks-view__guide {
    width: 1px;
    height: 100%;
    background: color-mix(in srgb, var(--text-main) 14%, transparent);
}

.tasks-group[data-kind="session"] .tasks-view__guide {
    background: transparent;
}

:deep(.tasks-group__chevron) {
    transition: transform var(--motion-move) var(--ease-layout);
}

[data-collapsed] :deep(.tasks-group__chevron) {
    transform: rotate(-90deg);
}

/* 状态变了（在跑到失败、中断）图标的颜色过渡过去；图标用 currentColor，跟着外框的颜色。 */
.tasks-view__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--text-secondary);
    transition: color var(--motion-fast) var(--ease-layout);
}

.tasks-view__icon > span {
    width: 14px;
    height: 14px;
}

[data-state="succeeded"] .tasks-view__icon { color: var(--status-success, var(--text-secondary)); }
[data-state="failed"] .tasks-view__icon { color: var(--status-danger); }
[data-state="interrupted"] .tasks-view__icon { color: var(--status-warning); }

.tasks-group__waiting-icon {
    color: var(--status-warning);
}

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

.tasks-group__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    overflow: hidden;
    min-width: 0;
}

.tasks-group__name {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}

[data-head-kind="session"] .tasks-group__name {
    color: var(--text-main);
    font-weight: 600;
}

[data-head-kind="caption"] .tasks-group__name {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
}

.tasks-group__count {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
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

.tasks-view__kind {
    margin-inline-end: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.tasks-view__status {
    color: var(--text-secondary);
    transition: color var(--motion-fast) var(--ease-layout);
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
    justify-content: flex-end;
    gap: var(--space-1);
}

/* “停止”变“正在停止”、“取消”变“正在取消”时宽度不变，旁边的“打开”不被挤动。 */
.tasks-view__steady {
    min-width: 6em;
}

.tasks-view__remove {
    display: flex;
    justify-content: center;
}

.tasks-view__note {
    margin: var(--space-2) 0 0;
    padding-inline: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
}

/*
 * 组与行的出现、消失与挪位（提供方清掉一行、会话结束整块消失、换范围）：进来的淡入；离开的脱离排版、原处淡出，其余的从原位滑到新位置。
 * 系统减少动态效果时挪位的 `--motion-move` 是 0，淡入淡出照常。这几条放在最后、带上视图的类：会话块自己的底色过渡选择器更具体，排在前面会把它们盖掉；
 * `TransitionGroup` 拿第一个子元素（常是会话块）判断有没有 transform 过渡，判成没有就整组不做挪位。
 */
.tasks-view .tasks-motion-enter-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.tasks-view .tasks-motion-leave-active {
    position: absolute;
    inset-inline: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.tasks-view .tasks-motion-enter-from,
.tasks-view .tasks-motion-leave-to {
    opacity: 0;
}

.tasks-view .tasks-motion-move {
    transition: transform var(--motion-move) var(--ease-layout), background-color var(--motion-base) var(--ease-layout);
}

/* 组头的“等你处理”徽标：在原处淡入淡出。 */
.tasks-fade-enter-active,
.tasks-fade-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.tasks-fade-enter-from,
.tasks-fade-leave-to {
    opacity: 0;
}

/*
 * 视图不到 600px 宽（例如 390 宽的窗口）：一行放不下，每件改排两行：第一行缩进、图标、标题、时间、按钮、移除，第二行在标题下面放进展，
 * 进度条在它右边。
 */
@container (max-width: 600px) {
    .tasks-view__grid {
        grid-template-columns: 20px 16px minmax(0, 1fr) minmax(3.5em, max-content) max-content 24px;
        column-gap: var(--space-2);
        padding-block: 2px;
    }

    .tasks-view__lead { grid-area: 1 / 1 / 3 / 2; }
    /* 组头的收起箭头对着第一行（标题那一行），不在两行中间。 */
    .tasks-group__head .tasks-view__lead { grid-area: 1 / 1; }
    .tasks-view__icon { grid-area: 1 / 2; }
    .tasks-view__title,
    .tasks-group__title { grid-area: 1 / 3; }
    .tasks-view__time { grid-area: 1 / 4; }
    .tasks-view__actions { grid-area: 1 / 5; }
    .tasks-view__remove { grid-area: 1 / 6; }
    .tasks-view__status { grid-area: 2 / 3 / 3 / 5; }
    .tasks-view__progress { grid-area: 2 / 5 / 3 / 7; }

    .tasks-view__status:empty,
    .tasks-view__progress:empty {
        display: none;
    }
}
</style>
