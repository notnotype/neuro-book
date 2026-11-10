<script setup lang="ts">
import {Badge, Button, Popover, Select, Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {ApiError, getJson} from "../host/api.js";
import {HERDR_STATUS_LABEL, relativeTime, shortSession, taskLabel, TITLE_SOURCE, workLabel} from "../host/format.js";
import {attentionCount, useNotifyActions} from "../host/notify-actions.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {taskHref} from "../host/routes.js";
import {useSessionConsoleHost} from "../host/session-console.js";
import {autoSelect, sessionRows} from "../host/sessions-list.js";
import type {Meta, NotifyData, SessionsData} from "../host/types.js";
import DeveloperMessageDialog from "../parts/DeveloperMessageDialog.vue";
import LoadState from "../parts/LoadState.vue";
import NotifyStatus from "../parts/NotifyStatus.vue";
import PageShell from "../parts/PageShell.vue";
import ScreenConfirmDialog from "../parts/ScreenConfirmDialog.vue";
import SessionConsole from "../parts/SessionConsole.vue";
import SessionList from "../parts/SessionList.vue";
import TakeoverDialog from "../parts/TakeoverDialog.vue";
import TerminalTextView from "../parts/TerminalTextView.vue";
import TerminalView from "../parts/TerminalView.vue";
import TruncatedText from "../parts/TruncatedText.vue";
import WriteResult from "../parts/WriteResult.vue";

/**
 * 会话页（t03 第三轮；终端在 t12；t15 阶段 4 第 3 批重新设计，见 t15 计划的“第 3 批”）：铺满页，左列表、右详情。
 * - 左列表：通知一行（点了右栏显示通知，`?view=notify`）、本仓库的 Agent 会话、其它 pane（只读，D2）、无主的运行的入口、不在本仓库的会话；
 * - 右详情（`?pane=`）：头（标题、状态、Agent、pane、会话、租约的 Task）、终端（模式条、实时画面、回滚）、贴在终端下面的输入区；
 *   非 Agent 的 pane 只读，可读“更早的输出”（前台是全屏程序时不给）；
 * - 桌面上没选时自动选中（决定点 21）：有要处理的通知先显示通知，否则选最需要看的会话（等确认，其次工作中）；手机上不自动选。
 * 对选中会话的操作（终端连接、读屏、发送、两步确认、接管小窗）在 `host/session-console.ts`，都绑定发起时的目标（t15 阶段 1）。
 */
const route = useRoute();
const router = useRouter();
const navigate = (href: string) => void router.push(href);
const sessions = useResource<SessionsData>(() => "/api/sessions", ["activity", "sessions"]);
const notify = useResource<NotifyData>(() => "/api/notify", ["notify", "sessions"]);
const meta = useResource<Meta>(() => "/api/meta", ["notify"]);
const data = computed(() => sessions.data.value);
const rows = computed(() => (data.value ? sessionRows(data.value) : {agents: [], panes: [], elsewhere: []}));
const attention = computed(() => attentionCount(notify.data.value));

const notifyActions = useNotifyActions(() => notify.reload());
const recent = computed(() => (notify.data.value?.recent ?? []).slice(0, 30));
const audit = computed(() => meta.data.value?.audit ?? null);

// ---- 选中的是什么：`?view=notify` 是通知，`?pane=` 是一格 pane ----
const showNotify = computed(() => route.query.view === "notify");
const paneId = computed(() => (typeof route.query.pane === "string" ? route.query.pane : null));
const pane = computed(() => (data.value?.panes ?? []).find((entry) => entry.paneId === paneId.value) ?? null);
const row = computed(() => [...rows.value.agents, ...rows.value.panes].find((entry) => entry.paneId === paneId.value) ?? null);
/** 只开本仓库里的 pane（决定点 20）。非 Agent 的 pane 会话键为空串：只用来观看，发送与接管的入口不给。 */
const selected = computed(() => {
    const current = pane.value;
    if (!current || !current.inRepository || showNotify.value) return null;
    return {paneId: current.paneId, terminalId: current.terminalId, sessionKey: current.session ? `${current.session.agent}:${current.session.value}` : "", agent: current.agent, status: current.status};
});
const isAgent = computed(() => selected.value !== null && selected.value.agent !== null && selected.value.sessionKey !== "");
const session = computed(() => (selected.value && isAgent.value ? data.value?.sessions.find((entry) => entry.key === selected.value!.sessionKey) ?? null : null));
const terminalAvailable = computed(() => meta.data.value?.terminal?.available === true);
const host = useSessionConsoleHost({selected, terminalAvailable});
const terminal = host.terminal;

// ---- 三种宽度：按内容区（外壳的 main）宽度定，与速览面板同一个做法；手机按视口 ----
const SIDE_WIDE = 1100;
const SIDE_MEDIUM = 900;
const contentWidth = ref(1200);
const viewport = ref(window.innerWidth);
let resize: ResizeObserver | null = null;
function measure(): void {
    viewport.value = window.innerWidth;
    const main = document.getElementById("nbdev-main");
    if (main) contentWidth.value = main.clientWidth;
}
onMounted(() => {
    measure();
    const main = document.getElementById("nbdev-main");
    if (main) {
        resize = new ResizeObserver(measure);
        resize.observe(main);
    }
    window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
    resize?.disconnect();
    window.removeEventListener("resize", measure);
});
/** wide 两栏（左栏 330px）；medium 两栏（左栏 260px，行里只留标题、状态与 pane）；switch 收起左栏、详情上方给下拉；phone 列表与详情分两屏。 */
const tier = computed<"wide" | "medium" | "switch" | "phone">(() => (viewport.value < 768 ? "phone" : contentWidth.value >= SIDE_WIDE ? "wide" : contentWidth.value >= SIDE_MEDIUM ? "medium" : "switch"));
const showDetailOnPhone = computed(() => showNotify.value || paneId.value !== null);

/** 手机（窄屏或粗指针）：默认文字视图，不给接管。 */
const narrowQuery = window.matchMedia("(max-width: 767px), (pointer: coarse)");
const narrow = ref(narrowQuery.matches);
const onNarrow = () => {
    narrow.value = narrowQuery.matches;
};
narrowQuery.addEventListener("change", onNarrow);
onBeforeUnmount(() => narrowQuery.removeEventListener("change", onNarrow));
const showTerminalOnPhone = ref(false);
watch(host.connection, () => {
    showTerminalOnPhone.value = false;
});

// ---- 选中与自动选中 ----
function go(query: Record<string, string>): void {
    // 手机上列表与详情是两屏：进详情加历史，后退回列表。桌面上换选中不加历史。
    if (tier.value === "phone") void router.push({query});
    else void router.replace({query});
}
const select = (target: string) => go({pane: target});
const openNotify = () => go({view: "notify"});
function backToList(): void {
    if (typeof window.history.state?.back === "string" && window.history.state.back.startsWith("/live/sessions")) router.back();
    else void router.replace({query: {}});
}
/** 从别处的会话胶囊点进来（`?session=<会话键>`，t22）：换成它所在的 pane；它不在 herdr 里时退回列表。 */
const sessionParam = computed(() => (typeof route.query.session === "string" ? route.query.session : null));
watch([data, sessionParam], () => {
    if (!data.value || sessionParam.value === null) return;
    const target = data.value.sessions.find((entry) => entry.key === sessionParam.value)?.herdr?.paneId;
    void router.replace({query: target ? {pane: target} : {}});
}, {immediate: true});
/**
 * 决定点 21：桌面上什么都没选时（进页面、点左栏的“会话”）自动选；有要处理的通知先显示通知。用 replace，不加历史。
 * 等会话与通知都读到了再选，否则先选了会话、通知到了也不会再改。
 */
watch([data, () => notify.data.value, tier, paneId, showNotify], () => {
    if (!data.value || !notify.data.value || tier.value === "phone" || paneId.value !== null || showNotify.value || sessionParam.value !== null) return;
    if (attention.value > 0) return void router.replace({query: {view: "notify"}});
    const target = autoSelect(rows.value.agents);
    if (target) void router.replace({query: {pane: target}});
}, {immediate: true});
const switchOptions = computed(() => [
    {value: "notify", label: attention.value > 0 ? `通知 · ${attention.value} 条要处理` : "通知"},
    ...[...rows.value.agents, ...rows.value.panes].filter((entry) => entry.selectable && entry.paneId).map((entry) => ({value: entry.paneId!, label: `${entry.title} · ${entry.stateLabel} · ${entry.paneId}`})),
]);
const switchValue = computed(() => (showNotify.value ? "notify" : paneId.value ?? ""));
function onSwitch(value: string): void {
    if (value === "notify") openNotify();
    else select(value);
}

// ---- 终端与输入 ----
const controlling = computed(() => terminal.value?.state.mode === "control");
const takeoverBlocked = computed(() => {
    if (narrow.value) return "手机上不给接管，用下面的输入框";
    if (audit.value && !audit.value.enabled) return "审计不可用，不能接管";
    return null;
});
const controllerNote = computed(() => {
    const controller = terminal.value?.state.controller;
    return controller && controller.by === "other_browser" ? `面板的另一个浏览器正在接管（${relativeTime(controller.since)}起）` : null;
});
function openLink(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}
const consoleDisabled = computed(() => {
    if (audit.value && !audit.value.enabled) return audit.value.reason === "not_initialized" ? "审计还没初始化：运行 bun run --cwd packages/dev-panel audit-init 之后才能替你打字或按键" : `审计不可用，不能替你打字或按键：${audit.value.detail}`;
    if (data.value && !data.value.herdr.available) return "herdr 不可用";
    return null;
});
const sessionChangeNote = computed(() => (host.sessionChange.value ? `这格的会话换了（${shortSession(host.sessionChange.value.from)} → ${shortSession(host.sessionChange.value.to)}），发出去会发给后者` : null));
/** 正常时 herdr 的情况只在标题旁的说明图标里（t22）：版本、推送还是轮询、多久前更新、对账补上的漏掉的状态变化、没列出的进程。 */
const herdrNote = computed(() => {
    const value = data.value;
    if (!value?.herdr.available) return "";
    const parts = [`herdr ${value.herdr.version ?? ""}`.trim(), value.herdr.mode === "subscribed" ? "已订阅推送" : "轮询中"];
    if (value.herdr.at) parts.push(`${relativeTime(value.herdr.at)}更新`);
    if (value.herdr.missedEvents > 0) parts.push(`对账补上了 ${value.herdr.missedEvents} 次漏掉的状态变化`);
    if (value.ignoredProcesses > 0) parts.push(`另有 ${value.ignoredProcesses} 个短命或无关的进程没有列出`);
    return parts.join(" · ");
});
const titleNote = computed(() => {
    const title = pane.value?.title ?? session.value?.title ?? null;
    if (title) return `标题取自 ${TITLE_SOURCE[title.source] ?? title.source}`;
    return row.value?.titleFrom === "task" ? "标题取自租约的 Task（会话文件里读不到标题）" : null;
});

/** 确认框只有一个：会话页自己的（按键、文字），或通知的（手动发送判定不可投）。 */
const activeConfirm = computed(() => host.confirm.value ?? notifyActions.confirm.value);
function runConfirm(): void {
    if (host.confirm.value) void host.confirmRun();
    else void notifyActions.confirmRun();
}
function cancelConfirm(): void {
    if (host.confirm.value) host.cancelConfirm();
    else notifyActions.confirm.value = null;
}

// ---- 非 Agent 的 pane 的更早输出（D2）：点一次读一次；换 pane 就收起 ----
const paneHistory = ref<{text: string; lines: number; at: string} | null>(null);
const paneHistoryError = ref<string | null>(null);
const paneHistoryPending = ref(false);
watch(paneId, () => {
    paneHistory.value = null;
    paneHistoryError.value = null;
});
async function readPaneHistory(): Promise<void> {
    const target = paneId.value;
    if (!target) return;
    paneHistoryPending.value = true;
    paneHistoryError.value = null;
    try {
        const body = await getJson<{paneId: string; lines: number; text: string}>(`/api/panes/${encodeURIComponent(target)}/history`);
        if (paneId.value === target) paneHistory.value = {text: body.data.text, lines: body.data.lines, at: new Date().toISOString()};
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (paneId.value === target) paneHistoryError.value = error.message;
    } finally {
        paneHistoryPending.value = false;
    }
}
/**
 * Agent 会话能不能读更早的输出由服务端按 herdr 的回滚与已有的接口定（`history`，见 `historySource`）。读不到的（Claude 这类在备用屏上的会话）
 * 写明只能看当前屏（决定点 23：这一批不承诺在面板里往回翻）。
 */
const sessionHistory = computed(() => pane.value?.history === "session");
const NO_HISTORY_NOTE = "只能看当前屏；更早的输出去 herdr 里翻";
/** 只读的原因：没有会话键（开发服务、shell，或认出了 Agent 但还没报会话）。 */
const readOnlyReason = computed(() => (selected.value?.agent ? `${selected.value.agent} 还没报会话` : "没有 Agent 会话"));
/**
 * 手机上的详情一屏：收起页头（面包屑、标题、herdr 状态），顶上一条“‹ 会话”加标题，终端与输入区多占一些高度（线框稿 phone-390-detail）。
 * 只经 `PageShell` 的 `bare` 收起，不换根：跨 768px 时详情、输入框的草稿与接管中的终端都是同一个实例（第 3 批审查重要 3）。
 */
const phoneDetail = computed(() => tier.value === "phone" && showDetailOnPhone.value);
</script>

<template>
    <!-- 铺满（路由 layout: fill）：页头下面左列表、右详情，各自滚动，页面本身不滚（ux-b F3、ux-c R4）。手机上列表与详情分两屏。 -->
    <div class="relative h-full min-h-0" :class="tier === 'phone' && !showDetailOnPhone ? 'overflow-y-auto' : 'overflow-hidden'">
        <PageShell width="full" class="h-full min-h-0" compact :bare="phoneDetail" :crumbs="[{label: '首页', href: '/'}, {label: '会话'}]" title="会话" @navigate="navigate">
            <!-- 页头只在 herdr 不正常时写原因；正常时 herdr 的版本、推送、对账这些收进标题旁的说明图标（t22，开发者定）。 -->
            <template v-if="data" #meta>
                <template v-if="!data.herdr.available">
                    <Badge tone="warning" variant="soft" size="sm">herdr 不可用</Badge>
                    <span>{{ data.herdr.error ?? "连不上 herdr" }}：租约照常按会话进程与 24 小时判断，看不到会话的状态</span>
                </template>
                <Tooltip v-else :text="herdrNote"><button type="button" class="nbdev-hit inline-flex size-5 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)]" :aria-label="herdrNote"><span class="i-lucide-info size-3.5" aria-hidden="true" /></button></Tooltip>
            </template>
            <LoadState v-bind="loadStateOf(sessions)" label="正在读取会话" @retry="sessions.reload()" />
            <div v-if="data" class="grid min-h-0 flex-1" :class="[tier === 'wide' ? 'grid-cols-[330px_minmax(0,1fr)]' : tier === 'medium' ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1', phoneDetail ? '' : 'gap-4']">
                <aside v-if="tier === 'wide' || tier === 'medium' || (tier === 'phone' && !showDetailOnPhone)" class="nbdev-surface relative min-h-0 overflow-y-auto" aria-label="会话列表">
                    <SessionList :agents="rows.agents" :panes="rows.panes" :elsewhere="rows.elsewhere" :selected="showNotify ? 'notify' : paneId" :attention="attention" :unowned-runs="data.unownedRuns.length" :compact="tier === 'medium'" @select="select" @notify="openNotify" @navigate="navigate" />
                </aside>
                <section v-if="tier !== 'phone' || showDetailOnPhone" class="flex min-h-0 min-w-0 flex-col overflow-hidden" :class="phoneDetail ? 'nbdev-phone-detail' : 'nbdev-surface'" aria-label="详情">
                    <div v-if="tier === 'switch'" class="nbdev-divider shrink-0 border-b px-3 py-2">
                        <Select :model-value="switchValue" :options="switchOptions" placeholder="切换会话" aria-label="切换会话" size="sm" @update:model-value="onSwitch" />
                    </div>
                    <div v-if="phoneDetail" class="nbdev-divider flex shrink-0 items-center gap-2 border-b px-3 py-2">
                        <button type="button" class="nbdev-accent flex shrink-0 items-center gap-0.5" @click="backToList"><span class="i-lucide-chevron-left size-4" aria-hidden="true" />会话</button>
                        <span class="min-w-0 truncate font-semibold">{{ showNotify ? "通知" : row?.title ?? `窗格 ${paneId}` }}</span>
                    </div>

                    <!-- 通知（决定点 22：左列表最上面一行点进来） -->
                    <div v-if="showNotify" id="notify" class="relative nbdev-stack min-h-0 flex-1 overflow-y-auto p-4" aria-label="通知">
                        <h2 class="nbdev-card-title">通知<template v-if="attention > 0"> · {{ attention }} 条要处理</template></h2>
                        <p v-if="audit && !audit.enabled && audit.reason === 'not_initialized'" class="nbdev-warn nbdev-small">审计还没初始化：不发通知，也不能替你打字或按键。在终端运行 <code>bun run --cwd packages/dev-panel audit-init</code>（建 {{ audit.path }}）。</p>
                        <p v-else-if="audit && !audit.enabled" class="nbdev-warn nbdev-small">审计不可用：不发通知，也不能替你打字或按键。{{ audit.detail }}</p>
                        <p v-if="notify.data.value && data.herdr.available && !notify.data.value.auto.enabled" class="nbdev-note">这个 herdr 版本不自动投递通知，只能手动发</p>
                        <NotifyStatus :jobs="notify.data.value?.jobs ?? []" :attempts="recent" show-task :pending="notifyActions.pending.value" :dismissed="notifyActions.dismissed.value" empty-text="没有排队的通知，最近 24 小时也没有发过" @send="(job, target) => notifyActions.request(job, target)" @skip="(job) => notifyActions.skip(job)" @replaced="(job) => notifyActions.openReplaced(job)" @dismiss="notifyActions.dismiss" />
                        <WriteResult v-if="notifyActions.notice.value" :notice="notifyActions.notice.value" @dismiss="notifyActions.notice.value = null" />
                    </div>

                    <!-- 没选：桌面上通常已自动选中；没有能看的会话时给一句引导 -->
                    <div v-else-if="!paneId" class="nbdev-empty flex flex-1 items-center justify-center p-6 text-center">在左边选一个会话：看它的屏幕、发消息或接管键盘</div>

                    <!-- 选了但这格不在了，或不在本仓库 -->
                    <div v-else-if="!selected" class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                        <span class="i-lucide-square-dashed nbdev-secondary size-6" aria-hidden="true" />
                        <p class="font-semibold">{{ pane ? `窗格 ${paneId} 不在本仓库里` : `窗格 ${paneId} 不在了` }}</p>
                        <p class="nbdev-secondary">{{ pane ? "只开放本仓库里的窗格" : "会话结束了，或窗格关了；在左边选别的会话" }}</p>
                    </div>

                    <template v-else>
                        <!-- 会话信息一行（t17，t22 精简）：标题、状态、在动的 Task；Agent、窗格、会话键、运行数、目录、标题来源收进“详情”。 -->
                        <header class="nbdev-divider flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
                            <h2 v-if="!phoneDetail" class="nbdev-card-title min-w-0 break-words">{{ row?.title ?? `窗格 ${selected.paneId}` }}</h2>
                            <Badge v-if="isAgent" tone="accent" variant="soft" size="sm">{{ HERDR_STATUS_LABEL[selected.status] ?? selected.status }}</Badge>
                            <Badge v-else tone="neutral" variant="soft" size="sm">只看</Badge>
                            <span v-if="!isAgent" class="nbdev-note">{{ selected.agent ? `${selected.agent}，还没报会话` : "不是 Agent 会话" }}：不能发消息、不能接管</span>
                            <a v-for="lease in session?.leases ?? []" :key="`${lease.workId}/${lease.taskId}`" :href="taskHref(lease.workId, lease.taskId)" class="nbdev-small hover:underline" @click.prevent="navigate(taskHref(lease.workId, lease.taskId))">{{ workLabel(lease.workId) }}/{{ taskLabel(lease.taskId) }}<template v-if="lease.stale"> · 过期</template></a>
                            <Popover side="bottom" align="start">
                                <template #trigger>
                                    <Button size="sm" variant="ghost" icon-class="i-lucide-info">详情</Button>
                                </template>
                                <dl class="grid max-w-[22rem] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 nbdev-small">
                                    <template v-if="isAgent"><dt class="nbdev-secondary">Agent</dt><dd>{{ selected.agent }}</dd></template>
                                    <dt class="nbdev-secondary">窗格</dt><dd class="font-mono">{{ selected.paneId }}</dd>
                                    <!-- 会话键很长：只露开头一截（够认出是哪个），点一下复制全文。 -->
                                    <template v-if="isAgent"><dt class="nbdev-secondary">会话</dt><dd class="min-w-0"><TruncatedText :text="selected.sessionKey" mono /></dd></template>
                                    <template v-if="(session?.runs.length ?? 0) > 0"><dt class="nbdev-secondary">运行</dt><dd>{{ session!.runs.length }} 个</dd></template>
                                    <template v-if="!isAgent && pane?.foregroundCwd"><dt class="nbdev-secondary">目录</dt><dd class="break-all">{{ pane.foregroundCwd }}</dd></template>
                                    <template v-if="titleNote"><dt class="nbdev-secondary">标题</dt><dd>{{ titleNote }}</dd></template>
                                </dl>
                            </Popover>
                        </header>

                        <!-- Agent 会话：终端加贴底的输入区 -->
                        <SessionConsole v-if="isAgent" :session="selected" :screen="host.screen.value?.screen ?? null" :screen-at="host.screenAt.value" :disabled-reason="consoleDisabled" :pending="host.pending.value" :reset-key="host.resetKey.value" :session-change="sessionChangeNote" :live="terminal !== null" :controlling="controlling" @refresh="host.readScreen" @prompt="(text) => host.sendPrompt(text)" @key="host.pressKey">
                            <template v-if="terminal" #screen>
                                <p v-if="terminal.state.closedReason" class="nbdev-warn nbdev-small px-3 py-2">{{ terminal.state.closedReason }}</p>
                                <!-- 接管中不换成文字视图（桌面窗口缩窄时）：释放的入口与“正在接管”的提示都在终端视图里。 -->
                                <div v-else-if="narrow && !showTerminalOnPhone && !controlling" class="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                                    <template v-if="host.history.value">
                                        <p class="nbdev-note">更早的输出（最近 {{ host.history.value.lines }} 行，{{ relativeTime(host.history.value.at) }}读取）</p>
                                        <pre class="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2 nbdev-pre nbdev-small" aria-label="更早的输出">{{ host.history.value.text || "没有更早的输出" }}</pre>
                                    </template>
                                    <!-- key 是这一条连接：source 在零件实例的一生里不变，换连接就整体重建（t15）。 -->
                                    <TerminalTextView :key="host.connection.value" :source="terminal.source" />
                                    <div class="flex flex-wrap gap-2">
                                        <Button size="sm" variant="ghost" icon-class="i-lucide-monitor" @click="showTerminalOnPhone = true">终端画面（只看）</Button>
                                        <Button v-if="sessionHistory" size="sm" variant="ghost" icon-class="i-lucide-history" :disabled="host.historyPending.value" @click="host.readHistory">{{ host.history.value ? "重读更早的输出" : "更早的输出" }}</Button>
                                    </div>
                                    <p v-if="!sessionHistory" class="nbdev-note">{{ NO_HISTORY_NOTE }}</p>
                                </div>
                                <template v-else>
                                    <TerminalView :key="host.connection.value" :source="terminal.source" :mode="terminal.state.mode" :cols="terminal.state.cols" :rows="terminal.state.rows" :size-known="terminal.state.sizeKnown" :bracketed-paste="selected.agent === 'claude' || selected.agent === 'omp'" :can-takeover="takeoverBlocked === null" :takeover-blocked="takeoverBlocked" :controller-note="controllerNote" :pending="terminal.state.pending" @takeover="host.askTakeover" @release="terminal.release()" @input="(input, paste) => terminal?.input(input, paste)" @resize="(cols, rows) => terminal?.resize(cols, rows)" @open-link="openLink">
                                        <template v-if="(narrow && !controlling) || !sessionHistory" #actions>
                                            <span v-if="!sessionHistory" class="nbdev-secondary">{{ NO_HISTORY_NOTE }}</span>
                                            <Button v-if="narrow && !controlling" size="sm" variant="ghost" icon-class="i-lucide-text" @click="showTerminalOnPhone = false">回到文字视图</Button>
                                        </template>
                                    </TerminalView>
                                </template>
                            </template>
                            <template v-if="host.notice.value" #result>
                                <WriteResult :notice="host.notice.value" @dismiss="host.notice.value = null" />
                            </template>
                        </SessionConsole>

                        <!-- 非 Agent 的 pane：只读观看，可读更早的输出（D2） -->
                        <template v-else>
                            <div v-if="paneHistory || paneHistoryError" class="nbdev-divider relative flex max-h-[45%] shrink-0 flex-col gap-1 overflow-y-auto border-b p-3">
                                <div class="flex items-center gap-2">
                                    <p class="nbdev-note flex-1">{{ paneHistoryError ? `读不到更早的输出：${paneHistoryError}` : `更早的输出（最近 ${paneHistory!.lines} 行，${relativeTime(paneHistory!.at)}读取）` }}</p>
                                    <Button size="sm" variant="ghost" icon-class="i-lucide-x" @click="paneHistory = null; paneHistoryError = null">收起</Button>
                                </div>
                                <pre v-if="paneHistory" class="whitespace-pre-wrap break-all rounded-[var(--radius-control)] p-2 nbdev-pre nbdev-small" aria-label="更早的输出">{{ paneHistory.text || "没有更早的输出" }}</pre>
                            </div>
                            <p v-if="!terminal" class="nbdev-empty p-4">{{ terminalAvailable ? "正在连接终端" : "网页终端不可用（找不到 herdr、setpriv 或 setsid），只读观看也用不了" }}</p>
                            <p v-else-if="terminal.state.closedReason" class="nbdev-warn nbdev-small px-3 py-2">{{ terminal.state.closedReason }}</p>
                            <TerminalTextView v-else-if="narrow" :key="`text-${host.connection.value}`" :source="terminal.source" />
                            <TerminalView v-else :key="host.connection.value" :source="terminal.source" :mode="terminal.state.mode" :cols="terminal.state.cols" :rows="terminal.state.rows" :size-known="terminal.state.sizeKnown" :bracketed-paste="false" :can-takeover="false" :takeover-blocked="null" :read-only="readOnlyReason" :pending="terminal.state.pending" @open-link="openLink">
                                <template #actions>
                                    <Button v-if="pane?.history === 'pane' && pane.scrollback" size="sm" variant="secondary" icon-class="i-lucide-history" :loading="paneHistoryPending" @click="readPaneHistory">{{ paneHistory ? "重读更早的输出" : `更早的输出（${Math.min(1000, pane.scrollback)} 行）` }}</Button>
                                    <span v-else class="nbdev-empty">全屏程序或没有回滚：只能看当前屏</span>
                                </template>
                            </TerminalView>
                            <p class="nbdev-caption nbdev-divider shrink-0 border-t px-3 py-2">只读观看不写审计。要在这一格里操作，回 herdr。</p>
                        </template>
                    </template>
                </section>
            </div>
            <DeveloperMessageDialog :open="notifyActions.compose.value !== null" :compose="notifyActions.compose.value" :pending="notifyActions.pending.value" @send="(job, target, text) => notifyActions.deliver(job, target, text)" @skip="(job) => notifyActions.skip(job)" @cancel="notifyActions.compose.value = null" />
            <TakeoverDialog :open="host.takeoverAsk.value !== null" :current="{cols: terminal?.state.cols ?? 0, rows: terminal?.state.rows ?? 0, known: terminal?.state.sizeKnown ?? false}" :next="{cols: host.takeoverAsk.value?.cols ?? 0, rows: host.takeoverAsk.value?.rows ?? 0}" :conflict="host.takeoverAsk.value?.force ? host.lastConflict.value : null" :pending="terminal?.state.pending ?? false" @confirm="host.confirmTakeover" @cancel="host.cancelTakeover" />
            <ScreenConfirmDialog :open="activeConfirm !== null" :title="activeConfirm?.title ?? ''" :message="activeConfirm?.message ?? ''" :screen="activeConfirm?.screen ?? null" :confirm-label="activeConfirm?.confirmLabel ?? '确认'" :pending="notifyActions.pending.value || host.pending.value" @confirm="runConfirm" @cancel="cancelConfirm" />
        </PageShell>
    </div>
</template>

<style scoped>
.nbdev-phone-detail {
    background: var(--panel-surface);
}
</style>
