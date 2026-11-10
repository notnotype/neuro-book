<script setup lang="ts">
import {Badge, Button, Table} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {relativeTime, taskLabel, workLabel} from "../host/format.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {isPlainClick, taskHref} from "../host/routes.js";
import type {CheckoutFilesData, CheckoutRow, CheckoutsData} from "../host/types.js";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import TruncatedText from "../parts/TruncatedText.vue";

/**
 * checkout 页（Proposal 第九节）：路径、分支、HEAD、是哪个 Work 的执行 worktree；t14 加未提交、相对 master 的领先落后、在跑的服务、
 * 是哪些 Task 的 `home`。这几列请求时现算、每个 checkout 留 10 秒。
 * 页面开着时每 10 秒自己重取一次：改了文件不会改变“活动”，只随推送重取会一直显示旧的“干净”（t14 实现审查 I4）；服务端有同样长的缓存，
 * 不会放大开销。“N 秒前算的”按秒走。不做“是否可清理”（判据在根 scripts 的 governance:worktree，见 t09 计划“不一致”）。
 * t15 阶段 4 第 4 批：整行可点（去它的 Task，没有就去它的文档）；落后、有未提交、有服务在跑用同一种“需要注意”的颜色；
 * 未提交分已跟踪与未跟踪，点开看文件清单（`?files=<key>`）；“在跑”页的服务按 `?focus=<key>` 链到这一行。
 */
const REFETCH_MS = 10_000;
const route = useRoute();
const router = useRouter();
const navigate = (href: string) => void router.push(href);
const checkouts = useResource<CheckoutsData>(() => "/api/checkouts", ["records", "activity"]);
const filesKey = computed(() => (typeof route.query.files === "string" ? route.query.files : null));
const focusKey = computed(() => (typeof route.query.focus === "string" ? route.query.focus : null));
const files = useResource<CheckoutFilesData>(() => (filesKey.value ? `/api/checkouts/${encodeURIComponent(filesKey.value)}/files` : null), ["records", "activity"]);
const refetch = setInterval(() => {
    checkouts.reload();
    if (filesKey.value) files.reload();
}, REFETCH_MS);
const now = ref(Date.now());
const clock = setInterval(() => {
    now.value = Date.now();
}, 1_000);
onBeforeUnmount(() => {
    clearInterval(refetch);
    clearInterval(clock);
});
type Row = {key: string; branch: string; head: string; dirty: string; sync: string; runs: string; tasks: string; root: string; checkout: CheckoutRow};
const rows = computed<Row[]>(() => (checkouts.data.value?.checkouts ?? []).map((checkout) => ({key: checkout.key, branch: "", head: "", dirty: "", sync: "", runs: "", tasks: "", root: "", checkout})));
const computedAt = computed(() => checkouts.data.value?.checkouts.map((row) => row.at).sort()[0] ?? null);
const computedAgo = computed(() => {
    if (!computedAt.value) return null;
    const seconds = Math.max(0, Math.floor((now.value - Date.parse(computedAt.value)) / 1000));
    return seconds < 60 ? `${seconds} 秒前` : relativeTime(computedAt.value, new Date(now.value));
});
const columns: Array<{key: keyof Row & string; label: string; width?: string}> = [
    {key: "key", label: "checkout", width: "11rem"}, {key: "branch", label: "分支", width: "10rem"}, {key: "head", label: "HEAD", width: "6rem"}, {key: "dirty", label: "未提交", width: "6.5rem"},
    {key: "sync", label: "相对 master", width: "8rem"}, {key: "runs", label: "在跑", width: "10rem"}, {key: "tasks", label: "它的 Task 与 Work"}, {key: "root", label: "路径", width: "9rem"},
];

/** 整行去哪：它是某个 Task 的（`home` 或目录名认出的）就去第一个 Task，否则去这个 checkout 的文档。 */
function targetOf(checkout: CheckoutRow): string {
    const task = checkout.tasks[0];
    return task ? taskHref(task.workId, task.taskId) : `/docs?checkout=${encodeURIComponent(checkout.key)}`;
}
/** 需要注意的几种状态，同一种颜色（`nbdev-warn`，行首的点也是它）：落后 master、有未提交（已跟踪或未跟踪）、有服务在跑。 */
function attention(checkout: CheckoutRow): string[] {
    const reasons: string[] = [];
    if ((checkout.behind ?? 0) > 0) reasons.push(`落后 ${checkout.behind}`);
    if ((checkout.tracked ?? 0) > 0) reasons.push(`改了 ${checkout.tracked} 个文件`);
    if ((checkout.untracked ?? 0) > 0) reasons.push(`${checkout.untracked} 个未跟踪`);
    if (checkout.runs.length > 0) reasons.push(`${checkout.runs.length} 个服务在跑`);
    return reasons;
}
const hasChanges = (checkout: CheckoutRow) => (checkout.tracked ?? 0) + (checkout.untracked ?? 0) > 0;

/** 行里的链接：普通左键在本页跳，带修饰键的交给浏览器（新标签页）。整行点击见 `onTableClick`，点在链接上它不处理。 */
function followLink(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(href);
}
/**
 * 整行可点（第 4 批审查第 2、8 条）：在表格外层自己判断，不用 nb-ui `Table` 的 `row-click`（它拿不到事件，行里的复制按钮、
 * 修饰键、拖选文字都会冒泡成跳转）。点在链接或按钮上（第一格的链接、分支与 HEAD 的复制、“改 N · 新 M”）、带修饰键或不是左键、
 * 松手时有选中的文字（拖选想复制），都不跳。行由第一格的 `id` 认。
 */
function onTableClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest("tbody tr");
    if (!target || !row || target.closest("a, button, [role=button]")) return;
    if (!isPlainClick(event) || (window.getSelection()?.toString() ?? "") !== "") return;
    const key = row.querySelector("[id^='checkout-']")?.id.slice("checkout-".length);
    const checkout = checkouts.data.value?.checkouts.find((entry) => entry.key === key);
    if (checkout) navigate(targetOf(checkout));
}
function setQuery(patch: Record<string, string | undefined>): void {
    const query = Object.fromEntries(Object.entries({...route.query, ...patch}).filter(([, value]) => typeof value === "string")) as Record<string, string>;
    void router.replace({query});
}
function toggleFiles(key: string): void {
    setQuery({files: filesKey.value === key ? undefined : key});
}
const filesSection = ref<HTMLElement | null>(null);
watch(filesKey, async (key) => {
    if (!key) return;
    await nextTick();
    filesSection.value?.scrollIntoView({block: "nearest"});
});
/**
 * 从“在跑”页过来（`?focus=`）：数据到了就把那一行滚进视野，每个 key 只滚一次。这一页每 10 秒与每次推送都重取，
 * 每次都滚会把正在看文件清单、横向滚表格的人拉回来（第 4 批审查第 3 条）；框照旧留着。
 */
let scrolledFor: string | null = null;
watch(() => [focusKey.value, checkouts.data.value] as const, async ([key, data]) => {
    if (!key || !data || key === scrolledFor) return;
    scrolledFor = key;
    await nextTick();
    document.getElementById(`checkout-${key}`)?.scrollIntoView({block: "center"});
}, {immediate: true});
const STATUS_LABEL: Record<string, string> = {M: "改", A: "新增", D: "删", T: "类型变", U: "冲突"};
</script>

<template>
    <PageShell :crumbs="[{label: '首页', href: '/'}, {label: 'checkout'}]" title="checkout" @navigate="navigate">
        <template v-if="computedAgo" #meta><span>未提交与领先落后是 {{ computedAgo }}算的</span><span>点一行去它的 Task，没有 Task 的去它的文档</span></template>
        <LoadState v-bind="loadStateOf(checkouts)" label="正在读取 checkout" @retry="checkouts.reload()" />
        <!-- 列多：窄屏上整张表横向滚动，不把每列挤成一字一行；路径截断（悬停看全文、点一下复制），宽屏不必横向滚动。 -->
        <div v-if="checkouts.data.value" class="relative overflow-x-auto" @click="onTableClick">
            <div class="min-w-[56rem]">
            <Table class="nbdev-table nbdev-checkout-table" :columns="columns" :rows="rows" row-key="key" density="compact" hoverable>
                <template #cell-key="{row}">
                    <span :id="`checkout-${row.checkout.key}`" class="flex items-center gap-1.5" :class="{'nbdev-checkout-focus': focusKey === row.checkout.key}">
                        <span class="nbdev-attention-dot" :class="{'nbdev-attention-on': attention(row.checkout).length > 0}" aria-hidden="true" />
                        <a :href="targetOf(row.checkout)" class="font-medium hover:underline" @click="followLink($event, targetOf(row.checkout))">{{ row.checkout.key }}</a>
                        <span v-if="attention(row.checkout).length > 0" class="sr-only">需要注意：{{ attention(row.checkout).join("、") }}</span>
                        <Badge v-if="row.checkout.isMain" tone="accent" variant="soft" size="sm">主工作区</Badge>
                    </span>
                </template>
                <template #cell-branch="{row}"><span class="block max-w-[10rem]"><TruncatedText :text="row.checkout.branch ?? '分离 HEAD'" mono :copyable="row.checkout.branch !== null" /></span></template>
                <template #cell-head="{row}"><TruncatedText :text="row.checkout.head.slice(0, 9)" mono /></template>
                <template #cell-dirty="{row}">
                    <span v-if="row.checkout.error" class="nbdev-warn" :title="row.checkout.error">读不出</span>
                    <span v-else-if="row.checkout.timedOut" class="nbdev-empty" title="git 3 秒内没算完（冷的大 worktree），下一轮再算">没算完</span>
                    <button v-else-if="hasChanges(row.checkout)" type="button" class="nbdev-warn nbdev-num whitespace-nowrap underline-offset-2 hover:underline" :aria-expanded="filesKey === row.checkout.key" :aria-label="`改 ${row.checkout.tracked} · 新 ${row.checkout.untracked}：${row.checkout.key} 的未提交文件`" @click="toggleFiles(row.checkout.key)">改 {{ row.checkout.tracked }} · 新 {{ row.checkout.untracked }}</button>
                    <span v-else class="nbdev-empty">干净</span>
                </template>
                <template #cell-sync="{row}">
                    <span v-if="row.checkout.ahead === null" class="nbdev-empty">—</span>
                    <span v-else class="nbdev-num whitespace-nowrap">领先 {{ row.checkout.ahead }} · <span :class="{'nbdev-warn': (row.checkout.behind ?? 0) > 0}">落后 {{ row.checkout.behind }}</span></span>
                </template>
                <!-- 表格按内容自动分列宽，地址又不能断词：给这一格一个最小宽度，免得地址一行几个字。 -->
                <template #cell-runs="{row}">
                    <span v-if="row.checkout.runs.length === 0" class="nbdev-empty">—</span>
                    <span v-else class="block min-w-[8.5rem]" aria-hidden="true" />
                    <span v-for="run in row.checkout.runs" :key="run.runId" class="nbdev-warn nbdev-small block min-w-0"><span class="block">{{ run.package.slice(run.package.lastIndexOf("/") + 1) }} · {{ run.script }}</span><span v-if="run.url" class="block break-all">{{ run.url }}</span></span>
                    <span v-if="row.checkout.runs.length > 1" class="nbdev-note block">这个 checkout 上有 {{ row.checkout.runs.length }} 个服务</span>
                </template>
                <template #cell-tasks="{row}">
                    <span v-if="row.checkout.tasks.length === 0 && row.checkout.executionOf.length === 0" class="nbdev-empty">—</span>
                    <span v-else class="flex flex-wrap gap-x-2">
                        <a v-for="task in row.checkout.tasks" :key="`${task.workId}/${task.taskId}`" :href="taskHref(task.workId, task.taskId)" class="hover:underline" @click="followLink($event, taskHref(task.workId, task.taskId))">{{ workLabel(task.workId) }}/{{ taskLabel(task.taskId) }}</a>
                        <span v-if="row.checkout.executionOf.length > 0" class="nbdev-secondary">{{ row.checkout.executionOf.map(workLabel).join("、") }} 的执行 worktree</span>
                    </span>
                </template>
                <template #cell-root="{row}"><span class="nbdev-note block max-w-[9rem]"><TruncatedText :text="row.checkout.root" mono /></span></template>
            </Table>
            </div>
        </div>
        <section v-if="filesKey" ref="filesSection" class="nbdev-surface nbdev-stack relative p-4" :aria-label="`${filesKey} 的未提交文件`">
            <div class="flex items-center gap-2">
                <h2 class="nbdev-card-title flex-1">{{ filesKey }} 的未提交文件</h2>
                <Button size="sm" variant="ghost" icon-class="i-lucide-x" @click="setQuery({files: undefined})">收起</Button>
            </div>
            <LoadState v-bind="loadStateOf(files)" label="正在读取文件清单" @retry="files.reload()" />
            <template v-if="files.data.value">
                <p v-if="files.data.value.timedOut" class="nbdev-empty">git 3 秒内没算完，稍后会再取</p>
                <p v-else-if="files.data.value.error" class="nbdev-warn">读不出：{{ files.data.value.error }}</p>
                <p v-else-if="files.data.value.staged.length + files.data.value.unstaged.length + files.data.value.untracked.length === 0" class="nbdev-empty">没有未提交的文件</p>
                <div v-else class="grid gap-4 md:grid-cols-3">
                    <div v-for="part in [{title: '已暂存', items: files.data.value.staged.map((entry) => ({path: entry.path, code: entry.code}))}, {title: '工作区改动', items: files.data.value.unstaged.map((entry) => ({path: entry.path, code: entry.code}))}, {title: '未跟踪', items: files.data.value.untracked.map((path) => ({path, code: '?'}))}]" :key="part.title" class="nbdev-stack-tight min-w-0">
                        <h3 class="nbdev-secondary nbdev-small">{{ part.title }} · {{ part.items.length }}</h3>
                        <p v-if="part.items.length === 0" class="nbdev-empty nbdev-small">没有</p>
                        <ul v-else class="nbdev-small flex flex-col gap-0.5">
                            <li v-for="item in part.items" :key="item.path" class="flex min-w-0 items-baseline gap-2">
                                <span class="nbdev-secondary w-8 shrink-0">{{ item.code === "?" ? "新" : STATUS_LABEL[item.code] ?? item.code }}</span>
                                <span class="min-w-0 break-all font-mono">{{ item.path }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
                <p v-if="files.data.value.truncated" class="nbdev-note">每段只列前 300 条</p>
            </template>
        </section>
    </PageShell>
</template>

<style scoped>
.nbdev-checkout-table :deep(tbody tr) {
    cursor: pointer;
}
.nbdev-attention-dot {
    width: 0.5rem;
    height: 0.5rem;
    flex-shrink: 0;
    border-radius: 9999px;
    border: 1.5px solid var(--divider);
}
.nbdev-attention-on {
    border-color: var(--status-warning);
    background: var(--status-warning);
}
.nbdev-checkout-focus {
    outline: 2px solid var(--accent-main);
    outline-offset: 3px;
    border-radius: var(--radius-control);
}
</style>
