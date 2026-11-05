import {describe, expect, test} from "bun:test";
import {arrangeNavWorks, byAttention, entryActive, NAV_GROUPS, pageTitle, splitNavWorks} from "../src/web/host/nav.js";
import type {OverviewWork, RecordedValue} from "../src/web/host/types.js";

/** 左栏的描述表与 Work 树的取舍（t15 阶段 2b，D4）。 */
const recorded = <T extends string>(value: T | null, origin: RecordedValue["origin"] = value === null ? "unset" : "recorded"): RecordedValue<T> => ({value, origin});
const work = (workId: string, status: "active" | "done" | "shelved" | null, updated: string | null, origin?: RecordedValue["origin"], patch: Partial<OverviewWork> = {}) => ({workId, title: workId, status: recorded(status, origin), updated: recorded(updated), tasks: [], waiting: 0, ...patch}) as unknown as OverviewWork;
const NOW = new Date("2026-10-14T12:00:00");

describe("Work 树只列活跃的（D4）", () => {
    test("进行中的都列（不管多久没更新）；未标的只列 30 天内更新过的；完成、搁置、更早的、状态写坏的收进“更多”，各自保持原顺序", () => {
        const works = [
            work("w1", "active", "2026-01-01"),
            work("w2", null, "2026-09-14"),
            work("w3", null, "2026-09-13"),
            work("w4", "done", "2026-10-14"),
            work("w5", "shelved", "2026-10-14"),
            work("w6", null, null),
            work("w7", null, "2026-10-14", "invalid"),
            work("w8", "active", null),
        ];
        const {shown, more} = splitNavWorks(works, NOW);
        expect([shown.map((entry) => entry.workId), more.map((entry) => entry.workId)]).toEqual([["w1", "w2", "w8"], ["w3", "w4", "w5", "w6", "w7"]]);
    });
});

describe("左栏条目的高亮", () => {
    const entry = (key: string) => NAV_GROUPS.flatMap((group) => group.entries).find((item) => item.key === key)!;
    test("首页只在 / 上；其余条目在它下面的页也算，但不认前缀相同的别的路径", () => {
        expect([entryActive(entry("home"), "/"), entryActive(entry("home"), "/work/w1")]).toEqual([true, false]);
        expect([entryActive(entry("sessions"), "/live/sessions"), entryActive(entry("artifacts"), "/artifacts"), entryActive(entry("artifacts"), "/artifactsx")]).toEqual([true, true, false]);
    });
});

describe("标签页标题（2e）", () => {
    const works = [{...work("w00022-dev-panel", "active", "2026-10-14"), title: "开发者面板", tasks: [{taskId: "t15-ui-polish", title: "面板界面打磨"}]}] as unknown as OverviewWork[];
    // 页面名来自路由元信息（router.ts 的 meta.title），这里按路由表的写法给。
    const route = (name: string | null, title: string | null, params: Record<string, string> = {}, query: Record<string, string> = {}) => ({name, title, params, query});
    test("“页面名 · nbdev”：页面名取路由元信息；Work、Task 取标题，还没读到时用编号；文档与编辑带文件名；搜索带搜索词", () => {
        expect([
            pageTitle(route("home", "首页"), works),
            pageTitle(route("work", "Work", {workId: "w00022-dev-panel"}), works),
            pageTitle(route("task", "Task", {workId: "w00022-dev-panel", taskId: "t15-ui-polish"}), works),
            pageTitle(route("task", "Task", {workId: "w00022-dev-panel", taskId: "t15-ui-polish"}), null),
            pageTitle(route("artifact", "产物", {workId: "w1", taskId: "-", artifactId: "uxq"}), works),
            pageTitle(route("docs", "文档", {}, {path: "docs/specs/AGENTS.md"}), works),
            pageTitle(route("docs", "文档"), works),
            pageTitle(route("edit", "编辑", {}, {path: "a/b/README.md"}), works),
            pageTitle(route("search", "搜索", {}, {q: "滚动"}), works),
            pageTitle(route("runs", "在跑"), works),
            pageTitle(route(null, null), works),
        ]).toEqual(["首页 · nbdev", "开发者面板 · nbdev", "面板界面打磨 · nbdev", "w00022-dev-panel/t15-ui-polish · nbdev", "uxq · nbdev", "AGENTS.md · nbdev", "文档 · nbdev", "编辑 README.md · nbdev", "搜索 滚动 · nbdev", "在跑 · nbdev", "nbdev"]);
    });
});

describe("左栏 Work 列表的排列与筛选（t15 阶段 4 第 2 批）", () => {
    const works = [
        work("w1-alpha", "active", "2026-10-01"),
        work("w2-beta", null, "2026-10-13"),
        work("w3-gamma", "done", "2026-10-14"),
        work("w4-delta", "active", "2026-09-01", undefined, {waiting: 2}),
        work("w5-old", null, "2026-01-01", undefined, {title: "很久没动的 Work"} as Partial<OverviewWork>),
    ];
    const ids = (groups: ReturnType<typeof arrangeNavWorks>) => groups.map((group) => [group.key, group.foldable, group.works.map((entry) => entry.workId)]);

    test("有事等我在前：有待答的、进行中的、再按最近更新；首页卡片也用这个顺序", () => {
        expect([...works].sort(byAttention).map((entry) => entry.workId)).toEqual(["w4-delta", "w1-alpha", "w3-gamma", "w2-beta", "w5-old"]);
    });

    test("按编号、最近更新、有事等我都保留 D4 的“更多”；按状态分组时完成的一组缺省收起", () => {
        expect(ids(arrangeNavWorks(works, "number", "", NOW))).toEqual([["shown", false, ["w1-alpha", "w2-beta", "w4-delta"]], ["more", true, ["w3-gamma", "w5-old"]]]);
        expect(ids(arrangeNavWorks(works, "updated", "", NOW))).toEqual([["shown", false, ["w2-beta", "w1-alpha", "w4-delta"]], ["more", true, ["w3-gamma", "w5-old"]]]);
        expect(ids(arrangeNavWorks(works, "status", "", NOW))).toEqual([["active", false, ["w1-alpha", "w4-delta"]], ["unset", false, ["w2-beta", "w5-old"]], ["done", true, ["w3-gamma"]]]);
    });

    test("筛选按编号或标题、不分大小写，筛出来的不再收进“更多”", () => {
        expect(ids(arrangeNavWorks(works, "number", "W3", NOW))).toEqual([["matched", false, ["w3-gamma"]]]);
        expect(ids(arrangeNavWorks(works, "attention", "很久", NOW))).toEqual([["matched", false, ["w5-old"]]]);
    });
});
