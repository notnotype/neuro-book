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

/** 页面那一处出错的汇总播报（读屏念的那句）。 */
function summary(harness: Harness): string {
    return harness.target.querySelector("[data-site-dashboard-summary]")?.textContent?.trim() ?? "";
}

/** 一块面板里的重试按钮；没有时为 `null`。 */
function retryButton(harness: Harness, id: PanelId): HTMLButtonElement | null {
    return panel(harness, id).querySelector<HTMLButtonElement>("[data-site-panel-retry]");
}

/** 一个先不回答的请求：`release` 之后才给出 `respond()` 的结果。`answered` 在回答的内容被页面读走之后为真。 */
function held(respond: () => Response): {readonly handler: Handler; release(): void; readonly asked: boolean; readonly answered: boolean} {
    let release: (() => void) | undefined;
    let response: Response | undefined;
    return {
        handler: () => new Promise<Response>((resolve) => {
            release = () => {
                response = respond();
                resolve(response);
            };
        }),
        release: () => {
            if (release === undefined) throw new Error("请求还没发出来");
            release();
        },
        get asked() {
            return release !== undefined;
        },
        get answered() {
            return response?.bodyUsed === true;
        },
    };
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
        // 错误、崩溃、升级只来自带使用统计的上报：今天一份也没有时写这一句，不写“还没有上报”。
        for (const id of ["errors", "crashes", "upgrades"] as const) expect({id, text: panel(harness, id).textContent}).toEqual({id, text: expect.stringContaining(text.noUsageReports)});
        expect(panel(harness, "versions").textContent).toContain(text.emptyToday);
        expect(panel(harness, "active").querySelector("[data-site-chart]")).toBeNull();
    });

    it("有上报而没有一份带使用统计：版本照常画，错误、崩溃、升级写没有带使用统计的上报", async () => {
        const harness = await openDashboard("/admin", {...DATA, problems: EMPTY_DASHBOARD.problems});
        await vi.waitFor(() => expect(states(harness)).toEqual({...allReady, errors: "empty", crashes: "empty", upgrades: "empty"}));
        expect(panel(harness, "versions").textContent).toContain("0.15.0");
        for (const id of ["errors", "crashes", "upgrades"] as const) expect({id, text: panel(harness, id).textContent}).toEqual({id, text: expect.stringContaining(text.noUsageReports)});
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

    it("在线图读屏的概括按数据的分段写", async () => {
        const harness = await openDashboard("/admin", {...DATA, online: {...DATA.online, segmentMinutes: 30}});
        await vi.waitFor(() => expect(panel(harness, "online").querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.online.label, {minutes: 30})));
        const fifteen = await openDashboard("/admin", {...DATA, online: {...DATA.online, segmentMinutes: 15, segmentCount: 96}});
        await vi.waitFor(() => expect(panel(fifteen, "online").querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.online.label, {minutes: 15})));
    });
});

describe("出错", () => {
    it("一块取不到：只有那几块写原因与重试，别的照常；页面一处播报几块取不到；点重试再取，成功后画出来", async () => {
        let up = false;
        const harness = await openDashboard("/admin", DATA, {
            [`GET ${DASHBOARD_PATHS.problems}`]: () => (up ? Response.json(DATA.problems) : failure({error: {code: "unavailable"}}, 503)),
        });
        await vi.waitFor(() => expect(states(harness)).toEqual({...allReady, errors: "failed", crashes: "failed", upgrades: "failed"}));

        const errors = panel(harness, "errors");
        expect(errors.textContent).toContain(zhCN.errors.telemetry.unavailable);
        // 错误、崩溃、升级出自同一个请求，三块一起失败：播报一句，不在每块面板里各念一遍。
        expect(summary(harness)).toBe(fill(text.failedSummary, {count: 3}));
        expect(harness.target.querySelectorAll('[role="alert"]')).toHaveLength(0);
        // 三个重试按钮的读屏名字带各自面板的标题。
        expect((["errors", "crashes", "upgrades"] as const).map((id) => retryButton(harness, id)?.getAttribute("aria-label"))).toEqual(
            [text.errors.title, text.crashes.title, text.upgrades.title].map((title) => fill(text.retryPanel, {panel: title})),
        );
        expect(gets(harness, DASHBOARD_PATHS.problems)).toBe(1);

        up = true;
        retryButton(harness, "errors")!.click();
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));
        expect(gets(harness, DASHBOARD_PATHS.problems)).toBe(2);
        expect(summary(harness)).toBe("");
    });

    it("点了重试：原因留着、按钮转圈不可再点，200 毫秒后换成转圈；又失败时按钮恢复", async () => {
        let retry: ReturnType<typeof held> | undefined;
        const harness = await openDashboard("/admin", DATA, {
            [`GET ${DASHBOARD_PATHS.online}`]: (...args) => (retry === undefined ? failure({error: {code: "unavailable"}}, 503) : retry.handler(...args)),
        });
        await vi.waitFor(() => expect(panel(harness, "online").getAttribute("data-site-panel-state")).toBe("failed"));
        expect(summary(harness)).toBe(fill(text.failedSummary, {count: 1}));

        retry = held(() => failure({error: {code: "unavailable"}}, 503));
        retryButton(harness, "online")!.click();
        await vi.waitFor(() => expect(retry!.asked).toBe(true));
        const online = panel(harness, "online");
        await vi.waitFor(() => expect(online.getAttribute("data-site-panel-state")).toBe("loading"));
        expect(online.textContent).toContain(zhCN.errors.telemetry.unavailable);
        expect(retryButton(harness, "online")?.disabled).toBe(true);
        expect(retryButton(harness, "online")?.getAttribute("aria-busy")).toBe("true");
        // 重取期间没有“有几块取不到”的说法：结果还没出来。
        expect(summary(harness)).toBe("");

        harness.clock.advance(200);
        await vi.waitFor(() => expect(online.querySelector('[role="status"]')).not.toBeNull());
        await vi.waitFor(() => expect(retryButton(harness, "online")).toBeNull());

        retry.release();
        await vi.waitFor(() => expect(online.getAttribute("data-site-panel-state")).toBe("failed"));
        await vi.waitFor(() => expect(retryButton(harness, "online")?.disabled).toBe(false));
        expect(summary(harness)).toBe(fill(text.failedSummary, {count: 1}));
        expect(gets(harness, DASHBOARD_PATHS.online)).toBe(2);
    });

    it("服务的码目录里没有时也有字可显示：通用文案带上码", async () => {
        const harness = await openDashboard("/admin", DATA, {[`GET ${DASHBOARD_PATHS.online}`]: () => Response.json({error: {code: "query_timeout"}}, {status: 500})});
        await vi.waitFor(() => expect(panel(harness, "online").getAttribute("data-site-panel-state")).toBe("failed"));
        expect(panel(harness, "online").textContent).toContain(fill(zhCN.errors.web.unknown, {code: "query_timeout"}));
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

    it("重取时上一份图留着，200 毫秒后盖一层遮罩、遮罩下不可操作；新数据到了换上", async () => {
        const week = held(() => Response.json(DATA.active[7]));
        const harness = await openDashboard("/admin", DATA, {[`GET ${DASHBOARD_PATHS.active(7)}`]: week.handler});
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));
        const active = panel(harness, "active");

        rangeButton(harness, 7).click();
        await vi.waitFor(() => expect(week.asked).toBe(true));
        const content = (): HTMLElement | null => active.querySelector<HTMLElement>("[data-site-panel-content]");
        expect(active.getAttribute("aria-busy")).toBe("true");
        expect(active.querySelector('[role="status"]')).toBeNull();

        harness.clock.advance(200);
        await vi.waitFor(() => expect(active.querySelector('[role="status"]')).not.toBeNull());
        expect(active.querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.active.label, {days: 28}));
        expect(content()?.hasAttribute("inert")).toBe(true);

        week.release();
        await vi.waitFor(() => expect(active.querySelector("[data-site-chart]")?.getAttribute("aria-label")).toBe(fill(text.active.label, {days: 7})));
        await vi.waitFor(() => expect(active.querySelector('[role="status"]')).toBeNull());
        expect(content()?.hasAttribute("inert")).toBe(false);
    });

    it("连换两次范围：先发的回答晚到时丢掉，图停在后选的范围", async () => {
        const quarter = held(() => Response.json(DATA.active[90]));
        const harness = await openDashboard("/admin", DATA, {[`GET ${DASHBOARD_PATHS.active(90)}`]: quarter.handler});
        await vi.waitFor(() => expect(states(harness)).toEqual(allReady));
        const label = (): string | null | undefined => panel(harness, "active").querySelector("[data-site-chart]")?.getAttribute("aria-label");

        rangeButton(harness, 90).click();
        await vi.waitFor(() => expect(quarter.asked).toBe(true));
        rangeButton(harness, 7).click();
        await vi.waitFor(() => expect(label()).toBe(fill(text.active.label, {days: 7})));

        // 90 天的回答这时才到：等页面把它读完，再让出一轮事件循环，它若被写回，图此时已换成 90 天。
        quarter.release();
        await vi.waitFor(() => expect(quarter.answered).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(label()).toBe(fill(text.active.label, {days: 7}));
        expect(rangeButton(harness, 7).getAttribute("aria-checked")).toBe("true");
        expect(panel(harness, "active").getAttribute("aria-busy")).toBe("false");
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
