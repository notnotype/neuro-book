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
        const build = await readFile(resolve("desktop/spikes/electron/build.mjs"), "utf8");
        const main = await readFile(resolve("desktop/spikes/electron/src/main.ts"), "utf8");
        const packager = await readFile(resolve("desktop/spikes/package-portable.mjs"), "utf8");

        expect(build).toContain('format: "cjs"');
        expect(build).toContain('naming: "preload.cjs"');
        expect(main).toContain('resolve(import.meta.dirname, "preload.cjs")');
        expect(packager).toContain('join(envelopeDist, "preload.cjs")');
        expect(packager).toContain('join(appStagingRoot, "preload.cjs")');
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
    });

    it("keeps title-bar menus responsive and reserves explicit drag and control zones", async () => {
        const titleBar = await readFile(resolve("app/components/common/DesktopTitleBar.vue"), "utf8");

        expect(titleBar).toContain("useWorkbenchChrome");
        expect(titleBar).toContain("resolveTitleBarMenuPresentation");
        expect(titleBar).toContain("ResizeObserver");
        expect(titleBar).toContain("titlebar-area-width");
        expect(titleBar).toContain("desktop-title-bar__mode");
        expect(titleBar).toContain("toggleLayoutMode");
        expect(titleBar).toContain("grid-template-columns: auto minmax(120px, 1fr) auto auto");
        expect(titleBar).toContain("compactMenuItemKeydown");
        expect(titleBar).not.toContain("color-mix(in srgb, var(--bg-main) 92%, transparent)");
    });
});
