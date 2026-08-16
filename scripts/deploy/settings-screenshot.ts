import {copyFile, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {createConnection} from "node:net";
import sharp from "sharp";
import {PreviewRuntimeStartupError, startPreviewRuntime, type PreviewRuntimeHandle} from "nbook/scripts/deploy/preview-runtime";
import {parseResearchRunManifest, parseResearchVisionPlan, writeResearchRunManifest, type ResearchAnnotation, type ResearchAnnotationMark, type ResearchRunManifest, type ResearchTutorialStep} from "nbook/shared/research-run-contract";
import {chromium, type Browser, type BrowserServer, type ConsoleMessage, type Page, type Request, type Response} from "playwright-core";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY_PATH = "/settings.preview";
const DESKTOP_VIEWPORT = {width: 1_440, height: 1_000};
const MOBILE_VIEWPORT = {width: 390, height: 844};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_COUNT = 4;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type RuntimeModeArgument = "auto" | "product" | "source-dev";
type BrowserCleanup = "closed" | "killed" | "failed";
type ServiceCleanup = "not-started" | "graceful" | "forced" | "failed";
type CaptureFailureKind = "environment-blocked" | "product-failure";

type ScreenshotProfile = "settings" | "api-config-tutorial";

type CliOptions = {
    runtime: RuntimeModeArgument;
    browserExecutable: string;
    evidenceDir?: string;
    mediaDir?: string;
    headed: boolean;
    profile: ScreenshotProfile;
    annotate: boolean;
    manifestPath?: string;
    annotationPlanPath?: string;
};

type BrowserCapture = {
    viewports: ResearchRunManifest["browser"]["viewports"];
    consoleErrors: number;
    pageErrors: number;
    criticalFailures: string[];
    transientFailures: string[];
    evidenceFiles: string[];
};
type BrowserSession = {
    server: BrowserServer;
    browser: Browser;
};

class ScreenshotFailure extends Error {
    readonly kind: CaptureFailureKind;

    constructor(kind: CaptureFailureKind, message: string) {
        super(message);
        this.name = "ScreenshotFailure";
        this.kind = kind;
    }
}

async function main(): Promise<number> {
    const options = parseCli(process.argv.slice(2));
    if (options.annotate) return annotateMain(options);
    return captureMain(options);
}

async function captureMain(options: CliOptions): Promise<number> {
    const runId = `repository-settings-screenshot-${randomUUID()}`;
    const taskRoot = resolve(ROOT, ".agent", "tmp", runId);
    const evidenceDir = resolve(options.evidenceDir ?? join(taskRoot, "evidence"));
    const mediaDir = resolve(resolveSettingsMediaDir(options.mediaDir));
    await mkdir(evidenceDir, {recursive: true});
    await mkdir(mediaDir, {recursive: true});

    const repository = await repositoryIdentity(ROOT);
    const expectedVersion = await packageVersion(ROOT);
    const browserExecutable = options.browserExecutable;
    const manifestPath = resolve(evidenceDir, "repository-research-run.json");
    const desktopScreenshot = "settings-desktop.png";
    const mobileScreenshot = "settings-mobile.png";
    const browserEventsFile = "browser-events.json";
    let runtime: PreviewRuntimeHandle | null = null;
    let browserSession: BrowserSession | null = null;
    let browserCleanup: BrowserCleanup = "closed";
    let serviceCleanup: ServiceCleanup = "not-started";
    let portClosed = true;
    let ownedTempRootsRemoved = true;
    let resultStatus: ResearchRunManifest["result"]["status"] = "environment-blocked";
    let resultReason = "";
    let manifestProductAttempt: ResearchRunManifest["service"]["productAttempt"] = "not-attempted";
    let manifestProductAttemptReason: string | undefined;
    let capture: BrowserCapture = {
        viewports: [
            {width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height, screenshot: desktopScreenshot, horizontalOverflow: false},
            {width: MOBILE_VIEWPORT.width, height: MOBILE_VIEWPORT.height, screenshot: mobileScreenshot, horizontalOverflow: false},
        ],
        consoleErrors: 0,
        pageErrors: 0,
        criticalFailures: [],
        transientFailures: [],
        evidenceFiles: [],
    };
    const startedAt = new Date().toISOString();
    let mediaFiles: string[] = [];

    try {
        if (!browserExecutable || !await isExecutableFile(browserExecutable)) {
            resultReason = "浏览器 executable 不存在或未提供；未启动 NeuroBook。";
        } else {
            const runtimeStateRoot = options.runtime === "source-dev" ? join(taskRoot, "dev-state") : join(taskRoot, "product-state");
            const runtimeCacheRoot = options.runtime === "source-dev" ? join(taskRoot, "dev-cache") : join(taskRoot, "product-cache");
            runtime = await startPreviewRuntime({
                repoRoot: ROOT,
                taskRoot,
                operationId: runId,
                mode: options.runtime,
                port: 0,
                expectedVersion,
                stateRoot: runtimeStateRoot,
                cacheRoot: runtimeCacheRoot,
                browserMediaRoot: mediaDir,
                ...(options.profile === "api-config-tutorial"
                    ? {prepareStateRoot: prepareTutorialStateRoot}
                    : {}),
            });
            await runtime.ready;
            const session = await launchBrowser(browserExecutable, options.headed);
            browserSession = session;
            capture = await capturePreview(session.browser, runtime.url, evidenceDir, desktopScreenshot, mobileScreenshot, options.profile);
            await writeFile(join(evidenceDir, browserEventsFile), `${JSON.stringify({criticalFailures: capture.criticalFailures, transientFailures: capture.transientFailures}, null, 4)}\n`, "utf8");
            capture.evidenceFiles = [desktopScreenshot, mobileScreenshot, browserEventsFile];
            if (capture.criticalFailures.length || capture.consoleErrors || capture.pageErrors) {
                throw new ScreenshotFailure("product-failure", "真实预览页产生 console/page/resource 错误。");
            }
            mediaFiles = await copyValidatedMedia(
                [join(evidenceDir, desktopScreenshot), join(evidenceDir, mobileScreenshot)],
                mediaDir,
                runId,
            );
            resultStatus = "passed";
        }
    } catch (error) {
        resultStatus = error instanceof ScreenshotFailure ? error.kind : classifyRuntimeFailure(error, options.runtime);
        resultReason = safeError(error);
        if (error instanceof PreviewRuntimeStartupError && error.kind === "product-unavailable" && options.runtime === "product") {
            manifestProductAttempt = runtime?.productAttempt ?? "failed";
            manifestProductAttemptReason = runtime?.fallbackReason ?? safeError(error);
            resultStatus = "product-failure";
        }
    } finally {
        const browserResult = await closeBrowser(browserSession);
        browserCleanup = browserResult.status;
        if (browserResult.error && resultStatus === "passed") {
            resultStatus = "environment-blocked";
            resultReason = `浏览器收口失败：${browserResult.error}`;
        }
        if (runtime) {
            try {
                await runtime.stop();
                serviceCleanup = runtimeStopMode(runtime);
            } catch (error) {
                serviceCleanup = "failed";
                portClosed = false;
                if (resultStatus === "passed") {
                    resultStatus = "environment-blocked";
                    resultReason = `服务收口失败：${safeError(error)}`;
                }
            }
            portClosed = portClosed && await isPortClosed(runtime.port);
            ownedTempRootsRemoved = await ownedRootsRemoved(taskRoot);
        } else {
            ownedTempRootsRemoved = await ownedRootsRemoved(taskRoot);
        }
        if (browserCleanup === "failed" || serviceCleanup === "failed" || !portClosed || !ownedTempRootsRemoved) {
            if (resultStatus === "passed") resultStatus = "environment-blocked";
            if (!resultReason) resultReason = "运行资源未能完成可验证收口。";
        }

        const manifest: ResearchRunManifest = parseResearchRunManifest({
            schema: "nbook.repository-research-run/v1",
            runId,
            adapter: "neuro-book-settings",
            startedAt,
            finishedAt: new Date().toISOString(),
            repository,
            service: {
                mode: runtime?.mode ?? "source-dev",
                url: runtime?.url ?? "http://127.0.0.1:1",
                port: runtime?.port ?? 1,
                expectedVersion,
                startupNoncePresent: Boolean(runtime?.startupNonce),
                productAttempt: runtime?.productAttempt ?? manifestProductAttempt,
                ...(runtime?.fallbackReason ?? manifestProductAttemptReason
                    ? {fallbackReason: runtime?.fallbackReason ?? manifestProductAttemptReason}
                    : {}),
            },
            browser: {
                executable: browserExecutable ? resolve(browserExecutable) : null,
                viewports: capture.viewports,
                consoleErrors: capture.consoleErrors,
                pageErrors: capture.pageErrors,
            },
            evidence: {
                files: capture.evidenceFiles,
                mediaFiles,
                profile: options.profile,
            },
            cleanup: {
                browser: browserCleanup,
                service: runtime ? serviceCleanup : "not-started",
                portClosed,
                ownedTempRootsRemoved,
                sharedCachePreserved: true,
            },
            result: {
                status: resultStatus,
                ...(resultReason ? {reason: resultReason} : {}),
            },
        });
        try {
            await writeResearchRunManifest(manifestPath, manifest);
        } catch (error) {
            resultStatus = "environment-blocked";
            resultReason = `manifest 写入失败：${safeError(error)}`;
        }
    }

    process.stdout.write(`result=${resultStatus}\nmanifest=${manifestPath}\n`);
    for (const mediaFile of resultStatus === "passed" ? mediaFiles : []) process.stdout.write(`MEDIA:${mediaFile}\n`);
    return resultStatus === "passed" ? 0 : 2;
}

export function resolveSettingsMediaDir(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    if (!normalized || !isAbsolute(normalized)) {
        throw new Error("设置截图必须显式提供 --media-dir 绝对路径；禁止回退到隔离任务根。");
    }
    return normalized;
}

function parseCli(args: string[]): CliOptions {
    const result: CliOptions = {
        runtime: "auto",
        browserExecutable: process.env.NEURO_BOOK_BROWSER_EXECUTABLE?.trim() || "",
        headed: false,
        profile: "settings",
        annotate: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const name = args[index];
        const value = args[index + 1];
        if (name === "--runtime") {
            if (value !== "auto" && value !== "product" && value !== "source-dev") throw new Error("--runtime 必须是 auto、product 或 source-dev。");
            result.runtime = value;
            index += 1;
        } else if (name === "--browser-executable") {
            if (!value || !isAbsolute(value)) throw new Error("--browser-executable 必须是绝对路径。");
            result.browserExecutable = value;
            index += 1;
        } else if (name === "--evidence-dir") {
            if (!value || !isAbsolute(value)) throw new Error("--evidence-dir 必须是绝对路径。");
            result.evidenceDir = value;
            index += 1;
        } else if (name === "--media-dir") {
            if (!value || !isAbsolute(value)) throw new Error("--media-dir 必须是绝对路径。");
            result.mediaDir = value;
            index += 1;
        } else if (name === "--headed") {
            if (value !== "true" && value !== "false") throw new Error("--headed 必须是 true 或 false。");
            result.headed = value === "true";
            index += 1;
        } else if (name === "--profile") {
            if (value !== "settings" && value !== "api-config-tutorial") throw new Error("--profile 必须是 settings 或 api-config-tutorial。");
            result.profile = value;
            index += 1;
        } else if (name === "--annotate") {
            result.annotate = true;
        } else if (name === "--manifest") {
            if (!value || !isAbsolute(value)) throw new Error("--manifest 必须是绝对路径。");
            result.manifestPath = value;
            index += 1;
        } else if (name === "--annotation-plan") {
            if (!value || !isAbsolute(value)) throw new Error("--annotation-plan 必须是绝对路径。");
            result.annotationPlanPath = value;
            index += 1;
         } else {
             throw new Error(`未知参数：${name}`);
         }
     }
    if (result.annotate && (!result.manifestPath || !result.annotationPlanPath)) {
        throw new Error("--annotate 必须同时提供 --manifest 和 --annotation-plan。");
    }
     return result;
 }
/** 只向隔离 State Root 写入教程示例；不会读取或修改真实用户配置。 */
async function prepareTutorialStateRoot(stateRoot: string, _mode: "product" | "source-dev"): Promise<void> {
    const configRoot = resolve(stateRoot, "workspace", ".nbook");
    await mkdir(configRoot, {recursive: true});
    const config = {
        models: {
            default: "deepseek/deepseek-chat",
            providers: [{
                id: "deepseek",
                name: "DeepSeek",
                enabled: true,
                modelApi: "openai-completions",
                options: {
                    apiKey: "tutorial-placeholder-not-secret",
                    baseURL: "https://api.deepseek.com/v1",
                    proxy: "",
                    timeoutMs: 180000,
                    requestOptions: {},
                },
                models: [{
                    name: "DeepSeek Chat",
                    id: "deepseek-chat",
                    group: "DeepSeek",
                    enabled: true,
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    maxTokens: 8192,
                    contextWindowTokens: 128000,
                    cost: null,
                    compat: null,
                    headers: null,
                    thinkingLevelMap: null,
                }],
            }],
        },
    };
    await writeFile(resolve(configRoot, "config.json"), `${JSON.stringify(config, null, 4)}\n`, {encoding: "utf8", flag: "w"});
}
/** 读取视觉计划，按每个教程步骤生成独立标注 PNG，并绑定回同一次运行 manifest。 */
async function annotateMain(options: CliOptions): Promise<number> {
    const manifestPath = options.manifestPath!;
    let manifest: ResearchRunManifest | null = null;
    try {
        manifest = parseResearchRunManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
        if (manifest.result.status !== "passed") throw new Error("当前截图运行未通过，不能继续标注。" );
        if (manifest.evidence.profile !== "api-config-tutorial") throw new Error("当前 manifest 不是 api-config-tutorial profile。" );
        if (manifest.evidence.annotations || manifest.evidence.tutorialSteps) throw new Error("当前 manifest 已完成标注，拒绝重复覆盖。" );
        const plan = parseResearchVisionPlan(JSON.parse(await readFile(options.annotationPlanPath!, "utf8")) as unknown);
        if (!plan.success || plan.profile !== "api-config-tutorial") throw new Error(plan.failureReason ?? "视觉计划未通过 api-config-tutorial 校验。" );
        const mediaDir = resolve(resolveSettingsMediaDir(options.mediaDir));
        await mkdir(mediaDir, {recursive: true});
        const mediaRoot = await realpath(mediaDir);
        const mediaBySource = mapViewportMedia(manifest);
        if (mediaBySource.size !== manifest.browser.viewports.length) throw new Error("当前 manifest 缺少完整的视口媒体映射。");
        const mediaFiles: string[] = [];
        const annotations: ResearchAnnotation[] = [];
        let totalMediaBytes = 0;
        const mediaTargetByStep = new Map<string, string>();
        if (plan.tutorialSteps.length > MAX_MEDIA_COUNT) throw new Error("教程步骤媒体数量超过上限。");
        const regionsById = new Map(plan.regions.map((region) => [region.id, region]));
        for (const [index, step] of plan.tutorialSteps.entries()) {
            const region = regionsById.get(step.regionId);
            const sourceMedia = mediaBySource.get(step.source);
            if (!region || !sourceMedia) throw new Error(`教程步骤无法绑定截图或区域：${step.id}`);
            const stepSlug = safeStepSlug(step.id);
            const target = resolve(mediaRoot, `${manifest.runId}-tutorial-step-${String(index + 1).padStart(2, "0")}-${stepSlug}.png`);
            assertContained(mediaRoot, target, "教程步骤媒体根");
            await renderAnnotatedPng(sourceMedia, target, region.marks);
            const actual = await validateGeneratedPng(target, mediaRoot);
            const size = (await stat(actual)).size;
            if (mediaFiles.includes(actual)) throw new Error(`教程步骤媒体路径重复：${step.id}`);
            if (mediaFiles.length >= MAX_MEDIA_COUNT) throw new Error("教程步骤媒体数量超过上限。");
            if (totalMediaBytes + size > MAX_TOTAL_MEDIA_BYTES) throw new Error("教程步骤截图总大小超过 16 MiB。");
            totalMediaBytes += size;
            mediaFiles.push(actual);
            mediaTargetByStep.set(step.id, actual);
            annotations.push({stepId: step.id, mediaFile: actual, source: step.source, profile: plan.profile, marks: region.marks});
        }
        const tutorialSteps: ResearchTutorialStep[] = plan.tutorialSteps.map((step) => {
            const mediaFile = mediaTargetByStep.get(step.id);
            if (!mediaFile) throw new Error(`教程步骤没有独立媒体产物：${step.id}`);
            return {
                id: step.id,
                title: step.title,
                instruction: step.instruction,
                source: step.source,
                mediaFile,
            };
        });
        const updated = parseResearchRunManifest({
            ...manifest,
            evidence: {
                ...manifest.evidence,
                mediaFiles,
                annotations,
                tutorialSteps,
            },
        });
        await writeResearchRunManifest(manifestPath, updated);
        process.stdout.write(`result=passed\nmanifest=${manifestPath}\n`);
        for (const mediaFile of mediaFiles) process.stdout.write(`MEDIA:${mediaFile}\n`);
        return 0;
    } catch (error) {
        if (manifest) {
            const invalidated = parseResearchRunManifest({
                ...manifest,
                evidence: {...manifest.evidence, mediaFiles: []},
                result: {status: "unverified", reason: `标注失败：${safeError(error)}`},
            });
            await writeResearchRunManifest(manifestPath, invalidated).catch(() => undefined);
        }
        process.stdout.write(`result=unverified\nmanifest=${manifestPath}\n`);
        return 2;
    }
}

function mapViewportMedia(manifest: ResearchRunManifest): Map<string, string> {
    const result = new Map<string, string>();
    for (const [index, viewport] of manifest.browser.viewports.entries()) {
        const suffix = `-${basename(viewport.screenshot)}`;
        const matches = manifest.evidence.mediaFiles.filter((candidate) => candidate.endsWith(suffix));
        const mediaFile = matches.length === 1 ? matches[0] : manifest.evidence.mediaFiles[index];
        if (mediaFile) result.set(viewport.screenshot, mediaFile);
    }
    return result;
}

function safeStepSlug(stepId: string): string {
    const slug = stepId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48);
    return slug || "step";
}


async function renderAnnotatedPng(source: string, target: string, marks: readonly ResearchAnnotationMark[]): Promise<void> {
    const metadata = await sharp(source, {failOn: "error"}).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height || width < 1 || height < 1) throw new Error(`截图尺寸无效：${source}`);
    const overlay = Buffer.from(annotationSvg(width, height, marks), "utf8");
    await sharp(source, {failOn: "error"})
        .composite([{input: overlay, blend: "over"}])
        .png()
        .toFile(target);
}

function annotationSvg(width: number, height: number, marks: readonly ResearchAnnotationMark[]): string {
    const body = marks.map((mark) => {
        const x = clamp(mark.x, 0, 1) * width;
        const y = clamp(mark.y, 0, 1) * height;
        if (mark.kind === "rectangle") {
            const markWidth = clamp(mark.width ?? 0, 0, 1) * width;
            const markHeight = clamp(mark.height ?? 0, 0, 1) * height;
            return `<rect x="${x}" y="${y}" width="${markWidth}" height="${markHeight}" rx="12" fill="none" stroke="#e53935" stroke-width="6"/>`;
        }
        if (mark.kind === "arrow") {
            const toX = clamp(mark.toX ?? mark.x, 0, 1) * width;
            const toY = clamp(mark.toY ?? mark.y, 0, 1) * height;
            return `<line x1="${x}" y1="${y}" x2="${toX}" y2="${toY}" stroke="#1565c0" stroke-width="8" stroke-linecap="round" marker-end="url(#arrow)"/>`;
        }
        const text = escapeXml(mark.text ?? "");
        const boxWidth = Math.min(width * 0.42, Math.max(180, (mark.text?.length ?? 0) * 24 + 40));
        const boxHeight = 52;
        const boxX = clamp(x, 8, Math.max(8, width - boxWidth - 8));
        const boxY = clamp(y, 8, Math.max(8, height - boxHeight - 8));
        return `<g><rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="10" fill="#111827" fill-opacity="0.92"/><text x="${boxX + 18}" y="${boxY + 33}" fill="#ffffff" font-size="24" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${text}</text></g>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z" fill="#1565c0"/></marker></defs>${body}</svg>`;
}

async function validateGeneratedPng(target: string, mediaRoot: string): Promise<string> {
    const actual = await realpath(target);
    assertContained(mediaRoot, actual, "标注媒体根");
    const bytes = await readFile(actual);
    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) throw new Error(`标注产物不是 PNG：${actual}`);
    const info = await stat(actual);
    if (info.size < PNG_MAGIC.length || info.size > MAX_IMAGE_BYTES) throw new Error(`标注产物大小无效：${actual}`);
    return actual;
}

function escapeXml(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}


async function capturePreview(
    browser: Browser,
    baseUrl: string,
    evidenceDir: string,
    desktopScreenshot: string,
    mobileScreenshot: string,
    profile: ScreenshotProfile,
): Promise<BrowserCapture> {
    const viewports: ResearchRunManifest["browser"]["viewports"] = [];
    const criticalFailures: string[] = [];
    const transientFailures: string[] = [];
    let consoleErrors = 0;
    let pageErrors = 0;
    const captures = [
        {viewport: DESKTOP_VIEWPORT, screenshot: desktopScreenshot},
        {viewport: MOBILE_VIEWPORT, screenshot: mobileScreenshot},
    ];
    for (const capture of captures) {
        let captured = false;
        for (let attempt = 0; attempt < 5 && !captured; attempt += 1) {
            const context = await browser.newContext({viewport: capture.viewport});
            const attemptFailures: string[] = [];
            try {
                const page = await context.newPage();
                const pageResult = await capturePage(page, `${baseUrl}${ENTRY_PATH}`, join(evidenceDir, capture.screenshot), attemptFailures, profile);
                if (attempt < 4 && isTransientOptimizeFailure(attemptFailures)) {
                    await delay(4_000);
                    continue;
                }
                transientFailures.push(...attemptFailures.filter(isRecoverableViteAbort));
                consoleErrors += pageResult.consoleErrors;
                pageErrors += pageResult.pageErrors;
                criticalFailures.push(...attemptFailures.filter((failure) => !isRecoverableViteAbort(failure)));
                viewports.push({
                    width: capture.viewport.width,
                    height: capture.viewport.height,
                    screenshot: capture.screenshot,
                    horizontalOverflow: pageResult.horizontalOverflow,
                });
                captured = true;
            } catch (error) {
                if (attempt < 4 && isTransientOptimizeFailure(attemptFailures)) {
                    await delay(4_000);
                    continue;
                }
                criticalFailures.push(...attemptFailures);
                throw error;
            } finally {
                await context.close();
            }
        }
        if (!captured) throw new ScreenshotFailure("product-failure", `视口 ${String(capture.viewport.width)}×${String(capture.viewport.height)} 重试后仍未完成。`);
    }
    return {
        viewports,
        consoleErrors,
        pageErrors,
        criticalFailures,
        transientFailures: [...new Set(transientFailures)],
        evidenceFiles: [],
    };
}

/** 将真实设置表单从内部滚动容器展开，确保教程 PNG 同时呈现连接字段和模型条目。 */
async function expandTutorialScreenshot(page: Page): Promise<void> {
    await page.evaluate(() => {
        const surface = document.querySelector<HTMLElement>("[data-dialog-surface]");
        const overlay = surface?.parentElement;
        if (!surface || !overlay) throw new Error("设置教程截图缺少 Dialog surface。");

        const viewportWidth = window.innerWidth;
        const horizontalPadding = viewportWidth < 640 ? 16 : 24;
        const surfaceWidth = Math.max(0, viewportWidth - horizontalPadding * 2);
        overlay.style.position = "relative";
        overlay.style.display = "flex";
        overlay.style.alignItems = "flex-start";
        overlay.style.justifyContent = "center";
        overlay.style.width = `${viewportWidth}px`;
        overlay.style.maxWidth = `${viewportWidth}px`;
        overlay.style.padding = "32px 0";
        overlay.style.boxSizing = "border-box";
        overlay.style.overflowX = "hidden";
        surface.style.width = `${surfaceWidth}px`;
        surface.style.maxWidth = `${surfaceWidth}px`;
        surface.style.minWidth = "0";
        surface.style.height = "auto";
        surface.style.maxHeight = "none";
        surface.style.overflow = "visible";

        const body = surface.children[1] as HTMLElement | undefined;
        if (body) {
            body.style.height = "auto";
            body.style.maxHeight = "none";
            body.style.flex = "none";
            body.style.overflowY = "visible";
        }

        // 先打开真正的纵向滚动节点，再让其 flex/grid 父节点重新计算高度；不改写所有 flex-1，避免移动端横向布局被撑开。
        for (const element of surface.querySelectorAll<HTMLElement>("*")) {
            const computed = getComputedStyle(element);
            if (computed.overflowY === "auto" || computed.overflowY === "scroll") {
                element.style.overflowY = "visible";
                element.style.maxHeight = "none";
            }
            element.style.minWidth = "0";
            if (element.scrollWidth > element.clientWidth + 1) {
                element.style.maxWidth = "100%";
            }
        }
        for (const element of surface.querySelectorAll<HTMLElement>("*")) {
            const computed = getComputedStyle(element);
            if (element.scrollHeight > element.clientHeight + 1 && (computed.overflowY !== "visible" || computed.overflow === "hidden")) {
                element.style.overflowY = "visible";
                element.style.maxHeight = "none";
                if (computed.display === "flex" || computed.display === "grid") element.style.height = "auto";
            }
        }

        const expandedHeight = Math.max(surface.scrollHeight, surface.getBoundingClientRect().height);
        overlay.style.minHeight = `${expandedHeight + 64}px`;
        overlay.style.height = `${expandedHeight + 64}px`;
        document.documentElement.style.width = `${viewportWidth}px`;
        document.documentElement.style.maxWidth = `${viewportWidth}px`;
        document.documentElement.style.overflowX = "hidden";
        document.body.style.width = `${viewportWidth}px`;
        document.body.style.maxWidth = `${viewportWidth}px`;
        document.body.style.minHeight = `${expandedHeight + 64}px`;
        document.body.style.overflowX = "hidden";
    });
}
async function capturePage(
    page: Page,
    url: string,
    screenshotPath: string,
    criticalFailures: string[],
    profile: ScreenshotProfile,
): Promise<{consoleErrors: number; pageErrors: number; horizontalOverflow: boolean}> {
    let currentFailures: string[] = [];
    let currentConsoleErrors = 0;
    let currentPageErrors = 0;
    const onConsole = (message: ConsoleMessage): void => {
        if (message.type() !== "error") return;
        currentConsoleErrors += 1;
        currentFailures.push(`console:${message.text()}`);
    };
    const onPageError = (error: Error): void => {
        currentPageErrors += 1;
        currentFailures.push(`pageerror:${error.message}`);
    };
    const onRequestFailed = (request: Request): void => {
        if (!isCriticalResource(request.resourceType(), request.url())) return;
        const reason = request.failure()?.errorText ?? "unknown";
        currentFailures.push(`request:${reason}:${request.url()}`);
    };
    const onResponse = (response: Response): void => {
        if (response.status() >= 400 && isCriticalResource(response.request().resourceType(), response.url())) {
            currentFailures.push(`response:${String(response.status())}:${response.url()}`);
        }
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            currentFailures = [];
            currentConsoleErrors = 0;
            currentPageErrors = 0;
            try {
                let response;
                try {
                    response = await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60_000});
                } catch (error) {
                    throw new ScreenshotFailure("environment-blocked", `预览页导航失败：${safeError(error)}`);
                }
                if (!response || response.status() >= 400) {
                    throw new ScreenshotFailure("product-failure", `预览页 HTTP ${String(response?.status() ?? 0)}。`);
                }
                await page.waitForSelector("[data-settings-preview-page]", {timeout: 60_000});
                await page.waitForFunction(() => document.body.innerText.includes("设置中心独立预览页"), {timeout: 60_000});
                await page.waitForSelector("[data-dialog-surface]", {timeout: 60_000});
                await page.waitForFunction(() => {
                    const surface = document.querySelector<HTMLElement>("[data-dialog-surface]");
                    return Boolean(surface && (surface.innerText.trim().length >= 200));
                }, {timeout: 60_000});
                if (profile === "api-config-tutorial") {
                    await page.waitForFunction(() => {
                        const text = document.body.innerText;
                        return text.includes("DeepSeek")
                            && text.includes("API Base")
                            && text.includes("API Key")
                            && text.includes("OpenAI Completions")
                            && text.includes("deepseek-chat");
                    }, {timeout: 60_000});
                }
                await page.waitForLoadState("load", {timeout: 30_000});
                await page.waitForTimeout(1_500);
                if (profile === "api-config-tutorial") await expandTutorialScreenshot(page);
                await page.screenshot({path: screenshotPath, fullPage: true});
                const dimensions = await page.evaluate(() => ({
                    scrollWidth: document.documentElement.scrollWidth,
                    clientWidth: document.documentElement.clientWidth,
                }));
                criticalFailures.push(...currentFailures);
                return {
                    consoleErrors: currentConsoleErrors,
                    pageErrors: currentPageErrors,
                    horizontalOverflow: dimensions.scrollWidth > dimensions.clientWidth,
                };
            } catch (error) {
                if (attempt === 0 && isTransientOptimizeFailure(currentFailures)) {
                    await page.waitForTimeout(1_000);
                    continue;
                }
                criticalFailures.push(...currentFailures);
                if (error instanceof ScreenshotFailure) throw error;
                throw new ScreenshotFailure("product-failure", `预览页加载失败：${safeError(error)}`);
            }
        }
    } finally {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("requestfailed", onRequestFailed);
        page.off("response", onResponse);
    }
    throw new ScreenshotFailure("product-failure", "预览页重试后仍未完成挂载。");
}

function isRecoverableViteAbort(failure: string): boolean {
    return failure.startsWith("request:net::ERR_ABORTED:")
        && failure.includes("/_nuxt/@fs/")
        && /\?v=[A-Za-z0-9]{5,}/u.test(failure);
}

function isTransientOptimizeFailure(failures: string[]): boolean {
    return failures.some((failure) => (
        failure.includes("Outdated Optimize Dep")
        || failure.includes(":504:")
        || isRecoverableViteAbort(failure)
        || (failure.startsWith("request:") && /\?v=[A-Za-z0-9]{5,}/u.test(failure))
    ));
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function isCriticalResource(resourceType: string, url: string): boolean {
    if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) return false;
    return resourceType === "document" || resourceType === "script" || resourceType === "stylesheet";
}

async function launchBrowser(executablePath: string, headed: boolean): Promise<BrowserSession> {
    try {
        const server = await chromium.launchServer({executablePath, headless: !headed, timeout: 60_000});
        try {
            const browser = await chromium.connect(server.wsEndpoint());
            return {server, browser};
        } catch (error) {
            await server.kill().catch(() => undefined);
            throw new ScreenshotFailure("environment-blocked", `浏览器连接失败：${safeError(error)}`);
        }
    } catch (error) {
        if (error instanceof ScreenshotFailure) throw error;
        throw new ScreenshotFailure("environment-blocked", `浏览器启动失败：${safeError(error)}`);
    }
}

async function closeBrowser(session: BrowserSession | null): Promise<{status: BrowserCleanup; error?: string}> {
    if (!session) return {status: "closed"};
    let failure: string | undefined;
    try {
        for (const context of session.browser.contexts()) await context.close();
        await session.browser.close();
    } catch (error) {
        failure = safeError(error);
    }
    if (!failure) {
        try {
            await closeWithTimeout(session.server.close(), 10_000);
            return {status: "closed"};
        } catch (error) {
            failure = safeError(error);
        }
    }
    try {
        await session.server.kill();
        await waitChildExit(session.server);
        return {status: "killed", ...(failure ? {error: failure} : {})};
    } catch (error) {
        return {status: "failed", error: `${failure ?? "browser close failed"}; ${safeError(error)}`};
    }
}

async function copyValidatedMedia(paths: string[], mediaDir: string, runId: string): Promise<string[]> {
    if (paths.length > MAX_MEDIA_COUNT) throw new ScreenshotFailure("environment-blocked", "媒体数量超过上限。");
    const root = await realpath(mediaDir);
    let total = 0;
    const outputs: string[] = [];
    for (const source of paths) {
        const bytes = await readFile(source);
        const info = await stat(source);
        if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
            throw new ScreenshotFailure("product-failure", `截图不是有效 PNG：${source}`);
        }
        if (info.size > MAX_IMAGE_BYTES) throw new ScreenshotFailure("environment-blocked", `单图超过 8 MiB：${source}`);
        total += info.size;
        if (total > MAX_TOTAL_MEDIA_BYTES) throw new ScreenshotFailure("environment-blocked", "截图总大小超过 16 MiB。");
        const name = `${runId}-${basename(source)}`;
        const target = resolve(root, name);
        assertContained(root, target, "Hermes media root");
        await copyFile(source, target);
        const actual = await realpath(target);
        assertContained(root, actual, "Hermes media root");
        outputs.push(actual);
    }
    return outputs;
}

function classifyRuntimeFailure(error: unknown, mode: RuntimeModeArgument): ResearchRunManifest["result"]["status"] {
    if (error instanceof ScreenshotFailure) return error.kind;
    if (error instanceof PreviewRuntimeStartupError && mode === "product" && error.kind === "product-unavailable") return "product-failure";
    return "environment-blocked";
}

function runtimeStopMode(runtime: PreviewRuntimeHandle): ServiceCleanup {
    return runtime.stopResult === "forced" ? "forced" : runtime.stopResult === "failed" ? "failed" : "graceful";
}

async function repositoryIdentity(root: string): Promise<ResearchRunManifest["repository"]> {
    try {
        const revision = (await execFileAsync("git", ["rev-parse", "HEAD"], {cwd: root})).stdout.trim();
        const dirty = Boolean((await execFileAsync("git", ["status", "--porcelain"], {cwd: root})).stdout.trim());
        return {root: resolve(root), revision: revision || null, dirty};
    } catch {
        return {root: resolve(root), revision: null, dirty: null};
    }
}

async function packageVersion(root: string): Promise<string> {
    const value = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: unknown};
    if (typeof value.version !== "string" || !value.version) throw new Error("package.json version 缺失。");
    return value.version;
}

async function isExecutableFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

async function ownedRootsRemoved(taskRoot: string): Promise<boolean> {
    const roots = ["product-state", "dev-state", "product-cache", "dev-cache"];
    const states = await Promise.all(roots.map(async (name) => {
        try {
            await stat(join(taskRoot, name));
            return false;
        } catch {
            return true;
        }
    }));
    return states.every(Boolean);
}

async function isPortClosed(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolvePromise) => {
        const socket = createConnection({host: "127.0.0.1", port});
        const finish = (closed: boolean): void => {
            socket.removeAllListeners();
            socket.destroy();
            resolvePromise(closed);
        };
        socket.setTimeout(500, () => finish(true));
        socket.once("connect", () => finish(false));
        socket.once("error", () => finish(true));
    });
}

function closeWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
    const {promise: result, resolve, reject} = Promise.withResolvers<void>();
    const timer = setTimeout(() => reject(new Error("browser server close timeout")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    return result;
}

function waitChildExit(server: BrowserServer): Promise<void> {
    const child = server.process();
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const {promise, resolve} = Promise.withResolvers<void>();
    child.once("exit", () => resolve());
    const timer = setTimeout(resolve, 5_000);
    promise.finally(() => clearTimeout(timer));
    return promise;
}

function assertContained(root: string, target: string, label: string): void {
    const relativePath = relative(resolve(root), resolve(target));
    if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) return;
    throw new Error(`${label} 路径逃逸：${target}`);
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
if (import.meta.main) {
    try {
        process.exitCode = await main();
    } catch (error) {
        process.stderr.write(`${safeError(error)}\n`);
        process.exitCode = 2;
    }
}
