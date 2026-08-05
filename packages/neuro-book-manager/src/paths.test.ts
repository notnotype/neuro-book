import {join, resolve} from "node:path";

import {describe, expect, it} from "vitest";

import {installationPaths} from "#manager/paths";
import {
    INSTALLED_MACOS_ROOT_LOCATORS,
    INSTALLED_WINDOWS_ROOT_LOCATORS,
    INSTALLATION_SCOPED_ROOT_LOCATORS,
    PORTABLE_ROOT_LOCATORS,
    installationRootLocators,
    localAppDataRoot,
    macosDesktopInstallationRoot,
    resolveInstallationRoots,
    userAppDataRoot,
    userCacheRoot,
} from "#manager/root-locators";

describe("Installation Root 路径", () => {
    it("非桌面安装使用 Installation Root 内的明确子目录", () => {
        const root = resolve("fixtures", "neuro-book");
        const paths = installationPaths(root, INSTALLATION_SCOPED_ROOT_LOCATORS);
        expect(paths.state).toBe(join(root, "data"));
        expect(paths.cache).toBe(join(root, ".cache"));
        expect(paths.desktop).toBe(join(root, ".desktop"));
        expect(paths.webview).toBe(join(root, ".desktop", "webview"));
        expect(paths.manifest).toBe(join(root, ".deploy", "installation.json"));
    });

    it("Windows Portable 移动后四类 root 随 Installation Root 重新解析", () => {
        const root = resolve("fixtures", "neuro-book");
        const moved = resolve("fixtures", "moved-neuro-book");
        expect(resolveInstallationRoots(root, PORTABLE_ROOT_LOCATORS)).toEqual({
            state: join(root, "data"),
            cache: join(root, ".cache"),
            desktop: join(root, "data", ".desktop"),
            webview: join(root, "data", ".desktop", "webview"),
        });
        expect(resolveInstallationRoots(moved, PORTABLE_ROOT_LOCATORS).state).toBe(join(moved, "data"));
    });

    it("Installed Windows 使用 local-app-data Adapter，不随程序目录移动", () => {
        const localData = resolve("fixtures", "local-app-data");
        const roots = resolveInstallationRoots(
            resolve("fixtures", "neuro-book"),
            INSTALLED_WINDOWS_ROOT_LOCATORS,
            localData,
        );
        expect(roots).toEqual({
            state: join(localData, "NeuroBook", "data"),
            cache: join(localData, "NeuroBook", "cache"),
            desktop: join(localData, "NeuroBook", "desktop"),
            webview: join(localData, "NeuroBook", "desktop", "webview"),
        });
        expect(installationRootLocators("product-bun", "win32")).toBe(INSTALLED_WINDOWS_ROOT_LOCATORS);
        expect(installationRootLocators("product-bun", "linux")).toBe(INSTALLATION_SCOPED_ROOT_LOCATORS);
        expect(installationRootLocators("windows-portable", "win32")).toBe(PORTABLE_ROOT_LOCATORS);
    });

    it("macOS 用户级 Desktop 将 State/Desktop 放入 Application Support、Cache 放入 Caches", () => {
        const root = resolve("fixtures", "NeuroBook", "installation");
        const appSupport = resolve("fixtures", "Library", "Application Support");
        const caches = resolve("fixtures", "Library", "Caches");
        expect(resolveInstallationRoots(root, INSTALLED_MACOS_ROOT_LOCATORS, "unused", {
            userAppDataRoot: appSupport,
            userCacheRoot: caches,
        })).toEqual({
            state: join(appSupport, "NeuroBook", "data"),
            cache: join(caches, "NeuroBook"),
            desktop: join(appSupport, "NeuroBook", "desktop"),
            webview: join(appSupport, "NeuroBook", "desktop", "webview"),
        });
        expect(installationRootLocators("product-bun", "darwin")).toBe(INSTALLED_MACOS_ROOT_LOCATORS);
    });

    it("拒绝空、dot、绝对路径和向上逃逸", () => {
        for (const invalid of ["", ".", "../data", "data/../cache", "C:/data", "/data"]) {
            expect(() => resolveInstallationRoots("C:/NeuroBook", {
                ...PORTABLE_ROOT_LOCATORS,
                state: {base: "installation-root", path: invalid},
            }, "C:/LocalAppData")).toThrow();
        }
    });

    it("local-app-data Adapter 遵循宿主标准目录", () => {
        expect(localAppDataRoot({
            platform: "win32",
            environment: {LOCALAPPDATA: "C:/Users/test/AppData/Local"},
            homeDirectory: "C:/Users/test",
        })).toBe(resolve("C:/Users/test/AppData/Local"));
        expect(localAppDataRoot({
            platform: "linux",
            environment: {XDG_DATA_HOME: "/var/lib/test"},
            homeDirectory: "/home/test",
        })).toBe(resolve("/var/lib/test"));
        expect(userAppDataRoot({
            platform: "darwin",
            environment: {HOME: "/Users/test"},
            homeDirectory: "/fallback",
        })).toBe(resolve("/Users/test/Library/Application Support"));
        expect(userCacheRoot({
            platform: "darwin",
            environment: {HOME: "/Users/test"},
            homeDirectory: "/fallback",
        })).toBe(resolve("/Users/test/Library/Caches"));
        expect(macosDesktopInstallationRoot("/Users/test")).toBe(resolve("/Users/test/Library/Application Support/NeuroBook/installation"));
    });
});
