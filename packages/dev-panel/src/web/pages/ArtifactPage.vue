<script setup lang="ts">
import {Badge, Button, Dialog, Select} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {sendJson} from "../host/api.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {taskHref, workHref} from "../host/routes.js";
import {useNotifyActions} from "../host/notify-actions.js";
import type {ArtifactPageData, Meta, NotifyData, WriteData} from "../host/types.js";
import {answerText, groupQuestions} from "../host/answers.js";
import {failureNotice, successNotice, useWrite, type Notice} from "../host/writes.js";
import ActionLink from "../parts/ActionLink.vue";
import AnswerForm from "../parts/AnswerForm.vue";
import ArtifactFrame from "../parts/ArtifactFrame.vue";
import DeveloperMessageDialog from "../parts/DeveloperMessageDialog.vue";
import LoadState from "../parts/LoadState.vue";
import NotifyStatus from "../parts/NotifyStatus.vue";
import PageShell from "../parts/PageShell.vue";
import QuestionPanel from "../parts/QuestionPanel.vue";
import ScreenConfirmDialog from "../parts/ScreenConfirmDialog.vue";
import WriteResult from "../parts/WriteResult.vue";

/**
 * 产物页（t03 第二轮产物页）：左边是产物来源上的原页（沙箱 iframe，不给同源），右边是问题侧栏与答复表单（t10）。
 * 页面文件不按版本保存，所以切版本只切换题表，iframe 上标“页面是当前版本”；磁盘内容与最新一版不同时标“有未发布的改动”。
 * 答复只经侧栏表单提交：外壳不监听 iframe 发来的消息（页面自己的脚本能伪造任何取值）。390 宽时侧栏移到 iframe 下面。
 * 答复成功后侧栏多一块“通知”（t11）：这份答复要通知谁、在等什么、发出去了没有，随推送更新；提问的会话已经换了时弹小窗一次。
 */
const props = defineProps<{workId: string; taskId: string; artifactId: string}>();
const router = useRouter();
const version = ref<number | null>(null);
watch(() => [props.workId, props.taskId, props.artifactId], () => {
    version.value = null;
});
const artifact = useResource<ArtifactPageData>(() => `/api/artifact/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}/${encodeURIComponent(props.artifactId)}${version.value === null ? "" : `?version=${version.value}`}`, ["records"]);
const data = computed(() => artifact.data.value);
const versionOptions = computed(() => [...(data.value?.versions ?? [])].reverse().map((entry) => ({value: String(entry), label: entry === data.value?.latestVersion ? `v${entry}（最新）` : `v${entry}`})));
const crumbs = computed(() => [
    {label: "产物", href: "/artifacts"},
    {label: workLabel(props.workId), href: workHref(props.workId)},
    ...(props.taskId === "-" ? [] : [{label: taskLabel(props.taskId), href: taskHref(props.workId, props.taskId)}]),
    {label: props.artifactId},
]);
/** 产物找不到（404）时回到哪里：所属 Task，独立产物回到产物列表。 */
const upHref = computed(() => (props.taskId === "-" ? "/artifacts" : taskHref(props.workId, props.taskId)));
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const write = useWrite();
const notice = ref<Notice | null>(null);
const formErrors = ref<Record<string, string>>({});
const resetKey = ref(0);
/** 表单只给有发布记录的 Task 产物；能不能答写成原因，零件据此置只读。 */
const showForm = computed(() => data.value !== undefined && data.value !== null && data.value.ref.taskId !== null && data.value.state !== "unpublished");
const answerDisabled = computed(() => {
    const current = data.value;
    if (!current) return null;
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    if (current.source === "branch") return `记录在分支 ${current.branch ?? ""} 上维护，在那里答或先迁移`;
    if (current.state === "closed") return "产物已关闭，不能再答";
    if (current.version !== current.latestVersion) return `只能对最新一版（v${current.latestVersion}）答复；切回最新一版再答`;
    return null;
});
/** Task 的提问集不能关闭（关了这个 Task 就再也不能提问），开发者不想答时把没答的题一次撤回。 */
const isQuestionSet = computed(() => data.value?.ref.artifactId === "questions");
const closeLabel = computed(() => (isQuestionSet.value ? "撤回没答的题" : "关闭评审"));
const pendingCount = computed(() => (data.value ? groupQuestions(data.value.questions).pending.length : 0));
/** 和答复一样只对能写的最新一版给（不能答的原因就是不能关的原因）；提问集没有可撤回的题时不给。 */
const canClose = computed(() => showForm.value && answerDisabled.value === null && (!isQuestionSet.value || pendingCount.value > 0));
const closeAsking = ref(false);
const closeMessage = computed(() => {
    const pending = pendingCount.value === 0 ? "没有没答的题" : `没答的 ${pendingCount.value} 道题会撤回，不再进收件箱`;
    return `${pending}；已答的留着，表单里填了没交的不会保存。${isQuestionSet.value ? "" : "会话要继续问时重新发布就会打开。"}在等答复的会话会醒来，看到这块评审关了。`;
});
async function closeReview(): Promise<void> {
    const current = data.value;
    if (!current?.ref.taskId) return;
    notice.value = null;
    const outcome = await write.run(() => sendJson<WriteData>("POST", "/api/artifact-close", {workId: current.ref.workId, taskId: current.ref.taskId, artifactId: current.ref.artifactId}));
    closeAsking.value = false;
    notice.value = outcome.ok ? successNotice(isQuestionSet.value ? "撤回了没答的题" : "评审关了", outcome.body) : failureNotice(`没有${closeLabel.value}`, outcome.failure);
    resetKey.value += 1;
    artifact.reload();
}

const notify = useResource<NotifyData>(() => (data.value?.ref.taskId ? `/api/notify?workId=${encodeURIComponent(data.value.ref.workId)}&taskId=${encodeURIComponent(data.value.ref.taskId)}` : null), ["notify", "sessions"]);
const notifyActions = useNotifyActions(() => notify.reload());
/** 最近一次提交成功的答复：只显示它的通知。 */
const lastAnswerId = ref<string | null>(null);
const answerJobs = computed(() => (notify.data.value?.jobs ?? []).filter((job) => [...job.answers, ...job.legacy].some((entry) => entry.answerId === lastAnswerId.value)));
const answerAttempts = computed(() => (notify.data.value?.recent ?? []).filter((attempt) => lastAnswerId.value !== null && attempt.answers.includes(lastAnswerId.value)));
const autoOpened = new Set<string>();
watch(answerJobs, (jobs) => {
    const job = jobs.find((entry) => entry.state === "replaced");
    if (!job || lastAnswerId.value === null || autoOpened.has(lastAnswerId.value)) return;
    autoOpened.add(lastAnswerId.value);
    notifyActions.openReplaced(job);
});

type AnswerInput = {values: Record<string, unknown>; comments: Record<string, string>; note: string | null};
let lastAnswer: AnswerInput | null = null;
async function submitAnswer(answer: AnswerInput): Promise<void> {
    lastAnswer = answer;
    const current = data.value;
    if (!current?.ref.taskId || current.latestVersion === null) return;
    notice.value = null;
    formErrors.value = {};
    const body = {workId: current.ref.workId, taskId: current.ref.taskId, artifactId: current.ref.artifactId, version: current.latestVersion, ...answer};
    const outcome = await write.run(() => sendJson<WriteData>("POST", "/api/answers", body));
    if (outcome.ok) {
        // 结果写答了什么：逐题“题目：答案”，提交号放在说明里（成功只给提交号时，开发者看不出交上去的是哪几题）。
        const summary = Object.entries(answer.values).map(([id, value]) => {
            const question = current.questions.find((state) => state.question.id === id)?.question;
            return question ? `${question.label}：${answerText(question, value)}` : `${id}：${String(value)}`;
        });
        notice.value = {...successNotice(`答了 ${summary.length} 题`, outcome.body), items: summary};
        lastAnswerId.value = (outcome.body.data as WriteData & {answer?: {answerId: string}}).answer?.answerId ?? null;
        notify.reload();
        resetKey.value += 1;
        artifact.reload();
        return;
    }
    const {failure} = outcome;
    const problems = Array.isArray(failure.details.problems) ? failure.details.problems as Array<{questionId: string; reason: string}> : [];
    formErrors.value = Object.fromEntries([...problems.map((problem) => [problem.questionId, problem.reason]), ...(typeof failure.details.questionId === "string" ? [[failure.details.questionId, failure.message]] : [])]);
    // 表单只在这一版里能答的题（待答、已答）下面显示问题；锚到这些题的原因只在题目下面报一次（3c）。
    const {pending, answered} = groupQuestions(current.questions);
    const answerable = new Set([...pending, ...answered].map((state) => state.question.id));
    notice.value = failure.action === "unknown"
        ? {...failureNotice("结果未知", failure), message: `${failure.message}。已重新载入，看上面“已答”里有没有这次的答复`}
        : failureNotice("答复没有提交", failure, answerable);
    if (failure.action === "reload" || failure.action === "unknown") artifact.reload();
}

const navigate = (href: string) => void router.push(href);
</script>

<template>
    <!-- 铺满（路由 layout: fill）：宽屏时页头不动，左边产物的原页占满剩下的高度（iframe 自己滚），右边侧栏自己滚，两边不联动；
         窄屏上下堆叠，整页由这一层滚，仍只有一个竖向滚动者。 -->
    <div class="relative h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable] lg:overflow-hidden lg:[scrollbar-gutter:auto]">
        <PageShell width="full" class="lg:h-full lg:min-h-0" :crumbs="crumbs" :title="data?.title ?? props.artifactId" @navigate="navigate">
            <template v-if="data" #status>
                <Badge v-if="data.state === 'closed'" tone="neutral" variant="outline" size="sm">已关闭</Badge>
                <Badge v-if="data.state === 'unpublished'" tone="warning" variant="soft" size="sm">还没发布</Badge>
                <Badge v-if="data.unpublishedChanges" tone="warning" variant="soft" size="sm" icon-class="i-lucide-pencil">有未发布的改动</Badge>
            </template>
            <template v-if="data" #actions>
                <div v-if="versionOptions.length > 1" class="w-40">
                    <Select :model-value="String(data.version)" :options="versionOptions" aria-label="看哪一版的题表" @update:model-value="(value: string) => (version = Number(value) === data!.latestVersion ? null : Number(value))" />
                </div>
                <ActionLink v-if="data.pageUrl" :href="data.pageUrl" icon="i-lucide-external-link" external>单独打开</ActionLink>
                <Button v-if="canClose" size="sm" variant="ghost" icon-class="i-lucide-circle-x" :disabled="write.pending.value" @click="closeAsking = true">{{ closeLabel }}</Button>
            </template>
            <template v-if="data?.publishedAt" #meta>
                <span class="nbdev-num">v{{ data.latestVersion }} 发布于 {{ relativeTime(data.publishedAt) }}</span>
            </template>
            <LoadState v-bind="loadStateOf(artifact)" label="正在读取产物" :subject="`${props.artifactId} 这个产物`" :up-href="upHref" up-label="回到上一级" @navigate="navigate" @retry="artifact.reload()" />
            <div v-if="data" class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)]">
                <ArtifactFrame v-if="data.pageUrl" class="min-h-[32rem] lg:min-h-0" :src="data.pageUrl" :title="`${data.title ?? props.artifactId} 的页面`" note="页面是当前版本（磁盘上的），切换版本只切换题表" />
                <!-- 有表单时不留下内边距：表单的提交栏贴底，滚动容器的下内边距会让它离底边一截、后面的内容从缝里露出来。 -->
                <aside class="nbdev-surface relative min-w-0 px-4 pt-4 lg:min-h-0 lg:overflow-y-auto lg:[scrollbar-gutter:stable]" :class="{'lg:col-span-2': !data.pageUrl, 'pb-4': !showForm}" aria-label="问题">
                    <div class="flex flex-col gap-4">
                        <AnswerForm v-if="showForm" :questions="data.questions" :latest-version="data.latestVersion ?? 0" :pending="write.pending.value" :slow="write.slow.value" :disabled-reason="answerDisabled" :errors="formErrors" :reset-key="resetKey" @submit="submitAnswer">
                            <template #readonly>
                                <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" answering />
                            </template>
                            <!-- 提交的结果与这份答复的通知都在贴底栏里：提交时人在侧栏底部，要手动发送、不通知的按钮也要看得到。 -->
                            <template v-if="notice || lastAnswerId" #result>
                                <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" @retry="lastAnswer && submitAnswer(lastAnswer)" />
                                <section v-if="lastAnswerId" class="nbdev-stack-tight" aria-label="这份答复的通知">
                                    <h2 class="nbdev-card-title">通知</h2>
                                    <NotifyStatus :jobs="answerJobs" :attempts="answerAttempts" :pending="notifyActions.pending.value" :dismissed="notifyActions.dismissed.value" empty-text="没有要通知的会话：提问者不明（provenance 读不到）或已经确认过；会话下次读答复时会看到" @send="(job, target) => notifyActions.request(job, target)" @skip="(job) => notifyActions.skip(job)" @replaced="(job) => notifyActions.openReplaced(job)" @dismiss="notifyActions.dismiss" />
                                    <WriteResult v-if="notifyActions.notice.value" :notice="notifyActions.notice.value" @dismiss="notifyActions.notice.value = null" />
                                </section>
                            </template>
                        </AnswerForm>
                        <template v-else>
                            <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" />
                            <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" />
                        </template>
                    </div>
                </aside>
            </div>
            <Dialog :open="closeAsking" :title="`${closeLabel}？`" size="sm" :busy="write.pending.value" @request-close="closeAsking = false">
                <p>{{ closeMessage }}</p>
                <template #footer>
                    <div class="flex justify-end gap-2">
                        <Button variant="ghost" :disabled="write.pending.value" @click="closeAsking = false">取消</Button>
                        <Button variant="danger" :loading="write.pending.value" @click="closeReview">{{ closeLabel }}</Button>
                    </div>
                </template>
            </Dialog>
            <DeveloperMessageDialog :open="notifyActions.compose.value !== null" :compose="notifyActions.compose.value" :pending="notifyActions.pending.value" @send="(job, target, text) => notifyActions.deliver(job, target, text)" @skip="(job) => notifyActions.skip(job)" @cancel="notifyActions.compose.value = null" />
            <ScreenConfirmDialog :open="notifyActions.confirm.value !== null" :title="notifyActions.confirm.value?.title ?? ''" :message="notifyActions.confirm.value?.message ?? ''" :screen="notifyActions.confirm.value?.screen ?? null" :confirm-label="notifyActions.confirm.value?.confirmLabel ?? '确认'" :pending="notifyActions.pending.value" @confirm="notifyActions.confirmRun()" @cancel="notifyActions.confirm.value = null" />
        </PageShell>
    </div>
</template>
