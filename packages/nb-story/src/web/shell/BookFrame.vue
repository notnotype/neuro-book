<script setup lang="ts">
/**
 * 一本书的外壳（docs/specs/story/viewer.md 输出 1、2、4、5、32 到 35）：顶栏（书架入口与书名、阅读位置、搜索、
 * 明暗、抽屉开关）、左侧导航、主区、右侧抽屉。宽度三档按外壳自己的宽度算：宽屏三栏可拖；平板导航收成图标条、
 * 抽屉浮在主区右侧；手机顶栏两行、底部常用页签、抽屉从底部拉起。
 */
import type {GridGestureCommit, GridIssue, GridFailure} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";
import {DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, watch} from "vue";
import {useRouter} from "vue-router";

import {BOOK_SESSION, type BookSession, type DrawerContent, type Page} from "../host/book";
import {ingestBadge} from "../host/ingest";
import {StoryCallError, useStoryClient} from "../host/client";
import {readDrawerWidth, readNavCollapsed, writeDrawerWidth, writeNavCollapsed} from "../host/prefs";
import {LAYOUT_MOTION} from "../host/motion";
import ReadingControl from "../parts/ReadingControl.vue";
import RevisionBadge from "../parts/RevisionBadge.vue";
import ThemeMenu from "../parts/ThemeMenu.vue";
import {createBookGrid, DRAWER_MIN_WIDTH} from "./book-grid";
import DrawerCard from "./DrawerCard.vue";
import DrawerNode from "./DrawerNode.vue";
import DrawerParagraph from "./DrawerParagraph.vue";
import DrawerSource from "./DrawerSource.vue";
import RecordsTable from "./RecordsTable.vue";
import SearchBox from "./SearchBox.vue";

const props = defineProps<{session: BookSession}>();
const book = props.session;
provide(BOOK_SESSION, book);

const NAV: ReadonlyArray<{id: Page; label: string; icon: string}> = [
    {id: "overview", label: "全书总览", icon: "i-lucide-layout-dashboard"},
    {id: "relations", label: "关系图", icon: "i-lucide-share-2"},
    {id: "book-graph", label: "全书图", icon: "i-lucide-network"},
    {id: "roster", label: "人物", icon: "i-lucide-users"},
    {id: "secrets", label: "秘密", icon: "i-lucide-eye-off"},
    {id: "ledger", label: "数值", icon: "i-lucide-coins"},
    {id: "questions", label: "悬念", icon: "i-lucide-circle-help"},
    {id: "timeline", label: "时间线", icon: "i-lucide-clock"},
    {id: "episodes", label: "情节", icon: "i-lucide-list-tree"},
    {id: "source", label: "原文", icon: "i-lucide-book-open"},
    {id: "qa", label: "问答", icon: "i-lucide-messages-square"},
    {id: "revisions", label: "待确认", icon: "i-lucide-list-checks"},
    {id: "stats", label: "说明与统计", icon: "i-lucide-info"},
];
/** 导航只列这本书开着的页（输出 2）：关掉数值或秘密的书没有那一页。 */
const nav = computed(() => NAV.filter(item => book.pages.value.includes(item.id)));
const PHONE_TABS: ReadonlyArray<{id: Page; label: string; icon: string}> = [
    {id: "overview", label: "总览", icon: "i-lucide-layout-dashboard"},
    {id: "roster", label: "人物", icon: "i-lucide-users"},
    {id: "relations", label: "关系图", icon: "i-lucide-share-2"},
];

// 页面按需加载：图的依赖（sigma、graphology）只在打开图的页面时才下载。
const PAGES: Record<Page, ReturnType<typeof defineAsyncComponent>> = {
    overview: defineAsyncComponent(() => import("../pages/OverviewPage.vue")),
    relations: defineAsyncComponent(() => import("../pages/RelationsPage.vue")),
    "book-graph": defineAsyncComponent(() => import("../pages/BookGraphPage.vue")),
    roster: defineAsyncComponent(() => import("../pages/RosterPage.vue")),
    secrets: defineAsyncComponent(() => import("../pages/SecretsPage.vue")),
    revisions: defineAsyncComponent(() => import("../pages/RevisionsPage.vue")),
    ledger: defineAsyncComponent(() => import("../pages/LedgerPage.vue")),
    questions: defineAsyncComponent(() => import("../pages/QuestionsPage.vue")),
    timeline: defineAsyncComponent(() => import("../pages/TimelinePage.vue")),
    episodes: defineAsyncComponent(() => import("../pages/EpisodesPage.vue")),
    source: defineAsyncComponent(() => import("../pages/SourcePage.vue")),
    qa: defineAsyncComponent(() => import("../pages/QaPage.vue")),
    stats: defineAsyncComponent(() => import("../pages/StatsPage.vue")),
};

const root = ref<HTMLElement | null>(null);
// 初值取窗口宽度：外壳铺满窗口，第一次量到之前按它定档，在平板宽度打开时不先按宽屏建网格、再播一次收起。
const width = ref(window.innerWidth);
const tier = computed<"wide" | "tablet" | "phone">(() => (width.value < 720 ? "phone" : width.value < 1100 ? "tablet" : "wide"));
watch(tier, value => {
    book.tier.value = value;
}, {immediate: true});
const overlayDrawer = computed(() => tier.value !== "wide");
const navCollapsed = ref(readNavCollapsed());
const navSheet = ref(false);
let observer: ResizeObserver | null = null;
onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
        width.value = entry!.contentRect.width;
    });
    if (root.value) observer.observe(root.value);
});
// 浮层抽屉按 Escape 关掉（输出 32、33）。有 nb-ui 浮层开着时（例如抽屉里记录等级的依据，焦点可能还在抽屉里的色块上），
// Escape 先归浮层：它们的 Escape 监听也挂在 window 上、注册得比这里晚，既不阻止事件也不标记，只能看还有没有开着的浮层
// （reka-ui 给每个开着的浮层元素标 `data-dismissable-layer`）。抽屉改用 nb-ui 的浮层组件后，这一段可以去掉。
function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !overlayDrawer.value || !book.drawer.value) return;
    if (document.querySelector("[data-dismissable-layer]")) return;
    book.closeDrawer();
}
window.addEventListener("keydown", onKey);
onBeforeUnmount(() => {
    observer?.disconnect();
    window.removeEventListener("keydown", onKey);
});

const navIsCollapsed = computed(() => tier.value === "tablet" || navCollapsed.value);
/** 抽屉那一栏该不该收起：不是宽屏（抽屉画成浮层）或没有打开的内容。 */
const drawerIsCollapsed = computed(() => overlayDrawer.value || book.drawer.value === null);

// ---- 三栏（输出 1、32）：nb-layout 的网格，收起状态以上面两个期望值为准 ----
// 网格自己也会改收起状态（拖过阈值、分隔线上按 Enter）：落账后先把变化映射回宿主（导航偏好、抽屉开关），再对账一次，
// 让网格回到期望值。已知会对不上的两种由停用分隔线挡住（没打开过内容时拖开抽屉：`reopenDrawer` 什么也不做；平板档拖开
// 导航：导航固定是图标条，见 `sashDisabled`），对账兜住其余映射不回去的情形，不让网格与宿主各说各的。
const grid = createBookGrid({drawerWidth: readDrawerWidth(), navCollapsed: navIsCollapsed.value, drawerCollapsed: drawerIsCollapsed.value, compact: () => overlayDrawer.value});
const host = useGridHost({
    grid,
    contextKey: "book-frame",
    onApplied,
    onIssues: (issues: readonly (GridIssue<string> | GridFailure)[]) => {
        for (const issue of issues) console.warn("书页三栏的布局诊断", issue.code, issue);
    },
});
function reconcile(): void {
    host.setCollapsed("nav", navIsCollapsed.value);
    host.setCollapsed("drawer", drawerIsCollapsed.value);
}
function onApplied(commit: GridGestureCommit): void {
    for (const change of commit.changes) {
        // 平板档导航强制收成图标条，那条线停用，不会从这里改到偏好；这里再判一次档位，偏好只记宽屏的选择。
        if (change.collapsed.nav !== undefined && tier.value === "wide") setNavCollapsed(change.collapsed.nav);
        if (change.collapsed.drawer === true) book.closeDrawer();
        if (change.collapsed.drawer === false) book.reopenDrawer();
        // 只在抽屉参与了这次拖动时记它的宽度：拖导航线时抽屉可能被挤窄，那不是用户选的宽度。收到 0 的不记。
        const drawerTarget = change.target.drawer;
        if (change.active.includes("drawer") && drawerTarget !== undefined && drawerTarget >= DRAWER_MIN_WIDTH) writeDrawerWidth(drawerTarget);
    }
    reconcile();
}
watch(navIsCollapsed, collapsed => host.setCollapsed("nav", collapsed));
watch(drawerIsCollapsed, collapsed => host.setCollapsed("drawer", collapsed));
// 平板档主区与抽屉之间那条线宽 0（`createBookGrid` 的 `compact`）：档位变了让网格按新的线宽重算。
watch(overlayDrawer, () => host.invalidate());

/** 停用的分隔线：平板档导航那条（导航固定是图标条）；没打开过任何内容时抽屉那条（顶栏的开关这时也不可用）。 */
function sashDisabled(sash: {before: string; after: string}): boolean {
    if (sash.before === "nav") return tier.value !== "wide";
    return book.drawer.value === null && book.lastDrawer.value === null;
}

// ---- 收起、展开的过渡（输出 1） ----
// 网格在过渡（时长接到 --nb-layout-motion-move，与换成网格之前的分栏一样）里逐帧改外框。主区跟着逐帧重排，文字与表格的
// 重排不贵；贵的是图的画布：Sigma 换尺寸要整张重画，所以过渡期间经 LAYOUT_MOTION 告诉图先不换尺寸，结束后换一次。
// 收到 0 的抽屉，内层保持原宽、按外框裁切，跟着外框从右边滑出；关上那一刻 `book.drawer` 已经为空，过渡期间接着画刚关掉的内容。
const gridRef = ref<{readonly moving: boolean; readonly outgoingLeaves: ReadonlySet<string>} | null>(null);
provide(LAYOUT_MOTION, computed(() => gridRef.value?.moving ?? false));
/**
 * 抽屉那一栏里画的内容：正在收到 0 时是刚关掉的那个。在网格的插槽里读，读到的 `outgoingLeaves` 是这一轮的（关上的那一帧
 * 就已含抽屉）。平板与手机不画在栏里（抽屉是浮层），模板按档位挡掉。
 */
const paneDrawer = computed<DrawerContent | null>(() => {
    if (book.drawer.value !== null) return book.drawer.value;
    return gridRef.value?.outgoingLeaves.has("drawer") === true ? book.lastDrawer.value : null;
});
function setNavCollapsed(value: boolean): void {
    navCollapsed.value = value;
    writeNavCollapsed(value);
}
function goPage(page: Page): void {
    book.wideRecords.value = null;
    book.goPage(page);
    navSheet.value = false;
}

// ---- 顶栏右侧：明暗与抽屉开关；左侧：书架与换书（输出 1、34、35） ----
const router = useRouter();
const client = useStoryClient();
const otherBooks = ref<{id: string; title: string}[]>([]);
onMounted(async () => {
    try {
        otherBooks.value = (await client.call("books.list", {})).books.filter(item => item.id !== book.bookId);
    } catch (error) {
        // 换书菜单只是捷径：取不到书单时只留“回到书架”，不打断阅读。
        if (!(error instanceof StoryCallError)) throw error;
        console.warn({error}, "取书单失败，换书菜单只剩回到书架");
    }
});
const menuSeparator = (id: string): DropdownMenuItemData => ({id, label: "", separator: true});
/** 菜单里“设置”这一项的值：书 id 只有小写字母、数字与连字符，不会撞上。 */
const SETTINGS = "@settings";
const bookItems = computed<DropdownMenuItemData[]>(() => [
    ...otherBooks.value.map(item => ({id: item.id, label: item.title, iconClass: "i-lucide-book"})),
    // `separator: true` 的项本身就是分隔线（不是“上面加一条线”）。
    ...(otherBooks.value.length > 0 ? [menuSeparator("sep-books")] : []),
    {id: "", label: "全部书（书架）", iconClass: "i-lucide-library"},
    menuSeparator("sep-settings"),
    {id: SETTINGS, label: "设置", iconClass: "i-lucide-settings"},
]);
function switchBook(id: string): void {
    void router.push(id === SETTINGS ? "/settings" : id === "" ? "/" : `/book/${encodeURIComponent(id)}`);
}

// 抽屉开关：开着就收起；收着就恢复最近一次的内容。没打开过任何内容时不可用。
const drawerOpen = computed(() => book.drawer.value !== null);
function toggleDrawer(): void {
    if (drawerOpen.value) book.closeDrawer();
    else book.reopenDrawer();
}

const ingestPill = computed(() => (book.ingest.value ? ingestBadge(book.ingest.value) : null));

const notice = book.notice;
watch(notice, value => {
    if (value) setTimeout(() => {
        if (notice.value === value) notice.value = null;
    }, 8000);
}, {immediate: true});
</script>

<template>
    <div ref="root" class="book-frame relative flex h-full w-full flex-col overflow-hidden" :data-tier="tier" data-testid="book-frame">
        <header class="shrink-0 border-b border-[var(--divider)] px-3 py-2" :class="tier === 'phone' ? 'flex flex-col gap-2' : 'flex items-center gap-3'">
            <div class="flex min-w-0 items-center gap-1" :class="tier === 'phone' ? 'w-full' : ''">
                <IconButton v-if="tier === 'phone'" size="sm" icon-class="i-lucide-menu" aria-label="打开导航" @click="navSheet = true" />
                <IconButton size="sm" icon-class="i-lucide-library" aria-label="回到书架" title="回到书架" data-testid="go-shelf" @click="switchBook('')" />
                <DropdownMenu :items="bookItems" menu-class="min-w-[220px]" @select="switchBook">
                    <button type="button" class="book-title flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-0.5" title="换一本书" data-testid="book-switcher">
                        <span class="truncate font-[var(--weight-strong)]" data-testid="book-title">{{ book.info.title }}</span>
                        <span class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)]" />
                    </button>
                </DropdownMenu>
                <!-- 抽取中的书（输出 39）：平时是进度徽标、点开进度页；又提交了一章时变成“点这里更新”，点了才换数据。 -->
                <button
                    v-if="book.behind.value" type="button" class="ingest-pill ingest-pill-update shrink-0" data-testid="ingest-update"
                    :title="`第 ${book.ingest.value!.committed} 章已抽完，点这里换成新数据`" @click="book.refresh()"
                ><span class="i-lucide-refresh-cw" /><span>第 {{ book.ingest.value!.committed }} 章已抽完{{ tier === "phone" ? " · 更新" : "，点这里更新" }}</span></button>
                <RouterLink
                    v-else-if="ingestPill" :to="`/ingest/${encodeURIComponent(book.bookId)}`" class="ingest-pill shrink-0" :class="`ingest-pill-${ingestPill.tone}`" :data-state="book.ingest.value!.state"
                    data-testid="ingest-pill" :title="'打开抽取进度'"
                ><span v-if="ingestPill.dot" class="ingest-dot" /><span>{{ ingestPill.text }} {{ book.ingest.value!.committed }} / {{ book.ingest.value!.total }}</span></RouterLink>
                <template v-if="tier === 'phone'">
                    <SearchBox class="ml-auto" compact />
                    <ThemeMenu />
                    <IconButton size="sm" icon-class="i-lucide-panel-bottom-open" aria-label="打开详情面板" :disabled="!drawerOpen && !book.lastDrawer.value" @click="toggleDrawer" />
                </template>
            </div>
            <ReadingControl :class="tier === 'phone' ? 'w-full' : 'shrink-0'" :at="book.at.value" :paragraphs="book.info.paragraphs" :end="book.info.extractedThrough.chapter" :at-end="book.atEnd.value" :compact="tier !== 'wide'" @update:at="book.setAt" @to-end="book.setAt('end')" />
            <div v-if="tier !== 'phone'" class="ml-auto flex min-w-0 items-center gap-1">
                <SearchBox :compact="tier === 'tablet'" />
                <!-- 平板放不下整句：只留图标，文字给悬停与读屏（审查 F03：整句会把右侧栏开关挤出屏外） -->
                <span v-if="book.saveFailed.value" class="save-failed whitespace-nowrap" role="status" title="阅读位置没存上" aria-label="阅读位置没存上" data-testid="save-failed"><span class="i-lucide-triangle-alert" /><span v-if="tier === 'wide'">阅读位置没存上</span></span>
                <ThemeMenu />
                <IconButton
                    size="sm" :icon-class="drawerOpen ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" :aria-label="drawerOpen ? '收起右侧栏' : '展开右侧栏'"
                    :title="drawerOpen ? '收起右侧栏' : book.lastDrawer.value ? '展开右侧栏' : '还没有打开过内容'" :disabled="!drawerOpen && !book.lastDrawer.value" data-testid="toggle-drawer" @click="toggleDrawer"
                />
            </div>
            <span v-if="tier === 'phone' && book.saveFailed.value" class="save-failed" role="status" data-testid="save-failed"><span class="i-lucide-triangle-alert" />阅读位置没存上</span>
        </header>

        <div class="relative min-h-0 flex-1">
            <!-- 过渡时长接到控件形变那一档（与换成网格之前的分栏一样）；设在网格根上，减少动态效果时照样归零（ui/nested-grid 输出 142）。 -->
            <NestedGrid v-if="tier !== 'phone'" ref="gridRef" v-bind="host.bindings.value" :sash-disabled="sashDisabled" class="h-full" style="--nb-layout-motion-layout: var(--nb-layout-motion-move)">
                <template #leaf="{node}">
                    <nav v-if="node.id === 'nav'" class="flex h-full flex-col gap-0.5 overflow-y-auto py-2" :class="navIsCollapsed ? 'items-center px-1' : 'px-2'" aria-label="页面">
                        <button
                            v-for="item in nav" :key="item.id" type="button" class="nav-item relative flex items-center gap-2 rounded-[var(--radius-control)] py-1.5 text-[length:var(--text-sm)]"
                            :class="[book.page.value === item.id ? 'is-active' : '', navIsCollapsed ? 'justify-center px-1.5' : 'px-2']"
                            :title="item.label" :aria-current="book.page.value === item.id ? 'page' : undefined" :data-page="item.id" @click="goPage(item.id)"
                        >
                            <span :class="item.icon" class="shrink-0" />
                            <span v-if="!navIsCollapsed" class="truncate">{{ item.label }}</span>
                            <RevisionBadge v-if="item.id === 'revisions'" :variant="navIsCollapsed ? 'dot' : 'badge'" :class="navIsCollapsed ? '' : 'ml-auto'" />
                        </button>
                        <div class="flex-1" />
                        <!-- 设置入口（t27）：收起导航时叠在收起按钮上方，展开时与它并排。 -->
                        <div class="flex items-center gap-1" :class="navIsCollapsed ? 'flex-col' : 'justify-between px-1'">
                            <IconButton size="xs" icon-class="i-lucide-settings" aria-label="设置" title="设置" data-testid="nav-settings" @click="router.push('/settings')" />
                            <IconButton v-if="tier === 'wide'" size="xs" :icon-class="navCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'" :aria-label="navCollapsed ? '展开导航' : '收起导航'" @click="setNavCollapsed(!navCollapsed)" />
                        </div>
                    </nav>
                    <main v-else-if="node.id === 'main'" class="h-full min-w-0" data-testid="main">
                        <RecordsTable v-if="book.wideRecords.value" :entity="book.wideRecords.value" />
                        <component :is="PAGES[book.page.value]" v-else :key="book.page.value" />
                    </main>
                    <!-- 平板档抽屉是下面的浮层，这一栏收在 0、什么也不画，换档那一刻不会出现两份抽屉。 -->
                    <aside
                        v-else-if="node.id === 'drawer' && !overlayDrawer"
                        class="flex h-full min-w-0 flex-col overflow-hidden border-l border-[var(--divider)] bg-[var(--panel-surface)]"
                        data-testid="drawer" :data-closing="book.drawer.value === null ? 'true' : undefined"
                    >
                        <!-- 人物卡自己带关闭按钮；其余几种内容在这里补一个（反馈：右侧栏要有关闭按钮） -->
                        <div v-if="paneDrawer && paneDrawer.kind !== 'card'" class="flex shrink-0 justify-end px-2 pt-1"><IconButton size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="book.closeDrawer()" /></div>
                        <div class="min-h-0 flex-1">
                            <DrawerCard v-if="paneDrawer?.kind === 'card'" :key="paneDrawer.entity" :entity="paneDrawer.entity" :tab="paneDrawer.tab" />
                            <DrawerSource v-else-if="paneDrawer?.kind === 'source'" :ref-text="paneDrawer.ref" class="story-scroll-y h-full" />
                            <DrawerParagraph v-else-if="paneDrawer?.kind === 'para'" :chapter="paneDrawer.chapter" :paragraph="paneDrawer.paragraph" class="story-scroll-y h-full" />
                            <DrawerNode v-else-if="paneDrawer?.kind === 'node'" :id="paneDrawer.id" :label="paneDrawer.label" class="story-scroll-y h-full" />
                        </div>
                    </aside>
                </template>
            </NestedGrid>
            <main v-else class="h-full min-w-0 pb-12" data-testid="main">
                <RecordsTable v-if="book.wideRecords.value" :entity="book.wideRecords.value" />
                <component :is="PAGES[book.page.value]" v-else :key="book.page.value" />
            </main>

            <!-- 平板与手机：抽屉是浮层，不挤窄主区；点外面关掉（输出 32、33） -->
            <template v-if="overlayDrawer && book.drawer.value">
                <div class="absolute inset-0 z-20 bg-[var(--overlay-bg)]" data-testid="drawer-scrim" @click="book.closeDrawer()" />
                <aside
                    role="dialog" aria-modal="true" aria-label="详情"
                    class="drawer-overlay absolute z-30 flex flex-col overflow-hidden border-[var(--divider)] bg-[var(--bg-panel)] shadow-[var(--shadow-panel)]"
                    :class="tier === 'phone' ? 'inset-x-0 bottom-0 h-[78%] rounded-t-[12px] border-t' : 'inset-y-0 right-0 w-[min(420px,90%)] border-l'" data-testid="drawer"
                >
                    <div v-if="book.drawer.value.kind !== 'card'" class="flex justify-end px-2 pt-1"><IconButton size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="book.closeDrawer()" /></div>
                    <div class="min-h-0 flex-1">
                        <DrawerCard v-if="book.drawer.value.kind === 'card'" :key="book.drawer.value.entity" :entity="book.drawer.value.entity" :tab="book.drawer.value.tab" />
                        <DrawerSource v-else-if="book.drawer.value.kind === 'source'" :ref-text="book.drawer.value.ref" class="story-scroll-y h-full" />
                        <DrawerParagraph v-else-if="book.drawer.value.kind === 'para'" :chapter="book.drawer.value.chapter" :paragraph="book.drawer.value.paragraph" class="story-scroll-y h-full" />
                        <DrawerNode v-else :id="book.drawer.value.id" :label="book.drawer.value.label" class="story-scroll-y h-full" />
                    </div>
                </aside>
            </template>

            <!-- 手机：底部常用页签与“更多” -->
            <nav v-if="tier === 'phone'" class="absolute inset-x-0 bottom-0 z-10 flex border-t border-[var(--divider)] bg-[var(--bg-panel)]" aria-label="常用页面">
                <button v-for="item in PHONE_TABS" :key="item.id" type="button" class="flex flex-1 flex-col items-center py-1 text-[length:var(--text-2xs)]" :class="book.page.value === item.id ? 'text-[var(--accent-text)]' : ''" @click="goPage(item.id)">
                    <span :class="item.icon" />{{ item.label }}
                </button>
                <button type="button" class="flex flex-1 flex-col items-center py-1 text-[length:var(--text-2xs)]" @click="navSheet = true"><span class="relative"><span class="i-lucide-menu" /><RevisionBadge variant="dot" /></span>更多</button>
            </nav>
            <template v-if="tier === 'phone' && navSheet">
                <div class="absolute inset-0 z-20 bg-[var(--overlay-bg)]" @click="navSheet = false" />
                <nav class="absolute inset-y-0 left-0 z-30 flex w-[220px] flex-col gap-0.5 bg-[var(--bg-panel)] p-2 shadow-[var(--shadow-panel)]" aria-label="页面">
                    <button v-for="item in nav" :key="item.id" type="button" class="nav-item flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-[length:var(--text-sm)]" :class="book.page.value === item.id ? 'is-active' : ''" @click="goPage(item.id)">
                        <span :class="item.icon" />{{ item.label }}<RevisionBadge v-if="item.id === 'revisions'" class="ml-auto" />
                    </button>
                    <div class="flex-1" />
                    <button type="button" class="nav-item flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-[length:var(--text-sm)]" data-testid="nav-settings-sheet" @click="router.push('/settings')"><span class="i-lucide-settings" />设置</button>
                </nav>
            </template>
        </div>

        <div v-if="notice" class="absolute left-1/2 z-40 -translate-x-1/2 rounded-[var(--radius-control)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-[length:var(--text-sm)]" data-testid="notice" :class="tier === 'phone' ? 'bottom-14' : 'bottom-4'">{{ notice }}</div>
    </div>
</template>

<style scoped>
.ingest-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-left: 0.25rem;
    padding: 0.125rem 0.5rem;
    border: var(--border-w) solid var(--divider);
    border-radius: 999px;
    font-size: var(--text-xs);
    color: var(--accent-text);
    white-space: nowrap;
}
.ingest-pill:hover {
    background: var(--bg-hover);
}
/* 颜色与 IngestBadge 同一套：运行中强调色，已停下中性，失败停下警示色。 */
.ingest-pill-neutral {
    color: var(--text-secondary);
}
.ingest-pill-danger {
    color: var(--status-danger);
}
.ingest-pill-update {
    border-color: var(--accent-text);
}
.ingest-dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 999px;
    background: currentColor;
}
.nav-item {
    color: var(--text-secondary);
}
.nav-item:hover {
    background: var(--bg-hover);
}
.book-title:hover {
    background: var(--bg-hover);
}
.save-failed {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--status-danger);
}
.nav-item.is-active {
    color: var(--accent-text);
    background: var(--accent-bg);
}
</style>
