/**
 * 管理面板与看板的浏览器场景（t10 计划 3.5、3.13）：构建产物加假接口（`fake-api.ts`，数据在 `fixtures/dashboard.ts`），以管理员的会话
 * 打开 `/admin`，量 happy-dom 量不了的：两张 ECharts 图真的画在 canvas 上、鼠标停上去的提示框、换明暗之后重画、容器变宽之后跟着变、
 * 减弱动效下第一次就画完整；1440 与 1024 两种桌面宽、亮暗两种明暗下没有页面级的横向滚动；面板在加载、没有数据、出错、有数据
 * 四种状态下高度不变；暗色两组图表色对面板底的对比度。面板的状态、请求与地址在 `src/pages/admin/DashboardPage.dom.test.ts`。
 */

import {readFileSync} from "node:fs";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {DASHBOARD_PATHS} from "../src/pages/admin/dashboard/source";
import {dashboardSucceeds, EMPTY_DASHBOARD_BODIES, fails, installFakeIdentity} from "./fake-api";
import type {FakeAnswer, FakeIdentity} from "./fake-api";
import {dashboardActive, MISSING_DAYS, ZERO_DAY} from "./fixtures/dashboard";
import {box, boxes} from "./geometry";

const zhCN = JSON.parse(readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8")) as {
    readonly admin: {readonly dashboard: {readonly noReports: string; readonly active: {readonly daily: string; readonly weekly: string; readonly monthly: string}}};
};

const PANELS = ["today", "active", "online", "versions", "systems", "retention", "errors", "crashes", "upgrades"] as const;
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];
/** 1440 是定稿的宽度；1024 是常见的窄一些的桌面宽，内容区不到 880 像素，各排改成一列。 */
const VIEWPORTS = [{name: "1440", width: 1440, height: 900}, {name: "1024", width: 1024, height: 768}] as const;
/** 活跃图的绘图区离容器左右边的距离（`charts/options.ts` 的 `grid`）。 */
const ACTIVE_GRID = {left: 48, right: 76};

let fake: FakeIdentity;

test.afterEach(() => {
    expect(fake.unexpected).toEqual([]);
});

/** 过渡都跑完了。转圈是无限循环的动画，不算在内。 */
async function settled(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState !== "finished" && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
}

/** 以管理员的会话打开看板，等每块面板都画出来、两张图按这种明暗画完。 */
async function openDashboard(page: Page, viewport: {readonly width: number; readonly height: number}, scheme: Scheme, path = "/admin"): Promise<void> {
    await page.setViewportSize(viewport);
    await page.emulateMedia({colorScheme: scheme});
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", scheme);
    for (const id of PANELS) await expect(page.locator(`[data-site-dashboard-panel="${id}"]`)).toHaveAttribute("data-site-panel-state", "ready");
    for (const id of ["active", "online"]) await expect(page.locator(`[data-site-chart="${id}"]`)).toHaveAttribute("data-chart-appearance", scheme);
    await settled(page);
}

async function canvasSize(page: Page, chart: string): Promise<{readonly width: number; readonly height: number; readonly hostWidth: number}> {
    return page.locator(`[data-site-chart="${chart}"]`).evaluate((host) => {
        const canvas = host.querySelector("canvas");
        return {width: canvas?.getBoundingClientRect().width ?? 0, height: canvas?.getBoundingClientRect().height ?? 0, hostWidth: host.getBoundingClientRect().width};
    });
}

/** 页面与内容区横向多出来的像素（没有多出来时是 0）。 */
async function horizontalOverflow(page: Page): Promise<{readonly page: number; readonly main: number}> {
    return page.evaluate(() => {
        const main = document.querySelector("main")!;
        const root = document.documentElement;
        return {page: Math.max(0, root.scrollWidth - root.clientWidth), main: Math.max(0, main.scrollWidth - main.clientWidth)};
    });
}

/** 鼠标停在活跃图的第 `index` 天上。 */
async function hoverActiveDay(page: Page, index: number, days: number): Promise<void> {
    const host = await box(page, '[data-site-chart="active"]');
    const left = host.x + ACTIVE_GRID.left;
    const right = host.x + host.width - ACTIVE_GRID.right;
    const x = left + (index * (right - left)) / (days - 1);
    // 先移到图外：提示框跟着鼠标，从别处移进来才是一次新的停留。
    await page.mouse.move(host.x - 40, host.y - 40);
    await page.mouse.move(x, host.y + host.height / 2);
}

const tooltip = (page: Page) => page.locator('[data-site-chart="active"] [data-site-chart-tooltip]');

const count = (value: number): string => new Intl.NumberFormat("zh-CN").format(value);

/** 活跃图近 28 天里第 `index` 天的日期与三个数，按提示框的写法。 */
function activeDay(index: number): {readonly label: string; readonly values: readonly string[]} {
    const series = dashboardActive[28];
    const date = new Date(Date.parse(`${series.from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
    const day = series.days.find((entry) => entry.date === date);
    const values = day === undefined ? [zhCN.admin.dashboard.noReports, zhCN.admin.dashboard.noReports, zhCN.admin.dashboard.noReports] : [count(day.daily), count(day.weekly), count(day.monthly)];
    return {label: date.slice(5), values};
}

const dayIndex = (date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dashboardActive[28].from}T00:00:00Z`)) / 86_400_000);

/** 提示框里的标题与三行的数，与每行色块的颜色、提示框的底色。 */
async function readTooltip(page: Page): Promise<{readonly title: string; readonly values: string[]; readonly keys: string[]; readonly surface: string}> {
    return tooltip(page).evaluate((root) => {
        const [title, ...rows] = [...root.children] as HTMLElement[];
        return {
            title: title?.textContent ?? "",
            values: rows.map((row) => row.lastElementChild?.textContent ?? ""),
            keys: rows.map((row) => getComputedStyle(row.firstElementChild!).backgroundColor),
            surface: getComputedStyle(root.parentElement!).backgroundColor,
        };
    });
}

for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
        test(`${viewport.name} 宽、${scheme === "light" ? "亮色" : "暗色"}：两张图画在 canvas 上，页面与内容区都不横向滚动，左栏 216 像素`, async ({page}) => {
            fake = await installFakeIdentity(page, {session: "admin"});
            await openDashboard(page, viewport, scheme);
            for (const chart of ["active", "online"]) {
                const size = await canvasSize(page, chart);
                expect(size.width, chart).toBeGreaterThan(0);
                expect(size.height, chart).toBeGreaterThan(0);
                expect(Math.abs(size.width - size.hostWidth), chart).toBeLessThan(1);
            }
            expect(await horizontalOverflow(page)).toEqual({page: 0, main: 0});
            expect((await box(page, "[data-site-admin-shell] > nav")).width).toBe(216);
        });
    }
}

test("鼠标停在活跃图上：提示框写那一天的日期与三条线的数；没有上报的那天写“没有上报”，为 0 的那天写 0", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openDashboard(page, VIEWPORTS[0], "light");
    const days = dashboardActive[28].days.length + MISSING_DAYS.length;

    for (const index of [3, dayIndex(MISSING_DAYS[0]), dayIndex(ZERO_DAY), days - 1]) {
        await hoverActiveDay(page, index, days);
        await expect(tooltip(page)).toBeVisible();
        const expected = activeDay(index);
        await expect.poll(async () => {
            const read = await readTooltip(page);
            return {title: read.title, values: read.values};
        }).toEqual({title: expected.label, values: expected.values});
    }
    expect(activeDay(dayIndex(ZERO_DAY)).values[0]).toBe("0");
});

test("换成暗色：两张图按暗色重画，提示框的底色与色块跟着换", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openDashboard(page, VIEWPORTS[0], "light");
    await hoverActiveDay(page, 5, 28);
    await expect(tooltip(page)).toBeVisible();
    const light = await readTooltip(page);

    await page.emulateMedia({colorScheme: "dark"});
    for (const id of ["active", "online"]) await expect(page.locator(`[data-site-chart="${id}"]`)).toHaveAttribute("data-chart-appearance", "dark");
    await hoverActiveDay(page, 5, 28);
    await expect(tooltip(page)).toBeVisible();
    const dark = await readTooltip(page);
    const panel = await page.locator('[data-site-dashboard-panel="active"]').evaluate((element) => getComputedStyle(element).backgroundColor);

    expect(dark.title).toBe(light.title);
    expect(dark.surface).not.toBe(light.surface);
    expect(dark.surface).toBe(panel);
    expect(dark.keys).toHaveLength(3);
    for (const [index, key] of dark.keys.entries()) expect(key, `第 ${index + 1} 条线`).not.toBe(light.keys[index]);
});

test("窗口变宽：图跟着变宽，画布始终与容器一样宽", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openDashboard(page, {width: 1200, height: 900}, "light");
    const narrow = await canvasSize(page, "active");

    await page.setViewportSize({width: 1440, height: 900});
    await expect.poll(async () => (await canvasSize(page, "active")).width).toBeGreaterThan(narrow.width + 100);
    const wide = await canvasSize(page, "active");
    expect(Math.abs(wide.width - wide.hostWidth)).toBeLessThan(1);
});

test("减弱动效：第一次画出来就是整条线，不从左往右展开", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    // 第一次画完（`data-chart-appearance` 写上）之后再等两帧，看绘图区最右一段有没有序列色的像素。放动画时线从左往右展开、
    // 要一秒才到头，这时最右一段还是空的；不放动画时已经画到头了。观察器在页面脚本之前装上，免得错过第一次画。
    await page.addInitScript(() => {
        const record = window as unknown as {firstDraw?: Promise<{readonly hits: number; readonly columns: number}>};
        record.firstDraw = new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const host = document.querySelector<HTMLElement>('[data-site-chart="active"][data-chart-appearance]');
                if (host === null) return;
                observer.disconnect();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const canvas = host.querySelector("canvas")!;
                    const scale = canvas.width / canvas.getBoundingClientRect().width;
                    const style = getComputedStyle(host);
                    const probe = document.createElement("canvas").getContext("2d")!;
                    const rgb = (color: string): number[] => {
                        probe.fillStyle = color;
                        probe.fillRect(0, 0, 1, 1);
                        return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
                    };
                    const series = [1, 2, 3].map((index) => rgb(style.getPropertyValue(`--site-viz-${index}`).trim()));
                    const context = canvas.getContext("2d")!;
                    // 绘图区最右 24 像素宽的一条（绘图区右边离容器 76 像素）。
                    const right = Math.round((canvas.getBoundingClientRect().width - 76) * scale);
                    const columns = Math.round(24 * scale);
                    const image = context.getImageData(right - columns, 0, columns, canvas.height).data;
                    let hits = 0;
                    for (let offset = 0; offset < image.length; offset += 4) {
                        const pixel = [image[offset]!, image[offset + 1]!, image[offset + 2]!];
                        if (series.some((color) => color.every((channel, index) => Math.abs(channel - pixel[index]!) <= 24))) hits += 1;
                    }
                    resolve({hits, columns});
                }));
            });
            observer.observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ["data-chart-appearance"]});
        });
    });
    await page.setViewportSize(VIEWPORTS[0]);
    await page.emulateMedia({colorScheme: "light", reducedMotion: "reduce"});
    await page.goto("/admin");
    const first = await page.evaluate(() => (window as unknown as {firstDraw: Promise<{readonly hits: number; readonly columns: number}>}).firstDraw);
    expect(first.columns).toBeGreaterThan(0);
    expect(first.hits).toBeGreaterThan(0);
});

test("面板在加载、没有数据、出错、有数据四种状态下高度相同", async ({page}) => {
    const pending: (() => void)[] = [];
    fake = await installFakeIdentity(page, {session: "admin"});
    await page.setViewportSize(VIEWPORTS[0]);
    await page.emulateMedia({colorScheme: "light"});

    const heights = async (state: string): Promise<Record<string, number>> => {
        for (const id of PANELS) await expect(page.locator(`[data-site-dashboard-panel="${id}"]`), id).toHaveAttribute("data-site-panel-state", state === "empty" && id === "today" ? "ready" : state);
        await settled(page);
        const measured = await boxes(page, "[data-site-dashboard-panel]");
        return Object.fromEntries(PANELS.map((id, index) => [id, measured[index]!.height]));
    };

    // 加载：回答一直不来，等它转圈。
    fake.dashboard = () => new Promise<FakeAnswer>((resolve) => {
        pending.push(() => resolve({status: 503, body: {error: {code: "unavailable"}}}));
    });
    await page.goto("/admin");
    await expect(page.locator('[data-site-dashboard-panel="active"] [role="status"]')).toBeVisible();
    const loading = await heights("loading");

    fake.dashboard = dashboardSucceeds(EMPTY_DASHBOARD_BODIES);
    await page.reload();
    const empty = await heights("empty");

    fake.dashboard = fails(503, {error: {code: "unavailable"}});
    await page.reload();
    const failed = await heights("failed");

    fake.dashboard = dashboardSucceeds();
    await page.reload();
    const ready = await heights("ready");

    expect({empty, failed, ready}).toEqual({empty: loading, failed: loading, ready: loading});
    for (const release of pending) release();
});

test("走到空壳页再回来：外壳不动，看板的两张图重新画出来", async ({page}) => {
    fake = await installFakeIdentity(page, {session: "admin"});
    await openDashboard(page, VIEWPORTS[0], "light");
    const nav = await box(page, "[data-site-admin-shell] > nav");

    await page.locator('[data-site-admin-nav="admin-users"]').click();
    await expect(page.locator('[data-site-page="admin-users"]')).toBeVisible();
    expect(await box(page, "[data-site-admin-shell] > nav")).toEqual(nav);

    await page.locator('[data-site-admin-nav="admin-dashboard"]').click();
    for (const id of ["active", "online"]) await expect(page.locator(`[data-site-chart="${id}"]`)).toHaveAttribute("data-chart-appearance", "light");
    expect((await canvasSize(page, "active")).width).toBeGreaterThan(0);
    expect(fake.dashboardRequests.filter((path) => path === DASHBOARD_PATHS.active(28))).toHaveLength(2);
});

test.describe("图表色对面板底的对比度", () => {
    /** WCAG 的相对亮度对比度，两个颜色都是不透明的 sRGB 分量。 */
    function ratio(a: readonly number[], b: readonly number[]): number {
        const luminance = (rgb: readonly number[]): number => {
            const [r, g, bl] = rgb.map((channel) => {
                const value = channel / 255;
                return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
        };
        const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (high! + 0.05) / (low! + 0.05);
    }

    /** 面板底色、三条序列色与错误一块表头的五档红，在页面里用画布合成成不透明的 sRGB。 */
    async function colors(page: Page): Promise<{readonly panel: number[]; readonly series: number[][]; readonly ramp: number[][]}> {
        return page.evaluate(() => {
            const probe = document.createElement("canvas").getContext("2d")!;
            const over = (...layers: string[]): number[] => {
                probe.clearRect(0, 0, 1, 1);
                for (const layer of layers) {
                    probe.fillStyle = layer;
                    probe.fillRect(0, 0, 1, 1);
                }
                return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
            };
            const panel = getComputedStyle(document.querySelector('[data-site-dashboard-panel="errors"]')!).backgroundColor;
            const chart = getComputedStyle(document.querySelector('[data-site-chart="active"]')!);
            return {
                panel: over(panel),
                series: [1, 2, 3].map((index) => over(panel, chart.getPropertyValue(`--site-viz-${index}`).trim())),
                ramp: [...document.querySelectorAll<HTMLElement>("[data-site-error-swatch]")].map((swatch) => over(panel, getComputedStyle(swatch).backgroundColor)),
            };
        });
    }

    test("暗色三条序列色都过 3:1；两种明暗下五档红对面板底由弱到强、相邻两档分得开", async ({page}) => {
        fake = await installFakeIdentity(page, {session: "admin"});
        const measured: Record<string, {series: number[]; ramp: number[]; adjacent: number[]}> = {};
        for (const scheme of SCHEMES) {
            await openDashboard(page, VIEWPORTS[0], scheme);
            const {panel, series, ramp} = await colors(page);
            expect(ramp).toHaveLength(5);
            measured[scheme] = {
                series: series.map((color) => ratio(color, panel)),
                ramp: ramp.map((color) => ratio(color, panel)),
                adjacent: ramp.slice(1).map((color, index) => ratio(color, ramp[index]!)),
            };
        }
        const round = (values: number[]): number[] => values.map((value) => Math.round(value * 100) / 100);
        console.info(Object.entries(measured).map(([scheme, {series, ramp, adjacent}]) => `${scheme}：序列色 ${round(series).join("、")}；五档红 ${round(ramp).join("、")}；相邻 ${round(adjacent).join("、")}`).join("\n"));

        // 图形的下限 3:1（WCAG 1.4.11）。亮色的绿是 t09 定的值，量到约 2.75，不在这条里（见交付说明）。
        for (const value of measured.dark!.series) expect(value).toBeGreaterThanOrEqual(3);
        for (const scheme of SCHEMES) {
            const {ramp, adjacent} = measured[scheme]!;
            // 次数越多越醒目：对面板底的对比度逐档变大。
            expect(ramp, scheme).toEqual([...ramp].sort((a, b) => a - b));
            // 相邻两档之间至少差 1.3 倍，看得出是两档。
            for (const value of adjacent) expect(value, scheme).toBeGreaterThanOrEqual(1.3);
        }
    });
});
