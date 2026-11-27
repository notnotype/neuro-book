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
  --media <偏好,...>           系统偏好：reduced-motion、reduced-transparency，逗号分隔；每种单独一组截图
  --text-spacing               另量一次加大文字间距（WCAG 1.4.12）后被裁掉的文字，只报告
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
    /** 模拟的系统偏好；null 是不模拟。 */
    media: Array<LabMedia | null>;
    textSpacing: boolean;
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
    media: LabMedia | null;
    file: string;
    measure: LabStageMeasure | null;
    /** `--text-spacing` 时：注入 WCAG 1.4.12 的四项间距之后的越界元素与被裁掉的文字；只报告。 */
    textSpacing: Pick<LabStageMeasure, "offenders" | "clippedText"> | null;
    /** pageerror 与 console 的 error / warning。 */
    problems: string[];
};

export type LabMedia = "reduced-motion" | "reduced-transparency";
const MEDIA_FEATURE: Record<LabMedia, string> = {"reduced-motion": "prefers-reduced-motion", "reduced-transparency": "prefers-reduced-transparency"};

/** WCAG 1.4.12 的四项：行高 1.5 倍、段后 2 倍、字距 0.12 倍、词距 0.16 倍字号。 */
const TEXT_SPACING_CSS = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;

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
                    for (const media of options.media) {
                        results.push(await withPage(async (page, problems) => ({
                            ...await shoot(page, options, scene, viewport, colorway, media),
                            problems: [...problems],
                        })));
                    }
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

/** 等 Lab 的结果：就绪（或 fixture 加载失败，由调用方看 loadError），或者要截的组件、场景不在 Lab 的清单里。 */
type LabWait =
    | {kind: "ready"}
    | {kind: "unknown_component"; components: string[]}
    | {kind: "unknown_scene"; scenes: string[]};

/** 不在清单里时报错列出的组件个数：清单有上百个，全列会淹没提示。 */
const LISTED_COMPONENTS = 15;
const RESTART_HINT = "开发服务运行中新建的组件文件或场景，要重启开发服务才进清单";

async function openLab(page: Page, url: string, component: string, scene: string | null): Promise<void> {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 180_000});
    // 开发服务首次打开要编译，等待放宽；就绪以调试接口为准，不看外壳文字。
    let outcome: LabWait | false;
    try {
        const handle = await page.waitForFunction(({component, scene}): LabWait | false => {
            const lab = window.__nbLab;
            if (lab === undefined) return false;
            // 清单在 Lab 挂载时就是全的（组件索引与 fixture 都是静态导入）。不在清单里的组件或场景，Lab 会退回别的，
            // 下面的就绪条件永远等不到，所以立即返回，不等到超时。
            const components = lab.components();
            if (!components.includes(component)) return {kind: "unknown_component", components};
            if (scene !== null) {
                const scenes = lab.scenes(component).map((entry) => entry.id);
                if (!scenes.includes(scene)) return {kind: "unknown_scene", scenes};
            }
            const state = lab.state();
            return state.component === component && (scene === null || state.scene === scene)
                && (state.ready || state.loadError !== "") ? {kind: "ready"} : false;
        }, {component, scene}, {timeout: 120_000});
        outcome = await handle.jsonValue();
    } catch (error) {
        const snapshot = await page.evaluate(() => ({
            href: location.href,
            state: window.__nbLab?.state() ?? null,
            text: document.body?.innerText.slice(0, 200) ?? "",
        })).catch((reason: unknown) => ({error: String(reason)}));
        throw new Error(`等待 Lab 就绪超时：${url}\n页面：${JSON.stringify(snapshot)}\n${error instanceof Error ? error.message : String(error)}`);
    }
    // waitForFunction 只在返回真值时 resolve，这一行只为把类型收窄到 LabWait。
    if (outcome === false) throw new Error(`等待 Lab 就绪的结果为空：${url}`);
    if (outcome.kind === "unknown_component") {
        const listed = outcome.components.slice(0, LISTED_COMPONENTS).join("、");
        const more = outcome.components.length > LISTED_COMPONENTS ? ` 等 ${outcome.components.length} 个` : "";
        throw new Error(`组件 ${component} 不在 Lab 的组件清单里（不存在、不可挂载或没有登记场景）。清单里有：${listed}${more}。${RESTART_HINT}`);
    }
    if (outcome.kind === "unknown_scene") {
        throw new Error(`组件 ${component} 没有场景 ${scene}；它的场景：${outcome.scenes.join("、") || "（无）"}。${RESTART_HINT}`);
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

async function shoot(page: Page, options: ShotOptions, scene: string, viewport: string, colorway: string | null, media: LabMedia | null): Promise<Omit<ShotResult, "problems">> {
    if (media !== null) {
        // Playwright 的 emulateMedia 没有 prefers-reduced-transparency，两种都经 CDP 设，同一条路。
        const session = await page.context().newCDPSession(page);
        await session.send("Emulation.setEmulatedMedia", {features: [{name: MEDIA_FEATURE[media], value: "reduce"}]});
    }
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
    // 点击引起的变化（展开、动画）没有统一的完成信号，只能等一段时长；没点击时舞台已由 __nbLab 的 ready 确认稳定。
    if (options.clicks.length > 0) {
        await page.waitForTimeout(options.waitMs);
    }
    const measure = await page.evaluate(() => window.__nbLab?.measure() ?? null);
    const name = [options.component, scene, viewport, colorway ?? "current", ...(media === null ? [] : [media])].join("__").replace(/[^\w.-]+/gu, "-");
    const file = join(options.out, `${name}.png`);
    await page.locator("[data-lab-stage]").screenshot({path: file});
    let textSpacing: ShotResult["textSpacing"] = null;
    if (options.textSpacing) {
        await page.addStyleTag({content: TEXT_SPACING_CSS});
        // 等两帧：样式生效、版面重排之后再量。
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        const spaced = await page.evaluate(() => window.__nbLab?.measure() ?? null);
        textSpacing = spaced === null ? null : {offenders: spaced.offenders, clippedText: spaced.clippedText};
        await page.locator("[data-lab-stage]").screenshot({path: join(options.out, `${name}__text-spacing.png`)});
    }
    return {component: options.component, scene, viewport, colorway, media, file, measure, textSpacing};
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
        media: [null],
        textSpacing: false,
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
        if (flag === "--text-spacing") {
            options.textSpacing = true;
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
            case "--media": options.media = list(value).map(parseMedia); break;
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

function parseMedia(value: string): LabMedia {
    if (value === "reduced-motion" || value === "reduced-transparency") return value;
    throw new Error(`--media 只认 reduced-motion、reduced-transparency，收到：${value}`);
}

/** 有溢出、越界元素、聚焦光晕会被裁的控件、外扩环被裁的元素或页面错误的结果。 */
export function failedShots(results: readonly ShotResult[]): ShotResult[] {
    return results.filter((result) => result.problems.length > 0
        || (result.measure !== null && (result.measure.overflowX > 0 || result.measure.offenders.length > 0 || result.measure.clippedFocus.length > 0 || result.measure.clippedRings.length > 0)));
}

function summarize(result: ShotResult): string {
    const measure = result.measure;
    const overflow = measure === null ? "无舞台" : `溢出 ${measure.overflowX}px，越界元素 ${measure.offenders.length} 个，光晕会被裁的控件 ${measure.clippedFocus.length} 个，外扩环被裁的元素 ${measure.clippedRings.length} 个`;
    const media = result.media === null ? "" : ` · ${result.media}`;
    const lines = [`${result.scene} · ${result.viewport} · ${result.colorway ?? "当前配色"}${media}：${overflow}，问题 ${result.problems.length} 条 → ${result.file}`];
    for (const offender of measure?.offenders ?? []) lines.push(`    越界 ${offender.overflow}px ${offender.componentName} ${offender.selector}`);
    for (const clipped of measure?.clippedFocus ?? []) lines.push(`    光晕被裁 离边 ${clipped.gap}px ${clipped.componentName} ${clipped.selector} ← ${clipped.clipper}`);
    for (const clipped of measure?.clippedRings ?? []) lines.push(`    外扩环被裁 离边 ${clipped.gap}px ${clipped.componentName} ${clipped.selector} ← ${clipped.clipper}`);
    for (const problem of result.problems) lines.push(`    ${problem.split("\n")[0]}`);
    // 下面几项只报告，不算失败（nb-ui 设计语言“六、无障碍”，开发规范“可点区域与焦点”）。
    for (const target of measure?.smallTargets ?? []) lines.push(`    [报告] 目标小于 24×24 且太挤 ${target.width}×${target.height} ${target.componentName} ${target.selector}`);
    for (const text of result.textSpacing?.clippedText ?? []) lines.push(`    [报告] 加大文字间距后文字被裁 ${text.overflow}px ${text.componentName} ${text.selector}`);
    for (const offender of result.textSpacing?.offenders ?? []) lines.push(`    [报告] 加大文字间距后越界 ${offender.overflow}px ${offender.componentName} ${offender.selector}`);
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
