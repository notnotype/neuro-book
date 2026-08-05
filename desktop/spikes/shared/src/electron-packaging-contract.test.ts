import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Electron portable packaging contract", () => {
    it("将壳代码归档到 app.asar，且图标保留为 native resource", async () => {
        const packager = await readFile(resolve("desktop/spikes/package-portable.mjs"), "utf8");
        expect(packager).toMatch(/createPackage\(appStagingRoot, join\(resourcesRoot, "app\.asar"\)\)/u);
        expect(packager).toContain('await rm(appStagingRoot, {recursive: true, force: true});');
        expect(packager).toContain('join(resourcesRoot, "icon.ico")');
        expect(packager).not.toContain('join(targetRoot, "resources", "app", "main.mjs")');
        expect(packager).not.toContain('join(targetRoot, "resources", "app", "icon.ico")');
    });

    it("运行时优先从 Electron resources 根读取托盘图标", async () => {
        const source = await readFile(resolve("desktop/spikes/electron/src/main.ts"), "utf8");
        expect(source).toContain('resolve(process.resourcesPath, "icon.ico")');
        expect(source).toContain("existsSync(packagedIconPath)");
    });

    it("headless 支持单独的 forced shutdown smoke", async () => {
        const source = await readFile(resolve("desktop/spikes/electron/src/main.ts"), "utf8");
        expect(source).toContain('process.argv.includes("--t140-force")');
        expect(source).toContain('running.lease.terminate("shutdown")');
        expect(source).toContain('shutdown: "forced"');
    });
});
