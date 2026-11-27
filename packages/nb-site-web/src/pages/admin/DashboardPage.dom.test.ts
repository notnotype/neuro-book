/**
 * 看板（`DashboardPage.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开 `/admin`，看板的数据由注入的 `fetch` 按路径
 * 回答（`testing/dashboard-answers.ts`），时间由手动时钟推进。断言的是看得到的：每块面板处在哪种状态、写了什么字、发了哪些请求、
 * 地址怎样变。图画在 canvas 上，happy-dom 里容器没有尺寸、不建图；图上的样子、提示框、面板高度在 `e2e/dashboard.e2e.ts`。
 */

import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {dashboardHandlers, EMPTY_DASHBOARD} from "../../testing/dashboard-answers";
import type {DashboardData} from "../../testing/dashboard-answers";
import {cleanUp, failure, settledAt, startAt} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import {DASHBOARD_PATHS} from "./dashboard/source";

const text = zhCN.admin.dashboard;

afterEach(cleanUp);

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values[key]));
}

const DATA: DashboardData = {
    today: {manifestVersion: 1, active: 1234, activeChange: 12, fresh: 56, freshChange: -3, online: 78, onlineWindowMinutes: 5, usageShare: 0.425},
    active: {
        7: {from: "2026-11-20", to: "2026-11-26", days: [{date: "2026-11-20", daily: 100, weekly: 300, monthly: 900}, {date: "2026-11-26", daily: 120, weekly: 310, monthly: 910}]},
        28: {from: "2026-10-30", to: "2026-11-26", days: [{date: "2026-11-01", daily: 90, weekly: 280, monthly: 880}, {date: "2026-11-26", daily: 120, weekly: 310, monthly: 910}]},
        90: {from: "2026-08-29", to: "2026-11-26", days: [{date: "2026-09-01", daily: 40, weekly: 120, monthly: 400}]},
    },
    online: {from: "2026-11-25T10:00:00.000Z", segmentMinutes: 30, segmentCount: 48, segments: [{start: "2026-11-25T10:00:00.000Z", count: 30}]},
    versions: {rows: [{label: "0.15.0", count: 60}, {label: "0.14.2", count: 30}, {label: "", count: 10, rest: true}]},
    systems: {rows: [{label: "Windows", count: 70}, {label: "macOS", count: 30}]},
    retention: {cohorts: [{week: "2026-11-02", fresh: 40, retained: [20, 10, null, null]}]},
    problems: {
        reports: 200,
        errors: [{owner: "nbook", code: "store_locked", reports: 50, bins: [30, 10, 5, 4, 1]}],
        crashes: {none: 180, once: 15, few: 4, many: 1},
        upgrades: {none: 150, succeeded: 45, failed: 5},
    },
};

const PANELS = ["today", "active", "online", "versions", "systems", "retention", "errors", "crashes", "upgrades"] as const;
type PanelId = (typeof PANELS)[number];

function panel(harness: Harness, id: PanelId): HTMLElement {
    const found = harness.target.querySelector<HTMLElement>(`[data-site-dashboard-panel="${id}"]`);
    if (found === null) throw new Error(`没有 ${id} 这块面板`);
    return found;
}

function states(harness: Harness): Record<PanelId, string | null> {
    return Object.fromEntries(PANELS.map((id) => [id, panel(harness, id).getAttribute("data-site-panel-state")])) as Record<PanelId, string | null>;
}

/** 以管理员身份打开看板。`handlers` 盖在 `data` 的回答上面。 */
async function openDashboard(path = "/admin", data: DashboardData = DATA, handlers: Readonly<Record<string, Handler>> = {}): Promise<Harness> {
    const harness = startAt(path, {session: {role: "admin", consentRequired: false}, handlers: {...dashboardHandlers(data), ...handlers}});
    const url = new URL(path, "http://site.invalid");
    await settledAt(harness, `${url.pathname}${url.search}`, "admin-dashboard");
    return harness;
}

/** 某条 `GET` 发了几次。 */
function gets(harness: Harness, path: string): number {
    return harness.requests.filter((request) => request.method === "GET" && request.path === path).length;
}

const allReady = Object.fromEntries(PANELS.map((id) => [id, "ready"]));

describe("有数据", () => {
    it("每块面板都画出来：今天的四个数、版本与系统的份数、留存与错误", async () => {
        const harness = await openDashboard();
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));

        const figure = (id: string) => panel(harness, "today").querySelector(`[data-site-figure="${id}"]`)?.textContent;
        expect(figure("active")).toContain("1,234");
        expect(figure("active")).toContain(fill(text.change, {change: "+12"}));
        expect(figure("fresh")).toContain(fill(text.change, {change: "-3"}));
        expect(figure("online")).toContain(fill(text.onlineWindow, {minutes: 5}));
        expect(figure("usage")).toContain("42.5%");
        expect(harness.target.querySelector("header")?.textContent).toContain(fill(text.manifest, {version: 1}));

        expect(panel(harness, "versions").textContent).toContain("0.15.0");
        expect(panel(harness, "versions").textContent).toContain(text.rest);
        expect(panel(harness, "systems").textContent).toContain("Windows");
        expect(panel(harness, "retention").textContent).toContain("50%");
        expect(panel(harness, "errors").textContent).toContain("store_locked");
        expect(panel(harness, "errors").textContent).toContain("25%");
        // 五档的份数也写在横条的 `aria-label` 里，不单靠颜色。
        expect(panel(harness, "errors").querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
            [text.errors.bin1, text.errors.bin2, text.errors.bin3, text.errors.bin4, text.errors.bin5].map((bin, index) => fill(text.errors.binCount, {bin, count: [30, 10, 5, 4, 1][index]!})).join(text.errors.binSeparator),
        );
        // 两张图的容器带着读屏的概括。
        expect(panel(harness, "active").querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.active.label, {days: 28}));
    });
});

describe("没有数据", () => {
    it("还没有上报：今天的四个数是 0 与“—”，其余面板写没有数据，不画空的图与表", async () => {
        const harness = await openDashboard("/admin", EMPTY_DASHBOARD);
        await vi.waitFor(() => expect(states(harness)).toEqual({...Object.fromEntries(PANELS.map((id) => [id, "empty"])), today: "ready"}));

        expect(panel(harness, "today").querySelector('[data-site-figure="active"]')?.textContent).toContain(text.noYesterday);
        expect(panel(harness, "today").querySelector('[data-site-figure="usage"]')?.textContent).toContain(text.noValue);
        expect(panel(harness, "active").textContent).toContain(text.active.empty);
        expect(panel(harness, "online").textContent).toContain(text.online.empty);
        expect(panel(harness, "retention").textContent).toContain(text.retention.empty);
        expect(panel(harness, "errors").textContent).toContain(text.emptyToday);
        expect(panel(harness, "active").querySelector("[data-site-chart]")).toBeNull();
    });

    it("有上报而没有错误：错误一块写今天没有错误，崩溃与升级照常画", async () => {
        const harness = await openDashboard("/admin", {...DATA, problems: {...DATA.problems, errors: []}});
        await vi.waitFor(() => expect(states(harness)).toEqual({...allReady, errors: "empty"}));
        expect(panel(harness, "errors").textContent).toContain(text.errors.empty);
    });
});

describe("加载", () => {
    it("200 毫秒之内只留着空白，之后转圈；回答到了画出来", async () => {
        let release: (() => void) | undefined;
        const harness = await openDashboard("/admin", DATA, {
            [`GET ${DASHBOARD_PATHS.active(28)}`]: () => new Promise<Response>((resolve) => {
                release = () => resolve(Response.json(DATA.active[28]));
            }),
        });
        await vi.waitFor(() => expect(release).toBeDefined());
        const active = panel(harness, "active");
        expect(active.getAttribute("data-site-panel-state")).toBe("loading");
        expect(active.querySelector('[role="status"]')).toBeNull();

        harness.clock.advance(200);
        await vi.waitFor(() => expect(active.querySelector('[role="status"]')).not.toBeNull());

        release!();
        await vi.waitFor(() => expect(active.getAttribute("data-site-panel-state")).toBe("ready"));
        await vi.waitFor(() => expect(active.querySelector('[role="status"]')).toBeNull());
    });
});

describe("出错", () => {
    it("一块取不到：只有那一块写原因与重试，别的照常；点重试再取，成功后画出来", async () => {
        let up = false;
        const harness = await openDashboard("/admin", DATA, {
            [`GET ${DASHBOARD_PATHS.problems}`]: () => (up ? Response.json(DATA.problems) : failure({error: {code: "unavailable"}}, 503)),
        });
        await vi.waitFor(() => expect(states(harness)).toEqual({...allReady, errors: "failed", crashes: "failed", upgrades: "failed"}));

        const errors = panel(harness, "errors");
        expect(errors.querySelector('[role="alert"]')?.textContent).toContain(zhCN.errors.telemetry.unavailable);
        expect(gets(harness, DASHBOARD_PATHS.problems)).toBe(1);

        up = true;
        const retry = [...errors.querySelectorAll("button")].find((button) => button.textContent?.trim() === zhCN.shell.retry);
        expect(retry).toBeDefined();
        retry!.click();
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));
        expect(gets(harness, DASHBOARD_PATHS.problems)).toBe(2);
    });

    it("服务的码目录里没有时也有字可显示：通用文案带上码", async () => {
        const harness = await openDashboard("/admin", DATA, {[`GET ${DASHBOARD_PATHS.online}`]: () => Response.json({error: {code: "query_timeout"}}, {status: 500})});
        await vi.waitFor(() => expect(panel(harness, "online").getAttribute("data-site-panel-state")).toBe("failed"));
        expect(panel(harness, "online").querySelector('[role="alert"]')?.textContent).toContain(fill(zhCN.errors.web.unknown, {code: "query_timeout"}));
    });
});

describe("时间范围", () => {
    function rangeButton(harness: Harness, range: 7 | 28 | 90): HTMLButtonElement {
        const button = harness.target.querySelector<HTMLButtonElement>(`[data-site-dashboard-range] [data-value="${range}"]`);
        if (button === null) throw new Error(`没有 ${range} 天的按钮`);
        return button;
    }

    it("换范围写进地址并只重取活跃图；回到近 28 天时地址里不写", async () => {
        const harness = await openDashboard();
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));
        expect(rangeButton(harness, 28).getAttribute("aria-checked")).toBe("true");
        const before = harness.requests.length;

        rangeButton(harness, 7).click();
        await settledAt(harness, "/admin?range=7", "admin-dashboard");
        await vi.waitFor(() => expect(gets(harness, DASHBOARD_PATHS.active(7))).toBe(1));
        expect(rangeButton(harness, 7).getAttribute("aria-checked")).toBe("true");
        await vi.waitFor(() => expect(panel(harness, "active").querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.active.label, {days: 7})));
        expect(harness.requests.slice(before).map((request) => request.path)).toEqual([DASHBOARD_PATHS.active(7)]);

        rangeButton(harness, 28).click();
        await settledAt(harness, "/admin", "admin-dashboard");
        await vi.waitFor(() => expect(gets(harness, DASHBOARD_PATHS.active(28))).toBe(2));
    });

    it("带着范围打开看板：按地址里的范围取；认不出的范围按近 28 天", async () => {
        const harness = await openDashboard("/admin?range=90");
        await vi.waitFor(() => expect(gets(harness, DASHBOARD_PATHS.active(90))).toBe(1));
        expect(gets(harness, DASHBOARD_PATHS.active(28))).toBe(0);

        const other = await openDashboard("/admin?range=30");
        await vi.waitFor(() => expect(gets(other, DASHBOARD_PATHS.active(28))).toBe(1));
        expect(rangeButton(other, 28).getAttribute("aria-checked")).toBe("true");
    });
});
