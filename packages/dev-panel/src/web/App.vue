<script setup lang="ts">
import {Badge, Banner, Button, Drawer, Input, IconButton, Popover, Splitter, Tooltip, type BannerTone, type SplitterGestureState, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import {NB_Z_INDEX} from "@notnotype/nb-ui/theme";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect} from "vue";
import {RouterLink, RouterView, useRoute, useRouter} from "vue-router";
import {relativeTime} from "./host/format.js";
import {groupInbox} from "./host/inbox.js";
import {pageKey} from "./host/routes.js";
import {confirmRelogin, panelState, startPanelData, stopPanelData, useResource} from "./host/panel-data.js";
import {readAppearance, readDismissedAudit, readNavArrange, readNavCollapsed, readNavOpen, readNavWidth, writeAppearance, writeDismissedAudit, writeNavArrange, writeNavCollapsed, writeNavOpen, writeNavWidth, type Appearance} from "./host/prefs.js";
import {applyAppearance, followSystem} from "./host/theme.js";
import {attentionCount} from "./host/notify-actions.js";
import {pageTitle, type NavArrange} from "./host/nav.js";
import {isEditableTarget, wantsSearchFocus} from "./host/shortcuts.js";
import PanelNav from "./parts/PanelNav.vue";
import type {Meta, NotifyData, Overview} from "./host/types.js";

/**
 * 外壳：左栏（`PanelNav`）、顶栏（搜索、状态点、通知要处理的计数、明暗）、顶栏下的横幅（代码已更新、前端构建失败、审计、后台重算失败）、页面。
 * 外壳与页面按组件规范豁免（它们是宿主）；左栏的展开、宽度、收起与明暗经 host/prefs.ts 记住。
 * 左栏与正文是 nb-ui 的 `Splitter` 的两块面板（t15 阶段 2c）：可拖宽度、可收起；窄于 1024px 时同一个 Splitter 把左栏收成 0、禁用拖动，
 * 导航改由抽屉显示。面板按 id 渲染，断点来回切换时正文（RouterView 与页面实例）不重挂。
 */
startPanelData();
onBeforeUnmount(stopPanelData);
const route = useRoute();
const router = useRouter();
const overview = useResource<Overview>(() => "/api/overview", ["records", "activity"]);
const meta = useResource<Meta>(() => "/api/meta", ["records", "activity", "sessions", "notify"]);
const notify = useResource<NotifyData>(() => "/api/notify", ["notify"]);
const attention = computed(() => attentionCount(notify.data.value));
/** 代码更新之后怎么重启：作为服务运行时给 systemctl 命令（不放重启按钮：面板不经 HTTP 结束自己）。 */
const restartHint = computed(() => {
    const command = meta.data.value?.service.restartCommand;
    return command ? `代码已更新：运行 ${command} 后生效` : "代码已更新：在终端重启 nbdev panel serve 后生效";
});

/** 登录失效的提示：出现时把焦点放进去；“我已重新登录”重探之后解除，失败写明原因。 */
const authDialog = ref<HTMLElement | null>(null);
/**
 * 登录失效的阻挡层压在一切浮层之上：页面的速览面板（z-30、z-40）、nb-ui 的抽屉与对话框（NB_Z_INDEX.dialog 起，多个模态按打开顺序往上）。
 * 留出几层给同时开着的模态，仍低于右下角的通知。层级取 nb-ui 的登记常量，所以写成绑定的 style。
 */
const AUTH_LAYER = {zIndex: NB_Z_INDEX.dialog + 40};
const relogging = ref(false);
const reloginError = ref<string | null>(null);
watch(() => panelState.unauthorized, (lost) => {
    reloginError.value = null;
    if (lost) void nextTick(() => authDialog.value?.querySelector("button")?.focus());
});
async function relogin(): Promise<void> {
    relogging.value = true;
    try {
        reloginError.value = await confirmRelogin();
    } finally {
        relogging.value = false;
    }
}

const appearance = ref<Appearance>(readAppearance());
const appearanceLabel = computed(() => ({system: "明暗：跟随系统", light: "明暗：亮", dark: "明暗：暗"})[appearance.value]);
function cycleAppearance(): void {
    appearance.value = appearance.value === "system" ? "light" : appearance.value === "light" ? "dark" : "system";
    writeAppearance(appearance.value);
    applyAppearance(appearance.value);
}
let unfollow: () => void = () => undefined;
onMounted(() => {
    unfollow = followSystem(() => appearance.value);
});
onBeforeUnmount(() => unfollow());

const navOpen = ref<Record<string, boolean>>(readNavOpen());
/** 左栏 Work 列表的排列方式（桌面左栏与抽屉共用一份）。 */
const navArrange = ref<NavArrange>(readNavArrange());
function setNavArrange(value: NavArrange): void {
    navArrange.value = value;
    writeNavArrange(value);
}
function toggleWork(workId: string, open: boolean): void {
    navOpen.value = {...navOpen.value, [workId]: open};
    writeNavOpen(navOpen.value);
}
/** 导航的“当前页”：路径不含查询参数；Work 级产物的 taskId 写成 `-`，不算 Task。 */
const navCurrent = computed(() => {
    const one = (value: unknown) => (typeof value === "string" ? value : null);
    const taskId = one(route.params.taskId);
    return {path: route.path, workId: one(route.params.workId), taskId: taskId === "-" ? null : taskId};
});
// 进入一个 Work（路由的 workId 变了）时展开它，哪怕偏好里记的是收起：否则当前 Task 不在树里、高亮不了。
// 只在 workId 变化时做，开发者在同一个 Work 里手动收起仍然有效。
watch(() => navCurrent.value.workId, (workId) => {
    if (workId && navOpen.value[workId] === false) toggleWork(workId, true);
}, {immediate: true});
const drawerOpen = ref(false);

// ---- 左栏的宽度与收起（D4、决定点 7、8） ----
const viewportWidth = ref(window.innerWidth);
const onViewportResize = () => {
    viewportWidth.value = window.innerWidth;
};
onMounted(() => window.addEventListener("resize", onViewportResize));
onBeforeUnmount(() => window.removeEventListener("resize", onViewportResize));
/** 抽屉的断点是 lg（1024）：窄于它时左栏收进抽屉。会话页的“手机”判定（767px 或粗指针）管接管，与它分开。 */
const narrow = computed(() => viewportWidth.value < 1024);
watch(narrow, (value) => {
    if (!value) drawerOpen.value = false;
});
/** 面板 id 也是分隔线的可读名（Splitter 拿它拼“调整 导航 与 正文 的宽度”）。 */
const NAV = "导航";
const CONTENT = "正文";
const NAV_SLOT = `panel-${NAV}` as const;
const CONTENT_SLOT = `panel-${CONTENT}` as const;
/** 用户要的宽度：渲染前同步读出（免得刷新时先 300 再跳），拖完写回。窗口窄时由上限夹住，变宽时恢复到它。 */
const navWidth = ref(readNavWidth());
const navCollapsed = ref(readNavCollapsed());
type NavCollapse = NonNullable<SplitterPanelConfig["collapse"]>;
/**
 * 用 computed 生成：Splitter 未受控时，`panels` 换了对象就按 defaultSizePx 重新分配；模板里写字面量数组的话，外壳每 15 秒的
 * 时钟重渲染都会把左栏弹回缺省宽度。这里的值只随宽度、收起与视口变，重新分配是幂等的。
 */
const panels = computed<SplitterPanelConfig[]>(() => [
    {
        id: NAV,
        defaultSizePx: navWidth.value,
        minSizePx: 200,
        maxSizePx: Math.min(480, Math.floor(viewportWidth.value * 0.4)),
        sizing: "fixed",
        // 拖到最小宽度以内再过 80px 就收起（D4）。收起后分隔线禁用（不可拖、不进 Tab 顺序），由顶栏的“展开左栏”展开（决定点 8）：
        // 否则收起时键盘要先经过一条看不见的分隔线才到“展开左栏”。expandThreshold 只在拖动中途反悔时用到。
        collapse: {collapsedSize: 0, restoreSize: navWidth.value, collapseThreshold: 80, expandThreshold: 80, collapsed: narrow.value || navCollapsed.value} satisfies NavCollapse,
    },
    {id: CONTENT, minSizePx: 360, sizing: "weight"},
]);
/** 左栏宽 0（收起、窄屏）时整块 inert：宽 0 与裁切不会把条目移出 Tab 顺序和读屏树。 */
const navHidden = computed(() => narrow.value || navCollapsed.value);
const shellButton = (name: "collapse-nav" | "expand-nav" | "open-nav") => document.querySelector<HTMLElement>(`[data-shell="${name}"]`);
/**
 * 点“收起左栏”“展开左栏”之后（`fromButton`），按下去的那个按钮或者被 inert、或者被移除，焦点交给对面的那个按钮；
 * 拖动分隔线收起时不挪，焦点已经在别处时也不挪。
 */
function setNavCollapsed(value: boolean, fromButton = false): void {
    navCollapsed.value = value;
    writeNavCollapsed(value);
    if (!fromButton) return;
    void nextTick(() => {
        const active = document.activeElement;
        const lost = !active || active === document.body || active.closest("aside") !== null;
        if (lost) shellButton(value ? "expand-nav" : "collapse-nav")?.focus();
    });
}
/** 拖完（或键盘调完）：收起状态要回写，否则下一次重新分配又展开；展开着时记下新宽度。 */
function onNavGestureEnd(state: SplitterGestureState): void {
    const collapsed = state.collapsed[NAV];
    if (collapsed !== undefined) setNavCollapsed(collapsed);
    const width = state.sizesPx[0];
    if (!navCollapsed.value && width !== undefined && width > 0) {
        navWidth.value = width;
        writeNavWidth(width);
    }
}
watch(() => route.fullPath, () => {
    drawerOpen.value = false;
});
/**
 * 用 Esc、遮罩或关闭按钮关掉抽屉（路由没变）：焦点回到“打开导航”。nb-ui 的 Drawer 只把焦点还给它自己登记的触发器，
 * 这里的按钮在顶栏，没有登记，不补的话焦点掉到 body。抽屉有退场动画，等它把焦点交出来（落到 body）再接；
 * 换了页的交给 focusPageHeading。
 */
let drawerReturn: ReturnType<typeof setTimeout> | null = null;
watch(drawerOpen, (open, wasOpen) => {
    if (drawerReturn) clearTimeout(drawerReturn);
    drawerReturn = null;
    if (open || !wasOpen) return;
    const path = route.fullPath;
    let tries = 0;
    const settle = () => {
        drawerReturn = null;
        if (route.fullPath !== path || drawerOpen.value) return;
        const active = document.activeElement;
        if (!active || active === document.body) {
            shellButton("open-nav")?.focus();
            return;
        }
        // 焦点还在退场中的抽屉里：再等一会儿；已经在别处（开发者点了页面）就不管。
        if (active.closest(".nbdev-drawer") && (tries += 1) < 40) drawerReturn = setTimeout(settle, 50);
    };
    drawerReturn = setTimeout(settle, 50);
});
onBeforeUnmount(() => {
    if (drawerReturn) clearTimeout(drawerReturn);
});

const mainWritable = computed(() => meta.data.value?.mainWritable ?? null);
/* 收件箱按行数：一块 30 道题的评审是一件事，不是 30 件。 */
const navCounts = computed(() => ({inbox: groupInbox(overview.data.value?.inbox ?? []).length, sessions: overview.data.value?.sessions.total, runs: overview.data.value?.runs}));
const navWritable = computed(() => (mainWritable.value ? {ok: mainWritable.value.ok, code: mainWritable.value.code} : null));

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
watch(() => route.query.q, (value) => {
    if (typeof value === "string") query.value = value;
});
function submitSearch(): void {
    const q = query.value.trim();
    if (q.length >= 2) void router.push({name: "search", query: {q}});
}
/** `/` 与 Ctrl+K 聚焦搜索框（判定见 host/shortcuts.ts）：冒泡阶段监听，焦点在可编辑的地方或对话框里时不处理。 */
const searchForm = ref<HTMLFormElement | null>(null);
function onShortcut(event: KeyboardEvent): void {
    if (panelState.unauthorized) return;
    if (!wantsSearchFocus(event, event.target instanceof HTMLElement ? event.target : null)) return;
    const input = searchForm.value?.querySelector("input");
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.select();
}
onMounted(() => document.addEventListener("keydown", onShortcut));
onBeforeUnmount(() => document.removeEventListener("keydown", onShortcut));

// ---- 可访问性（t15 阶段 2e） ----
const mainEl = ref<HTMLElement | null>(null);
/** 页标题（main 里的 h1）拿得到焦点；它是程序挪过去的落点，不进 Tab 顺序。 */
function focusHeading(heading: HTMLElement): void {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({preventScroll: true});
}
function skipToMain(): void {
    const main = mainEl.value;
    if (!main) return;
    const heading = main.querySelector<HTMLElement>("h1");
    if (heading) focusHeading(heading);
    else main.focus();
}
let headingObserver: MutationObserver | null = null;
let headingTimer: ReturnType<typeof setTimeout> | null = null;
function stopHeadingWait(): void {
    headingObserver?.disconnect();
    headingObserver = null;
    if (headingTimer) clearTimeout(headingTimer);
    headingTimer = null;
}
/**
 * 换了页（路由名或路径参数变了）：正文回到顶上，焦点放到新页面的标题，读屏器从这里读起。标题常在数据到了之后才出现，
 * 最多等 5 秒；这期间开发者已经把焦点挪到别处（点进文档树、在输入框里打字）就不抢。查询参数变化（会话页选会话、文档页选文档）
 * 不走这里，焦点留在原处。
 */
function focusPageHeading(): void {
    stopHeadingWait();
    const main = mainEl.value;
    if (!main) return;
    main.scrollTop = 0;
    const origin = document.activeElement;
    const attempt = (): boolean => {
        const active = document.activeElement;
        if (active !== origin && active !== null && active !== document.body) return true;
        if (active instanceof HTMLElement && isEditableTarget(active)) return true;
        const heading = main.querySelector<HTMLElement>("h1");
        if (!heading) return false;
        focusHeading(heading);
        return true;
    };
    if (attempt()) return;
    headingObserver = new MutationObserver(() => {
        if (attempt()) stopHeadingWait();
    });
    headingObserver.observe(main, {childList: true, subtree: true});
    headingTimer = setTimeout(stopHeadingWait, 5_000);
}
// 打开面板时路由先是没有名字的起始位置，第一次解析到页面不算“换页”：焦点留在文档开头，第一次 Tab 是“跳到主内容”。
watch(() => ({key: pageKey(route), named: route.name !== undefined && route.name !== null}), (next, previous) => {
    if (previous?.named && next.key !== previous.key) void nextTick(focusPageHeading);
});
onBeforeUnmount(stopHeadingWait);
/** 标签页标题“页面名 · nbdev”（host/nav.ts 的 pageTitle）。 */
const asStrings = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
watchEffect(() => {
    document.title = pageTitle({name: typeof route.name === "string" ? route.name : null, title: route.meta.title ?? null, params: asStrings(route.params), query: asStrings(route.query)}, overview.data.value?.works ?? null);
});

const tick = ref(Date.now());
const ticker = setInterval(() => {
    tick.value = Date.now();
}, 15_000);
onBeforeUnmount(() => clearInterval(ticker));
const freshness = computed(() => {
    void tick.value;
    const at = meta.data.value?.parts.records?.at;
    return at ? `${relativeTime(at)}读到` : "还没有读到";
});
const PART_LABEL: Record<string, string> = {records: "记录", activity: "活动"};

/**
 * 顶栏的状态点（t15 阶段 2d）：推送、herdr、数据新旧这几样正常时只是一个绿点，点开看详情；有一样不正常时点变黄，旁边写出是哪一样。
 */
type StatusLine = {label: string; text: string; ok: boolean};
const shellResources = [{label: "左栏与收件箱", resource: overview}, {label: "面板状态", resource: meta}, {label: "通知", resource: notify}];
const statusLines = computed<StatusLine[]>(() => {
    const connection = panelState.connection;
    const herdr = meta.data.value?.herdr;
    const lines: StatusLine[] = [
        {label: "推送", text: connection === "open" ? "已连接" : connection === "connecting" ? "正在连接" : "断开了，正在重连", ok: connection === "open"},
    ];
    if (herdr) lines.push({label: "herdr", text: !herdr.available ? `不可用${herdr.error ? `：${herdr.error}` : ""}` : herdr.mode === "subscribed" ? `已订阅${herdr.version ? `（${herdr.version}）` : ""}` : "轮询中", ok: herdr.available});
    // 外壳自己的三份数据（左栏与收件箱、面板状态、通知）有一份重取失败，左栏、计数与横幅就停在上一份；第一次就失败时横幅根本出不来。
    // 不按 parts.records.at 的年龄判断：没有变化时它本来就会很旧。
    const failed = shellResources.find((entry) => entry.resource.error.value !== null);
    if (failed) {
        const {error, receivedAt} = failed.resource;
        lines.push({label: "数据", text: `（${failed.label}）重取失败：${error.value!.message}${receivedAt.value ? `，显示的是${relativeTime(receivedAt.value)}读到的` : "，还没有读到过"}`, ok: false});
    } else {
        lines.push({label: "数据", text: freshness.value, ok: true});
    }
    const audit = meta.data.value?.audit;
    if (audit && !audit.enabled) lines.push({label: "审计", text: audit.reason === "not_initialized" ? "未开启（运行 bun run --cwd packages/dev-panel audit-init 开启）" : `不可用：${audit.detail}`, ok: audit.reason === "not_initialized"});
    return lines;
});
const statusProblem = computed(() => statusLines.value.find((line) => !line.ok) ?? null);
const statusLabel = computed(() => (statusProblem.value ? `状态：${statusProblem.value.label}${statusProblem.value.text}` : "状态：正常"));

/**
 * 顶栏下面的横幅（t15 阶段 2d）：要开发者做点什么、或者显示的东西可能不对的情形。正常时没有横幅。
 */
type ShellBanner = {key: string; tone: BannerTone; icon: string; text: string; dismiss?: () => void};
/**
 * 审计有两类“没开”：`not_initialized` 是这台机器的配置（多半有意不用通知与代打字），横幅可以“知道了”，关掉后只在状态点的
 * 详情里留一行；初始化过又坏了的（`bad_owner`、`bad_mode`、`not_regular`、`unreadable`）是故障，横幅常驻、不能关。
 * “知道了”按“原因 + 审计文件路径”记，换了路径或原因会重新出现。
 */
const auditDismissed = ref(readDismissedAudit());
const auditKey = computed(() => {
    const audit = meta.data.value?.audit;
    return audit && !audit.enabled ? `${audit.reason}:${audit.path}` : null;
});
function dismissAudit(): void {
    if (!auditKey.value) return;
    auditDismissed.value = auditKey.value;
    writeDismissedAudit(auditKey.value);
}
const banners = computed<ShellBanner[]>(() => {
    const data = meta.data.value;
    const list: ShellBanner[] = [];
    if (data?.codeChanged) list.push({key: "code", tone: "info", icon: "i-lucide-refresh-cw", text: restartHint.value});
    if (data?.build.failed) list.push({key: "build", tone: "danger", icon: "i-lucide-triangle-alert", text: `前端构建失败，用的是旧版${data.build.message ? `：${data.build.message}` : ""}`});
    if (data && !data.audit.enabled) {
        if (data.audit.reason !== "not_initialized") list.push({key: "audit", tone: "danger", icon: "i-lucide-shield-alert", text: `审计不可用：不发通知，也不能替你打字或按键。${data.audit.detail}`});
        else if (auditDismissed.value !== auditKey.value) list.push({key: "audit", tone: "warning", icon: "i-lucide-shield-off", text: "审计未开启：不发通知，也不能替你打字或按键。运行 bun run --cwd packages/dev-panel audit-init 开启", dismiss: dismissAudit});
    }
    for (const [name, part] of Object.entries(data?.parts ?? {})) {
        // 后台重算失败：服务端保留上一份，页面显示的就是它。
        if (part.error !== null) list.push({key: `part-${name}`, tone: "warning", icon: "i-lucide-history", text: `后台重算${PART_LABEL[name] ?? name}失败，显示的是上一份：${part.error}`});
    }
    return list;
});
</script>

<template>
    <!-- 登录失效时页面不卸载（草稿、填了一半的答复都还在），盖一层提示、整个外壳 inert；重新登录后点按钮接着用（t15）。 -->
    <div v-if="panelState.unauthorized" class="shell-scrim fixed inset-0 flex items-center justify-center p-6" :style="AUTH_LAYER">
        <section ref="authDialog" role="alertdialog" aria-modal="true" aria-labelledby="auth-lost-title" aria-describedby="auth-lost-message" class="flex max-w-md flex-col gap-3 rounded-[var(--radius-panel)] p-5 nbdev-surface">
            <h2 id="auth-lost-title" class="font-semibold">没有登录，或登录已失效</h2>
            <p class="nbdev-secondary" id="auth-lost-message">在终端运行 <code>nbdev panel open</code>，用它给的一次性链接登录（在这个浏览器的另一个标签页里打开也行；面板重启后要重新登录）。这一页还开着，没保存的改动都在；登录后点下面的按钮接着用。</p>
            <p class="nbdev-warn nbdev-small" v-if="reloginError" role="status">{{ reloginError }}</p>
            <Button variant="primary" :loading="relogging" @click="relogin">我已重新登录</Button>
        </section>
    </div>
    <a href="#nbdev-main" class="nbdev-skip" :inert="panelState.unauthorized || undefined" @click.prevent="skipToMain">跳到主内容</a>
    <Splitter class="h-full" :panels="panels" :sash-sizes="[narrow ? 0 : 1]" :disabled="navHidden" :inert="panelState.unauthorized || undefined" @gesture-end="onNavGestureEnd">
        <template #[NAV_SLOT]>
            <aside class="shell-nav h-full overflow-hidden" :inert="navHidden || undefined">
                <PanelNav :works="overview.data.value?.works ?? null" :current="navCurrent" :expanded="navOpen" :counts="navCounts" :writable="navWritable" :arrange="navArrange" @navigate="(href) => router.push(href)" @toggle="toggleWork" @arrange="setNavArrange">
                    <template #actions>
                        <Tooltip text="收起左栏"><IconButton icon-class="i-lucide-panel-left-close" aria-label="收起左栏" data-shell="collapse-nav" @click="setNavCollapsed(true, true)" /></Tooltip>
                    </template>
                </PanelNav>
            </aside>
        </template>
        <template #[CONTENT_SLOT]>
            <div class="flex h-full min-h-0 min-w-0 flex-col">
                <header class="shell-toolbar nbdev-divider flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
                    <IconButton v-if="narrow" icon-class="i-lucide-menu" aria-label="打开导航" data-shell="open-nav" @click="drawerOpen = true" />
                    <Tooltip v-else-if="navCollapsed" text="展开左栏"><IconButton icon-class="i-lucide-panel-left-open" aria-label="展开左栏" data-shell="expand-nav" @click="setNavCollapsed(false, true)" /></Tooltip>
                    <form ref="searchForm" class="min-w-0 max-w-xl flex-1 basis-48" role="search" @submit.prevent="submitSearch">
                        <Input v-model="query" placeholder="搜索 Work、Task、产物、会话与文件（/ 或 Ctrl+K）" aria-label="搜索" aria-keyshortcuts="/ Control+K" />
                    </form>
                    <div class="ml-auto flex items-center gap-2 nbdev-note">
                        <RouterLink v-if="attention > 0" to="/live/sessions?view=notify" aria-label="有要处理的通知，去会话页"><Badge tone="warning" variant="soft" size="sm" icon-class="i-lucide-bell">通知要处理 {{ attention }}</Badge></RouterLink>
                        <Popover side="bottom" align="end">
                            <template #trigger>
                                <button type="button" class="nbdev-status flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1" :aria-label="statusLabel">
                                    <span class="size-2 rounded-full" :class="statusProblem ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-success)]'" aria-hidden="true" />
                                    <span v-if="statusProblem" class="max-w-[24rem] truncate nbdev-warn">{{ statusProblem.label }}{{ statusProblem.text }}</span>
                                </button>
                            </template>
                            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 nbdev-small">
                                <template v-for="line in statusLines" :key="line.label">
                                    <dt class="nbdev-secondary">{{ line.label }}</dt>
                                    <dd :class="{'nbdev-warn': !line.ok}">{{ line.text }}</dd>
                                </template>
                            </dl>
                        </Popover>
                        <Tooltip :text="appearanceLabel"><IconButton :icon-class="appearance === 'dark' ? 'i-lucide-moon' : appearance === 'light' ? 'i-lucide-sun' : 'i-lucide-sun-moon'" :aria-label="appearanceLabel" @click="cycleAppearance" /></Tooltip>
                    </div>
                </header>
                <div v-if="banners.length > 0" class="flex flex-col">
                    <Banner
                        v-for="banner in banners"
                        :key="banner.key"
                        :tone="banner.tone"
                        :icon-class="banner.icon"
                        :message="banner.text"
                        :dismissible="banner.dismiss !== undefined"
                        close-label="知道了"
                        @dismiss="banner.dismiss?.()"
                    />
                </div>
                <!-- 一页一个竖向滚动者：流式页面由 main 滚，铺满的页面（文档页）由它的分栏各自滚（路由元信息 layout）。 -->
                <main id="nbdev-main" ref="mainEl" tabindex="-1" class="relative min-h-0 flex-1" :class="route.meta.layout === 'fill' ? 'overflow-hidden' : 'nbdev-scroll-y'">
                    <!-- 按路由名与路径参数重建页面实例，查询参数变化不重建（t15）。 -->
                    <RouterView v-slot="{Component, route: viewRoute}">
                        <component :is="Component" :key="pageKey(viewRoute)" />
                    </RouterView>
                </main>
            </div>
        </template>
    </Splitter>
    <Drawer v-model:open="drawerOpen" direction="left" title="导航" content-class="nbdev-drawer">
        <!-- 抽屉正文自己有左右内边距，导航不再叠一层。 -->
        <PanelNav :inset="false" :works="overview.data.value?.works ?? null" :current="navCurrent" :expanded="navOpen" :counts="navCounts" :writable="navWritable" :arrange="navArrange" @navigate="(href) => router.push(href)" @toggle="toggleWork" @arrange="setNavArrange" />
    </Drawer>
</template>

<style scoped>
/* 外壳的几块面层底色各只用一次，写在这里，不进 app.css 的语义类。 */
.shell-scrim {
    background: color-mix(in srgb, var(--bg-main) 75%, transparent);
}
.shell-nav {
    background: var(--sidebar-surface, var(--bg-sidebar));
}
.shell-toolbar {
    background: var(--toolbar-surface, var(--bg-main));
}
.nbdev-status:hover, .nbdev-status:focus-visible {
    background: var(--bg-hover);
}
</style>
