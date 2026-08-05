import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";

import {parseDesktopInstallationManifest, type DesktopConnection, type DesktopEnvelope, type DesktopInstallationManifest} from "nbook/shared/desktop-contract";

import {extractZip} from "#manager/download";
import {ensureDirectory, pathExists, readJson, writeJsonAtomic} from "#manager/files";
import {writeInstallationManifest} from "#manager/manifest-store";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, resolveInstallationRoots} from "#manager/root-locators";
import {parseInstallationManifest} from "#manager/schema";
import {run, runCapture} from "#manager/process";
import type {InstallationManifest} from "#manager/types";

const DESKTOP_RUNTIME_SCHEMA = "nbook.desktop-installation-runtime/v1" as const;
const DESKTOP_INSTALLATION_FILE = "desktop-installation.json";
const DEFAULT_INSTALLATION_ROOT = "Programs\\NeuroBook";

export type DesktopLocalDepot = {
    archivePath: string;
    envelope: DesktopEnvelope;
    channel: "stable" | "canary";
    connection: DesktopConnection;
    installationRoot?: string;
    addCliToUserPath: boolean;
};

export type DesktopInstallResult = {
    installationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manifest: DesktopInstallationManifest;
    applicationManifest: InstallationManifest;
};

type PortableArchiveManifest = {
    schema: "nbook.desktop-portable/v1";
    kind: DesktopEnvelope;
    platform: "windows-x64";
    product: {imagePath: ".output"; dirty: boolean; imageId: string};
    runtime: {bunPath: "runtime/bun.exe"; envelopePath: string; envelopeVersion: string};
    toolPack: {digest: string};
};

/** 从本地 Portable depot 安装 Windows 用户级 Desktop；网络下载仍由 Manager 的上层流程负责。 */
export async function installDesktopFromLocalDepot(options: DesktopLocalDepot): Promise<DesktopInstallResult> {
    assertWindowsDesktopHost();
    const installationRoot = resolve(options.installationRoot ?? defaultInstallationRoot());
    if (await pathExists(installationRoot)) {
        throw new Error(`Desktop Installation Root 已存在，更新请使用 Manager update：${installationRoot}`);
    }
    const archivePath = resolve(options.archivePath);
    if (!await pathExists(archivePath)) throw new Error(`Desktop Portable archive 不存在：${archivePath}`);

    const desktopCacheRoot = managerDesktopCacheRoot();
    await ensureDirectory(desktopCacheRoot);
    const staging = await mkdtemp(join(desktopCacheRoot, `stage-${randomUUID()}-`));
    try {
        await extractZip(archivePath, staging);
        const portable = parsePortableManifest(await readJson(join(staging, "manifest.json")));
        if (portable.kind !== options.envelope) {
            throw new Error(`Portable envelope 为 ${portable.kind}，命令选择为 ${options.envelope}。`);
        }
        const applicationManifest = await prepareInstalledManifest(staging);
        const roots = resolveInstallationRoots(installationRoot, applicationManifest.roots);
        await removePortableDataRoots(staging);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        await ensureDirectory(roots.state);
        await ensureDirectory(roots.cache);
        await ensureDirectory(roots.desktop);
        await ensureDirectory(roots.webview);
        await writeDesktopRuntimeConfig(installationRoot);
        await writeManagerWrappers(installationRoot, applicationManifest);
        const desktopManifest = await createDesktopInstallationManifest(options, installationRoot, applicationManifest, portable);
        await writeJsonAtomic(join(roots.desktop, DESKTOP_INSTALLATION_FILE), desktopManifest);
        await registerWindowsDesktop(installationRoot, desktopManifest, options.addCliToUserPath);
        return {installationRoot, stateRoot: roots.state, cacheRoot: roots.cache, desktopRoot: roots.desktop, manifest: desktopManifest, applicationManifest};
    } catch (error) {
        await rm(installationRoot, {recursive: true, force: true}).catch(() => undefined);
        throw error;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

/** 将 Portable 的 Application Manifest 切换为 Windows 用户级 locator。 */
async function prepareInstalledManifest(staging: string): Promise<InstallationManifest> {
    const path = join(staging, ".deploy", "installation.json");
    const value = await readJson(path);
    const portable = parseInstallationManifest(value);
    if (portable.profile !== "windows-portable") throw new Error("Desktop 本地 depot 必须来自 windows-portable Product 包。");
    const installed: InstallationManifest = {
        ...portable,
        profile: "product-bun",
        roots: INSTALLED_WINDOWS_ROOT_LOCATORS,
        updatedAt: new Date().toISOString(),
    };
    parseInstallationManifest(installed);
    await writeInstallationManifest(path, installed);
    return installed;
}

/** 安装根只保存程序，Portable 的空 data/cache 目录不能遮蔽 local-app-data owner。 */
async function removePortableDataRoots(staging: string): Promise<void> {
    await Promise.all([
        rm(join(staging, "data"), {recursive: true, force: true}),
        rm(join(staging, ".cache"), {recursive: true, force: true}),
    ]);
}

/** 生成供两个 Envelope 读取的相对运行时 locator；不持久化本机绝对路径。 */
async function writeDesktopRuntimeConfig(installationRoot: string): Promise<void> {
    await writeJsonAtomic(join(installationRoot, "desktop", "runtime-locators.json"), {
        schema: DESKTOP_RUNTIME_SCHEMA,
        state: {base: "local-app-data", path: "NeuroBook/data"},
        cache: {base: "local-app-data", path: "NeuroBook/cache"},
        desktop: {base: "local-app-data", path: "NeuroBook/desktop"},
        webview: {base: "local-app-data", path: "NeuroBook/desktop/webview"},
    });
}

/** 让系统安装仍可从开始菜单调用 Manager CLI；wrapper 不携带 secret。 */
async function writeManagerWrappers(root: string, manifest: InstallationManifest): Promise<void> {
    const runtime = manifest.components.managerRuntime;
    if (runtime.provider !== "managed") throw new Error("Desktop 用户级安装必须携带 managed Bun Runtime。");
    const manager = manifest.components.manager.path.replaceAll("/", "\\");
    const bun = runtime.path.replaceAll("/", "\\");
    const wrapperRoot = join(root, ".runtime", "bin");
    await ensureDirectory(wrapperRoot);
    await writeFile(join(wrapperRoot, "neuro-book.cmd"), `@echo off\r\n"%~dp0..\\..\\${bun}" "${join(root, manager)}" %*\r\n`, "utf8");
    await writeFile(join(wrapperRoot, "neuro-book.ps1"), `& "${join(root, bun)}" "${join(root, manager)}" @args\r\n`, "utf8");
}

async function createDesktopInstallationManifest(
    options: DesktopLocalDepot,
    root: string,
    applicationManifest: InstallationManifest,
    portable: PortableArchiveManifest,
): Promise<DesktopInstallationManifest> {
    const now = new Date().toISOString();
    const envelopePath = options.envelope === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    const envelopeId = options.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const manager = applicationManifest.components.manager;
    const managerRuntime = applicationManifest.components.managerRuntime;
    if (managerRuntime.provider !== "managed") throw new Error("Desktop 安装需要 managed Bun Runtime。" );
    const value = {
        schema: "nbook.desktop-installation/v1",
        installationId: randomUUID(),
        envelope: options.envelope,
        channel: options.channel,
        connection: options.connection,
        components: [
            {id: "product", version: applicationManifest.appVersion, path: ".output", sha256: portable.product.imageId},
            {id: "bun", version: managerRuntime.version, path: managerRuntime.path, sha256: `sha256:${managerRuntime.executableSha256}`},
            {id: "manager-cli", version: manager.version, path: manager.path, sha256: `sha256:${manager.bundleSha256}`},
            {id: "tool-pack", version: "portable", path: "tools", sha256: portable.toolPack.digest},
            {id: envelopeId, version: portable.runtime.envelopeVersion, path: envelopePath, sha256: await fileSha256(root, envelopePath)},
        ],
        addCliToUserPath: options.addCliToUserPath,
        installedAt: now,
        updatedAt: now,
    };
    return parseDesktopInstallationManifest(value);
}

/** 注册用户级开始菜单、桌面快捷方式、卸载项和 neurobook:// 协议。 */
async function registerWindowsDesktop(root: string, manifest: DesktopInstallationManifest, addCliToUserPath: boolean): Promise<void> {
    const envelopeId = manifest.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const envelope = manifest.components.find((component) => component.id === envelopeId);
    if (!envelope) throw new Error(`Desktop Installation Manifest 缺少 ${envelopeId}。`);
    const executable = join(root, envelope.path);
    const manager = join(root, ".runtime", "bin", "neuro-book.cmd");
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const startMenu = join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "NeuroBook");
    const desktop = join(process.env.USERPROFILE ?? homedir(), "Desktop");
    await ensureDirectory(startMenu);
    await ensureDirectory(desktop);
    await createShortcut(join(startMenu, "NeuroBook.lnk"), executable, root);
    await createShortcut(join(desktop, "NeuroBook.lnk"), executable, root);
    const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook";
    await regAdd(uninstallKey, "DisplayName", "NeuroBook");
    await regAdd(uninstallKey, "InstallLocation", root);
    await regAdd(uninstallKey, "UninstallString", `"${manager}" uninstall --yes`);
    const protocolKey = "HKCU\\Software\\Classes\\neurobook";
    await regAdd(protocolKey, "", "URL:NeuroBook Protocol");
    await regAdd(protocolKey, "URL Protocol", "");
    await regAdd(`${protocolKey}\\shell\\open\\command`, "", `"${executable}" "%1"`);
    if (addCliToUserPath) await addUserPath(dirname(manager));
}

async function createShortcut(path: string, target: string, workingDirectory: string): Promise<void> {
    const script = "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut($env:NBOOK_SHORTCUT); $s.TargetPath = $env:NBOOK_TARGET; $s.WorkingDirectory = $env:NBOOK_CWD; $s.Save()";
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: {...process.env, NBOOK_SHORTCUT: path, NBOOK_TARGET: target, NBOOK_CWD: workingDirectory},
        stdio: "ignore",
    });
}

async function regAdd(key: string, name: string, value: string): Promise<void> {
    await run("reg.exe", ["ADD", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], {stdio: "ignore"});
}

async function addUserPath(directory: string): Promise<void> {
    const existing = await runCapture("reg.exe", ["QUERY", "HKCU\\Environment", "/v", "Path"]).catch(() => "");
    const match = existing.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/imu);
    const entries = (match?.[1] ?? "").split(";").map((value) => value.trim()).filter(Boolean);
    if (entries.some((value) => value.toLocaleLowerCase() === directory.toLocaleLowerCase())) return;
    await regAdd("HKCU\\Environment", "Path", [...entries, directory].join(";"));
}

function parsePortableManifest(value: unknown): PortableArchiveManifest {
    if (!value || typeof value !== "object") throw new Error("Portable manifest 不是对象。");
    const root = value as Record<string, unknown>;
    if (root.schema !== "nbook.desktop-portable/v1") throw new Error("Portable manifest schema 不受支持。");
    if (root.kind !== "electron" && root.kind !== "tauri") throw new Error("Portable manifest envelope 无效。");
    if (root.platform !== "windows-x64") throw new Error("Desktop 用户级安装只接受 Windows x64 Portable。");
    const product = root.product;
    const runtime = root.runtime;
    const toolPack = root.toolPack;
    if (!product || typeof product !== "object" || (product as Record<string, unknown>).imagePath !== ".output") throw new Error("Portable manifest 缺少 Product Image。");
    if (!runtime || typeof runtime !== "object" || (runtime as Record<string, unknown>).bunPath !== "runtime/bun.exe") throw new Error("Portable manifest 缺少 Bun Runtime。");
    if (!toolPack || typeof toolPack !== "object") throw new Error("Portable manifest 缺少 Tool Pack。");
    const imageId = (product as Record<string, unknown>).imageId;
    const envelopeVersion = (runtime as Record<string, unknown>).envelopeVersion;
    const toolDigest = (toolPack as Record<string, unknown>).digest;
    if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("Portable Product imageId 无效。");
    if (typeof envelopeVersion !== "string" || !envelopeVersion.trim()) throw new Error("Portable Envelope version 缺失。");
    if (typeof toolDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(toolDigest)) throw new Error("Portable Tool Pack digest 无效。");
    return {
        schema: "nbook.desktop-portable/v1",
        kind: root.kind,
        platform: "windows-x64",
        product: {imagePath: ".output", dirty: Boolean((product as Record<string, unknown>).dirty), imageId},
        runtime: {bunPath: "runtime/bun.exe", envelopePath: String((runtime as Record<string, unknown>).envelopePath ?? ""), envelopeVersion},
        toolPack: {digest: toolDigest},
    };
}

async function fileSha256(root: string, relativePath: string): Promise<string> {
    const digest = createHash("sha256").update(await readFile(join(root, relativePath))).digest("hex");
    return `sha256:${digest}`;
}

function assertWindowsDesktopHost(): void {
    if (process.platform !== "win32") throw new Error("Desktop 用户级安装当前只支持 Windows；macOS 仅完成安装合同与 CI 准备。");
    if (process.arch !== "x64") throw new Error(`Desktop Windows 用户级安装只支持 x64，当前为 ${process.arch}。`);
}

function defaultInstallationRoot(): string {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, DEFAULT_INSTALLATION_ROOT);
}

function managerDesktopCacheRoot(): string {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "NeuroBook", "manager", "desktop");
}
