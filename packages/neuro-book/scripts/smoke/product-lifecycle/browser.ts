import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {chromium, type BrowserContext, type Page, type Route} from "playwright-core";
import type {CheckId, RunningProduct, SmokeContext} from "./types";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "lifecycle-admin-password-123";
const STATE_DIRECTORY = "product-lifecycle";
const PROJECT_TITLE = "生命周期浏览器 Smoke 项目";
const PROJECT_SUMMARY = "L1/L9/L10 临时项目，不属于用户数据。";
const FILES = {
    index: "index.md",
    note: "lifecycle-smoke-note.md",
} as const;

/**
 * 在真实 Manager/Product 与 Chromium 中执行产品生命周期的浏览器切片。
 *
 * L1 建立项目、在隔离 State Root 的 Workspace 内准备文件，并从真实工作台文件树读回；
 * L9 在同一正常服务上拦截主页 Project Catalog 请求，验证浏览器内连接失败外壳与真实重试恢复；
 * L10 在同一浏览器上下文开两个窗口，关闭一个后继续从另一个窗口读文件。
 */
export async function runBrowserChecks(ctx: SmokeContext): Promise<void> {
    const selected = ["L1", "L9", "L10"] as const satisfies readonly CheckId[];
    if (!selected.some((id) => ctx.selected.has(id))) {
        return;
    }

    const stateRoot = join(ctx.tempRoot, STATE_DIRECTORY);
    const browserUserDataDir = join(ctx.tempRoot, "product-lifecycle-browser-user-data");
    let prepared = false;
    let product: RunningProduct | null = null;
    let productUsable = false;
    let browserContext: BrowserContext | null = null;
    let projectRoot: string | null = null;
    let projectFilesReady = false;

    const ensureProduct = async (id: CheckId): Promise<RunningProduct> => {
        if (product !== null && productUsable) {
            ctx.log(id, `复用已就绪 Product：${product.url}；stdout/stderr=${product.outputLogPath}`);
            return product;
        }
        if (!prepared) {
            await ctx.prepare(stateRoot, id);
            prepared = true;
        }
        product = await ctx.start(stateRoot, id, {ready: true});
        productUsable = true;
        ctx.log(id, `真实 Product 已由 Manager 就绪：${product.url}，port=${String(product.port)}，stateRoot=${stateRoot}`);
        return product;
    };

    const ensureBrowser = async (): Promise<BrowserContext> => {
        if (browserContext !== null) {
            return browserContext;
        }
        const userDataDir = browserUserDataDir;
        await mkdir(userDataDir, {recursive: true});
        browserContext = await chromium.launchPersistentContext(userDataDir, {
            executablePath: resolve(ctx.browserExecutable),
            headless: true,
            timeout: 60_000,
            viewport: {width: 1440, height: 1000},
        });
        ctx.log("setup", `Chromium 已启动，userDataDir=${userDataDir}`);
        return browserContext;
    };

    const ensurePageReady = async (page: Page, baseUrl: string): Promise<boolean> => {
        await page.goto(baseUrl, {waitUntil: "domcontentloaded", timeout: 30_000});
        const loggedIn = await loginIfNeeded(page);
        await page.waitForFunction(
            () => Boolean(document.querySelector("[data-project-picker-view], [data-role=files-explorer-view], [data-role=workbench-shell]")),
            undefined,
            {timeout: 30_000},
        );
        return loggedIn;
    };


    try {
        if (ctx.selected.has("L1")) {
            await ctx.check("L1", async (observe) => {
                const running = await ensureProduct("L1");
                const context = await ensureBrowser();
                const page = await context.newPage();
                attachPageEvidence(page, ctx, "L1");
                try {
                    const loggedInThroughUi = await ensurePageReady(page, running.url);
                    observe({id: "L1-login", result: loggedInThroughUi ? "pass" : "fail", evidence: loggedInThroughUi ? "Chromium 通过真实登录页提交用户名 admin 与生命周期 smoke 密码后进入产品主页。" : "未出现真实登录表单；不能声称已按合同完成 admin 登录。"});

                    const created = await createProjectThroughApi(page, PROJECT_TITLE, PROJECT_SUMMARY);
                    projectRoot = created.projectRoot;
                    observe({id: "L1-create-project", result: "pass", evidence: `真实 POST /api/projects 创建 Project：projectRoot=${created.projectRoot}，title=${created.title}`});

                    await seedProjectFiles(stateRoot, created.projectRoot);
                    projectFilesReady = true;
                    ctx.log("L1", `已在隔离 Workspace 写入真实项目文件：${FILES.index}、${FILES.note}`);
                    observe({id: "L1-seed-files", result: "pass", evidence: `临时 State Root 内按已发布 project.yaml 约束写入至少两个普通文件：${FILES.index}、${FILES.note}。`});

                    await page.goto(running.url, {waitUntil: "domcontentloaded", timeout: 30_000});
                    await page.waitForFunction(() => Boolean(document.querySelector("[data-project-picker-view]")), undefined, {timeout: 30_000});
                    const card = page.locator("[data-project-card]").filter({hasText: PROJECT_TITLE}).first();
                    await card.waitFor({state: "visible", timeout: 20_000});
                    const cardVisible = await card.isVisible();
                    await card.locator("button").first().click();
                    await page.locator("[data-role=files-explorer-view]").waitFor({state: "visible", timeout: 30_000});
                    await page.locator(`[data-role=workspace-file-row][data-path=\"${FILES.index}\"]`).waitFor({state: "visible", timeout: 30_000});
                    await page.locator(`[data-role=workspace-file-row][data-path=\"${FILES.note}\"]`).waitFor({state: "visible", timeout: 30_000});
                    const visibleFiles = await page.locator("[data-role=workspace-file-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-path")));
                    const workbenchText = await page.locator("body").textContent() ?? "";
                    const projectNameVisible = workbenchText.includes(PROJECT_TITLE);
                    observe({
                        id: "L1-workbench-files",
                        result: cardVisible && projectNameVisible && visibleFiles.includes(FILES.index) && visibleFiles.includes(FILES.note) ? "pass" : "fail",
                        evidence: `主页 Project 卡片可见=${String(cardVisible)}；工作台项目名可见=${String(projectNameVisible)}；真实资源管理器文件树=${JSON.stringify(visibleFiles)}。`,
                    });
                    await captureEvidence(page, ctx, "L1", "L1-workbench");
                } finally {
                    await page.close();
                }
            });
        }

        if (ctx.selected.has("L9")) {
            await ctx.check("L9", async (observe) => {
                const running = await ensureProduct("L9");
                const context = await ensureBrowser();
                const page = await context.newPage();
                const projectsRoutePattern = "**/api/projects**";
                let projectCatalogRouteHits = 0;
                let routeRemoved = false;
                const observed = new Set<string>();
                const record = (observation: Parameters<typeof observe>[0]): void => {
                    if (observed.has(observation.id)) return;
                    observed.add(observation.id);
                    observe(observation);
                };
                /**
                 * 当前主页由 ProjectPickerScreen 的 onMounted 真实调用 GET /api/projects；
                 * 暂以该 catalog 请求作为 browser-host 引导接口的替身，未来接入 browser-host
                 * 后应替换此规则，而不是伪造 Chromium network offline。
                 */
                const failProjectCatalogRoute = async (route: Route): Promise<void> => {
                    const request = route.request();
                    const requestUrl = request.url();
                    const parsedUrl = new URL(requestUrl);
                    if (parsedUrl.pathname !== "/api/projects" || request.method() !== "GET") {
                        await route.continue();
                        return;
                    }
                    projectCatalogRouteHits += 1;
                    await route.fulfill({
                        status: 500,
                        contentType: "application/json",
                        body: JSON.stringify({message: "browser smoke catalog failure"}),
                    });
                    ctx.log("L9", `已拦截主页真实 API：method=${request.method()} URL=${requestUrl} status=500`);
                };
                let l9Product: RunningProduct | null = running;
                attachPageEvidence(page, ctx, "L9");
                try {
                    await ensurePageReady(page, running.url);
                    if (projectRoot === null || !projectFilesReady) {
                        const created = await createProjectThroughApi(page, PROJECT_TITLE, PROJECT_SUMMARY);
                        projectRoot = created.projectRoot;
                        await seedProjectFiles(stateRoot, created.projectRoot);
                        projectFilesReady = true;
                        ctx.log("L9", `为独立 L9 运行准备真实 Project：projectRoot=${projectRoot}`);
                    }

                    await page.route(projectsRoutePattern, failProjectCatalogRoute);
                    await page.reload({waitUntil: "domcontentloaded", timeout: 30_000}).catch((error) => {
                        ctx.log("L9", `拦截后主页刷新返回异常：${String(error)}`);
                    });
                    await page.locator("[data-project-picker-view]").waitFor({state: "visible", timeout: 30_000}).catch((error) => {
                        ctx.log("L9", `拦截后未出现 Project Picker：${String(error)}`);
                    });
                    await page.locator("[data-project-picker-view] [role=alert]").waitFor({state: "visible", timeout: 30_000}).catch((error) => {
                        ctx.log("L9", `拦截后未出现失败 alert：${String(error)}`);
                    });

                    const failurePage = await readConnectionFailureSurface(page);
                    ctx.log("L9", `L9 failure raw page text：${failurePage.text}`);
                    await captureEvidence(page, ctx, "L9", "L9-browser-api-failure");
                    record({
                        id: "no-half-workbench",
                        result: failurePage.hasHalfWorkbench ? "fail" : "pass",
                        evidence: `失败请求后 files/workbench markers 存在=${String(failurePage.hasHalfWorkbench)}；raw page text=${failurePage.text}`,
                    });
                    record({
                        id: "failure-surface-with-retry",
                        result: projectCatalogRouteHits > 0 && failurePage.hasConnectionFailurePage && failurePage.hasRetry ? "pass" : "fail",
                        evidence: `真实 GET /api/projects 拦截命中=${String(projectCatalogRouteHits)}，HTTP=500；failure alert=${String(failurePage.hasConnectionFailurePage)}，真实 retry=${String(failurePage.hasRetry)}；raw page text=${failurePage.text}`,
                    });

                    await page.unroute(projectsRoutePattern, failProjectCatalogRoute);
                    routeRemoved = true;
                    const retryButton = page.locator("[data-project-picker-view] [role=alert]").getByRole("button", {name: /重试|retry/iu}).first();
                    const hasRetryButton = await retryButton.count() > 0;
                    if (hasRetryButton) {
                        await retryButton.click();
                    } else {
                        await page.reload({waitUntil: "domcontentloaded", timeout: 30_000}).catch((error) => {
                            ctx.log("L9", `解除拦截后刷新返回异常：${String(error)}`);
                        });
                        await loginIfNeeded(page).catch((error) => ctx.log("L9", `解除拦截后登录恢复失败：${String(error)}`));
                    }
                    await page.waitForFunction(
                        () => Boolean(document.querySelector("[data-project-picker-view] [data-project-card], [data-role=files-explorer-view], [data-workbench-shell]")),
                        undefined,
                        {timeout: 30_000},
                    ).catch((error) => ctx.log("L9", `真实 retry 后未出现 Project Picker/Workbench：${String(error)}`));

                    const recoveredPicker = await page.locator("[data-project-picker-view] [data-project-card]").count() > 0;
                    const recoveredWorkbench = await page.locator("[data-role=files-explorer-view], [data-workbench-shell], [data-role=workbench-shell], .workbench-shell").count() > 0;
                    if (recoveredPicker && projectRoot !== null) {
                        await openProjectAndFiles(page, PROJECT_TITLE).catch((error) => ctx.log("L9", `真实 retry 后打开 Project 失败：${String(error)}`));
                    }
                    const recoveredFiles = await page.locator("[data-role=workspace-file-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-path"))).catch((error) => { ctx.log("L9", `恢复文件树取证失败：${String(error)}`); return [] as string[]; });
                    const recoveredText = (await page.locator("body").textContent().catch((error) => { ctx.log("L9", `恢复正文取证失败：${String(error)}`); return ""; }))?.replace(/\s+/gu, " ").trim() ?? "";
                    ctx.log("L9", `L9 recovery raw page text：${recoveredText}`);
                    record({
                        id: "retry-recovery",
                        result: recoveredPicker || recoveredWorkbench ? "pass" : "fail",
                        evidence: `解除 route=${String(routeRemoved)} 后点击真实 retry/刷新；project picker=${String(recoveredPicker)}，workbench=${String(recoveredWorkbench)}，文件树=${JSON.stringify(recoveredFiles)}；raw page text=${recoveredText.slice(0, 500)}`,
                    });
                    await captureEvidence(page, ctx, "L9", "L9-browser-api-recovered");
                } catch (error) {
                    ctx.log("L9", `L9 browser API failure flow 异常：${String(error)}`);
                    record({id: "no-half-workbench", result: "fail", evidence: `L9 流程异常，无法确认无半工作台：${String(error)}`});
                    record({id: "failure-surface-with-retry", result: "fail", evidence: `L9 流程异常，无法确认失败外壳与 retry：${String(error)}`});
                    record({id: "retry-recovery", result: "fail", evidence: `L9 流程异常，无法确认解除拦截后的真实恢复：${String(error)}`});
                } finally {
                    await page.unroute(projectsRoutePattern, failProjectCatalogRoute).catch((error) => ctx.log("L9", `L9 route 收口失败：${String(error)}`));
                    if (l9Product !== null && product === l9Product) {
                        await l9Product.dispose();
                        ctx.log("L9", `前一 Product 已完成收口：${l9Product.outputLogPath}`);
                        productUsable = false;
                        product = null;
                        await rm(stateRoot, {recursive: true, force: true});
                        prepared = false;
                        projectRoot = null;
                        projectFilesReady = false;
                        ctx.log("L9", `L9 专属 State Root 已清理，L10 将重新准备：${stateRoot}`);
                    }
                }
            });
        }

        if (ctx.selected.has("L10")) {
            await ctx.check("L10", async (observe) => {
                const running = await ensureProduct("L10");
                const context = await ensureBrowser();
                const pageA = await context.newPage();
                const pageB = await context.newPage();
                attachPageEvidence(pageA, ctx, "L10");
                attachPageEvidence(pageB, ctx, "L10");
                try {
                    await ensurePageReady(pageA, running.url);
                    await ensurePageReady(pageB, running.url);
                    if (projectRoot === null || !projectFilesReady) {
                        const created = await createProjectThroughApi(pageA, PROJECT_TITLE, PROJECT_SUMMARY);
                        projectRoot = created.projectRoot;
                        await seedProjectFiles(stateRoot, created.projectRoot);
                        projectFilesReady = true;
                    }
                    await openProjectAndFiles(pageA, PROJECT_TITLE);
                    await openProjectAndFiles(pageB, PROJECT_TITLE);
                    const readyBeforeClose = await pageB.locator("[data-role=files-explorer-view]").count() > 0;
                    await pageA.close();
                    const readyHttp = await fetch(`${running.url}/api/app/version`, {redirect: "manual"}).then((response) => response.status === 200).catch((error: unknown) => { ctx.log("L10", `readyHTTP取证失败：${String(error)}`); return false; });
                    await pageB.reload({waitUntil: "domcontentloaded", timeout: 30_000});
                    await loginIfNeeded(pageB);
                    await pageB.waitForFunction(() => Boolean(document.querySelector("[data-role=files-explorer-view], [data-project-picker-view]")), undefined, {timeout: 30_000});
                    const rows = await pageB.locator("[data-role=workspace-file-row]").evaluateAll((items) => items.map((item) => item.getAttribute("data-path"))).catch((error) => { ctx.log("L10", `文件树取证失败：${String(error)}`); return [] as string[]; });
                    const fileRead = rows.includes(FILES.index) || rows.includes(FILES.note);
                    observe({id: "L10-window-isolation", result: readyBeforeClose && readyHttp && fileRead ? "pass" : "fail", evidence: `关闭窗口 A 后窗口 B 仍可重载；B 文件读取=${String(fileRead)}，readyHTTP=${String(readyHttp)}，Product port=${String(running.port)}。`});
                    await captureEvidence(pageB, ctx, "L10", "L10-window-b");
                } finally {
                    await pageA.close().catch((error) => ctx.log("L10", `窗口 A 收口失败：${String(error)}`));
                    await pageB.close().catch((error) => ctx.log("L10", `窗口 B 收口失败：${String(error)}`));
                }
            });
        }
    } finally {
        const currentProduct = product as RunningProduct | null;
        const currentBrowser = browserContext as BrowserContext | null;
        await currentBrowser?.close().catch((error: unknown) => ctx.log("setup", `Chromium 收口失败：${String(error)}`));
        browserContext = null;
        await currentProduct?.dispose().catch((error: unknown) => ctx.log("setup", `owned Product 收口失败：${String(error)}`));
        product = null;
        productUsable = false;
        await rm(browserUserDataDir, {recursive: true, force: true}).catch((error: unknown) => ctx.log("setup", `浏览器 userData 清理失败：${String(error)}`));
        await rm(stateRoot, {recursive: true, force: true}).catch((error: unknown) => ctx.log("setup", `生命周期 State Root 清理失败：${String(error)}`));
    }
}

async function loginIfNeeded(page: Page): Promise<boolean> {
    const username = page.locator('input[autocomplete="username"]');
    const password = page.locator('input[autocomplete="current-password"]');
    if (await username.count() === 0 || await password.count() === 0) {
        const response = await page.evaluate(async ({username: inputUsername, password: inputPassword}) => {
            const result = await fetch("/api/auth/login", {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({username: inputUsername, password: inputPassword}),
            });
            return {status: result.status, body: await result.text()};
        }, {username: ADMIN_USERNAME, password: ADMIN_PASSWORD});
        if (response.status !== 200) throw new Error(`登录表单不可见且直接登录失败：HTTP ${String(response.status)} ${response.body.slice(0, 300)}`);
        await page.reload({waitUntil: "domcontentloaded", timeout: 30_000});
        return true;
    }
    await username.fill(ADMIN_USERNAME);
    await password.fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname !== "/login", {timeout: 20_000});
    return true;
}

async function createProjectThroughApi(page: Page, title: string, summary: string): Promise<{projectRoot: string; title: string}> {
    const result = await page.evaluate(async ({title: inputTitle, summary: inputSummary}) => {
        const response = await fetch("/api/projects", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({title: inputTitle, summary: inputSummary}),
        });
        const body = await response.json() as {project?: {projectRoot?: unknown; title?: unknown}; projectRoot?: unknown; title?: unknown; message?: unknown};
        if (!response.ok) {
            throw new Error(`创建临时 Project 失败：HTTP ${String(response.status)} ${String(body.message ?? "")}`);
        }
        const project = body.project ?? body;
        const projectRoot = typeof project.projectRoot === "string" ? project.projectRoot : "";
        const createdTitle = typeof project.title === "string" ? project.title : inputTitle;
        if (!/^[^/\\.][^/\\]*$/u.test(projectRoot)) {
            throw new Error(`创建接口返回非法 projectRoot：${projectRoot}`);
        }
        return {projectRoot, title: createdTitle};
    }, {title, summary});
    return result;
}

async function seedProjectFiles(stateRoot: string, projectRoot: string): Promise<void> {
    const projectDirectory = join(stateRoot, "workspace", projectRoot);
    await mkdir(projectDirectory, {recursive: true});
    await writeFile(join(projectDirectory, FILES.index), "# 生命周期 Smoke\n\n真实文件树读取。\n", "utf8");
    await writeFile(join(projectDirectory, FILES.note), "L1/L9/L10 second file\n", "utf8");
    await readFile(join(projectDirectory, FILES.index), "utf8");
    await readFile(join(projectDirectory, FILES.note), "utf8");
}

async function openProjectAndFiles(page: Page, title: string): Promise<void> {
    await page.goto(new URL("/", page.url()).href, {waitUntil: "domcontentloaded", timeout: 30_000});
    if (await page.locator("[data-role=files-explorer-view]").count() > 0) {
        return;
    }
    await page.waitForFunction(() => Boolean(document.querySelector("[data-project-picker-view]")), undefined, {timeout: 30_000});
    const card = page.locator("[data-project-card]").filter({hasText: title}).first();
    await card.waitFor({state: "visible", timeout: 20_000});
    await card.locator("button").first().click();
    await page.locator("[data-role=files-explorer-view]").waitFor({state: "visible", timeout: 30_000});
}

async function readConnectionFailureSurface(page: Page): Promise<{hasConnectionFailurePage: boolean; hasRetry: boolean; hasHalfWorkbench: boolean; text: string}> {
    const text = (await page.locator("body").textContent())?.replace(/\s+/gu, " ").trim() ?? "";
    const failureAlert = page.locator("[data-project-picker-view] [role=alert]").first();
    const failureAlertText = await failureAlert.count() > 0
        ? (await failureAlert.textContent())?.replace(/\s+/gu, " ").trim() ?? ""
        : "";
    const hasRetry = await failureAlert.getByRole("button", {name: /重试|retry/iu}).count() > 0;
    const hasConnectionFailurePage = await failureAlert.count() > 0
        && /读取书架失败|加载.*失败|failed to load bookshelf|load bookshelf|连接失败|无法连接|服务端不可用|重新连接|连接中断|离线/iu.test(failureAlertText || text);
    const hasHalfWorkbench = await page.locator("[data-role=files-explorer-view], [data-workbench-shell], [data-role=workbench-shell], .workbench-shell").count() > 0;
    return {hasConnectionFailurePage, hasRetry, hasHalfWorkbench, text: text.slice(0, 500)};
}

function attachPageEvidence(page: Page, ctx: SmokeContext, id: string): void {
    page.on("console", (message) => {
        if (message.type() === "error") ctx.log(id, `浏览器 console.error：${message.text()}`);
    });
    page.on("pageerror", (error) => ctx.log(id, `浏览器 pageerror：${error.message}`));
}

async function captureEvidence(page: Page, ctx: SmokeContext, id: string, label = id): Promise<void> {
    await mkdir(ctx.evidenceRoot, {recursive: true});
    const safeId = label.replace(/[^A-Za-z0-9_-]/gu, "-");
    const screenshotPath = join(ctx.evidenceRoot, `${safeId}.png`);
    const outputPath = join(ctx.evidenceRoot, `${safeId}.txt`);
    await page.screenshot({path: screenshotPath, fullPage: true}).catch((error) => ctx.log("setup", `截图失败 ${screenshotPath}：${String(error)}`));
    const bodyText = (await page.locator("body").textContent())?.replace(/\s+/gu, " ").trim() ?? "";
    await writeFile(outputPath, `URL: ${page.url()}\nTitle: ${await page.title()}\nBody: ${bodyText.slice(0, 10_000)}\n`, "utf8").catch((error) => ctx.log("setup", `browser 输出保存失败 ${outputPath}：${String(error)}`));
    ctx.log(id, `Chromium 页面截图证据：${screenshotPath}；browser 输出：${outputPath}`);
}
