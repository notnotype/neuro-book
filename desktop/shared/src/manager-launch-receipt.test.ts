import {createHash} from "node:crypto";
import {existsSync, lstatSync, readFileSync} from "node:fs";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import {describe, expect, it} from "vitest";

import {
    createManagerLaunchReceipt,
    sameManagerLaunchReceipt,
} from "nbook/desktop/electron/src/manager-launch-receipt";

describe("Manager Electron launch receipt", () => {
    it("同时绑定 Electron executable 与 app.asar，任一壳代码篡改都 fail closed", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-launch-receipt-"));
        const localAppData = join(root, "LocalAppData");
        const installationRoot = join(localAppData, "Programs", "NeuroBook");
        const executablePath = join(installationRoot, "desktop", "NeuroBook-Electron.exe");
        const applicationPath = join(installationRoot, "desktop", "resources", "app.asar");
        const manifestPath = join(localAppData, "NeuroBook", "desktop", "desktop-installation.json");
        try {
            await mkdir(dirname(executablePath), {recursive: true});
            await mkdir(dirname(applicationPath), {recursive: true});
            await mkdir(dirname(manifestPath), {recursive: true});
            await writeFile(executablePath, "electron-runtime", "utf8");
            await writeFile(applicationPath, "electron-application", "utf8");
            const components = [
                {
                    id: "electron-envelope",
                    version: "43.2.0",
                    path: "desktop/NeuroBook-Electron.exe",
                    sha256: digest("electron-runtime"),
                },
                {
                    id: "electron-application",
                    version: "0.9.3",
                    path: "desktop/resources/app.asar",
                    sha256: digest("electron-application"),
                },
            ];
            await writeFile(manifestPath, `${JSON.stringify({
                schema: "nbook.desktop-installation/v3",
                installationId: "test-installation",
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
                    managerRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: digest("bun")},
                    applicationRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: digest("bun")},
                    tools: {
                        rg: {provider: "managed", version: "15.1.0", path: "tools/rg/rg.exe", sha256: digest("rg")},
                        git: {provider: "managed", version: "2.51.0", path: "tools/git/cmd/git.exe", sha256: digest("git"), bashPath: "tools/git/usr/bin/bash.exe"},
                    },
                },
                components,
                receipts: components.map((component) => ({...component, source: "depot"})),
                uninstall: {
                    preserveStateRootByDefault: true,
                    deleteStateRootRequiresExplicit: true,
                    preserveExternalProjectWorkspace: true,
                },
                addCliToUserPath: false,
                installedAt: "2026-08-10T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
            }, null, 4)}\n`, "utf8");
            const environment = {
                LOCALAPPDATA: localAppData,
                USERPROFILE: join(root, "User"),
            };
            const electronPatchedFileSystem = {
                existsSync,
                readFileSync,
                lstatSync(path: Parameters<typeof lstatSync>[0]) {
                    const info = lstatSync(path);
                    if (String(path).endsWith("app.asar")) {
                        return new Proxy(info, {
                            get(target, property) {
                                if (property === "isFile") return () => false;
                                if (property === "isDirectory") return () => true;
                                const value = Reflect.get(target, property, target);
                                return typeof value === "function" ? value.bind(target) : value;
                            },
                        });
                    }
                    return info;
                },
            };
            await expect(createManagerLaunchReceipt(installationRoot, environment, electronPatchedFileSystem))
                .rejects.toThrow("Electron application 不是普通文件");
            const receipt = await createManagerLaunchReceipt(installationRoot, environment);
            expect(receipt.applicationPath).toBe(applicationPath);
            expect(sameManagerLaunchReceipt(receipt, {...receipt})).toBe(true);

            await writeFile(applicationPath, "tampered", "utf8");
            await expect(createManagerLaunchReceipt(installationRoot, environment))
                .rejects.toThrow("Electron application checksum 不匹配");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

function digest(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
