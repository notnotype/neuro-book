<script setup lang="ts">
import {Badge} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {groupQuestions} from "../host/answers.js";
import {relativeDay, sessionName, taskLabel, workLabel} from "../host/format.js";
import {renderMarkdown} from "../host/markdown.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {parsePeek, peekValue, type Peek} from "../host/peek.js";
import {artifactHref, docHref, editHref, isPlainClick, workHref} from "../host/routes.js";
import {useStatusChange} from "../host/status-change.js";
import type {ArtifactPageData, DocFileData, Meta, TaskPageData} from "../host/types.js";
import ActionLink from "../parts/ActionLink.vue";
import ArtifactFrame from "../parts/ArtifactFrame.vue";
import PeekPanel from "../parts/PeekPanel.vue";
import PageShell from "../parts/PageShell.vue";
import StatusSwitch from "../parts/StatusSwitch.vue";
import TruncatedText from "../parts/TruncatedText.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteResult from "../parts/WriteResult.vue";
import EphemeralFrame from "../parts/EphemeralFrame.vue";
import LeaseChip from "../parts/LeaseChip.vue";
import LoadState from "../parts/LoadState.vue";
import MarkdownView from "../parts/MarkdownView.vue";
import StatusChip from "../parts/StatusChip.vue";

/**
 * Task 页（Proposal 第九节；第三轮没有单独的稿，结构照 Work 页）：当前情况、执行 checkout 与它上面的提交、README、
 * 产物与文档类产物、证据、链到的 Spec、谁在动。从这里进文档页时带上执行 checkout。
 */
const props = defineProps<{workId: string; taskId: string}>();
const router = useRouter();
const page = useResource<TaskPageData>(() => `/api/task/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}`, ["records", "activity"]);
const meta = useResource<Meta>(() => "/api/meta", ["records"]);
const TASK_STATUSES = ["planned", "active", "done", "shelved"];
const writeBlocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const task = page.data.value?.task;
    if (task?.source === "branch") return `记录在分支 ${task.branch ?? ""} 上维护，在那里改或先迁移`;
    return null;
});
// 改成完成或搁置时核心会释放这个 Task 的全部租约，并提醒还有没答的必答题（警告照列）。
const status = useStatusChange(() => `/api/works/${encodeURIComponent(props.workId)}/tasks/${encodeURIComponent(props.taskId)}/status`, () => page.data.value?.task.readmeHash ?? null, () => page.reload());

const RULE_LABEL: Record<string, string> = {readme: "README 的执行位置", name: "目录名", home: "登记表", work: "Work 的执行 worktree", master: "主工作区"};
const readmeHtml = computed(() => {
    const data = page.data.value;
    if (!data?.detail.readme.text) return "";
    // frontmatter 与第一个一级标题（页头已经写了标题）不重复显示。
    return renderMarkdown(data.detail.readme.text.replace(/^---\n[\s\S]*?\n---\n/u, "").replace(/^\s*# .*\n/u, ""), {checkoutKey: data.task.checkoutKey ?? "main", path: data.detail.readme.path, artifactBase: meta.data.value?.artifactBase ?? null});
});
const executionKey = computed(() => page.data.value?.detail.execution.chosen.key ?? "main");
const preferKeys = computed(() => (page.data.value?.detail.execution.candidates ?? []).map((candidate) => candidate.key).join(","));

function navigate(href: string): void {
    void router.push(href);
}
function evidenceUrl(path: string): string | null {
    const base = meta.data.value?.artifactBase;
    const key = page.data.value?.task.checkoutKey;
    return base && key ? `${base}/${encodeURIComponent(key)}/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}

// ---- 速览面板（D1、决定点 10、17）：开着什么写在 ?peek= 里；查询参数变了页面不重建（决定点 14） ----
const route = useRoute();
const peek = computed(() => parsePeek(route.query.peek));
const peekArtifact = useResource<ArtifactPageData>(() => (peek.value?.kind === "artifact" ? `/api/artifact/${encodeURIComponent(props.workId)}/${encodeURIComponent(props.taskId)}/${encodeURIComponent(peek.value.artifactId)}` : null), ["records"]);
const peekDoc = useResource<DocFileData>(() => (peek.value?.kind === "doc" ? `/api/docs/file?checkout=${encodeURIComponent(peek.value.checkout)}&path=${encodeURIComponent(peek.value.path)}` : null), ["records"]);
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const peekTitle = computed(() => {
    const current = peek.value;
    if (!current) return "";
    if (current.kind === "artifact") return peekArtifact.data.value?.title ?? current.artifactId;
    if (current.kind === "doc") return peekDoc.data.value?.title ?? fileName(current.path);
    return fileName(current.path);
});
const peekPending = computed(() => (peekArtifact.data.value ? groupQuestions(peekArtifact.data.value.questions).pending.length : 0));
const peekDocHtml = computed(() => {
    const current = peek.value;
    const data = peekDoc.data.value;
    if (current?.kind !== "doc" || !data) return "";
    return renderMarkdown(data.body.replace(/^\s*# .*\n?/u, ""), {checkoutKey: current.checkout, path: data.path, artifactBase: meta.data.value?.artifactBase ?? null});
});

/**
 * 摆法按内容区（外壳的 main，不含左栏）的宽度定（决定点 17）：宽于 1100px 并排、推开正文；窄于它浮在正文上；手机整屏。
 * 左栏拖宽时内容区变窄，自动从并排切到浮层。面板是 fixed 定位，所以页面要知道 main 在视口里的位置：这是外壳的元素，页面只读它的尺寸。
 */
const SIDE_MIN = 1100;
const box = ref({top: 0, left: 0, width: 0, height: 0});
const viewport = ref(typeof window === "undefined" ? 1440 : window.innerWidth);
let resize: ResizeObserver | null = null;
function measureMain(): void {
    const main = document.getElementById("nbdev-main");
    viewport.value = window.innerWidth;
    if (!main) return;
    const rect = main.getBoundingClientRect();
    box.value = {top: rect.top, left: rect.left, width: main.clientWidth, height: rect.height};
}
onMounted(() => {
    measureMain();
    const main = document.getElementById("nbdev-main");
    if (main) {
        resize = new ResizeObserver(measureMain);
        resize.observe(main);
    }
    window.addEventListener("resize", measureMain);
});
onBeforeUnmount(() => {
    resize?.disconnect();
    window.removeEventListener("resize", measureMain);
});
const peekMode = computed<"side" | "overlay" | "full">(() => (viewport.value < 768 ? "full" : box.value.width >= SIDE_MIN ? "side" : "overlay"));
const peekWidth = computed(() => (peekMode.value === "side" ? Math.round(Math.min(560, Math.max(420, box.value.width * 0.4))) : Math.min(560, box.value.width - 48)));

/** 打开它的那个链接：关闭后焦点回到这里。是不是这一页自己 push 的：是就后退（后退就是关），不是（分享来的网址）就替换。 */
let opener: HTMLElement | null = null;
let pushed = false;
function openPeek(event: MouseEvent, target: Peek): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    opener = event.currentTarget as HTMLElement;
    const query = {...route.query, peek: peekValue(target)};
    // 已经开着一个时换内容不另加历史：关闭时一次后退就回到没开的样子。
    if (peek.value) void router.replace({query});
    else {
        pushed = true;
        void router.push({query});
    }
}
function closePeek(): void {
    if (pushed) {
        router.back();
        return;
    }
    const {peek: _closed, ...rest} = route.query;
    void router.replace({query: rest});
}
/** 并排时给正文让出面板的宽度（随测量算，所以是绑定的 style）。 */
const contentStyle = computed(() => (peek.value && peekMode.value === "side" ? {paddingRight: `${peekWidth.value}px`} : undefined));
// flush: post：正文在浮层、整屏时带 inert，要等 DOM 去掉它之后才能把焦点放回去。
watch(peek, (current) => {
    if (current) return;
    pushed = false;
    // 没有记下打开它的链接（从 Work 页的速览链接进来、刷新、分享来的网址）：退回页标题，与换页时外壳挪焦点的落点相同。
    const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>("#nbdev-main h1");
    // 页标题本来不可聚焦：与外壳 focusHeading 一样先给 tabindex="-1"。
    if (target && !opener && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target?.focus({preventScroll: true});
    opener = null;
}, {flush: "post"});
/** 浮层与整屏时遮罩下面的正文不能点、也 Tab 不进去（并排时正文照常可用）。 */
const contentInert = computed(() => (peek.value && peekMode.value !== "side" ? true : undefined));
/**
 * 速览的证据只认这个 Task 列出的证据文件：别的路径（别的 Work 的证据、产物里的文件）不以“证据”的名义显示。
 * Task 数据还没到时是 undefined（显示加载），到了没有就是 null。
 */
const peekEvidence = computed(() => {
    const current = peek.value;
    const data = page.data.value;
    if (current?.kind !== "evidence" || !data) return undefined;
    return data.detail.evidences.find((evidence) => evidence.kind === "file" && evidence.path === current.path) ?? null;
});
</script>

<template>
    <!-- 阅读档：README 卡片的宽度就是正文的阅读宽度，旁边是 22rem 的侧栏；加载时两栏先占住位置，页头不跳（t15 阶段 3b）。 -->
    <div :style="contentStyle">
        <PageShell width="reading" :inert="contentInert" :crumbs="[{label: '首页', href: '/'}, {label: workLabel(props.workId), href: workHref(props.workId)}, {label: taskLabel(props.taskId)}]" :title="page.data.value?.task.title ?? taskLabel(props.taskId)" @navigate="navigate">
            <template v-if="page.data.value" #status><StatusChip :status="page.data.value.task.status" size="md" /></template>
            <template v-if="page.data.value" #actions>
                <StatusSwitch :status="page.data.value.task.status.value" :options="TASK_STATUSES" :subject="taskLabel(props.taskId)" :disabled-reason="writeBlocked" :pending="status.write.pending.value" :slow="status.write.slow.value" @confirm="status.change" />
                <ActionLink v-if="!writeBlocked" :href="editHref(page.data.value.task.readmePath)" icon="i-lucide-pencil" @navigate="navigate">编辑 README</ActionLink>
            </template>
            <template v-if="page.data.value" #meta>
                <span>{{ page.data.value.task.workId }}/{{ page.data.value.task.taskId }}</span>
                <span>{{ page.data.value.task.updated.value ? `最近更新 ${relativeDay(page.data.value.task.updated.value)}` : "最近更新：未标" }}</span>
                <span>记录：{{ page.data.value.task.source === "branch" ? `分支 ${page.data.value.task.branch ?? ""}` : "master" }}{{ page.data.value.task.uncommitted ? "（有未提交的改动）" : "" }}</span>
            </template>
            <template v-if="status.notice.value" #feedback>
                <WriteResult :notice="status.notice.value" @dismiss="status.notice.value = null" @retry="status.retry" />
            </template>
            <LoadState v-if="page.data.value" v-bind="loadStateOf(page)" :subject="`${taskId} 这个 Task`" :up-href="workHref(workId)" up-label="回到 Work" @navigate="navigate" @retry="page.reload()" />
            <p v-if="page.data.value" :class="page.data.value.task.currentState ? 'nbdev-secondary' : 'nbdev-empty'">当前情况：{{ page.data.value.task.currentState ?? "未标" }}</p>
            <UncommittedDialog :open="status.pending.value !== null" :path="status.pending.value?.path ?? ''" :changes="status.pending.value?.changes ?? null" :pending="status.write.pending.value" @confirm="status.confirmUncommitted" @cancel="status.pending.value = null" />
            <!-- 速览面板并排时正文只剩约 680px，放不下阅读宽度的卡片加 22rem 的侧栏：改成一栏，侧栏接在 README 下面。 -->
            <div class="grid grid-cols-1 gap-5" :class="{'lg:grid-cols-[minmax(0,max-content)_22rem]': !(peek && peekMode === 'side')}">
                <article class="nbdev-surface nbdev-reading-card min-w-0">
                    <LoadState v-if="!page.data.value" v-bind="loadStateOf(page)" label="正在读取 Task" :subject="`${taskId} 这个 Task`" :up-href="workHref(workId)" up-label="回到 Work" @navigate="navigate" @retry="page.reload()" />
                    <MarkdownView v-else-if="readmeHtml" :html="readmeHtml" @navigate="navigate" />
                    <p v-else class="nbdev-empty">没有 README</p>
                </article>
                <aside class="nbdev-stack-page min-w-0">
                    <template v-if="page.data.value">
                        <section class="nbdev-stack">
                            <h2 class="nbdev-heading">执行 checkout</h2>
                            <ul class="nbdev-stack-tight nbdev-small">
                                <li v-for="candidate in page.data.value.detail.execution.candidates" :key="candidate.key" class="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <Badge v-if="candidate.key === executionKey" tone="accent" variant="soft" size="sm">选中</Badge>
                                    <RouterLink :to="{name: 'docs', query: {checkout: candidate.key, prefer: preferKeys}}">{{ candidate.key }}</RouterLink>
                                    <span class="nbdev-secondary flex min-w-0 items-center gap-1"><TruncatedText :text="candidate.branch ?? '分离 HEAD'" mono :copyable="candidate.branch !== null" /> · 按{{ RULE_LABEL[candidate.rule] }}</span>
                                </li>
                            </ul>
                        </section>
                        <section class="nbdev-stack">
                            <h2 class="nbdev-heading">{{ page.data.value.detail.commits.range === "branch" ? `${page.data.value.detail.commits.checkout} 分支上的提交` : "碰过这个 Task 的提交" }}</h2>
                            <p v-if="page.data.value.detail.commits.entries.length === 0" class="nbdev-empty">没有</p>
                            <ol v-else class="nbdev-stack-tight nbdev-small">
                                <li v-for="commit in page.data.value.detail.commits.entries" :key="commit.sha" class="flex min-w-0 items-center gap-2">
                                    <span class="nbdev-secondary shrink-0"><TruncatedText :text="commit.sha.slice(0, 9)" mono /></span>
                                    <span class="min-w-0 flex-1 truncate" :title="commit.subject">{{ commit.subject }}</span>
                                    <span class="nbdev-secondary shrink-0">{{ relativeDay(commit.date) }}</span>
                                </li>
                            </ol>
                        </section>
                        <section class="nbdev-stack">
                            <h2 class="nbdev-heading">产物与文档</h2>
                            <ul class="nbdev-stack-tight">
                                <li v-for="artifact in page.data.value.task.artifacts" :key="artifact.artifactId" class="flex flex-wrap items-center gap-1.5">
                                    <a :href="artifactHref(props.workId, props.taskId, artifact.artifactId)" @click="openPeek($event, {kind: 'artifact', artifactId: artifact.artifactId})">{{ artifact.title ?? artifact.artifactId }}</a>
                                    <Badge v-if="artifact.waiting > 0" tone="warning" variant="soft" size="sm">待答 {{ artifact.waiting }}</Badge>
                                    <span v-if="artifact.state === 'unpublished'" class="nbdev-empty nbdev-small">没发布</span>
                                </li>
                                <li v-for="document in page.data.value.task.documents" :key="document.path">
                                    <a :href="docHref(page.data.value.task.checkoutKey ?? 'main', document.path)" @click="openPeek($event, {kind: 'doc', checkout: page.data.value.task.checkoutKey ?? 'main', path: document.path})">{{ document.title ?? document.path.slice(document.path.lastIndexOf("/") + 1) }}</a>
                                </li>
                                <li v-if="page.data.value.task.artifacts.length === 0 && page.data.value.task.documents.length === 0" class="nbdev-empty">没有</li>
                            </ul>
                        </section>
                        <section v-if="page.data.value.detail.specs.length > 0" class="nbdev-stack">
                            <h2 class="nbdev-heading">README 链到的 Spec</h2>
                            <ul class="nbdev-stack-tight">
                                <li v-for="spec in page.data.value.detail.specs" :key="spec" class="min-w-0 break-words"><a :href="`${docHref(executionKey, spec)}&prefer=${encodeURIComponent(preferKeys)}`" @click="openPeek($event, {kind: 'doc', checkout: executionKey, path: spec})">{{ spec }}</a></li>
                            </ul>
                        </section>
                        <section class="nbdev-stack">
                            <h2 class="nbdev-heading">证据</h2>
                            <p v-if="page.data.value.detail.evidences.length === 0" class="nbdev-empty">没有</p>
                            <ul v-else class="nbdev-stack-tight nbdev-small">
                                <li v-for="evidence in page.data.value.detail.evidences" :key="evidence.path">
                                    <a v-if="evidence.kind === 'file' && evidenceUrl(evidence.path)" :href="evidenceUrl(evidence.path)!" target="_blank" rel="noopener noreferrer" @click="openPeek($event, {kind: 'evidence', path: evidence.path})">{{ evidence.name }}</a>
                                    <span v-else>{{ evidence.name }}{{ evidence.kind === "dir" ? "/" : "" }}</span>
                                </li>
                            </ul>
                        </section>
                        <!-- 持久页里混着的临时片段，仍用虚线框标出（t15 阶段 3g）。 -->
                        <EphemeralFrame title="谁在动">
                            <p v-if="page.data.value.task.leases.length === 0" class="nbdev-empty">没有</p>
                            <div v-else class="flex flex-wrap gap-1.5">
                                <LeaseChip v-for="lease in page.data.value.task.leases" :key="lease.sessionKey" :session="sessionName(lease.sessionKey, lease.label, page.data.value.sessionTitles)" :stale="lease.stale" />
                            </div>
                        </EphemeralFrame>
                    </template>
                </aside>
            </div>
        </PageShell>
        <!-- 速览面板：产物显示页面本身（不放答复表单），文档与 Spec 显示渲染后的正文，证据文件原样显示（决定点 10）。 -->
        <PeekPanel v-if="peek" :title="peekTitle" :mode="peekMode" :box="box" :width="peekWidth" :focus-key="peekValue(peek)" @close="closePeek">
            <template #actions>
                <template v-if="peek.kind === 'artifact'">
                    <ActionLink :href="artifactHref(props.workId, props.taskId, peek.artifactId)" icon="i-lucide-message-square-reply" @navigate="navigate">去答复</ActionLink>
                    <ActionLink v-if="peekArtifact.data.value?.pageUrl" :href="peekArtifact.data.value.pageUrl" icon="i-lucide-external-link" external>打开完整页</ActionLink>
                </template>
                <ActionLink v-else-if="peek.kind === 'doc'" :href="docHref(peek.checkout, peek.path)" icon="i-lucide-book-open" @navigate="navigate">打开文档页</ActionLink>
                <ActionLink v-else-if="evidenceUrl(peek.path)" :href="evidenceUrl(peek.path)!" icon="i-lucide-external-link" external>新标签页打开</ActionLink>
            </template>
            <template v-if="peek.kind === 'artifact' && peekArtifact.data.value" #status>
                <Badge v-if="peekArtifact.data.value.state === 'closed'" tone="neutral" variant="outline" size="sm">已关闭</Badge>
                <Badge v-else-if="peekArtifact.data.value.state === 'unpublished'" tone="warning" variant="soft" size="sm">还没发布</Badge>
                <Badge v-if="peekPending > 0" tone="warning" variant="soft" size="sm">待答 {{ peekPending }}</Badge>
                <span v-else>没有待答的题</span>
                <span v-if="peekArtifact.data.value.latestVersion !== null" class="nbdev-num">v{{ peekArtifact.data.value.latestVersion }}</span>
            </template>
            <template v-if="peek.kind === 'artifact'">
                <LoadState v-bind="loadStateOf(peekArtifact)" label="正在读取产物" :subject="`${peek.artifactId} 这个产物`" @retry="peekArtifact.reload()" />
                <ArtifactFrame v-if="peekArtifact.data.value?.pageUrl" :src="peekArtifact.data.value.pageUrl" :title="`${peekTitle} 的页面`" />
                <p v-else-if="peekArtifact.data.value" class="nbdev-empty">这个产物没有页面（Task 的提问集），去答复页看题</p>
            </template>
            <template v-else-if="peek.kind === 'doc'">
                <LoadState v-bind="loadStateOf(peekDoc)" label="正在读取文档" :subject="`${peek.path} 这份文档`" @retry="peekDoc.reload()" />
                <MarkdownView v-if="peekDoc.data.value" :html="peekDocHtml" @navigate="navigate" />
            </template>
            <template v-else>
                <p v-if="peekEvidence === null" class="nbdev-empty">这个 Task 没有这份证据</p>
                <ArtifactFrame v-else-if="peekEvidence && evidenceUrl(peek.path)" :src="evidenceUrl(peek.path)!" :title="`证据 ${peekTitle}`" note="证据文件，原样显示" />
                <LoadState v-else :loading="true" label="正在读取证据" />
            </template>
        </PeekPanel>
    </div>
</template>
