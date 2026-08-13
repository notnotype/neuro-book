import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Desktop UI shell contract", () => {
    it("keeps the custom title bar in document flow so it cannot cover the page", async () => {
        const titleBar = await readFile(resolve("app/components/common/DesktopTitleBar.vue"), "utf8");
        const appShell = await readFile(resolve("app/app.vue"), "utf8");

        expect(titleBar).not.toMatch(/position:\s*fixed/u);
        expect(titleBar).toMatch(/position:\s*relative/u);
        expect(titleBar).toContain("data-tauri-drag-region");
        expect(appShell).not.toContain("padding-top: 36px");
        expect(appShell).toContain("height: calc(100dvh - 36px)");
        expect(appShell).toContain("min-height: 0");
        expect(appShell).toContain(".desktop-page-shell > *");
        expect(appShell).toContain("height: 100%");
    });

    it("uses a sandbox-compatible CommonJS preload and wires the packaged path", async () => {
        const build = await readFile(resolve("desktop/electron/build.mjs"), "utf8");
        const main = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        const packager = await readFile(resolve("desktop/packaging/package-portable.mjs"), "utf8");

        expect(build).toContain('format: "cjs"');
        expect(build).toContain('naming: "preload.cjs"');
        expect(main).toContain('resolve(import.meta.dirname, "preload.cjs")');
        expect(packager).toContain('join(envelopeDist, "preload.cjs")');
        expect(packager).toContain('join(appStagingRoot, "preload.cjs")');
    });

    it("shows the main window on a local startup page before Product ready", async () => {
        const build = await readFile(resolve("desktop/electron/build.mjs"), "utf8");
        const main = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        const preload = await readFile(resolve("desktop/electron/src/preload.ts"), "utf8");
        const startup = await readFile(resolve("desktop/electron/src/startup.html"), "utf8");
        const packager = await readFile(resolve("desktop/packaging/package-portable.mjs"), "utf8");

        expect(build).toContain('resolve(root, "src", "startup.html")');
        expect(main).toContain("createInteractiveWindow(config)");
        expect(main).toContain("await window.loadFile(startupPagePath())");
        expect(main).toContain("const localLaunch =");
        expect(main).toContain("neurobook:desktop:startup-action");
        expect(main).toContain("assertStartupFrame");
        expect(preload).toContain('window.location.protocol === "file:"');
        expect(preload).toContain("neuroBookStartup");
        expect(startup).toContain("data-stage");
        expect(startup).toContain("data-action=\"repair\"");
        expect(packager).toContain('join(envelopeDist, "startup.html")');
        expect(packager).toContain('join(appStagingRoot, "startup.html")');
    });
    it("把 Supervisor quick/full 阶段投影为不同的启动授权文案", async () => {
        const main = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        const supervisor = await readFile(resolve("packages/neuro-book-manager/src/desktop-supervisor.ts"), "utf8");
        const startDesktop = supervisor.slice(
            supervisor.indexOf("async function startDesktop("),
            supervisor.indexOf("async function verifyReceipt("),
        );

        expect(main).toContain('"quick-verify": "快速确认 Product..."');
        expect(main).toContain('"full-verify": "完整验证 Product..."');
        expect(main).toContain('event.verification === "quick"');
        expect(main).toContain("Product 启动授权已确认。");
        expect(main).toContain('event.verification === "full"');
        expect(main).toContain("Product 完整验证完成。");
        expect(startDesktop).toContain("authorizeProductRuntimeReceiptControlPlane");
        expect(startDesktop).toContain('stage: "quick-verify"');
        expect(startDesktop).toContain('verification: "quick"');
        expect(startDesktop).not.toContain('stage: "full-verify"');
        expect(startDesktop).not.toContain('verification: "full"');
        expect(supervisor).toContain('stage: "full-verify"');
        expect(supervisor).toContain('verification: "full"');
    });

    it("uses one persistent Activity Bar instead of page-owned horizontal headers", async () => {
        const indexPage = await readFile(resolve("app/pages/index.vue"), "utf8");
        const picker = await readFile(resolve("app/components/novel-ide/ProjectPickerScreen.vue"), "utf8");
        const activityBar = await readFile(resolve("app/components/novel-ide/NovelIdeActivityBar.vue"), "utf8");

        expect(indexPage).toContain("NovelIdeActivityBar");
        expect(indexPage).not.toContain("NovelIdeHeader");
        expect(picker).not.toContain("<header");
        expect(picker).not.toContain("header-actions");
        expect(activityBar).toContain("createWorkbenchActivityItems");
        expect(activityBar).toContain("resolveActivityBarSecondaryItems");
        expect(activityBar).not.toContain("useAgentJobsFeed");
        expect(activityBar).toContain("NovelIdeAccountMenu");
        expect(activityBar).toContain("ide.activityBar.moreActions");
        expect(activityBar).not.toContain('"user-assets"');
        expect(activityBar).not.toContain('"jobs"');
    });

    it("keeps title-bar menus responsive and exposes project, search, and Agent panel controls", async () => {
        const titleBar = await readFile(resolve("app/components/common/DesktopTitleBar.vue"), "utf8");
        const indexPage = await readFile(resolve("app/pages/index.vue"), "utf8");
        const welcome = await readFile(resolve("app/components/markdown-studio/MarkdownStudioWelcome.vue"), "utf8");

        expect(titleBar).toContain("useWorkbenchChrome");
        expect(titleBar).toContain("resolveTitleBarMenuPresentation");
        expect(titleBar).toContain("ResizeObserver");
        expect(titleBar).toContain("titlebar-area-width");
        expect(titleBar).toContain('data-titlebar-action="project-switcher"');
        expect(titleBar).toContain("data-titlebar-search");
        expect(titleBar).toContain('data-titlebar-action="toggle-agent-panel"');
        expect(titleBar).toContain(':data-project-root="item.projectRoot ?? \'\'"');
        expect(titleBar).toContain("openBookshelf");
        expect(titleBar).toContain("switchProject");
        expect(titleBar).toContain("toggleAgentPanel");
        expect(titleBar).not.toContain("toggleLayoutMode");
        expect(titleBar).not.toContain("toggleStudioPanel");
        expect(titleBar).toContain("grid-template-columns: auto minmax(120px, 1fr) auto auto");
        expect(titleBar).toContain("compactMenuItemKeydown");
        expect(titleBar).not.toContain("color-mix(in srgb, var(--bg-main) 92%, transparent)");
        expect(indexPage).toContain("agentPanelMaxWidth");
        expect(indexPage).toContain("agentPanelOverlay");
        expect(indexPage).toContain("data-agent-panel");
        expect(welcome).toContain("welcome-action-grid");
        expect(welcome).not.toContain("studio-agent-modes-grid");
        expect(welcome).not.toContain("welcome-agent-card");
    });

    it("uses one opaque dialog surface language without blur and keeps full dialogs inset", async () => {
        const dialog = await readFile(resolve("app/components/common/Dialog.vue"), "utf8");
        const dialogWindow = await readFile(resolve("app/components/common/DialogWindow.vue"), "utf8");

        expect(dialog).toContain('overlayType: "opaque"');
        expect(dialog).not.toContain('"blur"');
        expect(dialog).not.toContain("backdrop-blur");
        expect(dialog).toContain('width: "min(1120px, calc(100vw - 48px))"');
        expect(dialog).toContain('height: "min(640px, calc(100dvh - 80px))"');
        expect(dialog).toContain("data-dialog-size");
        expect(dialogWindow).toContain("data-dialog-window");
        expect(dialog).toContain("0 18px 44px");
        expect(dialogWindow).not.toContain("backdrop-filter");
        expect(dialogWindow).toContain("background: var(--bg-panel)");
        expect(dialogWindow).toContain("0 18px 44px");
    });
});
