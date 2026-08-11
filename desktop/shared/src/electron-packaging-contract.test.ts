import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Electron portable packaging contract", () => {
    it("将壳代码归档到 app.asar，且图标保留为 native resource", async () => {
        const packager = await readFile(resolve("desktop/packaging/package-portable.mjs"), "utf8");
        expect(packager).toMatch(/createPackage\(appStagingRoot, join\(resourcesRoot, "app\.asar"\)\)/u);
        expect(packager).toContain('await rm(appStagingRoot, {recursive: true, force: true});');
        expect(packager).toContain('join(resourcesRoot, "icon.ico")');
        expect(packager).toContain('applicationPath: "desktop/resources/app.asar"');
        expect(packager).toContain('applicationSha256: `sha256:${await fileSha256(join(stageRoot, "desktop/resources/app.asar"))}`');
        expect(packager).not.toContain('join(targetRoot, "resources", "app", "main.mjs")');
        expect(packager).not.toContain('join(targetRoot, "resources", "app", "icon.ico")');
        expect(packager).toContain("portableTemplateTimestamp = verified.manifest.createdAt");
        expect(packager).not.toContain('const now = "2026-08-05T00:00:00.000Z"');
    });

    it("生产组包入口只生成 Electron Portable 和 Electron-only Depot", async () => {
        const packager = await readFile(resolve("desktop/packaging/package-portable.mjs"), "utf8");
        expect(packager).toContain("buildElectronPortable");
        expect(packager).toContain("neuro-book-electron-portable-win-x64");
        expect(packager).not.toContain("tauriExecutable");
        expect(packager).not.toContain("versions.tauri");
        expect(packager).not.toContain("NeuroBook-Tauri");
        expect(packager).not.toContain("--tauri-exe");
    });

    it("Portable 复用 Manager 的统一 runtime wrapper 合同", async () => {
        const packager = await readFile(resolve("desktop/packaging/package-portable.mjs"), "utf8");
        expect(packager).toContain("writeDesktopRuntimeWrappers");
        expect(packager).toContain("await writeDesktopRuntimeWrappers(stageRoot, installationManifest)");
    });

    it("运行时优先从 Electron resources 根读取托盘图标", async () => {
    const source = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        expect(source).toContain('resolve(process.resourcesPath, "icon.ico")');
        expect(source).toContain("existsSync(packagedIconPath)");
    });

    it("headless 支持单独的 forced shutdown smoke", async () => {
    const source = await readFile(resolve("desktop/electron/src/main.ts"), "utf8");
        expect(source).toContain('process.argv.includes("--desktop-force")');
        expect(source).toContain('running.lease.terminate("shutdown")');
        expect(source).toContain('shutdown: "forced"');
        expect(source).toContain('const headlessEntry = process.argv.includes("--desktop-headless") || process.argv.includes("--headless")');
        const fatalHandler = source.slice(source.indexOf("void dispatchEntry().catch"));
        expect(fatalHandler).toContain("if (managerEntry || headlessEntry)");
        expect(fatalHandler).toContain("app.exit(1)");
    });

    it("Manager 只有在复核安装清单和 Envelope 摘要后才允许自动启动", async () => {
        const source = await readFile(resolve("desktop/electron/src/manager-main.ts"), "utf8");
        const receipt = await readFile(resolve("desktop/electron/src/manager-launch-receipt.ts"), "utf8");
        expect(source).toContain("type ManagerLaunchReceipt");
        expect(source).toContain("launchReceipt = await createPhysicalLaunchReceipt(result.installationRoot)");
        expect(source).toContain("安装完成回执与当前 Installation Manifest 不一致");
        expect(source).not.toContain("if (!lastInstallationRoot)");
        expect(receipt).toContain('item.id === "electron-envelope"');
        expect(receipt).toContain('item.id === "electron-application"');
        expect(receipt).toContain('"Electron application"');
        expect(receipt).toContain("${label} checksum 不匹配");
        expect(source).toContain('from "original-fs"');
        expect(source).toContain("createPhysicalLaunchReceipt");
    });
});
