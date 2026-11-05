<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {relativeDay, sessionName, taskLabel} from "../host/format.js";
import {isPlainClick, taskHref} from "../host/routes.js";
import type {TaskTableDetail} from "../host/task-expand.js";
import type {SessionTitle, TaskView} from "../host/types.js";
import LeaseChip from "./LeaseChip.vue";
import LoadState from "./LoadState.vue";
import MarkdownView from "./MarkdownView.vue";
import StatusChip from "./StatusChip.vue";

/**
 * Work 页的 Task 表（t03 第三轮 Work 页；t15 阶段 4 第 2 批改成能就地展开的网格）。契约见同名 .md。
 * nb-ui 的 Table 不做行展开（它的 .md 写明由消费方组合），这里用 ARIA 表格角色自己排。
 */
const props = defineProps<{
    workId: string;
    tasks: TaskView[];
    /** 展开着的 Task。 */
    expanded: readonly string[];
    /** 展开行的内容，键是 Task id；还没取到时缺项。 */
    details: Readonly<Record<string, TaskTableDetail>>;
    /** “当前情况”按行内 Markdown 渲染后的 HTML，键是 Task id；没有当前情况的缺项。 */
    currentHtml: Readonly<Record<string, string>>;
    /** 会话标题（Work 页数据的 `sessionTitles`，t17）：展开内容里的“谁在动”写标题加短键，表格列里只进提示。 */
    sessionTitles: Readonly<Record<string, SessionTitle>>;
}>();
const emit = defineEmits<{navigate: [href: string]; toggle: [taskId: string]; retry: [taskId: string]}>();
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
const isOpen = (taskId: string) => props.expanded.includes(taskId);
const detailId = (taskId: string) => `nbdev-task-detail-${props.workId}-${taskId}`;
const COLUMNS = ["Task", "状态", "当前情况", "最近更新", "产物", "待答", "记录", "谁在动"];
</script>

<template>
    <!-- 窄时整张表横向滚动，页面不变宽；滚动容器带 relative（见 tests/web-scroll-containers.test.ts）。 -->
    <div class="relative overflow-x-auto">
        <div role="table" class="nbdev-task-grid nbdev-small" :aria-label="`${workId} 的 Task`">
            <div role="row" class="nbdev-task-row nbdev-task-head nbdev-divider border-b">
                <span role="columnheader"><span class="sr-only">展开</span></span>
                <span v-for="(column, index) in COLUMNS" :key="column" role="columnheader" :class="{'nbdev-task-wide': index >= 2}">{{ column }}</span>
            </div>
            <p v-if="tasks.length === 0" class="nbdev-empty px-2 py-6 text-center">这个 Work 还没有 Task</p>
            <template v-for="task in tasks" :key="task.taskId">
                <div role="row" class="nbdev-task-row nbdev-divider border-b" :class="{'nbdev-task-open': isOpen(task.taskId)}">
                    <span role="cell">
                        <button type="button" class="nbdev-task-toggle" :aria-expanded="isOpen(task.taskId)" :aria-controls="detailId(task.taskId)" :aria-label="`${taskLabel(task.taskId)} 的详情`" @click="emit('toggle', task.taskId)">
                            <span :class="isOpen(task.taskId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" aria-hidden="true" />
                        </button>
                    </span>
                    <span role="cell" class="min-w-0">
                        <a :href="taskHref(workId, task.taskId)" class="block truncate hover:underline focus-visible:underline" :title="`${taskLabel(task.taskId)} ${task.title ?? task.taskId}`" @click="follow($event, taskHref(workId, task.taskId))">
                            <span class="nbdev-secondary">{{ taskLabel(task.taskId) }}</span> {{ task.title ?? task.taskId }}
                        </a>
                    </span>
                    <span role="cell"><StatusChip :status="task.status" /></span>
                    <span role="cell" class="nbdev-task-wide min-w-0">
                        <MarkdownView v-if="currentHtml[task.taskId]" class="nbdev-secondary line-clamp-2" :html="currentHtml[task.taskId]!" inline @navigate="(href) => emit('navigate', href)" />
                        <span v-else class="nbdev-empty">未标</span>
                    </span>
                    <span role="cell" class="nbdev-task-wide">
                        <span v-if="task.updated.value" class="nbdev-secondary">{{ relativeDay(task.updated.value) }}</span>
                        <span v-else class="nbdev-empty">未标</span>
                    </span>
                    <!-- 为 0 的计数淡化：一眼只看到有东西的格子。 -->
                    <span role="cell" class="nbdev-task-wide nbdev-num text-right" :class="task.artifacts.length + task.documents.length > 0 ? 'nbdev-secondary' : 'nbdev-empty'">{{ task.artifacts.length + task.documents.length }}</span>
                    <span role="cell" class="nbdev-task-wide text-right">
                        <Badge v-if="task.waiting > 0" tone="warning" variant="soft" size="sm">{{ task.waiting }}</Badge>
                        <span v-else class="nbdev-empty nbdev-num">0</span>
                    </span>
                    <span role="cell" class="nbdev-task-wide">
                        <span class="nbdev-secondary">{{ task.source === "branch" ? "分支" : "master" }}</span>
                        <span v-if="task.uncommitted" class="nbdev-warn"> · 未提交</span>
                    </span>
                    <span role="cell" class="nbdev-task-wide flex min-w-0 flex-wrap gap-1">
                        <LeaseChip v-for="lease in task.leases" :key="lease.sessionKey" :session="sessionName(lease.sessionKey, lease.label, sessionTitles)" :stale="lease.stale" compact />
                    </span>
                </div>
                <div v-if="isOpen(task.taskId)" :id="detailId(task.taskId)" role="row" class="nbdev-task-detail nbdev-divider border-b">
                    <!-- 展开内容占满一行：按表头的列数横跨（手机上多出的列是 display: none，读屏按看得见的列算）。 -->
                    <div role="cell" :aria-colspan="COLUMNS.length + 1" class="nbdev-stack">
                        <LoadState v-if="!details[task.taskId]?.state.hasData" v-bind="details[task.taskId]?.state ?? {loading: true}" label="正在读取 Task" @retry="emit('retry', task.taskId)" />
                        <div v-if="details[task.taskId]?.state.hasData" class="nbdev-task-detail-grid">
                            <section class="nbdev-stack-tight min-w-0" aria-label="当前状态">
                                <h3 class="nbdev-card-title">当前状态</h3>
                                <MarkdownView v-if="details[task.taskId]!.currentHtml" class="nbdev-markdown-compact" :html="details[task.taskId]!.currentHtml!" @navigate="(href) => emit('navigate', href)" />
                                <p v-else class="nbdev-empty">README 里没有“当前状态”</p>
                            </section>
                            <section class="nbdev-stack-tight min-w-0" aria-label="下一步">
                                <h3 class="nbdev-card-title">下一步</h3>
                                <MarkdownView v-if="details[task.taskId]!.nextHtml" class="nbdev-markdown-compact" :html="details[task.taskId]!.nextHtml!" @navigate="(href) => emit('navigate', href)" />
                                <p v-else class="nbdev-empty">README 里没有“下一步”</p>
                            </section>
                            <section class="nbdev-stack-tight min-w-0" aria-label="产物与证据">
                                <h3 class="nbdev-card-title">产物</h3>
                                <p v-if="details[task.taskId]!.artifacts.length === 0" class="nbdev-empty">没有</p>
                                <ul v-else class="nbdev-stack-tight">
                                    <li v-for="item in details[task.taskId]!.artifacts" :key="item.key" class="flex flex-wrap items-center gap-1.5">
                                        <a :href="item.href" class="hover:underline" @click="follow($event, item.href)">{{ item.label }}</a>
                                        <Badge v-if="item.waiting > 0" tone="warning" variant="soft" size="sm">待答 {{ item.waiting }}</Badge>
                                    </li>
                                </ul>
                                <h3 class="nbdev-card-title mt-2">证据</h3>
                                <p v-if="details[task.taskId]!.evidences.length === 0" class="nbdev-empty">没有</p>
                                <ul v-else class="nbdev-stack-tight">
                                    <li v-for="item in details[task.taskId]!.evidences" :key="item.key" class="min-w-0 break-words">
                                        <a v-if="item.href" :href="item.href" class="hover:underline" @click="follow($event, item.href)">{{ item.label }}</a>
                                        <span v-else>{{ item.label }}</span>
                                    </li>
                                </ul>
                                <h3 class="nbdev-card-title mt-2">谁在动</h3>
                                <p v-if="task.leases.length === 0" class="nbdev-empty">没有</p>
                                <div v-else class="flex flex-wrap gap-1"><LeaseChip v-for="lease in task.leases" :key="lease.sessionKey" :session="sessionName(lease.sessionKey, lease.label, sessionTitles)" :stale="lease.stale" /></div>
                            </section>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
/* 列宽：标题列最宽、单行截断。整张表最窄约 67rem（定宽列 25.5、三个 minmax 的下限 35、8 个列间距 6、行的左右内边距 0.5），
   再窄就由外层横向滚动；min-width 与这个和一致，行的分隔线才横跨到最后一列。“谁在动”一列只有约 7rem，胶囊用紧凑写法。 */
.nbdev-task-grid {
    min-width: 67rem;
}
.nbdev-task-row {
    display: grid;
    grid-template-columns: 2rem minmax(16rem, 2.2fr) 5.5rem minmax(12rem, 3fr) 6rem 3rem 3.5rem 5.5rem minmax(7rem, 1.2fr);
    align-items: center;
    column-gap: 0.75rem;
    padding: 0.375rem 0.25rem;
}
.nbdev-task-head {
    color: var(--text-secondary);
    font-weight: 500;
}
.nbdev-task-open {
    background: color-mix(in srgb, var(--accent-bg) 45%, transparent);
}
.nbdev-task-toggle {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
}
.nbdev-task-toggle:hover {
    background: var(--bg-hover);
}
.nbdev-task-detail {
    padding: 0.75rem 0.5rem 1rem 2.75rem;
    background: var(--bg-subtle);
}
.nbdev-task-detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.25rem;
}
/* 手机上只留展开按钮、Task 与状态三列，其余在展开里看；展开内容改成一栏，不再横向滚动。 */
@media (max-width: 767px) {
    .nbdev-task-grid {
        min-width: 0;
    }
    .nbdev-task-row {
        grid-template-columns: 2rem minmax(0, 1fr) auto;
    }
    .nbdev-task-wide {
        display: none;
    }
    .nbdev-task-detail {
        padding-left: 0.75rem;
    }
    .nbdev-task-detail-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
