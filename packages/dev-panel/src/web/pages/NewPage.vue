<script setup lang="ts">
import {Button, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {ApiError, sendJson} from "../host/api.js";
import {useResource} from "../host/panel-data.js";
import {taskHref, workHref} from "../host/routes.js";
import {workLabel} from "../host/format.js";
import type {CreatePreviewData, Meta, Overview, PreviewProblem, WriteData} from "../host/types.js";
import {TASK_FORM_FIELDS, WORK_FORM_FIELDS} from "../host/create-fields.js";
import {failureNotice, fieldProblems, successNotice, useWrite, type Notice} from "../host/writes.js";
import ActionLink from "../parts/ActionLink.vue";
import CreatePreview from "../parts/CreatePreview.vue";
import NewTaskForm, {type TaskFormValue} from "../parts/NewTaskForm.vue";
import NewWorkForm, {type WorkFormValue} from "../parts/NewWorkForm.vue";
import PageShell from "../parts/PageShell.vue";
import WriteResult from "../parts/WriteResult.vue";

/**
 * 新建 Work 与 Task（第三轮稿 `r3/new.html`）：左边表单，右边随填随变的预览（300 毫秒去抖，预览不取锁、不写文件）。
 * 号以提交时为准；提交成功后结果区写实际领到的 id，与预览不同时多一行说明。从 Work 页进来（`?workId=`）时默认新建 Task。
 */
const route = useRoute();
const router = useRouter();
const navigate = (href: string) => void router.push(href);
const overview = useResource<Overview>(() => "/api/overview", ["records"]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const presetWork = typeof route.query.workId === "string" ? route.query.workId : "";
const mode = ref<"work" | "task">(presetWork ? "task" : "work");
const MODES = [{value: "work", label: "新建 Work"}, {value: "task", label: "新建 Task"}];
const EMPTY_WORK: WorkFormValue = {slug: "", title: "", goal: "", issue: "", taskSlug: "", taskTitle: "", taskStatus: "planned"};
const EMPTY_TASK: TaskFormValue = {workId: presetWork, slug: "", title: "", goal: "", status: "planned"};
const workForm = ref<WorkFormValue>({...EMPTY_WORK});
const taskForm = ref<TaskFormValue>({...EMPTY_TASK});
const works = computed(() => (overview.data.value?.works ?? []).map((work) => ({workId: work.workId, title: work.title})));
const disabledReason = computed(() => {
    const writable = meta.data.value?.mainWritable;
    return writable && !writable.ok ? `主工作区现在不能写（${writable.message ?? writable.code}）` : null;
});

const workBody = () => ({...workForm.value, issue: workForm.value.issue === "" ? null : Number(workForm.value.issue), taskTitle: workForm.value.taskTitle || null});
const taskBody = () => ({slug: taskForm.value.slug, title: taskForm.value.title, goal: taskForm.value.goal || null, status: taskForm.value.status});

const preview = ref<CreatePreviewData | null>(null);
const previewLoading = ref(false);
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSequence = 0;
async function refreshPreview(): Promise<void> {
    const mine = ++previewSequence;
    const empty = mode.value === "work" ? Object.values(workForm.value).every((value) => value === "" || value === "planned") : taskForm.value.slug === "" && taskForm.value.title === "";
    if (empty) {
        preview.value = null;
        return;
    }
    previewLoading.value = true;
    try {
        const body = mode.value === "work" ? workBody() : {workId: taskForm.value.workId, ...taskBody()};
        const result = await sendJson<CreatePreviewData>("POST", `/api/preview/${mode.value}`, body);
        if (mine === previewSequence) preview.value = result.data;
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        // 预览失败不挡提交（表单只吸收字段名在表单里的问题，`preview` 这一条只在预览区显示）：服务端提交时还会再校验一遍。
        if (mine === previewSequence) preview.value = {workId: null, taskId: null, paths: [], files: {}, message: null, problems: [{field: "preview", code: error.code, message: error.message}]};
    } finally {
        if (mine === previewSequence) previewLoading.value = false;
    }
}
watch([mode, workForm, taskForm], () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 300);
}, {deep: true, immediate: true});
onBeforeUnmount(() => {
    if (previewTimer) clearTimeout(previewTimer);
});

const write = useWrite();
const notice = ref<Notice | null>(null);
const created = ref<{workId: string; taskId: string; previewed: string | null} | null>(null);
/**
 * 结果未知（连接中途断开）之后锁住表单：服务端可能已经建好了，再按一次就会领第二个号。
 * 开发者看过左栏或首页、确认之后才解锁。
 */
const unconfirmed = ref(false);
/** nb-ui 的 SegmentedControl 只能按选项禁用：提交在途时禁用另一项，当前这项保持选中的样子。 */
const modeOptions = computed(() => MODES.map((option) => ({...option, disabled: write.pending.value && option.value !== mode.value})));
/** 这次提交的是 Work 还是 Task：回包与“结果未知”的确认都按它处理，不按提交之后的模式（t15）。提交在途时也不让切换。 */
const submittedMode = ref<"work" | "task">(mode.value);
const formBlocked = computed(() => disabledReason.value ?? (unconfirmed.value ? "上一次新建的结果未知：先确认建好了没有" : null));
function confirmUnknown(clear: boolean): void {
    unconfirmed.value = false;
    notice.value = null;
    if (!clear) return;
    if (submittedMode.value === "work") workForm.value = {...EMPTY_WORK};
    else taskForm.value = {...EMPTY_TASK, workId: taskForm.value.workId};
}
/**
 * 提交时服务端报的字段问题（`details.field`、`problems[].field`）：交给表单显示在字段旁边，结果里只写“表单里标出了 N 处”。
 * 表单一改就清掉，免得旧问题一直挡着提交。
 */
const submitProblems = ref<PreviewProblem[]>([]);
watch([workForm, taskForm], () => {
    submitProblems.value = [];
}, {deep: true});
const formProblems = computed(() => [...(preview.value?.problems ?? []), ...submitProblems.value]);
async function submit(): Promise<void> {
    if (unconfirmed.value) return;
    notice.value = null;
    created.value = null;
    submitProblems.value = [];
    const submitting = mode.value;
    submittedMode.value = submitting;
    const previewed = submitting === "work" ? preview.value?.workId ?? null : preview.value?.taskId ?? null;
    const outcome = submitting === "work"
        ? await write.run(() => sendJson<WriteData & {workId: string; taskId: string}>("POST", "/api/works", workBody()))
        : await write.run(() => sendJson<WriteData & {workId: string; taskId: string}>("POST", `/api/works/${encodeURIComponent(taskForm.value.workId)}/tasks`, taskBody()));
    if (!outcome.ok) {
        if (outcome.failure.action === "unknown") {
            unconfirmed.value = true;
            overview.reload();
            notice.value = {...failureNotice("结果未知", outcome.failure), message: `${outcome.failure.message}。先刷新看看建好了没有：左栏与首页随推送更新，看有没有新的 Work 或 Task`};
            return;
        }
        const anchored = submitting === "work" ? WORK_FORM_FIELDS : TASK_FORM_FIELDS;
        submitProblems.value = fieldProblems(outcome.failure).filter((problem) => anchored.has(problem.field)).map((problem) => ({field: problem.field, code: outcome.failure.code, message: problem.message}));
        notice.value = failureNotice("没有新建", outcome.failure, anchored);
        return;
    }
    const {workId, taskId} = outcome.body.data;
    created.value = {workId, taskId, previewed};
    notice.value = successNotice(submitting === "work" ? `已新建 ${workId} 与 ${taskId}` : `已新建 ${workId}/${taskId}`, outcome.body);
    if (submitting === "work") workForm.value = {...EMPTY_WORK};
    else taskForm.value = {...EMPTY_TASK, workId: taskForm.value.workId};
}
// 带“重试”的失败提示属于提交时的那一种：切换模式后“重试”会提交另一张表，所以切换时收起它（t15 阶段 1 实现审查建议 4）。
watch(mode, () => {
    if (notice.value?.retry) notice.value = null;
});
const actualId = computed(() => (created.value ? (submittedMode.value === "work" ? created.value.workId : created.value.taskId) : null));
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, ...(presetWork ? [{label: workLabel(presetWork), href: workHref(presetWork)}] : []), {label: '新建'}]" title="新建" @navigate="navigate">
        <SegmentedControl class="self-start" :model-value="mode" :options="modeOptions" aria-label="新建什么" @update:model-value="(value) => (mode = value as 'work' | 'task')" />
        <section v-if="unconfirmed" class="nbdev-surface nbdev-surface-warn flex flex-wrap items-center gap-2 p-3">
            <span>表单已锁住：确认上一次建好了没有再继续。</span>
            <Button size="sm" variant="secondary" @click="confirmUnknown(true)">已经建好了，清空表单</Button>
            <Button size="sm" variant="ghost" @click="confirmUnknown(false)">没有建成，还要再建</Button>
        </section>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]">
            <NewWorkForm v-if="mode === 'work'" v-model="workForm" :problems="formProblems" :pending="write.pending.value" :slow="write.slow.value" :disabled-reason="formBlocked" @submit="submit" />
            <NewTaskForm v-else v-model="taskForm" :works="works" :problems="formProblems" :pending="write.pending.value" :slow="write.slow.value" :disabled-reason="formBlocked" @submit="submit" />
            <!-- 结果放在右栏顶上：出现时不推动左边的表单（t15 阶段 3c）。 -->
            <aside class="nbdev-stack min-w-0" aria-label="预览">
                <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" @retry="submit" />
                <section v-if="created" class="nbdev-surface nbdev-stack-tight p-3" aria-label="新建的结果">
                    <p v-if="created.previewed && created.previewed !== actualId" class="nbdev-warn">预览时是 {{ created.previewed }}，提交时它已被领走，实际领到 {{ actualId }}</p>
                    <div class="flex flex-wrap items-center gap-2">
                        <ActionLink :href="workHref(created.workId)" icon="i-lucide-folder-open" @navigate="navigate">打开 {{ created.workId }}</ActionLink>
                        <ActionLink :href="taskHref(created.workId, created.taskId)" icon="i-lucide-file-text" @navigate="navigate">打开 {{ created.taskId }}</ActionLink>
                        <Button size="sm" variant="ghost" icon-class="i-lucide-plus" @click="created = null; notice = null">再建一个</Button>
                    </div>
                </section>
                <div class="nbdev-surface p-4">
                    <p v-if="disabledReason" class="nbdev-warn mb-2">{{ disabledReason }}</p>
                    <CreatePreview :preview="preview" :loading="previewLoading" />
                </div>
            </aside>
        </div>
    </PageShell>
</template>
