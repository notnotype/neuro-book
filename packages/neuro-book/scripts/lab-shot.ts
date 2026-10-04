#!/usr/bin/env node
/**
 * Component Lab 截图与溢出检查（ui.component-lab 场景 14）：按组件、场景、画布尺寸、配色批量截取舞台，并输出 JSON 报告。
 * Lab 只在开发模式加载，所以对着 `bun run dev` 的页面地址运行：
 *
 *   bun run lab:shot -- -c SkillChip --url http://127.0.0.1:3000/
 *
 * 只依赖 Lab 的 URL 参数（c、s、vp、cw、theme）、舞台标记 `data-lab-stage` 和 `window.__nbLab` 调试接口，
 * 不点击 Lab 外壳的按钮，外壳改版不影响本脚本。由 Node 运行（Node 直接执行 TypeScript）：Bun 下 Playwright 连接浏览器
 * 的握手会超时。
 */
import {mkdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {chromium} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";

import type {LabDebugApi, LabStageMeasure} from "../src/plugins/lab/shared/debug-api.ts";
import {parseLabViewport} from "../src/plugins/lab/web/lab-url.ts";

const USAGE = `用法：bun run lab:shot -- --component <组件名> [选项]

  --url <地址>                 Lab 所在的开发服务；默认取 NB_LAB_URL，再默认 http://127.0.0.1:3000
  --component, -c <名称>       组件名，必填
  --scene, -s <id,...>         场景 id，逗号分隔；默认全部场景
  --vp <尺寸,...>              画布尺寸：phone、tablet、free 或 宽x高；默认 phone,free
  --cw <配色,...>              配色：light、dark 或配色 id；默认沿用 Lab 当前配色
  --theme <主题 id>            Lab 主题
  --window <宽x高>             浏览器窗口，默认 1600x1000；vp=free 时画布随它
  --click <选择器>             截图前依次点击舞台内的元素，可重复
  --wait <毫秒>                点击后、截图前等待，默认 300
  --scale <倍数>               设备像素比，默认 1
  --out <目录>                 输出目录；默认系统临时根下的 browser/lab-shot/<时间戳>
  --browser-executable <路径>  浏览器可执行文件；默认用本机 Chrome
  --no-fail                    有溢出或页面错误时也以 0 退出`;

type ShotOptions = {
    url: string;
    component: string;
    scenes: string[] | "all";
    viewports: string[];
    colorways: Array<string | null>;
    theme: string | null;
    windowSize: {width: number; height: number};
    clicks: string[];
    waitMs: number;
    scale: number;
    out: string;
    browserExecutable: string | null;
    fail: boolean;
};

export type ShotResult = {
    component: string;
    scene: string;
    viewport: string;
    colorway: string | null;
    file: string;
    measure: LabStageMeasure | null;
    /** pageerror 与 console 的 error / warning。 */
    problems: string[];
};

declare global {
    interface Window {
        __nbLab?: LabDebugApi;
    }
}

export async function runLabShot(options: ShotOptions): Promise<ShotResult[]> {
    let browser: Browser | null = null;
    try {
        browser = await chromium.launch(options.browserExecutable === null
            ? {channel: "chrome", headless: true}
            : {executablePath: resolve(options.browserExecutable), headless: true});
        const context = await browser.newContext({viewport: options.windowSize, deviceScaleFactor: options.scale});
        // 每个组合用一个新标签页：同一标签页连续导航到开发服务，第七次左右会停在空白页不再启动应用，
        // 新标签页没有这个问题；页面问题也因此按组合天然隔离。
        const withPage = async <T>(run: (page: Page, problems: string[]) => Promise<T>): Promise<T> => {
            const page = await context.newPage();
            const problems: string[] = [];
            page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
            page.on("console", (message) => {
                if (message.type() === "error" || message.type() === "warning") {
                    problems.push(`${message.type()}: ${message.text()}`);
                }
            });
            try {
                return await run(page, problems);
            } finally {
                await page.close();
            }
        };

        const scenes = options.scenes === "all" ? await withPage((page) => listScenes(page, options)) : options.scenes;
        await mkdir(options.out, {recursive: true});
        const results: ShotResult[] = [];
        for (const scene of scenes) {
            for (const viewport of options.viewports) {
                for (const colorway of options.colorways) {
                    results.push(await withPage(async (page, problems) => ({
                        ...await shoot(page, options, scene, viewport, colorway),
                        problems: [...problems],
                    })));
                }
            }
        }
        await writeFile(join(options.out, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
        return results;
    } finally {
        await browser?.close();
    }
}

function labUrl(options: ShotOptions, scene: string | null, viewport: string | null, colorway: string | null): string {
    const url = new URL("/lab", options.url);
    url.searchParams.set("c", options.component);
    if (scene !== null) url.searchParams.set("s", scene);
    if (viewport !== null) url.searchParams.set("vp", viewport);
    if (colorway !== null) url.searchParams.set("cw", colorway);
    if (options.theme !== null) url.searchParams.set("theme", options.theme);
    return url.href;
}

async function openLab(page: Page, url: string, component: string, scene: string | null): Promise<void> {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 180_000});
    // 开发服务首次打开要编译，等待放宽；就绪以调试接口为准，不看外壳文字。
    try {
        await page.waitForFunction(({component, scene}) => {
            const state = window.__nbLab?.state();
            return state !== undefined && state.component === component && (scene === null || state.scene === scene)
                && (state.ready || state.loadError !== "");
        }, {component, scene}, {timeout: 120_000});
    } catch (error) {
        const snapshot = await page.evaluate(() => ({
            href: location.href,
            state: window.__nbLab?.state() ?? null,
            text: document.body?.innerText.slice(0, 200) ?? "",
        })).catch((reason: unknown) => ({error: String(reason)}));
        throw new Error(`等待 Lab 就绪超时：${url}\n页面：${JSON.stringify(snapshot)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}

async function listScenes(page: Page, options: ShotOptions): Promise<string[]> {
    await openLab(page, labUrl(options, null, null, null), options.component, null);
    const scenes = await page.evaluate(() => window.__nbLab?.scenes() ?? []);
    if (scenes.length === 0) {
        throw new Error(`组件 ${options.component} 没有可截图的场景（不存在、不可挂载或未登记场景）`);
    }
    return scenes.map((scene) => scene.id);
}

/** Lab 左右两栏与画布四周留白的大致尺寸；窗口至少要比固定画布大这么多，舞台才不会被检视栏盖住。 */
const LAB_CHROME = {width: 900, height: 260};

async function shoot(page: Page, options: ShotOptions, scene: string, viewport: string, colorway: string | null): Promise<Omit<ShotResult, "problems">> {
    const canvas = parseLabViewport(viewport);
    if (canvas !== undefined && canvas.width > 0) {
        await page.setViewportSize({
            width: Math.max(options.windowSize.width, canvas.width + LAB_CHROME.width),
            height: Math.max(options.windowSize.height, canvas.height + LAB_CHROME.height),
        });
    }
    await openLab(page, labUrl(options, scene, viewport, colorway), options.component, scene);
    const loadError = await page.evaluate(() => window.__nbLab?.state().loadError ?? "");
    if (loadError !== "") {
        throw new Error(`${options.component}/${scene} 加载失败：${loadError}`);
    }
    // 场景切换带淡入淡出：等旧舞台退场、只剩一个舞台。
    await page.waitForFunction(() => document.querySelectorAll("[data-lab-stage]").length === 1, undefined, {timeout: 10_000});
    await page.evaluate(() => document.fonts.ready);
    for (const selector of options.clicks) {
        await page.locator(`[data-lab-stage] ${selector}`).first().click({timeout: 10_000});
    }
    await page.waitForTimeout(options.waitMs);
    const measure = await page.evaluate(() => window.__nbLab?.measure() ?? null);
    const name = [options.component, scene, viewport, colorway ?? "current"].join("__").replace(/[^\w.-]+/gu, "-");
    const file = join(options.out, `${name}.png`);
    await page.locator("[data-lab-stage]").screenshot({path: file});
    return {component: options.component, scene, viewport, colorway, file, measure};
}

function list(value: string): string[] {
    return value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

function parseSize(value: string, flag: string): {width: number; height: number} {
    const match = /^(\d+)x(\d+)$/u.exec(value);
    if (match === null) throw new Error(`${flag} 需要 宽x高，收到：${value}`);
    return {width: Number(match[1]), height: Number(match[2])};
}

export function parseShotArgs(args: readonly string[], env: NodeJS.ProcessEnv = process.env): ShotOptions {
    const options: ShotOptions = {
        url: env.NB_LAB_URL ?? "http://127.0.0.1:3000",
        component: "",
        scenes: "all",
        viewports: ["phone", "free"],
        colorways: [null],
        theme: null,
        windowSize: {width: 1600, height: 1000},
        clicks: [],
        waitMs: 300,
        scale: 1,
        out: "",
        browserExecutable: null,
        fail: true,
    };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index]!;
        if (flag === "--no-fail") {
            options.fail = false;
            continue;
        }
        if (flag === "--help" || flag === "-h") {
            throw new Error(USAGE);
        }
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error(`${flag} 缺少取值\n\n${USAGE}`);
        index += 1;
        switch (flag) {
            case "--url": options.url = new URL(value).href; break;
            case "--component": case "-c": options.component = value; break;
            case "--scene": case "-s": options.scenes = list(value); break;
            case "--vp": options.viewports = list(value); break;
            case "--cw": options.colorways = list(value); break;
            case "--theme": options.theme = value; break;
            case "--window": options.windowSize = parseSize(value, flag); break;
            case "--click": options.clicks.push(value); break;
            case "--wait": options.waitMs = Number(value); break;
            case "--scale": options.scale = Number(value); break;
            case "--out": options.out = resolve(value); break;
            case "--browser-executable": options.browserExecutable = value; break;
            default: throw new Error(`未知参数：${flag}\n\n${USAGE}`);
        }
    }
    if (options.component === "") throw new Error(`缺少 --component\n\n${USAGE}`);
    if (options.out === "") {
        options.out = resolveAgentScratchPath("browser", "lab-shot", new Date().toISOString().replace(/[:.]/gu, "-"));
    }
    return options;
}

/** 有溢出、越界元素或页面错误的结果。 */
export function failedShots(results: readonly ShotResult[]): ShotResult[] {
    return results.filter((result) => result.problems.length > 0
        || (result.measure !== null && (result.measure.overflowX > 0 || result.measure.offenders.length > 0)));
}

function summarize(result: ShotResult): string {
    const measure = result.measure;
    const overflow = measure === null ? "无舞台" : `溢出 ${measure.overflowX}px，越界元素 ${measure.offenders.length} 个`;
    const lines = [`${result.scene} · ${result.viewport} · ${result.colorway ?? "当前配色"}：${overflow}，问题 ${result.problems.length} 条 → ${result.file}`];
    for (const offender of measure?.offenders ?? []) lines.push(`    越界 ${offender.overflow}px ${offender.componentName} ${offender.selector}`);
    for (const problem of result.problems) lines.push(`    ${problem.split("\n")[0]}`);
    return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const options = parseShotArgs(process.argv.slice(2));
        const results = await runLabShot(options);
        results.forEach((result) => console.log(summarize(result)));
        console.log(`报告：${join(options.out, "report.json")}`);
        if (options.fail && failedShots(results).length > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
