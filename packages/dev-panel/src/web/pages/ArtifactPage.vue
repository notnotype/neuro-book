<script setup lang="ts">
import type {SplitterGestureState} from "@notnotype/nb-layout";
import {Splitter, type SplitterPanelConfig} from "@notnotype/nb-layout/vue";
import {Badge, Button, Dialog, Select, Tabs} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {sendJson} from "../host/api.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {taskHref, workHref} from "../host/routes.js";
import {useNotifyActions} from "../host/notify-actions.js";
import type {ArtifactPageData, Meta, NotifyData, WriteData} from "../host/types.js";
import {useAnswerDraft} from "../host/answer-draft.js";
import {useArtifactBridge} from "../host/artifact-bridge.js";
import {answerText, chosenQuestions, groupQuestions} from "../host/answers.js";
import {readAnswerPanelCollapsed, readAnswerPanelWidth, writeAnswerPanelCollapsed, writeAnswerPanelWidth} from "../host/prefs.js";
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
 * 版式（t23）：一行页头；页面与答题栏是 nb-layout `Splitter` 的两块面板，宽屏时答题栏可拖宽、可收起（收起后页面下面一条提交栏），
 * 窄于 1024px 时页头下“页面”“答题”两个标签，同一个 `Splitter` 把没选中的一块收成 0：两块一直挂着，切换不重载页面、不重建表单。
 * 进这一页时外壳把左栏收起（路由元信息 `focus`）。
 * 页面文件不按版本保存，所以切版本只切换题表，iframe 上标“页面是当前版本”；磁盘内容与最新一版不同时标“有未发布的改动”。
 * 页面里每道题末尾有答题控件（t23）：页面里填的经 `useArtifactBridge` 校验后只进草稿，提交仍在侧栏表单里按（页面自己的脚本能伪造任何取值）。
 * 答复成功后侧栏多一块“通知”（t11）：这份答复要通知谁、在等什么、发出去了没有，随推送更新；提问的会话已经换了时弹小窗一次。
 * 表单里没交的填写存在这台浏览器里（t21）：离开、刷新、面板重启后回来还在，提交成功或开发者自己关闭评审时清掉。
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
// 产物页按路径参数重建实例，这里的键在页面的一生里不变。
const {draft: answerDraft, clear: clearAnswerDraft} = useAnswerDraft(`${props.workId}/${props.taskId}/${props.artifactId}`);
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
const frame = ref<InstanceType<typeof ArtifactFrame> | null>(null);
const bridge = useArtifactBridge({
    frame: () => frame.value?.contentWindow() ?? null,
    questions: () => (showForm.value ? data.value?.questions ?? null : null),
    draft: answerDraft,
    // 提交在途时页面里也不能改：成功后草稿整份清空，在途时改的会悄悄丢掉。
    disabledReason: () => answerDisabled.value ?? (write.pending.value ? "正在提交" : null),
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
    return `${pending}；已答的留着，表单里填了没交的会清掉。${isQuestionSet.value ? "" : "会话要继续问时重新发布就会打开。"}在等答复的会话会醒来，看到这块评审关了。`;
});
async function closeReview(): Promise<void> {
    const current = data.value;
    if (!current?.ref.taskId) return;
    notice.value = null;
    const outcome = await write.run(() => sendJson<WriteData>("POST", "/api/artifact-close", {workId: current.ref.workId, taskId: current.ref.taskId, artifactId: current.ref.artifactId}));
    closeAsking.value = false;
    notice.value = outcome.ok ? successNotice(isQuestionSet.value ? "撤回了没答的题" : "评审关了", outcome.body) : failureNotice(`没有${closeLabel.value}`, outcome.failure);
    if (outcome.ok) clearAnswerDraft();
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
        clearAnswerDraft();
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

/** 宽屏（与外壳左栏的断点相同）：页面与答题栏并排；窄屏时两个标签切换。 */
const wideQuery = window.matchMedia("(min-width: 1024px)");
const wide = ref(wideQuery.matches);
const onWideChange = (event: MediaQueryListEvent) => (wide.value = event.matches);
wideQuery.addEventListener("change", onWideChange);
onBeforeUnmount(() => wideQuery.removeEventListener("change", onWideChange));
/** 面板 id 也是分隔线的可读名（Splitter 拿它拼“调整 页面 与 答题 的宽度”）。 */
const PAGE_PANEL = "页面";
const ANSWER_PANEL = "答题";
/** 答题栏的宽度与收起记在偏好里（拖完、点按钮时写）；窄屏的标签不记，进页面时有待答的题就先看答题。 */
const answerWidth = ref(readAnswerPanelWidth());
const answerCollapsed = ref(readAnswerPanelCollapsed());
const mobileView = ref<"page" | "answer" | null>(null);
watch(() => data.value?.questions, (questions) => {
    if (mobileView.value === null && questions) mobileView.value = groupQuestions(questions).pending.length > 0 ? "answer" : "page";
}, {immediate: true});
const answerHidden = computed(() => (wide.value ? answerCollapsed.value : mobileView.value === "page"));
const pageHidden = computed(() => !wide.value && mobileView.value !== "page");
/** 窄屏、有页面时页面与答题栏是两个标签面板。 */
const tabbed = computed(() => !wide.value && Boolean(data.value?.pageUrl));
type PanelCollapse = NonNullable<SplitterPanelConfig["collapse"]>;
/**
 * 用 computed 生成（理由同外壳的左栏：模板里写字面量的话每次重渲染都按缺省重新分配）。宽屏时页面按比例占剩下的，
 * 答题栏保持拖出来的像素宽；窄屏时两块都按比例，没选中的那块收成 0，选中的占满。没有页面（只有 ask 登记的题）时只有答题栏。
 */
const panels = computed<SplitterPanelConfig[]>(() => {
    const answer: SplitterPanelConfig = wide.value
        ? {id: ANSWER_PANEL, defaultSizePx: answerWidth.value, minSizePx: 288, maxSizePx: 720, sizing: "fixed", collapse: {collapsedSize: 0, restoreSize: answerWidth.value, collapseThreshold: 80, expandThreshold: 80, collapsed: answerHidden.value} satisfies PanelCollapse}
        : {id: ANSWER_PANEL, minSizePx: 200, sizing: "weight", collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 80, expandThreshold: 80, collapsed: answerHidden.value} satisfies PanelCollapse};
    if (!data.value?.pageUrl) return [{id: ANSWER_PANEL, sizing: "weight"}];
    const page: SplitterPanelConfig = wide.value
        ? {id: PAGE_PANEL, minSizePx: 360, sizing: "weight"}
        : {id: PAGE_PANEL, minSizePx: 200, sizing: "weight", collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 80, expandThreshold: 80, collapsed: pageHidden.value, toggleable: false} satisfies PanelCollapse};
    return [page, answer];
});
function setAnswerCollapsed(value: boolean): void {
    answerCollapsed.value = value;
    writeAnswerPanelCollapsed(value);
}
/** 拖完：收起状态回写（否则下一次重新分配又展开），展开着时记下新宽度。窄屏时分隔线禁用，不会到这里。 */
function onAnswerGestureEnd(state: SplitterGestureState): void {
    const collapsed = state.collapsed[ANSWER_PANEL];
    if (collapsed !== undefined) setAnswerCollapsed(collapsed);
    const width = state.sizesPx[state.sizesPx.length - 1];
    if (!answerCollapsed.value && width !== undefined && width > 0) {
        answerWidth.value = width;
        writeAnswerPanelWidth(width);
    }
}
const changedCount = computed(() => (data.value ? chosenQuestions(data.value.questions, answerDraft.value).length : 0));
const mobileTabs = computed(() => [{value: "page", label: "页面", id: "nbdev-tab-page", controls: "nbdev-page-panel"}, {value: "answer", label: "答题", count: pendingCount.value, id: "nbdev-tab-answer", controls: "nbdev-answer"}]);
/**
 * 打开答题栏并把焦点交给它（跳过页面去答题、提交栏的按钮）：DOM 里 iframe 在答题栏前面，键盘要先穿过页面里的全部控件（t22 实测 15 个停靠点）。
 * 收起时答题栏是 inert 的，先展开、等它重新可聚焦再聚焦；答题栏自己滚，聚焦时不滚动外层。
 */
/** 答题栏里点了“在页面里看”：窄屏时先切到页面。 */
function reveal(id: string): void {
    if (!wide.value) mobileView.value = "page";
    bridge.reveal(id);
}
const answerPanel = ref<HTMLElement | null>(null);
async function openAnswer(): Promise<void> {
    if (wide.value) setAnswerCollapsed(false);
    else mobileView.value = "answer";
    await nextTick();
    answerPanel.value?.focus({preventScroll: true});
}
</script>

<template>
    <!-- 铺满（路由 layout: fill）：页头不动，下面页面与答题栏各自滚动（iframe 自己滚），一页只有这两个竖向滚动者。 -->
    <div class="relative h-full min-h-0">
        <PageShell width="full" compact class="h-full min-h-0" :crumbs="crumbs" :title="data?.title ?? props.artifactId" @navigate="navigate">
            <template v-if="data" #status>
                <Badge v-if="data.state === 'closed'" tone="neutral" variant="outline" size="sm">已关闭</Badge>
                <Badge v-if="data.state === 'unpublished'" tone="warning" variant="soft" size="sm">还没发布</Badge>
                <Badge v-if="data.unpublishedChanges" tone="warning" variant="soft" size="sm" icon-class="i-lucide-pencil">有未发布的改动</Badge>
            </template>
            <template v-if="data?.publishedAt" #meta>
                <span class="nbdev-num">v{{ data.latestVersion }} 发布于 {{ relativeTime(data.publishedAt) }}</span>
            </template>
            <template v-if="data" #actions>
                <div v-if="versionOptions.length > 1" class="w-40">
                    <Select :model-value="String(data.version)" :options="versionOptions" aria-label="看哪一版的题表" @update:model-value="(value: string) => (version = Number(value) === data!.latestVersion ? null : Number(value))" />
                </div>
                <ActionLink v-if="data.pageUrl" :href="data.pageUrl" icon="i-lucide-external-link" external>单独打开</ActionLink>
                <Button v-if="data.pageUrl && wide" size="sm" variant="ghost" :icon-class="answerCollapsed ? 'i-lucide-panel-right-open' : 'i-lucide-panel-right-close'" :aria-expanded="!answerCollapsed" aria-controls="nbdev-answer" @click="answerCollapsed ? openAnswer() : setAnswerCollapsed(true)">{{ answerCollapsed ? "展开答题栏" : "收起答题栏" }}</Button>
                <Button v-if="canClose" size="sm" variant="ghost" icon-class="i-lucide-circle-x" :disabled="write.pending.value" @click="closeAsking = true">{{ closeLabel }}</Button>
            </template>
            <LoadState v-bind="loadStateOf(artifact)" label="正在读取产物" :subject="`${props.artifactId} 这个产物`" :up-href="upHref" up-label="回到上一级" @navigate="navigate" @retry="artifact.reload()" />
            <a v-if="data?.pageUrl && wide" href="#nbdev-answer" class="nbdev-skip-local" @click.prevent="openAnswer">{{ showForm ? "跳到答题" : "跳到问题" }}</a>
            <Tabs v-if="data?.pageUrl && !wide" class="-mt-1" size="sm" aria-label="页面与答题" :model-value="mobileView ?? 'page'" :items="mobileTabs" @update:model-value="(value: string) => (mobileView = value === 'answer' ? 'answer' : 'page')" />
            <Splitter v-if="data" class="min-h-0 flex-1" :panels="panels" :sash-sizes="[wide ? 1 : 0]" :disabled="!wide || answerCollapsed" @gesture-end="onAnswerGestureEnd">
                <template #[`panel-${PAGE_PANEL}`]>
                    <div id="nbdev-page-panel" class="flex h-full min-h-0 flex-col gap-2 lg:pr-3" :role="tabbed ? 'tabpanel' : undefined" :aria-labelledby="tabbed ? 'nbdev-tab-page' : undefined" :inert="pageHidden || undefined">
                        <!-- 页面文件不按版本保存：看的是最新一版时不用说明，看旧版的题表时说清页面仍是当前的。 -->
                        <ArtifactFrame v-if="data.pageUrl" ref="frame" class="min-h-0" :src="data.pageUrl" :title="`${data.title ?? props.artifactId} 的页面`" :note="data.version !== data.latestVersion ? `页面是当前版本（磁盘上的），题表是 v${data.version} 的` : null" />
                        <!-- 答题栏收起（宽屏）或在看页面（窄屏）时：数着待答与已改的题，提交前要展开看过一遍再按。 -->
                        <div v-if="showForm && answerHidden" class="nbdev-surface flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-panel)] px-3 py-2">
                            <span class="nbdev-note nbdev-num">待答 {{ pendingCount }}<template v-if="changedCount > 0"> · 已改 {{ changedCount }} 题</template></span>
                            <Button class="ml-auto" size="sm" :variant="changedCount > 0 ? 'primary' : 'secondary'" :icon-class="wide ? 'i-lucide-panel-right-open' : undefined" @click="openAnswer">{{ changedCount > 0 ? `去提交 ${changedCount} 题` : wide ? "展开答题栏" : "去答题" }}</Button>
                        </div>
                    </div>
                </template>
                <template #[`panel-${ANSWER_PANEL}`]>
                    <!-- 有表单时不留下内边距：表单的提交栏贴底，滚动容器的下内边距会让它离底边一截、后面的内容从缝里露出来。 -->
                    <!-- 窄屏有标签时是标签面板（div），宽屏时是侧栏（aside）：aside 不能带 tabpanel 角色。 -->
                    <component :is="tabbed ? 'div' : 'aside'" id="nbdev-answer" ref="answerPanel" tabindex="-1" class="nbdev-surface relative h-full min-h-0 min-w-0 overflow-y-auto px-4 pt-4 outline-none [scrollbar-gutter:stable]" :class="{'pb-4': !showForm, 'lg:ml-3': data.pageUrl}" :role="tabbed ? 'tabpanel' : undefined" :aria-labelledby="tabbed ? 'nbdev-tab-answer' : undefined" :aria-label="tabbed ? undefined : '问题'" :inert="(data.pageUrl && answerHidden) || undefined">
                        <div class="flex flex-col gap-4">
                            <AnswerForm v-if="showForm" :questions="data.questions" :latest-version="data.latestVersion ?? 0" :pending="write.pending.value" :slow="write.slow.value" :disabled-reason="answerDisabled" v-model:draft="answerDraft" :errors="formErrors" :revealable="data.pageUrl !== null" @submit="submitAnswer" @reveal="reveal">
                                <template #readonly>
                                    <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" answering />
                                </template>
                                <!-- 提交的结果与这份答复的通知都在贴底栏里：提交时人在侧栏底部，要手动发送、不通知的按钮也要看得到。 -->
                                <template v-if="notice || lastAnswerId" #result>
                                    <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" @retry="lastAnswer && submitAnswer(lastAnswer)" />
                                    <section v-if="lastAnswerId" class="nbdev-stack-tight" aria-label="这份答复的通知">
                                        <h2 class="nbdev-card-title">通知</h2>
                                        <NotifyStatus :jobs="answerJobs" :attempts="answerAttempts" :pending="notifyActions.pending.value" :dismissed="notifyActions.dismissed.value" empty-text="没有要通知的会话：提问者不明（读不到是哪个会话提的问）或已经确认过；会话下次读答复时会看到" @send="(job, target) => notifyActions.request(job, target)" @skip="(job) => notifyActions.skip(job)" @replaced="(job) => notifyActions.openReplaced(job)" @dismiss="notifyActions.dismiss" />
                                        <WriteResult v-if="notifyActions.notice.value" :notice="notifyActions.notice.value" @dismiss="notifyActions.notice.value = null" />
                                    </section>
                                </template>
                            </AnswerForm>
                            <template v-else>
                                <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" />
                                <QuestionPanel :questions="data.questions" :version="data.version ?? 0" :latest-version="data.latestVersion ?? 0" />
                            </template>
                        </div>
                    </component>
                </template>
            </Splitter>
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
