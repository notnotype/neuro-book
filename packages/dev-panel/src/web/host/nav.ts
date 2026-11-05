import {daysSince} from "./format.js";
import type {OverviewWork} from "./types.js";

/**
 * 左栏的描述表与 Work 树的取舍（t15 阶段 2b）。左栏的条目从这里来，路由仍在 `router.ts` 里显式声明；
 * 零件 `PanelNav` 按它画，桌面左栏与手机抽屉共用。本文件不用 DOM 类型（L1 测试在 Node 类型下导入它）。
 */

/** 条目右边的计数从宿主给的哪一项来。 */
export type NavCount = "inbox" | "sessions" | "runs";
export type NavEntry = {
    key: string;
    label: string;
    icon: string;
    href: string;
    /** 高亮的判定：`exact` 只在这一页，`prefix` 在它下面的页也算。 */
    match: "exact" | "prefix";
    count?: NavCount;
    /** 只在主工作区能写时给（新建的入口）。 */
    needsWritable?: boolean;
};
export type NavGroup = {title: string | null; entries: NavEntry[]};

/** 上段固定的条目：首页与新建、资料、现场。Work 树在它们下面，单独滚动。 */
export const NAV_GROUPS: NavGroup[] = [
    {title: null, entries: [
        {key: "home", label: "首页与收件箱", icon: "i-lucide-inbox", href: "/", match: "exact", count: "inbox"},
        {key: "new", label: "新建 Work 或 Task", icon: "i-lucide-plus", href: "/new", match: "exact", needsWritable: true},
    ]},
    {title: "资料", entries: [
        {key: "artifacts", label: "产物", icon: "i-lucide-files", href: "/artifacts", match: "prefix"},
        {key: "docs", label: "文档", icon: "i-lucide-book-open", href: "/docs", match: "prefix"},
    ]},
    {title: "现场", entries: [
        {key: "sessions", label: "会话", icon: "i-lucide-terminal", href: "/live/sessions", match: "prefix", count: "sessions"},
        {key: "runs", label: "在跑", icon: "i-lucide-activity", href: "/live/runs", match: "prefix", count: "runs"},
        {key: "checkouts", label: "checkout", icon: "i-lucide-git-fork", href: "/live/checkouts", match: "prefix"},
        {key: "github", label: "GitHub", icon: "i-lucide-git-pull-request", href: "/live/github", match: "prefix"},
    ]},
];

export function entryActive(entry: NavEntry, path: string): boolean {
    return entry.match === "exact" ? path === entry.href : path === entry.href || path.startsWith(`${entry.href}/`);
}

/** 30 天内更新过的未标 Work 列在树里；更早的、完成的、搁置的收进“更多”（D4）。 */
export const NAV_RECENT_DAYS = 30;

/** Work 树的取舍（D4）：进行中的都列；未标的只列 30 天内更新过的；其余（完成、搁置、更早的未标、状态写坏的）收进“更多”。 */
export function splitNavWorks(works: readonly OverviewWork[], now: Date = new Date()): {shown: OverviewWork[]; more: OverviewWork[]} {
    const shown: OverviewWork[] = [];
    const more: OverviewWork[] = [];
    for (const work of works) {
        const status = work.status.value;
        const recent = work.updated.value !== null && daysSince(work.updated.value, now) <= NAV_RECENT_DAYS;
        if (status === "active" || (status === null && work.status.origin !== "invalid" && recent)) shown.push(work);
        else more.push(work);
    }
    return {shown, more};
}

/** 左栏 Work 列表的排列方式（t15 阶段 4 第 2 批，开发者 10-14：多给些办法快速找到 Work）。只用记录里已有的字段。 */
export type NavArrange = "number" | "updated" | "attention" | "status";
export const NAV_ARRANGES: ReadonlyArray<{value: NavArrange; label: string}> = [
    {value: "number", label: "按编号"},
    {value: "updated", label: "最近更新在前"},
    {value: "attention", label: "有事等我在前"},
    {value: "status", label: "按状态分组"},
];

const updatedOf = (work: OverviewWork) => work.updated.value ?? "";
/** 最近更新的在前；没有更新日期的排后面；同一天按编号。 */
export function byUpdated(left: OverviewWork, right: OverviewWork): number {
    return updatedOf(right).localeCompare(updatedOf(left)) || left.workId.localeCompare(right.workId);
}
/** 有事等我在前：有待答题的，其次进行中，再按最近更新。首页的 Work 卡片与左栏的“有事等我在前”共用。 */
export function byAttention(left: OverviewWork, right: OverviewWork): number {
    const rank = (work: OverviewWork) => (work.waiting > 0 ? 0 : work.status.value === "active" ? 1 : 2);
    return rank(left) - rank(right) || byUpdated(left, right);
}

/** 筛选：编号（含 w00022 这种前缀）或标题里有这段文字，不分大小写。 */
export function matchesWork(work: OverviewWork, query: string): boolean {
    const needle = query.trim().toLowerCase();
    return needle === "" || work.workId.toLowerCase().includes(needle) || (work.title ?? "").toLowerCase().includes(needle);
}

/** 左栏里的一组 Work：`label` 为 null 的是不带标题的那组；`foldable` 的一组缺省收起（D4 的“更多”、完成与搁置）。 */
export type NavWorkGroup = {key: string; label: string | null; works: OverviewWork[]; foldable: boolean};

const STATUS_GROUPS: ReadonlyArray<{key: string; label: string; foldable: boolean; test: (work: OverviewWork) => boolean}> = [
    {key: "active", label: "进行中", foldable: false, test: (work) => work.status.value === "active"},
    {key: "unset", label: "未标", foldable: false, test: (work) => work.status.value === null && work.status.origin !== "invalid"},
    {key: "done", label: "完成", foldable: true, test: (work) => work.status.value === "done"},
    {key: "shelved", label: "搁置", foldable: true, test: (work) => work.status.value === "shelved"},
    {key: "invalid", label: "状态写坏的", foldable: true, test: (work) => work.status.origin === "invalid"},
];

/**
 * 左栏 Work 列表按排列方式分组与排序。有筛选词时不再收进“更多”：筛出来的都列出来（找的往往正是不活跃的那个）。
 * 按编号保持服务端的顺序；按状态分组时组内按最近更新。
 */
export function arrangeNavWorks(works: readonly OverviewWork[], arrange: NavArrange, query: string, now: Date = new Date()): NavWorkGroup[] {
    const matched = works.filter((work) => matchesWork(work, query));
    const sorter = arrange === "updated" ? byUpdated : arrange === "attention" ? byAttention : null;
    const sort = (list: OverviewWork[]) => (sorter ? [...list].sort(sorter) : list);
    if (arrange === "status") {
        return STATUS_GROUPS.map((group) => ({key: group.key, label: group.label, works: [...matched.filter(group.test)].sort(byUpdated), foldable: group.foldable && query.trim() === ""}))
            .filter((group) => group.works.length > 0);
    }
    if (query.trim() !== "") return [{key: "matched", label: null, works: sort(matched), foldable: false}];
    const {shown, more} = splitNavWorks(matched, now);
    return [{key: "shown", label: null, works: sort(shown), foldable: false}, ...(more.length > 0 ? [{key: "more", label: `${more.length} 个（完成、搁置或 ${NAV_RECENT_DAYS} 天没有更新）`, works: sort(more), foldable: true}] : [])];
}

/**
 * 标签页标题（t15 阶段 2e）：“页面名 · nbdev”。页面名写在路由元信息的 `title` 里（`router.ts`）；Work、Task 页取
 * `/api/overview` 里的标题（还没读到时用编号），产物页用产物 id，文档页与编辑页带上文件名，搜索页带上搜索词。
 */
export function pageTitle(route: {name: string | null; title: string | null; params: Record<string, string | undefined>; query: Record<string, string | undefined>}, works: readonly OverviewWork[] | null): string {
    const {workId, taskId, artifactId} = route.params;
    const work = workId ? works?.find((entry) => entry.workId === workId) : undefined;
    const base = (path: string | undefined) => path?.split("/").filter(Boolean).at(-1);
    let name: string;
    if (route.name === "work" && workId) name = work?.title ?? workId;
    else if (route.name === "task" && workId && taskId) name = work?.tasks.find((task) => task.taskId === taskId)?.title ?? `${workId}/${taskId}`;
    else if (route.name === "artifact" && artifactId) name = artifactId;
    else if ((route.name === "docs" || route.name === "edit") && base(route.query.path)) name = `${route.name === "edit" ? "编辑 " : ""}${base(route.query.path)}`;
    else if (route.name === "search" && route.query.q) name = `搜索 ${route.query.q}`;
    else if (route.title) name = route.title;
    else return "nbdev";
    return `${name} · nbdev`;
}
