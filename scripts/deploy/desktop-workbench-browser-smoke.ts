import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {chromium, type BrowserContext, type Page} from "playwright-core";

type SmokeOptions = {
    url: string;
    browserExecutable: string;
    evidenceDir: string;
    headless: boolean;
};

type Geometry = {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
};

type SmokeEvidence = {
    url: string;
    projectRoot: string;
    desktopGeometry: {
        titleBar: Geometry;
        pageShell: Geometry;
        activityBar: Geometry;
    };
    browserGeometry: {
        pageRoot: Geometry;
        activityBar: Geometry;
    };
    desktopInteractions: {
        welcome: {
            clientHeight: number;
            scrollHeight: number;
        };
        agentPanel: {
            initialWidth: number;
            resizedWidth: number;
        };
        dialog: {
            surface: Geometry;
            overlayBackgroundColor: string;
            overlayBackdropFilter: string;
            surfaceBackgroundColor: string;
            surfaceBoxShadow: string;
        };
    };
    menuPresentation: Record<string, "full" | "compact">;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await runDesktopWorkbenchBrowserSmoke(parseOptions(process.argv.slice(2)));
}

/**
 * 使用普通 Chromium + mock DesktopBridge 验证共享 Workbench Chrome。
 * 原生拖动、Snap Layout、托盘和窗口按钮仍由真实 Envelope 验收。
 */
export async function runDesktopWorkbenchBrowserSmoke(options: SmokeOptions): Promise<void> {
    if (process.platform === "win32" && typeof Bun !== "undefined") {
        throw new Error("Desktop Workbench Playwright smoke 必须由 Node 运行。");
    }
    await mkdir(options.evidenceDir, {recursive: true});
    const browser = await chromium.launch({
        executablePath: options.browserExecutable,
        headless: options.headless,
        timeout: 60_000,
    });
    try {
        const desktop = await browser.newContext({viewport: {width: 1440, height: 900}});
        await installDesktopBridge(desktop, options.url);
        const desktopPage = await desktop.newPage();
        await openWorkbench(desktopPage, options.url);
        const desktopGeometry = await verifyDesktopBookshelf(desktopPage, options.evidenceDir);
        const menuPresentation = await verifyResponsiveMenus(desktopPage);
        await verifyBookshelfSettings(desktopPage);
        const projectRoot = await ensureAcceptanceProject(desktopPage);
        const desktopInteractions = await verifyDesktopProject(
            desktopPage,
            options.url,
            projectRoot,
            options.evidenceDir,
        );
        await desktop.close();

        const browserContext = await browser.newContext({viewport: {width: 1024, height: 768}});
        const browserPage = await browserContext.newPage();
        await openWorkbench(browserPage, projectUrl(options.url, projectRoot));
        const browserGeometry = await verifyBrowserProject(browserPage, options.evidenceDir);
        await browserContext.close();

        const evidence: SmokeEvidence = {
            url: options.url,
            projectRoot,
            desktopGeometry,
            browserGeometry,
            desktopInteractions,
            menuPresentation,
        };
        await writeFile(
            resolve(options.evidenceDir, "desktop-workbench-browser-smoke.json"),
            `${JSON.stringify(evidence, null, 2)}\n`,
            "utf8",
        );
        console.log(`Desktop Workbench browser smoke passed: ${options.url}`);
    } finally {
        await browser.close();
    }
}

async function installDesktopBridge(context: BrowserContext, origin: string): Promise<void> {
    const desktopOrigin = JSON.stringify(new URL(origin).origin);
    await context.addInitScript({
        content: `(() => {
            const desktopOrigin = ${desktopOrigin};
            const menuListeners = new Set();
            let settings = {
                schema: "nbook.desktop-settings/v1",
                zoomFactor: 1,
                trayEnabled: true,
                closeBehavior: "ask",
            };
            Object.defineProperty(window, "neuroBookDesktop", {
                configurable: false,
                enumerable: true,
                writable: false,
                value: {
                    schema: "nbook.desktop-bridge/v2",
                    status: async () => ({
                        schema: "nbook.desktop-bridge/v2",
                        envelope: "electron",
                        connection: "local",
                        version: "workbench-smoke",
                        origin: desktopOrigin,
                        insecureRemote: false,
                        platform: "windows",
                        menuPresentation: "renderer",
                        windowControls: "custom",
                    }),
                    setAppearance: async () => {},
                    settings: async () => settings,
                    updateSettings: async (patch) => {
                        settings = {...settings, ...patch};
                        return settings;
                    },
                    window: async () => {},
                    menu: async (command) => {
                        for (const listener of menuListeners) listener(command);
                    },
                    onMenuCommand: (listener) => {
                        menuListeners.add(listener);
                        return () => menuListeners.delete(listener);
                    },
                },
            });
        })();`,
    });
}

async function openWorkbench(page: Page, url: string): Promise<void> {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30_000});
    if (new URL(page.url()).pathname === "/login") {
        throw new Error("Desktop Workbench smoke 需要在关闭认证的隔离 State Root 中运行。");
    }
    await page.locator(".novel-ide-page").waitFor({state: "visible", timeout: 30_000});
    await page.locator(".workbench-activity-bar").waitFor({state: "visible", timeout: 30_000});
}

async function verifyDesktopBookshelf(
    page: Page,
    evidenceDir: string,
): Promise<SmokeEvidence["desktopGeometry"]> {
    const desktopState = await page.evaluate(() => ({
        bridgeAvailable: Boolean(window.neuroBookDesktop),
        bridgeSchema: window.neuroBookDesktop?.schema ?? null,
        bodyClasses: document.body.className,
    }));
    assert(
        desktopState.bridgeAvailable && desktopState.bridgeSchema === "nbook.desktop-bridge/v2",
        `DesktopBridge v2 未注入页面：${JSON.stringify(desktopState)}`,
    );
    await expectCount(page, ".desktop-title-bar", 1, "Desktop 只能有一个横向标题栏");
    await expectCount(page, ".ide-header", 0, "旧 IDE Header 必须删除");
    await expectCount(page, ".workbench-activity-bar", 1, "Activity Bar 必须常驻");
    await expectCount(page, '[data-activity-id="home"]', 0, "Desktop 书架入口必须移到标题栏");
    await expectCount(page, '[data-activity-id="jobs"]', 0, "Activity Bar 不再展示后台任务中心");
    await expectCount(page, '[data-activity-id="user-assets"]', 0, "Activity Bar 不再展示用户资产");
    await expectCount(page, '[data-activity-id="agent-mode"]', 0, "Desktop 不再暴露 Agent 整页模式入口");
    await page.locator('[data-titlebar-action="project-switcher"]').waitFor({state: "visible"});
    await page.locator("[data-titlebar-search]").waitFor({state: "visible"});
    assert(await page.locator("[data-titlebar-search]").isDisabled(), "标题栏搜索占位必须明确禁用");
    await verifyTitleBarOrder(page);
    await verifyActivityBarOrder(page);
    const titleBar = await geometry(page, ".desktop-title-bar");
    const pageShell = await geometry(page, ".desktop-page-shell");
    const activityBar = await geometry(page, ".workbench-activity-bar");
    assertNear(titleBar.y, 0, "Desktop 标题栏 y");
    assertNear(titleBar.height, 36, "Desktop 标题栏高度");
    assertNear(pageShell.y, 36, "Desktop 内容起点");
    assertNear(activityBar.y, 36, "Activity Bar 起点");
    await verifyActivityFooter(page, activityBar);
    await page.screenshot({path: resolve(evidenceDir, "desktop-bookshelf.png")});
    return {titleBar, pageShell, activityBar};
}

async function verifyResponsiveMenus(page: Page): Promise<Record<string, "full" | "compact">> {
    const result: Record<string, "full" | "compact"> = {};
    for (const width of [800, 1024, 1440]) {
        await page.setViewportSize({width, height: 900});
        await page.waitForTimeout(80);
        result[String(width)] = await currentMenuPresentation(page);
        await assertTitleBarRegionsDoNotOverlap(page);
    }

    await page.setViewportSize({width: 1440, height: 900});
    const projectMenu = page.locator('[data-titlebar-action="project-switcher"]');
    await projectMenu.focus();
    await projectMenu.press("ArrowDown");
    await assertFocused(page, '[data-menu="project"] [role="menuitem"]');
    await page.keyboard.press("Escape");
    await assertFocused(page, '[data-titlebar-action="project-switcher"]');

    const fileMenu = page.locator('[data-menu-button="File"]');
    await fileMenu.focus();
    await fileMenu.press("ArrowDown");
    await assertFocused(page, '[data-menu="File"] [role="menuitem"]');
    await page.keyboard.press("Escape");
    await assertFocused(page, '[data-menu-button="File"]');

    await page.setViewportSize({width: 480, height: 760});
    await page.locator('[data-menu-button="compact"]').waitFor({state: "visible", timeout: 2_000});
    assert(await currentMenuPresentation(page) === "compact", "480px 下菜单必须整体折叠");
    const compactMenu = page.locator('[data-menu-button="compact"]');
    await compactMenu.focus();
    await compactMenu.press("ArrowDown");
    await assertFocused(page, '[data-menu="compact"] [role="menuitem"]');
    await page.keyboard.press("Escape");
    await assertFocused(page, '[data-menu-button="compact"]');
    await page.setViewportSize({width: 1440, height: 900});
    return result;
}

async function verifyBookshelfSettings(page: Page): Promise<void> {
    await page.locator('[data-activity-id="settings"]').click();
    const title = page.getByText(/^(配置中心|Settings)$/u).first();
    await title.waitFor({state: "visible", timeout: 10_000});
    const projectScope = page.getByRole("button", {name: /^(项目配置|Project Config)$/u});
    assert(await projectScope.isDisabled(), "书架页 Project 设置入口必须禁用");
    await page.keyboard.press("Escape");
    await title.waitFor({state: "hidden", timeout: 10_000});
}

async function ensureAcceptanceProject(page: Page): Promise<string> {
    const listResponse = await page.request.get(new URL("/api/projects", page.url()).href);
    assert(listResponse.ok(), `读取 Project 列表失败：HTTP ${listResponse.status()}`);
    const listPayload = await listResponse.json() as {projects?: Array<{projectRoot?: string}>};
    const existing = listPayload.projects?.find((project) => typeof project.projectRoot === "string")?.projectRoot;
    if (existing) return existing;

    const createResponse = await page.request.post(new URL("/api/projects", page.url()).href, {
        data: {
            title: `Desktop Workbench ${Date.now()}`,
            summary: "Task 143 browser smoke",
        },
    });
    assert(createResponse.ok(), `创建验收 Project 失败：HTTP ${createResponse.status()}`);
    const created = await createResponse.json() as {project?: {projectRoot?: string}};
    const projectRoot = created.project?.projectRoot;
    assert(typeof projectRoot === "string" && projectRoot.length > 0, "创建 Project 未返回 projectRoot");
    return projectRoot;
}

async function verifyDesktopProject(
    page: Page,
    baseUrl: string,
    projectRoot: string,
    evidenceDir: string,
): Promise<SmokeEvidence["desktopInteractions"]> {
    await page.setViewportSize({width: 1280, height: 840});
    await openWorkbench(page, projectUrl(baseUrl, projectRoot));
    const filesButton = page.locator('[data-activity-id="files"]');
    await filesButton.waitFor({state: "visible", timeout: 30_000});
    await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>('[data-activity-id="files"]')?.disabled,
        undefined,
        {timeout: 30_000},
    );
    assert(!await filesButton.isDisabled(), "Project 工作面 Files 入口不应禁用");

    const welcome = await verifyWelcomeFitsViewport(page, evidenceDir);
    await verifyProjectSwitcher(page, projectRoot);
    const dialog = await verifyWorldEngineDialog(page, evidenceDir);

    const filePath = `manuscript/desktop-workbench-${Date.now()}.md`;
    const createFileResponse = await page.request.post(new URL("/api/workspace-files/create-file", page.url()).href, {
        data: {
            projectRoot,
            path: filePath,
            content: "# Desktop Workbench\n\n用于 Task 143 Inline Agent 验收。\n",
        },
    });
    assert(createFileResponse.ok(), `创建 Inline 验收文件失败：HTTP ${createFileResponse.status()}`);
    await openWorkbench(page, projectUrl(baseUrl, projectRoot, filePath));
    const promptBar = page.locator(".ide-prompt-bar");
    await promptBar.waitFor({state: "visible", timeout: 30_000});
    await expectCount(page, ".mode-transition-agent", 0, "IDE 模式不应隐藏挂载 Agent Surface");
    const expandBar = page.locator('[data-inline-agent-action="expand-bar"]');
    if (await expandBar.count()) {
        await expandBar.click();
    }
    await page.locator('[data-inline-agent-action="create-session"]').click();
    const sessionMenu = page.locator('[data-inline-agent-action="session-menu"]');
    await page.waitForFunction(
        () => Boolean(document.querySelector('[data-inline-agent-action="session-menu"]')?.getAttribute("data-inline-agent-session-id")),
        undefined,
        {timeout: 30_000},
    );
    assert(Number(await sessionMenu.getAttribute("data-inline-agent-session-id")) > 0, "Inline Session 创建后必须成为当前 Session");
    await expectCount(page, ".mode-transition-agent", 0, "Inline Session 创建后仍不应提前挂载 Agent Surface");

    const agentToggle = page.locator('[data-titlebar-action="toggle-agent-panel"]');
    assert(!await agentToggle.isDisabled(), "Project 工作面标题栏 Agent 按钮不应禁用");
    await agentToggle.click();
    const agentPanel = page.locator("[data-agent-panel]");
    await agentPanel.waitFor({state: "visible", timeout: 30_000});
    await page.locator('.novel-ide-page[data-workbench-layout-mode="ide"]').waitFor({state: "visible", timeout: 30_000});
    assert(await agentToggle.getAttribute("aria-pressed") === "true", "Agent 按钮打开后必须反映面板状态");
    await expectCount(page, '[data-activity-id="agent-mode"]', 0, "Agent 面板不应恢复整页模式入口");
    const initialPanel = await geometry(page, "[data-agent-panel]");
    const resizeHandle = page.locator("[data-agent-panel-resize-handle]");
    const resizeBox = await resizeHandle.boundingBox();
    assert(resizeBox !== null, "Agent 面板调宽手柄缺失");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x - 72, resizeBox.y + resizeBox.height / 2, {steps: 6});
    await page.mouse.up();
    await page.waitForTimeout(160);
    const resizedPanel = await geometry(page, "[data-agent-panel]");
    assert(
        resizedPanel.width >= initialPanel.width + 48,
        `Agent 面板拖宽未生效：${String(initialPanel.width)} -> ${String(resizedPanel.width)}`,
    );
    await page.screenshot({path: resolve(evidenceDir, "desktop-agent-panel.png")});
    await agentToggle.click();
    await agentPanel.waitFor({state: "detached", timeout: 30_000});
    await expectCount(page, ".ide-prompt-bar", 1, "关闭 Agent 面板后只能保留一个 Inline Prompt Bar");
    await promptBar.waitFor({state: "visible", timeout: 30_000});
    await page.waitForTimeout(450);
    await page.screenshot({path: resolve(evidenceDir, "desktop-project.png")});
    return {
        welcome,
        agentPanel: {
            initialWidth: initialPanel.width,
            resizedWidth: resizedPanel.width,
        },
        dialog,
    };
}

async function verifyBrowserProject(
    page: Page,
    evidenceDir: string,
): Promise<SmokeEvidence["browserGeometry"]> {
    await expectCount(page, ".desktop-title-bar", 0, "B/S 不得绘制 Desktop 标题栏");
    await expectCount(page, ".desktop-page-shell", 0, "B/S 不得产生 36px Desktop shell");
    const pageRoot = await geometry(page, ".novel-ide-page");
    const activityBar = await geometry(page, ".workbench-activity-bar");
    assertNear(pageRoot.y, 0, "B/S 页面起点");
    assertNear(activityBar.y, 0, "B/S Activity Bar 起点");
    await expectCount(page, '[data-activity-id="agent-mode"]', 0, "B/S 不再暴露 Agent 整页模式");
    const agentPanelButton = page.locator('[data-activity-id="agent-panel"]');
    await agentPanelButton.waitFor({state: "visible", timeout: 30_000});
    await agentPanelButton.click();
    await page.locator(".mode-transition-agent").waitFor({state: "visible", timeout: 30_000});
    await page.locator('.novel-ide-page[data-workbench-layout-mode="ide"]').waitFor({state: "visible", timeout: 30_000});
    await expectCount(page, ".workbench-activity-bar", 1, "B/S Agent 面板仍必须保留 Activity Bar");
    await page.screenshot({path: resolve(evidenceDir, "browser-project.png")});
    return {pageRoot, activityBar};
}

async function verifyActivityFooter(page: Page, activityBar: Geometry): Promise<void> {
    const account = await geometry(page, '[data-activity-id="account"]');
    const settings = await geometry(page, '[data-activity-id="settings"]');
    assert(settings.bottom <= activityBar.bottom + 1, "Settings 超出 Activity Bar");
    assert(activityBar.bottom - settings.bottom <= 12, "Settings 未固定在 Activity Bar 底部");
    assert(account.bottom <= settings.top + 1, "Account 与 Settings 顺序错误");
}

async function verifyTitleBarOrder(page: Page): Promise<void> {
    const regions = await Promise.all([
        geometry(page, ".desktop-title-bar__brand"),
        geometry(page, ".desktop-title-bar__menus"),
        geometry(page, '[data-titlebar-action="project-switcher"]'),
        geometry(page, "[data-titlebar-search]"),
        geometry(page, '[data-titlebar-action="toggle-agent-panel"]'),
        geometry(page, ".desktop-title-bar__window-controls"),
    ]);
    const labels = ["品牌", "应用菜单", "Project 切换", "搜索", "Agent", "窗口按钮"];
    for (let index = 0; index < regions.length - 1; index += 1) {
        const current = regions[index];
        const next = regions[index + 1];
        assert(
            current && next && current.right <= next.left + 1,
            `标题栏顺序错误：${labels[index]} 进入 ${labels[index + 1]} 区域`,
        );
    }
}

async function verifyActivityBarOrder(page: Page): Promise<void> {
    const ids = await page.locator(".workbench-activity-bar [data-activity-id]").evaluateAll((elements) => elements
        .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        })
        .map((element) => element.getAttribute("data-activity-id")));
    const expected = ["files", "characters", "plot", "world", "trace", "history", "account", "settings"];
    assert(
        JSON.stringify(ids) === JSON.stringify(expected),
        `Activity Bar 顺序错误：${JSON.stringify(ids)}`,
    );
}

async function verifyWelcomeFitsViewport(
    page: Page,
    evidenceDir: string,
): Promise<SmokeEvidence["desktopInteractions"]["welcome"]> {
    const welcome = page.locator(".studio-welcome-root");
    await welcome.waitFor({state: "visible", timeout: 30_000});
    const metrics = await welcome.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
    }));
    assert(
        metrics.scrollHeight <= metrics.clientHeight + 1,
        `欢迎页在 1280×840 下仍需纵向滚动：${String(metrics.scrollHeight)} > ${String(metrics.clientHeight)}`,
    );
    await page.screenshot({path: resolve(evidenceDir, "desktop-welcome.png")});
    return metrics;
}

async function verifyProjectSwitcher(page: Page, projectRoot: string): Promise<void> {
    const switcher = page.locator('[data-titlebar-action="project-switcher"]');
    await switcher.click();
    const activeProject = page.locator(`[data-menu="project"] [data-project-root="${projectRoot}"]`);
    await activeProject.waitFor({state: "visible", timeout: 10_000});
    assert(await activeProject.getAttribute("aria-current") === "page", "Project 下拉未标记当前 Project");
    await page.locator('[data-menu="project"] [data-project-root=""]').click();
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.has("project"), undefined, {
        timeout: 30_000,
    });
    await page.locator('[data-titlebar-action="project-switcher"]').click();
    const projectItem = page.locator(`[data-menu="project"] [data-project-root="${projectRoot}"]`);
    await projectItem.waitFor({state: "visible", timeout: 10_000});
    await projectItem.click();
    await page.waitForFunction(
        (expectedProjectRoot) => new URL(window.location.href).searchParams.get("project") === expectedProjectRoot,
        projectRoot,
        {timeout: 30_000},
    );
    await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>('[data-activity-id="files"]')?.disabled,
        undefined,
        {timeout: 30_000},
    );
}

async function verifyWorldEngineDialog(
    page: Page,
    evidenceDir: string,
): Promise<SmokeEvidence["desktopInteractions"]["dialog"]> {
    await page.locator('[data-activity-id="world"]').click();
    const workbench = page.locator(".world-engine-workbench-dialog");
    await workbench.waitFor({state: "visible", timeout: 30_000});
    const surface = page.locator(".nb-dialog-surface").filter({has: workbench});
    await page.waitForTimeout(240);
    const layout = await surface.evaluate((element) => {
        const value = element.getBoundingClientRect();
        const parent = element.parentElement;
        if (!parent) throw new Error("Dialog 遮罩层缺失");
        const overlayValue = parent.getBoundingClientRect();
        const overlayStyle = getComputedStyle(parent);
        const surfaceStyle = getComputedStyle(element);
        return {
            surface: {
                x: value.x,
                y: value.y,
                width: value.width,
                height: value.height,
                top: value.top,
                right: value.right,
                bottom: value.bottom,
                left: value.left,
            },
            overlay: {
                width: overlayValue.width,
                height: overlayValue.height,
                backgroundColor: overlayStyle.backgroundColor,
                backdropFilter: overlayStyle.backdropFilter,
            },
            surfaceStyle: {
                backgroundColor: surfaceStyle.backgroundColor,
                boxShadow: surfaceStyle.boxShadow,
            },
        };
    });
    assert(layout.surface.width <= 1201, `Full Dialog 宽度超过 1200px：${String(layout.surface.width)}`);
    assert(layout.surface.height <= 721, `Full Dialog 高度超过 720px：${String(layout.surface.height)}`);
    assert(
        layout.overlay.width - layout.surface.width >= 63,
        `Full Dialog 横向留白不足 64px：${String(layout.overlay.width - layout.surface.width)}`,
    );
    assert(
        layout.overlay.height - layout.surface.height >= 95,
        `Full Dialog 纵向留白不足 96px：${String(layout.overlay.height - layout.surface.height)}`,
    );
    assert(
        layout.overlay.backgroundColor !== "rgba(0, 0, 0, 0)" && layout.overlay.backgroundColor !== "transparent",
        `Dialog 遮罩没有变暗：${layout.overlay.backgroundColor}`,
    );
    assert(
        layout.overlay.backdropFilter === "none" || layout.overlay.backdropFilter === "",
        `Dialog 遮罩不应模糊背景：${layout.overlay.backdropFilter}`,
    );
    assert(isOpaqueColor(layout.surfaceStyle.backgroundColor), `Dialog 表面必须不透明：${layout.surfaceStyle.backgroundColor}`);
    assert(layout.surfaceStyle.boxShadow !== "none", "Dialog 表面必须保留统一阴影");
    await page.screenshot({path: resolve(evidenceDir, "desktop-world-dialog.png")});
    await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>('[data-testid="world-workbench-close"]')?.disabled,
        undefined,
        {timeout: 30_000},
    );
    await page.keyboard.press("Escape");
    await workbench.waitFor({state: "detached", timeout: 10_000});
    return {
        surface: layout.surface,
        overlayBackgroundColor: layout.overlay.backgroundColor,
        overlayBackdropFilter: layout.overlay.backdropFilter,
        surfaceBackgroundColor: layout.surfaceStyle.backgroundColor,
        surfaceBoxShadow: layout.surfaceStyle.boxShadow,
    };
}

async function assertTitleBarRegionsDoNotOverlap(page: Page): Promise<void> {
    const title = await geometry(page, ".desktop-title-bar__center");
    const controls = await geometry(page, ".desktop-title-bar__controls");
    assert(title.right <= controls.left + 1, "标题拖动区进入应用控制区");
    const windowControls = page.locator(".desktop-title-bar__window-controls");
    if (await windowControls.count()) {
        const nativeControls = await geometry(page, ".desktop-title-bar__window-controls");
        assert(controls.right <= nativeControls.left + 1, "应用控制进入窗口按钮安全区");
    }
}

async function currentMenuPresentation(page: Page): Promise<"full" | "compact"> {
    const full = await page.locator(".desktop-title-bar__menus").count();
    const compact = await page.locator('[data-menu-button="compact"]').count();
    assert(full + compact === 1, `标题栏菜单必须完整或紧凑二选一：full=${full}, compact=${compact}`);
    return full === 1 ? "full" : "compact";
}

async function assertFocused(page: Page, selector: string): Promise<void> {
    const focused = await page.locator(selector).first().evaluate((element) => element === document.activeElement);
    assert(focused, `焦点未落到 ${selector}`);
}

async function geometry(page: Page, selector: string): Promise<Geometry> {
    const rect = await page.locator(selector).first().evaluate((element) => {
        const value = element.getBoundingClientRect();
        return {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            left: value.left,
        };
    });
    return rect;
}

async function expectCount(page: Page, selector: string, expected: number, message: string): Promise<void> {
    const actual = await page.locator(selector).count();
    assert(actual === expected, `${message}：期望 ${String(expected)}，实际 ${String(actual)}`);
}

function projectUrl(baseUrl: string, projectRoot: string, openPath?: string): string {
    const url = new URL(baseUrl);
    url.pathname = "/";
    url.search = new URLSearchParams({
        project: projectRoot,
        ...(openPath ? {openPath} : {}),
    }).toString();
    return url.href;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, label: string): void {
    if (Math.abs(actual - expected) > 1) {
        throw new Error(`${label}：期望 ${String(expected)}，实际 ${String(actual)}`);
    }
}

function isOpaqueColor(color: string): boolean {
    const match = color.match(/^rgba?\((.+)\)$/u);
    if (!match) return color !== "transparent";
    const parts = match[1]?.split(",").map((part) => part.trim()) ?? [];
    if (parts.length < 4) return true;
    return Number(parts[3]) >= 0.99;
}

function parseOptions(args: string[]): SmokeOptions {
    const values = new Map<string, string>();
    let headless = true;
    for (let index = 0; index < args.length; index += 1) {
        const key = args[index];
        if (key === "--headed") {
            headless = false;
            continue;
        }
        const value = args[index + 1];
        if (!key?.startsWith("--") || !value) {
            throw new Error(`无效参数：${args.slice(index).join(" ")}`);
        }
        values.set(key, value);
        index += 1;
    }
    const url = values.get("--url");
    const browserExecutable = values.get("--browser-executable");
    if (!url || !browserExecutable) {
        throw new Error("用法：node --import tsx scripts/deploy/desktop-workbench-browser-smoke.ts --url <url> --browser-executable <path> [--evidence-dir <path>] [--headed]");
    }
    return {
        url: new URL(url).href,
        browserExecutable: resolve(browserExecutable),
        evidenceDir: resolve(values.get("--evidence-dir") ?? ".agent/tmp/desktop-workbench-browser-smoke"),
        headless,
    };
}
