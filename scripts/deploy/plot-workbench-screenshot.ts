import {copyFile, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {homedir} from "node:os";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {createConnection} from "node:net";
import {PreviewRuntimeStartupError, startPreviewRuntime, type PreviewRuntimeHandle} from "nbook/scripts/deploy/preview-runtime";
import {parseResearchRunManifest, writeResearchRunManifest, type ResearchRunManifest} from "nbook/shared/research-run-contract";
import {chromium, type Browser, type BrowserServer, type ConsoleMessage, type Page, type Request, type Response} from "playwright-core";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY_PATH = "/plot-workbench.preview";
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

type CliOptions = {
    runtime: RuntimeModeArgument;
    browserExecutable: string;
    evidenceDir?: string;
    mediaDir?: string;
    headed: boolean;
};

type BrowserCapture = {
    viewports: ResearchRunManifest["browser"]["viewports"];
    consoleErrors: number;
    pageErrors: number;
    criticalFailures: string[];
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
    const runId = `repository-screenshot-${randomUUID()}`;
    const taskRoot = resolve(ROOT, ".agent", "tmp", runId);
    const evidenceDir = resolve(options.evidenceDir ?? join(taskRoot, "evidence"));
    const mediaDir = resolve(options.mediaDir ?? join(resolve(process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes")), "cache", "images"));
    await mkdir(evidenceDir, {recursive: true});
    await mkdir(mediaDir, {recursive: true});

    const repository = await repositoryIdentity(ROOT);
    const expectedVersion = await packageVersion(ROOT);
    const browserExecutable = options.browserExecutable;
    const manifestPath = resolve(evidenceDir, "repository-research-run.json");
    const desktopScreenshot = "plot-workbench-desktop.png";
    const mobileScreenshot = "plot-workbench-mobile.png";
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
            });
            await runtime.ready;
            const session = await launchBrowser(browserExecutable, options.headed);
            browserSession = session;
            capture = await capturePreview(session.browser, runtime.url, evidenceDir, desktopScreenshot, mobileScreenshot);
            await writeFile(join(evidenceDir, browserEventsFile), `${JSON.stringify({criticalFailures: capture.criticalFailures}, null, 4)}\n`, "utf8");
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
            adapter: "neuro-book-plot-workbench",
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
    for (const mediaFile of mediaFiles) process.stdout.write(`MEDIA:${mediaFile}\n`);
    return resultStatus === "passed" ? 0 : 2;
}

function parseCli(args: string[]): CliOptions {
    const result: CliOptions = {
        runtime: "auto",
        browserExecutable: process.env.NEURO_BOOK_BROWSER_EXECUTABLE?.trim() || "",
        headed: false,
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
        } else {
            throw new Error(`未知参数：${name}`);
        }
    }
    return result;
}

async function capturePreview(
    browser: Browser,
    baseUrl: string,
    evidenceDir: string,
    desktopScreenshot: string,
    mobileScreenshot: string,
): Promise<BrowserCapture> {
    const viewports: ResearchRunManifest["browser"]["viewports"] = [];
    const criticalFailures: string[] = [];
    let consoleErrors = 0;
    let pageErrors = 0;
    const captures = [
        {viewport: DESKTOP_VIEWPORT, screenshot: desktopScreenshot},
        {viewport: MOBILE_VIEWPORT, screenshot: mobileScreenshot},
    ];
    for (const capture of captures) {
        let captured = false;
        for (let attempt = 0; attempt < 3 && !captured; attempt += 1) {
            const context = await browser.newContext({viewport: capture.viewport});
            const attemptFailures: string[] = [];
            try {
                const page = await context.newPage();
                const pageResult = await capturePage(page, `${baseUrl}${ENTRY_PATH}`, join(evidenceDir, capture.screenshot), attemptFailures);
                if (attempt < 2 && isTransientOptimizeFailure(attemptFailures)) {
                    await delay(3_000);
                    continue;
                }
                consoleErrors += pageResult.consoleErrors;
                pageErrors += pageResult.pageErrors;
                criticalFailures.push(...attemptFailures);
                viewports.push({
                    width: capture.viewport.width,
                    height: capture.viewport.height,
                    screenshot: capture.screenshot,
                    horizontalOverflow: pageResult.horizontalOverflow,
                });
                captured = true;
            } catch (error) {
                if (attempt < 2 && isTransientOptimizeFailure(attemptFailures)) {
                    await delay(3_000);
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
    return {viewports, consoleErrors, pageErrors, criticalFailures, evidenceFiles: []};
}

async function capturePage(
    page: Page,
    url: string,
    screenshotPath: string,
    criticalFailures: string[],
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
        if (isCriticalResource(request.resourceType(), request.url())) currentFailures.push(`request:${request.url()}`);
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
                await page.waitForSelector(".plot-workbench-preview-page", {timeout: 60_000});
                await page.waitForFunction(() => document.body.innerText.includes("剧本工作台"), {timeout: 60_000});
                await page.waitForSelector("[data-workbench-scene-id]", {timeout: 60_000});
                await page.waitForTimeout(250);
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

function isTransientOptimizeFailure(failures: string[]): boolean {
    return failures.some((failure) => failure.includes("Outdated Optimize Dep") || failure.includes(":504:"));
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
