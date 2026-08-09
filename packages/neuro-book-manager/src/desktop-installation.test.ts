import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
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

vi.mock("#manager/process", () => processMocks);
vi.mock("#manager/product", () => ({verifyInstalledProductRuntimeImage: productMocks.verify}));
vi.mock("#manager/app-commands", () => ({createAdmin: appCommandMocks.createAdmin}));
vi.mock("#manager/config", () => ({enableAuthentication: appCommandMocks.enableAuthentication}));

import {
    assertDesktopPortableInstallable,
    assertDesktopShellInstallable,
    inferWindowsDesktopInstallationScope,
    installDesktopFromLocalDepot,
    installDesktopShellFromLocalDepot,
    parseDesktopPortableManifest,
    registerWindowsDesktop,
    removeWindowsDesktopRegistration,
    verifyDesktopPortablePayload,
    verifyDesktopShellPayload,
    uninstallRemoteDesktopInstallation,
    writeMachineUninstallLauncher,
    writeManagerWrappers,
} from "#manager/desktop-installation";
import type {DesktopInstallationManifest} from "nbook/shared/desktop-contract";
import type {InstallationComponents, InstallationManifest} from "#manager/types";

const roots: string[] = [];
const originalPlatform = process.platform;
const originalArch = process.arch;
const originalAppData = process.env.APPDATA;
const originalUserProfile = process.env.USERPROFILE;
const originalLocalAppData = process.env.LOCALAPPDATA;

beforeEach(() => {
    processMocks.run.mockReset().mockResolvedValue(undefined);
    processMocks.runCapture.mockReset().mockResolvedValue("");
    processMocks.runCaptureResult.mockReset().mockResolvedValue({stdout: "", stderr: "", exitCode: 1, signal: null});
    productMocks.verify.mockReset().mockResolvedValue(undefined);
    appCommandMocks.createAdmin.mockReset().mockResolvedValue(undefined);
    appCommandMocks.enableAuthentication.mockReset().mockResolvedValue(undefined);
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
    vi.unstubAllGlobals();
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Desktop Portable manifest", () => {
    it("严格校验 dirty 标记、Envelope 路径和 digest", () => {
        const manifest = portableManifest("electron");
        expect(parseDesktopPortableManifest(manifest)).toEqual(manifest);
        expect(() => assertDesktopPortableInstallable({...manifest, product: {...manifest.product, dirty: true}}, "electron"))
            .toThrow("拒绝 dirty Product");
        expect(() => assertDesktopPortableInstallable(manifest, "tauri")).toThrow("命令选择");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            product: {...manifest.product, dirty: "false"},
        })).toThrow("dirty 标记");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            toolPack: {digest: "not-a-digest"},
        })).toThrow("Tool Pack digest");
        expect(() => parseDesktopPortableManifest({
            ...manifest,
            runtime: {...manifest.runtime, envelopePath: ""},
        })).toThrow("Envelope 路径");
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

        await expect(verifyDesktopPortablePayload(root, {components}, portable, "electron")).resolves.toBeUndefined();
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

    it("Manager wrapper 只使用相对 Installation Root 路径", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-wrapper-"));
        roots.push(root);
        await writeManagerWrappers(root, {
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
            },
        });
        const cmd = await readFile(join(root, ".runtime", "bin", "neuro-book.cmd"), "utf8");
        const ps1 = await readFile(join(root, ".runtime", "bin", "neuro-book.ps1"), "utf8");
        expect(cmd).toContain("%~dp0..\\..\\runtime\\bun.exe");
        expect(cmd).toContain("%~dp0..\\..\\.runtime\\manager\\neuro-book.mjs");
        expect(ps1).toContain("$PSScriptRoot \"..\\..\\runtime\\bun.exe\"");
        expect(cmd).not.toContain(root);
        expect(ps1).not.toContain(root);
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
            webview: "bundled-chromium",
        } as const;
        await writeFile(archive, zipSync({
            "manifest.json": strToU8(`${JSON.stringify(shellManifest)}\n`),
            "desktop/NeuroBook-Electron.exe": executable,
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
        const launcher = await writeMachineUninstallLauncher(installationRoot, "installation-1");
        const script = await readFile(launcher, "utf8");
        expect(launcher).not.toContain(installationRoot);
        expect(script).toContain("Start-Process");
        expect(script).toContain("-Verb RunAs");
        expect(script).toContain("-RedirectStandardOutput");
        expect(script).toContain("resultPath");
        expect(script).toContain("expectedResultRoot");
        expect(script).toContain("canonicalResultPath");
        expect(script).toContain("等待外置卸载 Host 最终回执超时");
        expect(script).toContain("外置卸载 Host 返回失败");
        expect(script).toContain("-EncodedCommand");
        expect(script).toContain("Start-Sleep -Milliseconds 500");
        expect(script).toContain('Join-Path $Root "manager\\neuro-book.mjs"');
        expect(script).not.toContain(".runtime\\manager\\neuro-book.mjs");

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

function portableManifest(kind: "electron" | "tauri") {
    return {
        schema: "nbook.desktop-portable/v1" as const,
        kind,
        platform: "windows-x64" as const,
        product: {imagePath: ".output" as const, dirty: false, imageId: `sha256:${"e".repeat(64)}`},
        runtime: {
            bunPath: "runtime/bun.exe" as const,
            envelopePath: kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe",
            envelopeVersion: "43.2.0",
            envelopeSha256: `sha256:${digest(new TextEncoder().encode(kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe"))}`,
        },
        toolPack: {digest: `sha256:${"d".repeat(64)}`},
    };
}

async function createDesktopPortableArchive(path: string, portable: ReturnType<typeof portableManifest>): Promise<void> {
    portable.runtime.envelopeSha256 = `sha256:${digest(new TextEncoder().encode(portable.runtime.envelopePath))}`;
    const files = {
        ".runtime/manager/neuro-book.mjs": "manager",
        "runtime/bun.exe": "bun",
        "tools/rg.exe": "rg",
        "tools/git.exe": "git",
        "tools/bash.exe": "bash",
        [portable.runtime.envelopePath]: portable.runtime.envelopePath,
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
        components: [{id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"e".repeat(64)}`}],
        receipts: [{id: "electron-envelope", version: "43.2.0", path: "desktop/NeuroBook-Electron.exe", sha256: `sha256:${"e".repeat(64)}`, source: "depot"}],
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
