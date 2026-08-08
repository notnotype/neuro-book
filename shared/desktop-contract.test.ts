import {describe, expect, it} from "vitest";

import {
    DEFAULT_DESKTOP_SETTINGS,
    DESKTOP_BRIDGE_SCHEMA,
    DESKTOP_CAPABILITY_SCHEMA,
    DESKTOP_DISTRIBUTION_SCHEMA,
    DESKTOP_INSTALLATION_SCHEMA,
    DESKTOP_SUPERVISOR_SCHEMA,
    desktopUserInstallationContract,
    desktopRemoteOrigin,
    desktopRelativePath,
    desktopSupervisorLine,
    parseDesktopCapability,
    parseDesktopDistributionManifest,
    parseDesktopInstallationManifest,
    parseDesktopStatus,
    parseDesktopShellArchiveManifest,
    parseDesktopSettings,
    parseDesktopSupervisorEvent,
    parseDesktopSupervisorRequest,
    patchDesktopSettings,
} from "nbook/shared/desktop-contract";

describe("Desktop contracts", () => {
    it("接受本地 depot 与 HTTPS 组件并拒绝路径逃逸和重复组件", () => {
        const manifest = distribution();
        expect(parseDesktopDistributionManifest(manifest)).toEqual(manifest);
        expect(parseDesktopDistributionManifest({
            ...manifest,
            components: [
                ...manifest.components,
                {
                    id: "bun",
                    version: "1.3.14",
                    required: true,
                    archive: {
                        kind: "url",
                        location: "https://example.com/bun.zip",
                        sha256: digest("b"),
                        bytes: 20,
                        format: "zip",
                    },
                },
            ],
        }).components).toHaveLength(2);
        expect(() => parseDesktopDistributionManifest({
            ...manifest,
            components: [{
                ...manifest.components[0],
                archive: {...manifest.components[0]!.archive, location: "../product.zip"},
            }],
        })).toThrow("portable 相对路径");
        expect(() => parseDesktopDistributionManifest({
            ...manifest,
            components: [manifest.components[0], manifest.components[0]],
        })).toThrow("重复 ID");
    });

    it("严格解析本地与远端安装状态", () => {
        const local = installation({mode: "local"});
        expect(parseDesktopInstallationManifest(local)).toEqual(local);

        const remote = installation({
            mode: "remote",
            baseUrl: "https://example.com",
            insecureHttpAccepted: false,
        });
        expect(parseDesktopInstallationManifest(remote).connection).toEqual(remote.connection);
        expect(() => parseDesktopInstallationManifest(installation({
            mode: "remote",
            baseUrl: "http://192.168.1.8",
            insecureHttpAccepted: false,
        }))).toThrow("二次确认");
        expect(parseDesktopInstallationManifest(installation({
            mode: "remote",
            baseUrl: "http://192.168.1.8",
            insecureHttpAccepted: true,
        })).connection).toMatchObject({baseUrl: "http://192.168.1.8"});
        expect(() => parseDesktopInstallationManifest({
            ...local,
            receipts: [{...local.receipts[0]!, sha256: digest("d")}],
        })).toThrow("receipts 必须与 components");
        expect(() => parseDesktopInstallationManifest(installation({
            mode: "remote",
            baseUrl: "http://example.com",
            insecureHttpAccepted: true,
        }))).toThrow("必须使用 HTTPS");
        expect(desktopRemoteOrigin("https://example.com/")).toBe("https://example.com");
        expect(() => desktopRemoteOrigin("http://192.168.1.8")).toThrow("二次确认");
        expect(desktopRemoteOrigin("http://192.168.1.8", true)).toBe("http://192.168.1.8");
    });

    it("约束设备设置和 patch 字段", () => {
        expect(parseDesktopSettings(DEFAULT_DESKTOP_SETTINGS)).toEqual(DEFAULT_DESKTOP_SETTINGS);
        expect(patchDesktopSettings(DEFAULT_DESKTOP_SETTINGS, {zoomFactor: 1.25, closeBehavior: "tray"})).toMatchObject({
            zoomFactor: 1.25,
            trayEnabled: true,
            closeBehavior: "tray",
        });
        expect(() => patchDesktopSettings(DEFAULT_DESKTOP_SETTINGS, {zoomFactor: 2.01})).toThrow("0.75 到 2");
        expect(() => patchDesktopSettings(DEFAULT_DESKTOP_SETTINGS, {unknown: true} as never)).toThrow("未知字段");
    });

    it("严格解析 Supervisor 请求、ready 关联和 NDJSON", () => {
        const start = {
            schema: DESKTOP_SUPERVISOR_SCHEMA,
            requestId: "start-1",
            type: "start",
            startupNonce: "a".repeat(43),
            port: 43120,
        } as const;
        expect(parseDesktopSupervisorRequest(start)).toEqual(start);
        const ready = {
            schema: DESKTOP_SUPERVISOR_SCHEMA,
            requestId: "start-1",
            type: "ready",
            url: "http://127.0.0.1:43120/",
            origin: "http://127.0.0.1:43120",
            version: "0.9.0",
            startupNonce: "a".repeat(43),
        } as const;
        expect(parseDesktopSupervisorEvent(ready)).toEqual(ready);
        expect(desktopSupervisorLine(start)).toBe(`${JSON.stringify(start)}\n`);
        expect(() => parseDesktopSupervisorEvent({...ready, origin: "http://127.0.0.1:43121"})).toThrow("不一致");
        expect(() => parseDesktopSupervisorRequest({...start, extra: true})).toThrow("字段不匹配");
        expect(() => parseDesktopSupervisorRequest({...start, port: 80})).toThrow("1024-65535");
    });

    it("只接受声明 DesktopBridge v2 的远端 capability", () => {
        const capability = {
            schema: DESKTOP_CAPABILITY_SCHEMA,
            productVersion: "0.9.0",
            bridgeSchemas: [DESKTOP_BRIDGE_SCHEMA],
            supportsRemoteDesktop: true,
        } as const;
        expect(parseDesktopCapability(capability)).toEqual(capability);
        expect(() => parseDesktopCapability({...capability, bridgeSchemas: []})).toThrow("不支持 DesktopBridge v2");
    });

    it("严格解析 Desktop Chrome 的平台和窗口控制能力", () => {
        const status = {
            schema: DESKTOP_BRIDGE_SCHEMA,
            envelope: "electron",
            connection: "local",
            version: "0.9.0",
            origin: "http://127.0.0.1:43120",
            insecureRemote: false,
            platform: "windows",
            menuPresentation: "renderer",
            windowControls: "overlay",
        } as const;
        expect(DESKTOP_BRIDGE_SCHEMA).toBe("nbook.desktop-bridge/v2");
        expect(parseDesktopStatus(status)).toEqual(status);
        expect(() => parseDesktopStatus({...status, platform: "android"})).toThrow("platform");
        expect(() => parseDesktopStatus({...status, extra: true})).toThrow("字段不匹配");
    });

    it("远端 shell depot 只接受匹配的 Envelope 路径和 checksum", () => {
        const shell = {
            schema: "nbook.desktop-shell/v1",
            kind: "electron",
            platform: "windows-x64",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: digest("e"),
            webview: "bundled-chromium",
        } as const;
        expect(parseDesktopShellArchiveManifest(shell)).toEqual(shell);
        expect(() => parseDesktopShellArchiveManifest({...shell, envelopePath: "desktop/NeuroBook-Tauri.exe"})).toThrow("路径与壳类型");
        expect(() => parseDesktopShellArchiveManifest({...shell, envelopeSha256: "not-a-digest"})).toThrow("sha256 digest");
    });

    it("拒绝 Windows 绝对路径、反斜杠和 dot segment", () => {
        expect(desktopRelativePath("components/product.zip")).toBe("components/product.zip");
        for (const path of ["C:\\product.zip", "/product.zip", "components\\product.zip", "./product.zip", "components/../product.zip"]) {
            expect(() => desktopRelativePath(path)).toThrow("portable 相对路径");
        }
    });

    it("固定 Windows 用户级安装合同，并拒绝未支持的架构", () => {
        expect(desktopUserInstallationContract("windows", "x64")).toEqual({
            schema: "nbook.desktop-user-installation/v1",
            platform: "windows",
            architecture: "x64",
            applicationBundle: "%LOCALAPPDATA%/Programs/NeuroBook",
            installationRoot: "%LOCALAPPDATA%/Programs/NeuroBook",
            stateRoot: "%LOCALAPPDATA%/NeuroBook/data",
            cacheRoot: "%LOCALAPPDATA%/NeuroBook/cache",
            desktopRoot: "%LOCALAPPDATA%/NeuroBook/desktop",
            webviewRoot: "%LOCALAPPDATA%/NeuroBook/desktop/webview",
            signedBundleRequired: false,
            portable: false,
        });
        expect(() => desktopUserInstallationContract("windows", "arm64")).toThrow("只支持 x64");
    });

    it("固定 macOS Application Support、Caches 与分架构签名合同", () => {
        for (const architecture of ["x64", "arm64"] as const) {
            expect(desktopUserInstallationContract("macos", architecture)).toMatchObject({
                schema: "nbook.desktop-user-installation/v1",
                platform: "macos",
                architecture,
                applicationBundle: "~/Applications/NeuroBook.app",
                installationRoot: "~/Library/Application Support/NeuroBook/installation",
                stateRoot: "~/Library/Application Support/NeuroBook/data",
                cacheRoot: "~/Library/Caches/NeuroBook",
                desktopRoot: "~/Library/Application Support/NeuroBook/desktop",
                webviewRoot: "~/Library/Application Support/NeuroBook/desktop/webview",
                signedBundleRequired: true,
                portable: false,
            });
        }
    });
});

function distribution() {
    return {
        schema: DESKTOP_DISTRIBUTION_SCHEMA,
        version: "0.9.0",
        channel: "canary" as const,
        platform: "windows" as const,
        architecture: "x64" as const,
        components: [{
            id: "product" as const,
            version: "0.9.0",
            required: true,
            archive: {
                kind: "path" as const,
                location: "components/product.zip",
                sha256: digest("a"),
                bytes: 10,
                format: "zip" as const,
            },
        }],
    };
}

function installation(connection: {mode: "local"} | {mode: "remote"; baseUrl: string; insecureHttpAccepted: boolean}) {
    return {
        schema: DESKTOP_INSTALLATION_SCHEMA,
        installationId: "test-installation",
        installationScope: "user",
        programRoot: ".",
        userRoots: {
            state: {base: "local-app-data", path: "NeuroBook/data"},
            cache: {base: "local-app-data", path: "NeuroBook/cache"},
            desktop: {base: "local-app-data", path: "NeuroBook/desktop"},
            webview: {base: "local-app-data", path: "NeuroBook/desktop/webview"},
        },
        envelope: "electron" as const,
        channel: "canary" as const,
        connection,
        providers: {
            managerRuntime: {
                provider: "managed" as const,
                version: "1.3.14",
                path: "runtime/bun.exe",
                sha256: digest("a"),
            },
            applicationRuntime: {
                provider: "managed" as const,
                version: "1.3.14",
                path: "runtime/bun.exe",
                sha256: digest("b"),
            },
            tools: {
                rg: {
                    provider: "managed" as const,
                    version: "14.1.1",
                    path: "tools/rg.exe",
                    sha256: digest("c"),
                },
                git: {
                    provider: "managed" as const,
                    version: "2.51.0",
                    path: "tools/git.exe",
                    sha256: digest("d"),
                    bashPath: "tools/bash.exe",
                },
            },
        },
        components: [{
            id: "electron-envelope" as const,
            version: "43.2.0",
            path: "components/electron",
            sha256: digest("c"),
        }],
        receipts: [{
            id: "electron-envelope" as const,
            version: "43.2.0",
            path: "components/electron",
            sha256: digest("c"),
            source: "depot" as const,
        }],
        uninstall: {
            preserveStateRootByDefault: true as const,
            deleteStateRootRequiresExplicit: true as const,
            preserveExternalProjectWorkspace: true as const,
        },
        addCliToUserPath: false,
        installedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
    };
}

function digest(character: string): string {
    return `sha256:${character.repeat(64)}`;
}
