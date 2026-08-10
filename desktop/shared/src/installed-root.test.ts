import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {requireInstalledManifest} from "./installed-root";

describe("installed Desktop root manifest gate", () => {
    it("fails closed when a canonical root has a locator but no installation manifest", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-installed-root-"));
        const desktopRoot = join(root, "user-desktop");
        try {
            await mkdir(desktopRoot, {recursive: true});
            expect(() => requireInstalledManifest(
                "C:\\Program Files\\NeuroBook",
                desktopRoot,
                {programFiles: "C:\\Program Files", localAppData: "C:\\Users\\test\\AppData\\Local"},
            )).toThrow("缺少 desktop-installation.json");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("rejects a manifest whose scope does not match the canonical root", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-installed-root-"));
        const desktopRoot = join(root, "user-desktop");
        try {
            await mkdir(desktopRoot, {recursive: true});
            await writeFile(join(desktopRoot, "desktop-installation.json"), JSON.stringify({
                schema: "nbook.desktop-installation/v3",
                installationId: "0394a453-2122-4b9a-ac58-f5063194893f",
                installationScope: "user",
                programRoot: ".",
                userRoots: {
                    state: {base: "local-app-data", path: "NeuroBook/data"},
                    cache: {base: "local-app-data", path: "NeuroBook/cache"},
                    desktop: {base: "local-app-data", path: "NeuroBook/desktop"},
                    webview: {base: "local-app-data", path: "NeuroBook/desktop/webview"},
                },
                envelope: "electron",
                channel: "canary",
                connection: {mode: "local"},
                providers: {
                    managerRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"a".repeat(64)}`},
                    applicationRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"a".repeat(64)}`},
                    tools: {
                        rg: {provider: "managed", version: "15.1.0", path: "tools/rg/rg.exe", sha256: `sha256:${"b".repeat(64)}`},
                        git: {provider: "managed", version: "2.41.0", path: "tools/git/cmd/git.exe", sha256: `sha256:${"c".repeat(64)}`, bashPath: "tools/git/usr/bin/bash.exe"},
                    },
                },
                components: [
                    {id: "product", version: "0.9.3", path: ".output", sha256: `sha256:${"d".repeat(64)}`},
                    {id: "bun", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"a".repeat(64)}`},
                    {id: "manager-cli", version: "0.1.0", path: "manager/neuro-book.mjs", sha256: `sha256:${"e".repeat(64)}`},
                    {id: "tool-pack", version: "portable", path: "tools", sha256: `sha256:${"f".repeat(64)}`},
                    {id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"1".repeat(64)}`},
                    {id: "electron-application", version: "0.9.3", path: "desktop/resources/app.asar", sha256: `sha256:${"2".repeat(64)}`},
                ],
                receipts: [
                    {id: "product", version: "0.9.3", path: ".output", sha256: `sha256:${"d".repeat(64)}`, source: "depot"},
                    {id: "bun", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"a".repeat(64)}`, source: "depot"},
                    {id: "manager-cli", version: "0.1.0", path: "manager/neuro-book.mjs", sha256: `sha256:${"e".repeat(64)}`, source: "depot"},
                    {id: "tool-pack", version: "portable", path: "tools", sha256: `sha256:${"f".repeat(64)}`, source: "depot"},
                    {id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"1".repeat(64)}`, source: "depot"},
                    {id: "electron-application", version: "0.9.3", path: "desktop/resources/app.asar", sha256: `sha256:${"2".repeat(64)}`, source: "depot"},
                ],
                uninstall: {
                    preserveStateRootByDefault: true,
                    deleteStateRootRequiresExplicit: true,
                    preserveExternalProjectWorkspace: true,
                },
                addCliToUserPath: false,
                installedAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
            }), "utf8");
            expect(() => requireInstalledManifest(
                "C:\\Program Files\\NeuroBook",
                desktopRoot,
                {programFiles: "C:\\Program Files", localAppData: "C:\\Users\\test\\AppData\\Local"},
            )).toThrow("installationScope 与 Installation Root 不一致");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("recognizes the real Windows environment variable names for user installs", () => {
        expect(() => requireInstalledManifest(
            "C:\\Users\\test\\AppData\\Local\\Programs\\NeuroBook",
            "C:\\Users\\test\\AppData\\Local\\NeuroBook\\desktop",
            {
                LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
                ProgramFiles: "C:\\Program Files",
            },
        )).toThrow("缺少 desktop-installation.json");
    });
});
