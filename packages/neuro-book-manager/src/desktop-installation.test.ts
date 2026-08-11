import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {strToU8, zipSync} from "fflate";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const processMocks = vi.hoisted(() => ({
    run: vi.fn(),
    runCapture: vi.fn(),
    runCaptureResult: vi.fn(),
}));
const productMocks = vi.hoisted(() => ({
    verify: vi.fn(),
}));
const appCommandMocks = vi.hoisted(() => ({
    createAdmin: vi.fn(),
    enableAuthentication: vi.fn(),
}));
const migrationMocks = vi.hoisted(() => ({
    prepareInstalledApplication: vi.fn(),
}));

vi.mock("#manager/process", () => processMocks);
vi.mock("#manager/product", () => ({verifyInstalledProductRuntimeImage: productMocks.verify}));
vi.mock("#manager/app-commands", () => ({createAdmin: appCommandMocks.createAdmin}));
vi.mock("#manager/config", () => ({enableAuthentication: appCommandMocks.enableAuthentication}));
vi.mock("#manager/migration-operation", () => ({
    prepareInstalledApplication: migrationMocks.prepareInstalledApplication,
}));

import {
    assertDesktopPortableInstallable,
    assertDesktopShellInstallable,
    inferWindowsDesktopInstallationScope,
    installDesktopFromLocalDepot,
    installDesktopShellFromLocalDepot,
    repairDesktopRuntimeState,
    registerWindowsDesktop,
    removeWindowsDesktopRegistration,
    verifyDesktopPortablePayload,
    verifyDesktopShellPayload,
    uninstallRemoteDesktopInstallation,
    writeMachineUninstallLauncher,
    writeDesktopRuntimeWrappers,
} from "#manager/desktop-installation";
import {
    parseDesktopPortableManifest,
    type DesktopInstallationManifest,
    type DesktopPortableArchiveManifest,
} from "nbook/shared/desktop-contract";
import {
    DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
    DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
    DESKTOP_AGGREGATE_DEPOT_ENTRIES,
    DESKTOP_AGGREGATE_DEPOT_MANIFEST,
} from "nbook/desktop/shared/src/desktop-aggregate-depot";
import type {InstallationComponents, InstallationManifest} from "#manager/types";

const roots: string[] = [];
const originalPlatform = process.platform;
const originalArch = process.arch;
const originalAppData = process.env.APPDATA;
const originalUserProfile = process.env.USERPROFILE;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalProgramFiles = process.env.ProgramFiles;

beforeEach(() => {
    process.env.ProgramFiles = join(tmpdir(), `nbook-desktop-test-program-files-${String(process.pid)}`);
    processMocks.run.mockReset().mockResolvedValue(undefined);
    processMocks.runCapture.mockReset().mockResolvedValue("");
    processMocks.runCaptureResult.mockReset().mockResolvedValue({stdout: "", stderr: "", exitCode: 1, signal: null});
    productMocks.verify.mockReset().mockResolvedValue(undefined);
    appCommandMocks.createAdmin.mockReset().mockResolvedValue(undefined);
    appCommandMocks.enableAuthentication.mockReset().mockResolvedValue(undefined);
    migrationMocks.prepareInstalledApplication.mockReset().mockResolvedValue({
        port: 43123,
        migration: "checked",
        health: "ready",
    });
});

afterEach(async () => {
    Object.defineProperty(process, "platform", {configurable: true, value: originalPlatform});
    Object.defineProperty(process, "arch", {configurable: true, value: originalArch});
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    if (originalProgramFiles === undefined) delete process.env.ProgramFiles;
    else process.env.ProgramFiles = originalProgramFiles;
    vi.unstubAllGlobals();
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Desktop Portable manifest", () => {
    it("接受正式 packager 产出的完整 Portable manifest", () => {
        const base = portableManifest("electron");
        const manifest = {
            ...base,
            product: {
                ...base.product,
                sourceRevision: "f".repeat(40),
                sourceDigest: `sha256:${"a".repeat(64)}`,
                contractSchema: "nbook.product-runtime-contract/v5",
                contractSha256: `sha256:${"b".repeat(64)}`,
            },
            runtime: {
                ...base.runtime,
                bunVersion: "1.3.14",
            },
            toolPack: {
                files: 6279,
                bytes: 387519258,
                digest: `sha256:${"d".repeat(64)}`,
            },
            roots: {
                application: ".",
                state: "data",
                cache: ".cache",
                desktop: "data/.desktop",
                webview: "data/.desktop/webview",
            },
            webview: {
                kind: "bundled-chromium",
                webviewRoot: "data/.desktop/webview",
            },
            payload: {
                files: 9614,
                bytes: 985773924,
                digest: `sha256:${"c".repeat(64)}`,
            },
        };

        expect(parseDesktopPortableManifest(manifest)).toEqual(manifest);
    });

    it("严格校验 dirty 标记、Envelope 路径和 digest", () => {
        const manifest = portableManifest("electron");
        expect(parseDesktopPortableManifest(manifest)).toEqual(manifest);
        const tauri = portableManifest("tauri");
        expect(parseDesktopPortableManifest(tauri)).toEqual(tauri);
        expect(() => assertDesktopPortableInstallable({...manifest, product: {...manifest.product, dirty: true}}, "electron"))
            .toThrow("拒绝 dirty Product");
        expect(() => assertDesktopPortableInstallable(manifest, "tauri")).toThrow("命令选择");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            product: {...manifest.product, dirty: "false"},
        })).toThrow("product.dirty");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            toolPack: {...manifest.toolPack, digest: "not-a-digest"},
        })).toThrow("toolPack.digest");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            runtime: {...manifest.runtime, envelopePath: ""},
        })).toThrow("runtime.envelopePath");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            product: {...manifest.product, sourceRevision: "not-a-revision"},
        })).toThrow("product.sourceRevision");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            roots: {...manifest.roots, state: "other-data"},
        })).toThrow("roots.state");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            webview: {...manifest.webview, kind: "system-evergreen"},
        })).toThrow("webview.kind");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            payload: {...manifest.payload, digest: "not-a-digest"},
        })).toThrow("payload.digest");
    });

    it("校验 Product、运行时、Tool Pack 和 Envelope 的实际 checksum", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-payload-"));
        roots.push(root);
        const paths = [
            ".runtime/manager/neuro-book.mjs",
            "runtime/bun.exe",
            "tools/rg.exe",
            "tools/git.exe",
            "tools/bash.exe",
            "desktop/NeuroBook-Electron.exe",
            "desktop/resources/app.asar",
        ];
        await Promise.all(paths.map(async (path) => {
            await mkdir(dirname(join(root, path)), {recursive: true});
            await writeFile(join(root, path), path, "utf8");
        }));
        const hashes = new Map<string, string>();
        for (const path of paths) hashes.set(path, digest(await readFile(join(root, path))));
        const components = componentsManifest(hashes);
        const portable = portableManifest("electron");
        portable.runtime.envelopeSha256 = `sha256:${hashes.get("desktop/NeuroBook-Electron.exe")!}`;
        portable.runtime.applicationSha256 = `sha256:${hashes.get("desktop/resources/app.asar")!}`;

        await expect(verifyDesktopPortablePayload(root, {components}, portable, "electron")).resolves.toBeUndefined();
        await writeFile(join(root, "desktop/resources/app.asar"), "tampered", "utf8");
        await expect(verifyDesktopPortablePayload(root, {components}, portable, "electron"))
            .rejects.toThrow("Electron application checksum");
        await writeFile(join(root, "desktop/resources/app.asar"), "desktop/resources/app.asar", "utf8");
        await writeFile(join(root, ".runtime/manager/neuro-book.mjs"), "tampered", "utf8");
        await expect(verifyDesktopPortablePayload(root, {components}, portable, "electron")).rejects.toThrow("Manager CLI checksum");
    });
});

describe("Desktop installation lifecycle", () => {
    it("本地安装允许默认关闭 auth，并拒绝远端携带密码", async () => {
        setWindowsHost();
        const base = {
            archivePath: join(tmpdir(), "does-not-exist.zip"),
            envelope: "electron" as const,
            channel: "canary" as const,
            addCliToUserPath: false,
        };
        await expect(installDesktopFromLocalDepot({...base, connection: {mode: "local"}}))
            .rejects.toThrow("Portable archive 不存在");
        await expect(installDesktopFromLocalDepot({...base, connection: {mode: "remote", baseUrl: "https://example.com", insecureHttpAccepted: false}, adminPassword: "secret"}))
            .rejects.toThrow("不能接收本地管理员密码");
    });

    it("本地安装创建管理员时显式使用默认用户名，避免密码 stdin 被用户名提示消费", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-admin-username-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        const portable = portableManifest("electron");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portable);

        await installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
            adminPassword: "correct horse battery staple",
        });

        expect(appCommandMocks.createAdmin).toHaveBeenCalledWith(
            installRoot,
            expect.anything(),
            "admin",
            "correct horse battery staple",
        );
        expect(appCommandMocks.enableAuthentication).toHaveBeenCalledWith(
            join(root, "LocalAppData", "NeuroBook", "data"),
        );
        expect(migrationMocks.prepareInstalledApplication.mock.invocationCallOrder[0])
            .toBeLessThan(appCommandMocks.createAdmin.mock.invocationCallOrder[0]!);
    });

    it("migration 或健康检查失败时撤销系统注册、安装根和本事务创建的用户 Root", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-health-rollback-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        const localAppData = join(root, "LocalAppData");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        migrationMocks.prepareInstalledApplication.mockRejectedValueOnce(new Error("health failed"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
            adminPassword: "must-not-run",
        })).rejects.toThrow("health failed");

        expect(appCommandMocks.createAdmin).not.toHaveBeenCalled();
        expect(await pathExists(installRoot)).toBe(false);
        expect(await pathExists(join(localAppData, "NeuroBook", "data"))).toBe(false);
        expect(await pathExists(join(localAppData, "NeuroBook", "cache"))).toBe(false);
        expect(await pathExists(join(localAppData, "NeuroBook", "desktop"))).toBe(false);
        expect(processMocks.run.mock.calls.some(([command, args]) =>
            command === "reg.exe" && args.includes("DELETE"))).toBe(true);
    });

    it("Portable 内嵌 channel 与命令选择不一致时在移动安装根前失败", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-channel-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "stable",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("Portable 通道为 canary");
        expect(await pathExists(installRoot)).toBe(false);
    });

    it.runIf(process.platform === "win32")("canonical user 与 machine 程序根不能同时指向同一组用户数据", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-scope-conflict-"));
        const localAppData = join(root, "LocalAppData");
        const programFiles = join(root, "ProgramFiles");
        const userInstallRoot = join(localAppData, "Programs", "NeuroBook");
        const machineInstallRoot = join(programFiles, "NeuroBook");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.ProgramFiles = programFiles;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await mkdir(machineInstallRoot, {recursive: true});
        await writeFile(join(machineInstallRoot, "existing-installation"), "keep", "utf8");
        await createDesktopPortableArchive(archive, portableManifest("electron"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationScope: "user",
            installationRoot: userInstallRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("不能并存");

        await expect(readFile(join(machineInstallRoot, "existing-installation"), "utf8"))
            .resolves.toBe("keep");
        expect(await pathExists(userInstallRoot)).toBe(false);
    });

    it("从固定五项 aggregate Depot 校验 sidecar 后安装内置 Electron Portable", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-aggregate-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(root, "Installation");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        const depot = await createAggregateDesktopDepot(root);

        await expect(installDesktopFromLocalDepot({
            aggregateDepotPath: depot.archivePath,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).resolves.toMatchObject({installationRoot: installRoot});

        const cacheParent = join(localAppData, "NeuroBook", "manager", "desktop", "depots");
        expect(await readdir(cacheParent).catch(() => [])).toEqual([]);
    });

    it("aggregate Depot 对 sidecar、固定形状、路径逃逸和 channel 全部 fail closed 并回收 staging", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-aggregate-invalid-"));
        const localAppData = join(root, "LocalAppData");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");

        const checksumDepotRoot = join(root, "checksum");
        const checksumDepot = await createAggregateDesktopDepot(checksumDepotRoot);
        const checksumSidecar = JSON.parse(await readFile(checksumDepot.manifestPath, "utf8")) as {archive: {sha256: string}};
        checksumSidecar.archive.sha256 = `sha256:${"0".repeat(64)}`;
        await writeFile(checksumDepot.manifestPath, `${JSON.stringify(checksumSidecar)}\n`, "utf8");
        await expect(installDesktopFromLocalDepot({
            aggregateDepotPath: checksumDepot.archivePath,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallChecksum"),
            addCliToUserPath: false,
        })).rejects.toThrow("archive 与 sidecar 不一致");

        const missingDepot = await createAggregateDesktopDepot(join(root, "missing"), {
            omitEntry: "windows-bun-stage0.ps1",
        });
        await expect(installDesktopFromLocalDepot({
            aggregateDepotPath: missingDepot.archivePath,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallMissing"),
            addCliToUserPath: false,
        })).rejects.toThrow("缺少文件");

        const escapedPath = join(root, "escaped.txt");
        const escapeDepot = await createAggregateDesktopDepot(join(root, "escape"), {
            extraEntries: {"../escaped.txt": strToU8("escape")},
        });
        await expect(installDesktopFromLocalDepot({
            aggregateDepotPath: escapeDepot.archivePath,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallEscape"),
            addCliToUserPath: false,
        })).rejects.toThrow();
        expect(await pathExists(escapedPath)).toBe(false);

        const channelDepot = await createAggregateDesktopDepot(join(root, "channel"), {channel: "stable"});
        await expect(installDesktopFromLocalDepot({
            aggregateDepotPath: channelDepot.archivePath,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallChannel"),
            addCliToUserPath: false,
        })).rejects.toThrow("manifest 通道为 stable");

        const cacheParent = join(localAppData, "NeuroBook", "manager", "desktop", "depots");
        expect((await readdir(cacheParent).catch(() => [])).some((name) => name.startsWith(".aggregate-"))).toBe(false);
    });

    it("HTTPS distribution 对同长度篡改缓存重新校验并下载", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-https-cache-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        const archiveBytes = await readFile(archive);
        const archiveDigest = digest(archiveBytes);
        const componentURL = "https://downloads.example/neuro-book-electron-portable-win-x64.zip";
        const manifest = distributionManifestForUrl(archiveBytes, archiveDigest, componentURL);
        const cachePath = join(localAppData, "NeuroBook", "manager", "desktop", "downloads", `${archiveDigest}.zip`);
        await mkdir(dirname(cachePath), {recursive: true});
        await writeFile(cachePath, new Uint8Array(archiveBytes.byteLength).fill(1));
        const fetchMock = vi.fn(async (input: string | URL) => {
            const url = String(input);
            if (url === "https://downloads.example/desktop.distribution.json") {
                return new Response(JSON.stringify(manifest), {status: 200});
            }
            if (url === componentURL) {
                return new Response(archiveBytes, {status: 200});
            }
            throw new Error(`unexpected URL: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(installDesktopFromLocalDepot({
            distributionManifestUrl: "https://downloads.example/desktop.distribution.json",
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).resolves.toMatchObject({installationRoot: installRoot});

        expect(await readFile(cachePath)).toEqual(archiveBytes);
        expect(fetchMock).toHaveBeenCalledWith(
            componentURL,
            expect.objectContaining({redirect: "error"}),
        );
    });

    it("HTTPS distribution 的错误组件摘要失败且 HTTP manifest 不发起请求", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-https-checksum-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        const archiveBytes = await readFile(archive);
        const archiveDigest = digest(archiveBytes);
        const componentURL = "https://downloads.example/neuro-book-electron-portable-win-x64.zip";
        const manifest = distributionManifestForUrl(archiveBytes, archiveDigest, componentURL);
        const corruptBytes = new Uint8Array(archiveBytes.byteLength).fill(2);
        const fetchMock = vi.fn(async (input: string | URL) => {
            const url = String(input);
            if (url.endsWith("desktop.distribution.json")) {
                return new Response(JSON.stringify(manifest), {status: 200});
            }
            return new Response(corruptBytes, {status: 200});
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(installDesktopFromLocalDepot({
            distributionManifestUrl: "https://downloads.example/desktop.distribution.json",
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("SHA256 校验失败");
        expect(await pathExists(installRoot)).toBe(false);

        fetchMock.mockClear();
        await expect(installDesktopFromLocalDepot({
            distributionManifestUrl: "http://downloads.example/desktop.distribution.json",
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("只接受 HTTPS");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Product Bun、Git/Bash 和 rg provider 可以独立选择", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-independent-providers-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        processMocks.runCaptureResult.mockImplementation(async (command: string) => ({
            stdout: {
                bun: "1.3.14\n",
                rg: "ripgrep 14.1.1\n",
                git: "git version 2.51.0.windows.1\n",
                bash: "GNU bash, version 5.2.37(1)-release (x86_64-pc-msys)\n",
            }[command] ?? "",
            stderr: "",
            exitCode: 0,
            signal: null,
        }));

        const result = await installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
            runtimeProvider: "system",
            gitProvider: "system",
            rgProvider: "system",
        });

        expect(result.manifest.providers.managerRuntime.provider).toBe("managed");
        expect(result.manifest.providers.applicationRuntime).toMatchObject({
            provider: "system",
            executable: "bun",
            version: "1.3.14",
        });
        expect(result.manifest.providers.tools.git).toMatchObject({
            provider: "system",
            executable: "git",
            bashExecutable: "bash",
        });
        expect(result.manifest.providers.tools.rg).toMatchObject({
            provider: "system",
            executable: "rg",
        });
        expect(result.applicationManifest?.components.applicationRuntime).toMatchObject({
            provider: "system",
            executable: "bun",
            version: "1.3.14",
        });
        expect(result.applicationManifest?.components.tools.git).toMatchObject({
            provider: "system",
            executable: "git",
        });
        expect(result.applicationManifest?.components.tools.rg).toMatchObject({
            provider: "system",
            executable: "rg",
        });
        expect(result.manifest.components.some((component) => component.id === "tool-pack")).toBe(false);
        expect(await pathExists(join(installRoot, "tools"))).toBe(false);
        expect(migrationMocks.prepareInstalledApplication).toHaveBeenCalledWith(installRoot);
        expect(processMocks.runCaptureResult.mock.calls.map(([command]) => command)).toEqual(["bun", "rg", "git", "bash"]);
    });

    it("system provider 拒绝过旧 Bun 和伪造的工具版本输出", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-system-provider-version-"));
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        processMocks.runCaptureResult.mockResolvedValue({
            stdout: "1.2.9\n",
            stderr: "",
            exitCode: 0,
            signal: null,
        });

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallOldBun"),
            addCliToUserPath: false,
            runtimeProvider: "system",
            gitProvider: "managed",
            rgProvider: "managed",
        })).rejects.toThrow("至少需要 1.3.0");

        processMocks.runCaptureResult.mockResolvedValue({
            stdout: "some shim\n",
            stderr: "",
            exitCode: 0,
            signal: null,
        });
        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: join(root, "InstallFakeRg"),
            addCliToUserPath: false,
            runtimeProvider: "managed",
            gitProvider: "managed",
            rgProvider: "system",
        })).rejects.toThrow("ripgrep 返回的版本格式无效");
    });

    it("默认卸载留下的空 State Root 允许重新安装，但不会放行非空用户数据", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-reinstall-empty-state-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await mkdir(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true});
        await createDesktopPortableArchive(archive, portableManifest("electron"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).resolves.toMatchObject({installationRoot: installRoot});

        await rm(installRoot, {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "cache"), {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "desktop"), {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true, force: true});
        await mkdir(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true});
        await writeFile(join(root, "LocalAppData", "NeuroBook", "data", "config.yaml"), "auth:\n    enabled: false\n", "utf8");
        await writeFile(join(root, "LocalAppData", "NeuroBook", "data", "user-data.txt"), "keep", "utf8");
        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).resolves.toMatchObject({installationRoot: installRoot});

        await rm(installRoot, {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "cache"), {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "desktop"), {recursive: true, force: true});
        await rm(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true, force: true});
        await mkdir(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true});
        await writeFile(join(root, "LocalAppData", "NeuroBook", "data", "user-data.txt"), "keep", "utf8");
        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("拒绝覆盖");

        await rm(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true, force: true});
        await mkdir(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true});
        await writeFile(join(root, "LocalAppData", "NeuroBook", "data", "config.yaml"), "unrelated: true\n", "utf8");
        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("拒绝覆盖");

        await rm(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true, force: true});
        await mkdir(join(root, "LocalAppData", "NeuroBook", "data"), {recursive: true});
        await writeFile(join(root, "LocalAppData", "NeuroBook", "data", "config.yaml"), "auth: [not-an-object]\n", "utf8");
        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("拒绝覆盖");
    });

    it("State Root 本身是 symlink 或 junction 时拒绝接管", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-reinstall-linked-state-"));
        const localAppData = join(root, "LocalAppData");
        const stateRoot = join(localAppData, "NeuroBook", "data");
        const externalStateRoot = join(root, "ExternalState");
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await mkdir(externalStateRoot, {recursive: true});
        await writeFile(join(externalStateRoot, "config.yaml"), "auth:\n    enabled: false\n", "utf8");
        await mkdir(dirname(stateRoot), {recursive: true});
        await symlink(externalStateRoot, stateRoot, "junction");
        await createDesktopPortableArchive(archive, portableManifest("electron"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("拒绝覆盖");
        await expect(readFile(join(externalStateRoot, "config.yaml"), "utf8"))
            .resolves.toBe("auth:\n    enabled: false\n");
    });

    it("安装目标在校验后被其他进程抢先创建时不删除对方目录", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-install-race-"));
        const installRoot = join(root, "Installation");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        productMocks.verify.mockImplementationOnce(async () => {
            await mkdir(installRoot, {recursive: true});
            await writeFile(join(installRoot, "owned-by-other-process"), "keep", "utf8");
        });

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow();
        await expect(readFile(join(installRoot, "owned-by-other-process"), "utf8")).resolves.toBe("keep");
    });

    it.runIf(process.platform === "win32")("repair 从缺失 locator 状态重建 Installed runtime，而不回退 Portable root", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-repair-locator-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(localAppData, "Programs", "NeuroBook");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        const installed = await installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        });
        const locatorPath = join(installRoot, "desktop", "runtime-locators.json");
        await rm(locatorPath, {force: true});

        await repairDesktopRuntimeState(installRoot, installed.applicationManifest!);

        const locator = JSON.parse(await readFile(locatorPath, "utf8")) as {schema: string; state: {base: string; path: string}};
        expect(locator).toMatchObject({
            schema: "nbook.desktop-installation-runtime/v1",
            state: {base: "local-app-data", path: "NeuroBook/data"},
        });
        expect(await pathExists(join(installRoot, "data"))).toBe(false);
    });

    it.runIf(process.platform === "win32")("repair 在 app.asar 被篡改时 fail closed，不重建 locator 或注册项", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-repair-app-integrity-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(localAppData, "Programs", "NeuroBook");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        const installed = await installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
        });
        const locatorPath = join(installRoot, "desktop", "runtime-locators.json");
        await rm(locatorPath, {force: true});
        await writeFile(join(installRoot, "desktop", "resources", "app.asar"), "tampered", "utf8");
        processMocks.run.mockClear();

        await expect(repairDesktopRuntimeState(installRoot, installed.applicationManifest!))
            .rejects.toThrow("electron-application checksum 不匹配");
        expect(await pathExists(locatorPath)).toBe(false);
        expect(processMocks.run).not.toHaveBeenCalled();
    });

    it.runIf(process.platform === "win32")("repair 在同一 v3 合同内把旧候选的 Product Bun 重新投影为 system provider", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-repair-provider-projection-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(localAppData, "Programs", "NeuroBook");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        processMocks.runCaptureResult.mockResolvedValue({
            stdout: "1.3.14\n",
            stderr: "",
            exitCode: 0,
            signal: null,
        });
        const installed = await installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationRoot: installRoot,
            addCliToUserPath: false,
            runtimeProvider: "system",
            gitProvider: "managed",
            rgProvider: "managed",
        });
        const current = installed.applicationManifest!;
        const stale: InstallationManifest = {
            ...current,
            components: {
                ...current.components,
                applicationRuntime: current.components.managerRuntime,
            },
        };
        await writeFile(
            join(installRoot, ".deploy", "installation.json"),
            `${JSON.stringify(stale, null, 4)}\n`,
            "utf8",
        );

        const repaired = await repairDesktopRuntimeState(installRoot, stale);
        const persisted = JSON.parse(
            await readFile(join(installRoot, ".deploy", "installation.json"), "utf8"),
        ) as InstallationManifest;

        expect(repaired.components.applicationRuntime).toMatchObject({
            provider: "system",
            executable: "bun",
            version: "1.3.14",
        });
        expect(persisted.components.applicationRuntime).toEqual(repaired.components.applicationRuntime);
    });

    it.runIf(process.platform === "win32")("Desktop runtime wrappers 复用统一模板且只使用相对 Installation Root 路径", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-wrapper-"));
        roots.push(root);
        await writeDesktopRuntimeWrappers(root, {
            components: {
                manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/neuro-book.mjs", bundleSha256: "a".repeat(64)},
                managerRuntime: {
                    provider: "managed",
                    version: "1.3.14",
                    path: "runtime/bun.exe",
                    executableSha256: "b".repeat(64),
                    archiveSha256: "c".repeat(64),
                    sourceUrl: "local:bun",
                    license: "MIT",
                    redistribution: "test",
                },
                tools: {
                    rg: {
                        provider: "managed",
                        version: "15.1.0",
                        path: "tools/rg/rg.exe",
                        executableSha256: "d".repeat(64),
                        archiveSha256: "e".repeat(64),
                        sourceUrl: "local:rg",
                        license: "MIT",
                        redistribution: "test",
                    },
                    git: {
                        provider: "managed",
                        distribution: "PortableGit",
                        version: "2.41.0.windows.2",
                        path: "tools/git/cmd/git.exe",
                        bashPath: "tools/git/usr/bin/bash.exe",
                        archiveSha256: "f".repeat(64),
                        gitSha256: "1".repeat(64),
                        bashSha256: "2".repeat(64),
                        sourceUrl: "local:git",
                        license: "GPL-2.0-only",
                        redistribution: "test",
                    },
                },
            },
        });
        const cmd = await readFile(join(root, ".runtime", "bin", "neuro-book.cmd"), "utf8");
        const ps1 = await readFile(join(root, ".runtime", "bin", "neuro-book.ps1"), "utf8");
        const bun = await readFile(join(root, ".runtime", "bin", "bun.cmd"), "utf8");
        const rg = await readFile(join(root, ".runtime", "bin", "rg.cmd"), "utf8");
        const git = await readFile(join(root, ".runtime", "bin", "git.cmd"), "utf8");
        const bash = await readFile(join(root, ".runtime", "bin", "bash.cmd"), "utf8");
        expect(cmd).toContain('set "ROOT=%~dp0..\\.."');
        expect(cmd).toContain('"%ROOT%\\runtime\\bun.exe"');
        expect(cmd).toContain('"%ROOT%\\.runtime\\manager\\neuro-book.mjs"');
        expect(ps1).toContain("$PSScriptRoot \"neuro-book.cmd\"");
        expect(ps1).toContain("exit $LASTEXITCODE");
        expect(bun).toContain('"%ROOT%\\runtime\\bun.exe"');
        expect(rg).toContain('"%ROOT%\\tools\\rg\\rg.exe"');
        expect(git).toContain('"%ROOT%\\tools\\git\\cmd\\git.exe"');
        expect(bash).toContain('"%ROOT%\\tools\\git\\usr\\bin\\bash.exe"');
        for (const wrapper of [cmd, ps1, bun, rg, git, bash]) {
            expect(wrapper).not.toContain(root);
        }
    });

    it("远端模式只安装 shell、探测 capability，并拒绝 Product/Tool Pack 载荷", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-remote-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(root, "Installation");
        const archive = join(root, "shell.zip");
        const distributionManifest = join(root, "distribution.json");
        const managerExecutable = join(root, "manager.mjs");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await writeFile(managerExecutable, "console.log('manager fixture');", "utf8");
        const executable = new TextEncoder().encode("electron-shell");
        const shellManifest = {
            schema: "nbook.desktop-shell/v1",
            kind: "electron",
            platform: "windows-x64",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(executable)}`,
            applicationPath: "desktop/resources/app.asar",
            applicationVersion: "0.9.1",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("electron-application"))}`,
            webview: "bundled-chromium",
        } as const;
        await writeFile(archive, zipSync({
            "manifest.json": strToU8(`${JSON.stringify(shellManifest)}\n`),
            "desktop/NeuroBook-Electron.exe": executable,
            "desktop/resources/app.asar": strToU8("electron-application"),
        }));
        const archiveBytes = await readFile(archive);
        await writeFile(distributionManifest, `${JSON.stringify({
            schema: "nbook.desktop-distribution/v1",
            version: "0.9.1",
            channel: "canary",
            platform: "windows",
            architecture: "x64",
            components: [{
                id: "electron-envelope",
                version: "43.2.0",
                archive: {kind: "path", location: "shell.zip", sha256: `sha256:${digest(archiveBytes)}`, bytes: archiveBytes.byteLength, format: "zip"},
                required: false,
            }],
        }, null, 4)}\n`, "utf8");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                schema: "nbook.desktop-capability/v1",
                productVersion: "0.9.1",
                bridgeSchemas: ["nbook.desktop-bridge/v2"],
                supportsRemoteDesktop: true,
            }),
        }));

        const result = await installDesktopShellFromLocalDepot({
            distributionManifestPath: distributionManifest,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "remote", baseUrl: "https://example.com", insecureHttpAccepted: false},
            installationRoot: installRoot,
            addCliToUserPath: false,
            managerExecutable,
        });

        expect(result.applicationManifest).toBeUndefined();
        expect(result.remoteProductVersion).toBe("0.9.1");
        expect(await pathExists(join(installRoot, ".output"))).toBe(false);
        expect(await pathExists(join(installRoot, "runtime"))).toBe(false);
        expect(await pathExists(join(installRoot, "tools"))).toBe(false);
        expect(await pathExists(join(localAppData, "NeuroBook", "desktop", "desktop-installation.json"))).toBe(true);
        expect(processMocks.run.mock.calls.some(([command, args]) => command === "powershell.exe" && args.includes("-Command"))).toBe(true);
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
            new URL("/api/app/desktop-capability", "https://example.com/"),
            expect.objectContaining({redirect: "error", signal: expect.any(AbortSignal)}),
        );
        const uninstall = await uninstallRemoteDesktopInstallation(installRoot);
        expect(await pathExists(installRoot)).toBe(false);
        await expect(stat(uninstall.stateRoot)).resolves.toMatchObject({isDirectory: expect.any(Function)});
    });

    it("shell depot 的类型和壳路径必须匹配", () => {
        const shell = {
            schema: "nbook.desktop-shell/v1" as const,
            kind: "electron" as const,
            platform: "windows-x64" as const,
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode("electron"))}`,
            applicationPath: "desktop/resources/app.asar" as const,
            applicationVersion: "0.9.1",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("electron-application"))}`,
            webview: "bundled-chromium" as const,
        };
        expect(() => assertDesktopShellInstallable(shell, "tauri")).toThrow("命令选择");
    });

    it("shell depot 拒绝 Product 等禁止的顶层 owner", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-shell-owner-"));
        roots.push(root);
        const executable = join(root, "desktop", "NeuroBook-Electron.exe");
        await mkdir(dirname(executable), {recursive: true});
        await writeFile(executable, "electron", "utf8");
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, "manifest.json"), "{}\n", "utf8");
        await expect(verifyDesktopShellPayload(root, {
            schema: "nbook.desktop-shell/v1",
            kind: "electron",
            platform: "windows-x64",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode("electron"))}`,
            applicationPath: "desktop/resources/app.asar",
            applicationVersion: "0.9.1",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("electron-application"))}`,
            webview: "bundled-chromium",
        })).rejects.toThrow("禁止的顶层内容");
    });

    it("shell depot 缺少 manifest 时 fail closed", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-shell-no-manifest-"));
        roots.push(root);
        const executable = join(root, "desktop", "NeuroBook-Electron.exe");
        await mkdir(dirname(executable), {recursive: true});
        await writeFile(executable, "electron", "utf8");

        await expect(verifyDesktopShellPayload(root, {
            schema: "nbook.desktop-shell/v1",
            kind: "electron",
            platform: "windows-x64",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode("electron"))}`,
            applicationPath: "desktop/resources/app.asar",
            applicationVersion: "0.9.1",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("electron-application"))}`,
            webview: "bundled-chromium",
        })).rejects.toThrow("缺少 manifest.json");
    });

    it("shell depot 不能把 Product 藏在 Envelope 目录内", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-shell-nested-owner-"));
        roots.push(root);
        const executable = join(root, "desktop", "NeuroBook-Electron.exe");
        await mkdir(dirname(executable), {recursive: true});
        await writeFile(executable, "electron", "utf8");
        await mkdir(join(root, "desktop", ".output"), {recursive: true});
        await writeFile(join(root, "desktop", ".output", "server.mjs"), "not shell", "utf8");
        await writeFile(join(root, "manifest.json"), "{}\n", "utf8");
        await expect(verifyDesktopShellPayload(root, {
            schema: "nbook.desktop-shell/v1",
            kind: "electron",
            platform: "windows-x64",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode("electron"))}`,
            applicationPath: "desktop/resources/app.asar",
            applicationVersion: "0.9.1",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("electron-application"))}`,
            webview: "bundled-chromium",
        })).rejects.toThrow("禁止的 Product/Runtime owner");
    });

    it("注册失败会回滚快捷方式和注册项，卸载会清理同一组资源", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-registration-"));
        const appData = join(root, "AppData");
        const userProfile = join(root, "User");
        roots.push(root);
        process.env.APPDATA = appData;
        process.env.USERPROFILE = userProfile;
        const manifest = desktopManifest();
        await mkdir(join(root, ".runtime", "bin"), {recursive: true});
        await writeFile(join(root, ".runtime", "bin", "neuro-book.cmd"), "@echo off\n", "utf8");
        let call = 0;
        processMocks.run.mockImplementation(async () => {
            call += 1;
            if (call === 3) throw new Error("registry failure");
        });

        await expect(registerWindowsDesktop(root, manifest, false)).rejects.toThrow("registry failure");
        expect(await pathExists(join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "NeuroBook", "NeuroBook.lnk"))).toBe(false);
        expect(processMocks.run).toHaveBeenCalledWith("reg.exe", expect.arrayContaining(["DELETE"]), expect.anything());

        const desktopShortcut = join(userProfile, "Desktop", "NeuroBook.lnk");
        await mkdir(dirname(desktopShortcut), {recursive: true});
        await writeFile(desktopShortcut, "shortcut", "utf8");
        await removeWindowsDesktopRegistration(root, manifest);
        expect(await pathExists(desktopShortcut)).toBe(false);
    });

    it("machine 安装注册失败时清理本事务创建的外置 launcher", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-machine-launcher-rollback-"));
        const localAppData = join(root, "LocalAppData");
        const installRoot = join(root, "ProgramFiles", "NeuroBook");
        const archive = join(root, "electron.zip");
        roots.push(root);
        process.env.LOCALAPPDATA = localAppData;
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        process.env.ProgramData = join(root, "ProgramData");
        process.env.PUBLIC = join(root, "Public");
        await createDesktopPortableArchive(archive, portableManifest("electron"));
        processMocks.run.mockRejectedValueOnce(new Error("registration failure"));

        await expect(installDesktopFromLocalDepot({
            archivePath: archive,
            envelope: "electron",
            channel: "canary",
            connection: {mode: "local"},
            installationScope: "machine",
            installationRoot: installRoot,
            addCliToUserPath: false,
        })).rejects.toThrow("registration failure");

        expect(await pathExists(installRoot)).toBe(false);
        const launcherBase = join(localAppData, "NeuroBook", "manager", "uninstall");
        expect(await readdir(launcherBase).catch(() => [])).toEqual([]);
    });

    it("注册表卸载项使用安装根内的 Manager wrapper", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-uninstall-command-"));
        roots.push(root);
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        await mkdir(join(root, ".runtime", "bin"), {recursive: true});
        await writeFile(join(root, ".runtime", "bin", "neuro-book.cmd"), "@echo off\n", "utf8");

        await registerWindowsDesktop(root, desktopManifest(), false);

        const uninstallCall = processMocks.run.mock.calls.find(([command, args]) => command === "reg.exe" && args.includes("UninstallString"));
        expect(uninstallCall?.[1]).toEqual(expect.arrayContaining([expect.stringContaining(".runtime\\bin\\neuro-book.cmd")]));
        expect(uninstallCall?.[1]).not.toEqual(expect.arrayContaining([expect.stringContaining("neuro-book desktop")]));
    });

    it("machine scope 的 Programs and Features 卸载项使用安装根外 launcher", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-machine-launcher-"));
        const installationRoot = join(root, "Installation");
        roots.push(root);
        process.env.LOCALAPPDATA = join(root, "LocalAppData");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        const manifestSha256 = `sha256:${"a".repeat(64)}`;
        const launcher = await writeMachineUninstallLauncher(
            installationRoot,
            "installation-1",
            manifestSha256,
            "manager/neuro-book.mjs",
            "managed-runtime/bun.exe",
        );
        const script = await readFile(launcher, "utf8");
        expect(launcher).not.toContain(installationRoot);
        expect(script).toContain("Start-Process");
        expect(script).not.toContain("-Verb RunAs");
        expect(script).not.toContain("elevatedCommand");
        expect(script).toContain("1>");
        expect(script).toContain("2>");
        expect(script).toContain("LASTEXITCODE");
        expect(script).toContain("desktop");
        expect(script).toContain("broker-client");
        expect(script).toContain("--installation-root");
        expect(script).toContain("--installation-id");
        expect(script).toContain("installation-1");
        expect(script).toContain("--manifest-sha256");
        expect(script).toContain(manifestSha256);
        expect(script).not.toContain("--delete-data");
        expect(script).toContain("NeuroBook\\manager\\uninstall-runs\\installation-1");
        expect(script).not.toContain("${installationId}");
        expect(script).not.toContain("NeuroBook\\cache\\manager-runtime");
        expect(script).toContain("cached-bun.exe");
        expect(script).toContain("Copy-Item -LiteralPath $bun");
        expect(script).toContain("-EncodedCommand");
        expect(script).toContain("Start-Sleep -Milliseconds 500");
        expect(script).toContain('Join-Path $Root "manager\\neuro-book.mjs"');
        expect(script).toContain('Join-Path $Root "managed-runtime\\bun.exe"');
        expect(script).not.toContain(".runtime\\manager\\neuro-book.mjs");
        await expect(writeMachineUninstallLauncher(
            installationRoot,
            "installation-2",
            manifestSha256,
            "manager/neuro-book.mjs",
            "../outside/bun.exe",
        )).rejects.toThrow("Manager Runtime 路径必须是安全的相对路径");
        await expect(writeMachineUninstallLauncher(
            installationRoot,
            "installation-3",
            "sha256:not-a-digest",
            "manager/neuro-book.mjs",
            "managed-runtime/bun.exe",
        )).rejects.toThrow("manifest SHA-256");
        await expect(writeMachineUninstallLauncher(
            installationRoot,
            "../installation-4",
            manifestSha256,
            "manager/neuro-book.mjs",
            "managed-runtime/bun.exe",
        )).rejects.toThrow("installationId 必须是单段安全标识");

        const manifest = {...desktopManifest(), installationScope: "machine" as const};
        await registerWindowsDesktop(installationRoot, manifest, false, launcher);
        const uninstallCall = processMocks.run.mock.calls.find(([command, args]) => command === "reg.exe" && args.includes("UninstallString"));
        expect(uninstallCall?.[1]).toEqual(expect.arrayContaining([
            expect.stringContaining(`-File "${launcher}"`),
        ]));
        expect(uninstallCall?.[1]).not.toEqual(expect.arrayContaining([
            expect.stringContaining(".runtime\\bin\\neuro-book.cmd"),
        ]));
    });

    it("machine scope 使用 HKLM 和公共快捷方式根", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-machine-registration-"));
        roots.push(root);
        process.env.ProgramData = join(root, "ProgramData");
        process.env.PUBLIC = join(root, "Public");
        await mkdir(join(root, ".runtime", "bin"), {recursive: true});
        await writeFile(join(root, ".runtime", "bin", "neuro-book.cmd"), "@echo off\n", "utf8");

        const manifest = {...desktopManifest(), installationScope: "machine" as const};
        await registerWindowsDesktop(root, manifest, false);
        const registryCalls = processMocks.run.mock.calls.filter(([command]) => command === "reg.exe");
        expect(registryCalls.some(([, args]) => args.includes("HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook"))).toBe(true);
        expect(registryCalls.some(([, args]) => args.includes("HKLM\\Software\\Classes\\neurobook"))).toBe(true);
        await removeWindowsDesktopRegistration(root, manifest);
    });

    it("旧 Product-only 安装没有 Desktop manifest 时，只按 HKLM InstallLocation 清理注册", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-legacy-product-machine-"));
        roots.push(root);
        process.env.ProgramData = join(root, "ProgramData");
        process.env.PUBLIC = join(root, "Public");
        process.env.APPDATA = join(root, "AppData");
        process.env.USERPROFILE = join(root, "User");
        processMocks.runCaptureResult.mockImplementation(async (_command, args: string[]) => {
            const key = args.find((value) => value.startsWith("HK"));
            if (key?.startsWith("HKCU\\")) return {stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value.", exitCode: 1, signal: null};
            return {
                stdout: `HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook\r\n    InstallLocation    REG_SZ    ${root}\r\n`,
                stderr: "",
                exitCode: 0,
                signal: null,
            };
        });

        await expect(inferWindowsDesktopInstallationScope(root)).resolves.toBe("machine");
        await removeWindowsDesktopRegistration(root, "machine");

        const deletes = processMocks.run.mock.calls
            .filter(([command, args]) => command === "reg.exe" && args.includes("DELETE"))
            .map(([, args]) => args.join(" "));
        expect(deletes.some((value) => value.includes("HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook"))).toBe(true);
        expect(deletes.some((value) => value.includes("HKLM\\Software\\Classes\\neurobook"))).toBe(true);
        expect(deletes.some((value) => value.includes("HKCU\\"))).toBe(false);
    });

    it("旧注册项同时匹配 user 和 machine 时拒绝猜测清理范围", async () => {
        setWindowsHost();
        const root = await mkdtemp(join(tmpdir(), "nbook-legacy-ambiguous-"));
        roots.push(root);
        processMocks.runCaptureResult.mockResolvedValue({
            stdout: `    InstallLocation    REG_SZ    ${root}\r\n`,
            stderr: "",
            exitCode: 0,
            signal: null,
        });

        await expect(inferWindowsDesktopInstallationScope(root)).rejects.toThrow("同时匹配 user 和 machine");
        expect(processMocks.run).not.toHaveBeenCalled();
    });
});

function setWindowsHost(): void {
    Object.defineProperty(process, "platform", {configurable: true, value: "win32"});
    Object.defineProperty(process, "arch", {configurable: true, value: "x64"});
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function portableManifest(kind: "electron"): Extract<DesktopPortableArchiveManifest, {kind: "electron"}>;
function portableManifest(kind: "tauri"): Extract<DesktopPortableArchiveManifest, {kind: "tauri"}>;
function portableManifest(kind: "electron" | "tauri"): DesktopPortableArchiveManifest {
    const common = {
        schema: "nbook.desktop-portable/v1" as const,
        platform: "windows-x64" as const,
        product: {
            imagePath: ".output" as const,
            imageId: `sha256:${"e".repeat(64)}`,
            sourceRevision: "f".repeat(40),
            sourceDigest: `sha256:${"f".repeat(64)}`,
            dirty: false,
            contractSchema: "nbook.product-runtime-contract/v5",
            contractSha256: `sha256:${"b".repeat(64)}`,
        },
        toolPack: {files: 3, bytes: 9, digest: `sha256:${"d".repeat(64)}`},
        roots: {
            application: "." as const,
            state: "data" as const,
            cache: ".cache" as const,
            desktop: "data/.desktop" as const,
            webview: "data/.desktop/webview" as const,
        },
        payload: {files: 7, bytes: 42, digest: `sha256:${"c".repeat(64)}`},
    };
    if (kind === "tauri") {
        return {
            ...common,
            kind,
            runtime: {
                bunPath: "runtime/bun.exe",
                bunVersion: "1.3.14",
                envelopePath: "desktop/NeuroBook-Tauri.exe",
                envelopeVersion: "43.2.0",
                envelopeSha256: `sha256:${digest(new TextEncoder().encode("desktop/NeuroBook-Tauri.exe"))}`,
            },
            webview: {kind: "system-evergreen", webviewRoot: "data/.desktop/webview"},
        };
    }
    return {
        ...common,
        kind,
        runtime: {
            bunPath: "runtime/bun.exe" as const,
            bunVersion: "1.3.14",
            envelopePath: "desktop/NeuroBook-Electron.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode("desktop/NeuroBook-Electron.exe"))}`,
            applicationPath: "desktop/resources/app.asar",
            applicationSha256: `sha256:${digest(new TextEncoder().encode("desktop/resources/app.asar"))}`,
        },
        webview: {kind: "bundled-chromium", webviewRoot: "data/.desktop/webview"},
    };
}

function distributionManifestForUrl(
    archiveBytes: Uint8Array,
    archiveDigest: string,
    componentURL: string,
) {
    return {
        schema: "nbook.desktop-distribution/v1",
        version: "0.9.1",
        channel: "canary",
        platform: "windows",
        architecture: "x64",
        components: [{
            id: "electron-envelope",
            version: "43.2.0",
            archive: {
                kind: "url",
                location: componentURL,
                sha256: `sha256:${archiveDigest}`,
                bytes: archiveBytes.byteLength,
                format: "zip",
            },
            required: true,
        }],
    };
}

async function createAggregateDesktopDepot(
    root: string,
    options: {
        channel?: "stable" | "canary";
        omitEntry?: string;
        extraEntries?: Record<string, Uint8Array>;
    } = {},
): Promise<{archivePath: string; manifestPath: string; digest: string}> {
    await mkdir(root, {recursive: true});
    const portableSource = join(root, "portable-source.zip");
    await createDesktopPortableArchive(portableSource, portableManifest("electron"));
    const portableBytes = await readFile(portableSource);
    const portableName = "neuro-book-electron-portable-win-x64.zip";
    const portableSidecarName = "neuro-book-electron-portable-win-x64.manifest.json";
    const distribution = {
        schema: "nbook.desktop-distribution/v1",
        version: "0.9.1",
        channel: options.channel ?? "canary",
        platform: "windows",
        architecture: "x64",
        components: [{
            id: "electron-envelope",
            version: "43.2.0",
            archive: {
                kind: "path",
                location: portableName,
                sha256: `sha256:${digest(portableBytes)}`,
                bytes: portableBytes.byteLength,
                format: "zip",
            },
            required: true,
        }],
    };
    const entries: Record<string, Uint8Array> = {
        "install-desktop.ps1": strToU8("Write-Host install\n"),
        "windows-bun-stage0.ps1": strToU8("function Ensure-NeuroBookBun {}\n"),
        [DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST]: strToU8(`${JSON.stringify(distribution)}\n`),
        [portableName]: portableBytes,
        [portableSidecarName]: strToU8(`${JSON.stringify({
            archive: {bytes: portableBytes.byteLength, sha256: `sha256:${digest(portableBytes)}`},
        })}\n`),
    };
    if (options.omitEntry) delete entries[options.omitEntry];
    Object.assign(entries, options.extraEntries ?? {});

    const archivePath = join(root, DESKTOP_AGGREGATE_DEPOT_ARCHIVE);
    const archiveBytes = zipSync(entries);
    await writeFile(archivePath, archiveBytes);
    const manifestPath = join(root, DESKTOP_AGGREGATE_DEPOT_MANIFEST);
    const payloadBytes = Object.values(entries).reduce((total, value) => total + value.byteLength, 0);
    await writeFile(manifestPath, `${JSON.stringify({
        schema: "nbook.desktop-depot/v1",
        platform: "windows-x64",
        distributionManifest: DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
        entries: [...DESKTOP_AGGREGATE_DEPOT_ENTRIES],
        payload: {files: DESKTOP_AGGREGATE_DEPOT_ENTRIES.length, bytes: payloadBytes},
        archive: {
            path: DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
            bytes: archiveBytes.byteLength,
            sha256: `sha256:${digest(archiveBytes)}`,
        },
        distributionSchema: "nbook.desktop-distribution/v1",
    })}\n`, "utf8");
    return {archivePath, manifestPath, digest: digest(archiveBytes)};
}

async function createDesktopPortableArchive(path: string, portable: DesktopPortableArchiveManifest): Promise<void> {
    portable.runtime.envelopeSha256 = `sha256:${digest(new TextEncoder().encode(portable.runtime.envelopePath))}`;
    const files = {
        ".runtime/manager/neuro-book.mjs": "manager",
        "runtime/bun.exe": "bun",
        "tools/rg.exe": "rg",
        "tools/git.exe": "git",
        "tools/bash.exe": "bash",
        [portable.runtime.envelopePath]: portable.runtime.envelopePath,
        ...(portable.kind === "electron"
            ? {"desktop/resources/app.asar": "desktop/resources/app.asar"}
            : {}),
    };
    const hashes = new Map<string, string>();
    for (const [file, value] of Object.entries(files)) {
        hashes.set(file, digest(new TextEncoder().encode(value)));
    }
    const components = componentsManifest(hashes);
    components.applicationRuntime = components.managerRuntime;
    const now = new Date().toISOString();
    const manifest: InstallationManifest = {
        schemaVersion: 5,
        profile: "windows-portable",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.9.1",
        channel: "canary",
        sourceRevision: "f".repeat(40),
        roots: {
            state: {base: "installation-root", path: "data"},
            cache: {base: "installation-root", path: ".cache"},
            desktop: {base: "installation-root", path: "data/.desktop"},
            webview: {base: "installation-root", path: "data/.desktop/webview"},
        },
        components,
        installedAt: now,
        updatedAt: now,
    };
    await writeFile(path, zipSync({
        ...Object.fromEntries(Object.entries(files).map(([file, value]) => [file, strToU8(value)])),
        ".deploy/installation.json": strToU8(`${JSON.stringify(manifest)}\n`),
        "manifest.json": strToU8(`${JSON.stringify(portable)}\n`),
    }));
}

function componentsManifest(hashes: Map<string, string>): InstallationComponents {
    const asset = {archiveSha256: "c".repeat(64), sourceUrl: "local:test", license: "test", redistribution: "test"};
    return {
        source: {provider: "release", buildId: `sha256:${"a".repeat(64)}`, version: "0.9.1", revision: "f".repeat(40), path: ".", files: ["package.json"], archiveSha256: "a".repeat(64), sourceUrl: "local:source", license: "test", redistribution: "test"},
        product: {provider: "release", buildId: `sha256:${"a".repeat(64)}`, version: "0.9.1", revision: "f".repeat(40), path: ".output", platform: "windows-x64", archiveSha256: "a".repeat(64), sourceUrl: "local:product", license: "test", redistribution: "test", imageId: `sha256:${"e".repeat(64)}`, sourceDigest: `sha256:${"f".repeat(64)}`, lockfileSha256: `sha256:${"b".repeat(64)}`, builderContractVersion: "v1"},
        manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/neuro-book.mjs", bundleSha256: hashes.get(".runtime/manager/neuro-book.mjs")!},
        managerRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", executableSha256: hashes.get("runtime/bun.exe")!, ...asset},
        applicationRuntime: {provider: "system", version: "1.3.14", executable: "bun"},
        tools: {
            rg: {provider: "managed", version: "14.1.1", path: "tools/rg.exe", executableSha256: hashes.get("tools/rg.exe")!, ...asset},
            git: {provider: "managed", version: "2.51.0", path: "tools/git.exe", bashPath: "tools/bash.exe", distribution: "PortableGit", ...asset, archiveSha256: "d".repeat(64), gitSha256: hashes.get("tools/git.exe")!, bashSha256: hashes.get("tools/bash.exe")!},
        },
    };
}

function desktopManifest(): DesktopInstallationManifest {
    return {
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
            managerRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"b".repeat(64)}`},
            applicationRuntime: {provider: "managed", version: "1.3.14", path: "runtime/bun.exe", sha256: `sha256:${"b".repeat(64)}`},
            tools: {
                rg: {provider: "managed", version: "14.1.1", path: "tools/rg.exe", sha256: `sha256:${"a".repeat(64)}`},
                git: {provider: "managed", version: "2.51.0", path: "tools/git.exe", sha256: `sha256:${"c".repeat(64)}`, bashPath: "tools/bash.exe"},
            },
        },
        components: [
            {id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"e".repeat(64)}`},
            {id: "electron-application", version: "0.9.1", path: "desktop/resources/app.asar", sha256: `sha256:${"f".repeat(64)}`},
        ],
        receipts: [
            {id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"e".repeat(64)}`, source: "depot"},
            {id: "electron-application", version: "0.9.1", path: "desktop/resources/app.asar", sha256: `sha256:${"f".repeat(64)}`, source: "depot"},
        ],
        uninstall: {
            preserveStateRootByDefault: true,
            deleteStateRootRequiresExplicit: true,
            preserveExternalProjectWorkspace: true,
        },
        addCliToUserPath: false,
        installedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
    };
}

function digest(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}
