import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";

import {
    parseDesktopCapability,
    parseDesktopInstallationManifest,
    parseDesktopShellArchiveManifest,
    type DesktopCapability,
    type DesktopConnection,
    type DesktopEnvelope,
    type DesktopInstallationManifest,
    type DesktopShellArchiveManifest,
} from "nbook/shared/desktop-contract";

import {extractZip} from "#manager/download";
import {createAdmin} from "#manager/app-commands";
import {ensureDirectory, pathExists, readJson, sha256File, writeJsonAtomic} from "#manager/files";
import {writeInstallationManifest} from "#manager/manifest-store";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, resolveInstallationRoots} from "#manager/root-locators";
import {parseInstallationManifest} from "#manager/schema";
import {run, runCapture} from "#manager/process";
import {verifyInstalledProductRuntimeImage} from "#manager/product";
import type {InstallationComponents, InstallationManifest, InstallationRootLocators} from "#manager/types";

const DESKTOP_RUNTIME_SCHEMA = "nbook.desktop-installation-runtime/v1" as const;
const DESKTOP_INSTALLATION_FILE = "desktop-installation.json";
const DEFAULT_INSTALLATION_ROOT = "Programs\\NeuroBook";

export type DesktopLocalDepot = {
    /** 本地模式使用完整 Product Portable；远端模式改用 shellArchivePath。 */
    archivePath?: string;
    /** 远端模式只携带 Desktop Envelope，不携带 Product、Bun 或 Tool Pack。 */
    shellArchivePath?: string;
    envelope: DesktopEnvelope;
    channel: "stable" | "canary";
    connection: DesktopConnection;
    installationRoot?: string;
    addCliToUserPath: boolean;
    /** 本地 Product 首次安装时创建管理员；远端连接不允许携带该值。 */
    adminPassword?: string;
};

export type DesktopInstallResult = {
    installationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manifest: DesktopInstallationManifest;
    applicationManifest?: InstallationManifest;
    /** 远端安装前探测到的 Product 版本；本地模式为空。 */
    remoteProductVersion?: string;
};

/** 读取系统安装写入的 Desktop Manifest；普通 Product/Portable 返回 null。 */
export async function readDesktopInstallationManifest(
    installationRoot: string,
    locators: InstallationRootLocators,
): Promise<DesktopInstallationManifest | null> {
    const roots = resolveInstallationRoots(installationRoot, locators);
    const value = await readJson(join(roots.desktop, DESKTOP_INSTALLATION_FILE));
    return value === null ? null : parseDesktopInstallationManifest(value);
}

export type PortableArchiveManifest = {
    schema: "nbook.desktop-portable/v1";
    kind: DesktopEnvelope;
    platform: "windows-x64";
    product: {imagePath: ".output"; dirty: boolean; imageId: string};
    runtime: {bunPath: "runtime/bun.exe"; envelopePath: string; envelopeVersion: string};
    toolPack: {digest: string};
};

/** 从本地 depot 安装 Windows 用户级 Desktop；远端模式只安装壳并探测服务端能力。 */
export async function installDesktopFromLocalDepot(options: DesktopLocalDepot): Promise<DesktopInstallResult> {
    assertWindowsDesktopHost();
    if (options.connection.mode === "remote") return installDesktopShellFromLocalDepot(options);
    if (options.connection.mode === "local" && options.adminPassword === undefined) {
        throw new Error("本地 Desktop 首次安装必须提供管理员密码。" );
    }
    if (options.shellArchivePath !== undefined) throw new Error("本地 Desktop 安装必须使用完整 Portable archive，不接受 shell archive。" );
    if (!options.archivePath) throw new Error("本地 Desktop 安装缺少 Portable archive。" );
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
        const portable = parseDesktopPortableManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopPortableInstallable(portable, options.envelope);
        const applicationManifest = await prepareInstalledManifest(staging);
        await verifyDesktopPortablePayload(staging, applicationManifest, portable, options.envelope);
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
        if (options.connection.mode === "local") {
            await createAdmin(installationRoot, applicationManifest, undefined, options.adminPassword);
        }
        await registerWindowsDesktop(installationRoot, desktopManifest, options.addCliToUserPath);
        return {installationRoot, stateRoot: roots.state, cacheRoot: roots.cache, desktopRoot: roots.desktop, manifest: desktopManifest, applicationManifest};
    } catch (error) {
        await rm(installationRoot, {recursive: true, force: true}).catch(() => undefined);
        throw error;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

/**
 * 从独立 shell depot 安装远端 Desktop。
 *
 * 远端模式不解压或写入 Product、Bun、Manager、Tool Pack，也不读取管理员密码；
 * capability 在移动安装根前完成探测。
 */
export async function installDesktopShellFromLocalDepot(options: DesktopLocalDepot): Promise<DesktopInstallResult> {
    assertWindowsDesktopHost();
    if (options.connection.mode !== "remote") throw new Error("shell archive 只用于远端 Desktop 安装。" );
    if (options.adminPassword !== undefined) throw new Error("远端 Desktop 安装不能接收本地管理员密码。" );
    if (options.archivePath !== undefined) throw new Error("远端 Desktop 安装不能使用完整 Portable archive，请提供 shell archive。" );
    if (options.addCliToUserPath) throw new Error("远端 Desktop 只安装壳，不携带 Manager CLI，不能修改用户 PATH。" );
    if (!options.shellArchivePath) throw new Error("远端 Desktop 安装缺少 shell archive；它只应包含 Desktop Envelope。" );
    const capability = await probeRemoteDesktopCapability(options.connection.baseUrl);
    const installationRoot = resolve(options.installationRoot ?? defaultInstallationRoot());
    if (await pathExists(installationRoot)) {
        throw new Error(`Desktop Installation Root 已存在，更新请使用 Manager update：${installationRoot}`);
    }
    const archivePath = resolve(options.shellArchivePath);
    if (!await pathExists(archivePath)) throw new Error(`Desktop shell archive 不存在：${archivePath}`);

    const desktopCacheRoot = managerDesktopCacheRoot();
    await ensureDirectory(desktopCacheRoot);
    const staging = await mkdtemp(join(desktopCacheRoot, `stage-remote-${randomUUID()}-`));
    try {
        await extractZip(archivePath, staging);
        const shell = parseDesktopShellArchiveManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopShellInstallable(shell, options.envelope);
        await verifyDesktopShellPayload(staging, shell);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        const roots = resolveInstallationRoots(installationRoot, INSTALLED_WINDOWS_ROOT_LOCATORS);
        await ensureDirectory(roots.state);
        await ensureDirectory(roots.cache);
        await ensureDirectory(roots.desktop);
        await ensureDirectory(roots.webview);
        await writeDesktopRuntimeConfig(installationRoot);
        const desktopManifest = createRemoteDesktopInstallationManifest(options, shell);
        await writeJsonAtomic(join(roots.desktop, DESKTOP_INSTALLATION_FILE), desktopManifest);
        await registerWindowsDesktop(installationRoot, desktopManifest, options.addCliToUserPath);
        return {
            installationRoot,
            stateRoot: roots.state,
            cacheRoot: roots.cache,
            desktopRoot: roots.desktop,
            manifest: desktopManifest,
            remoteProductVersion: capability.productVersion,
        };
    } catch (error) {
        await rm(installationRoot, {recursive: true, force: true}).catch(() => undefined);
        throw error;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

/** 远端安装前验证服务端是否支持 DesktopBridge v1。 */
export async function probeRemoteDesktopCapability(baseUrl: string): Promise<DesktopCapability> {
    const origin = new URL(baseUrl).origin;
    const response = await fetch(new URL("/api/app/desktop-capability", `${origin}/`), {redirect: "error"});
    if (!response.ok) throw new Error(`远端 Desktop capability 请求失败：HTTP ${String(response.status)}`);
    return parseDesktopCapability(await response.json());
}

/** 壳 depot 必须与命令选择一致。 */
export function assertDesktopShellInstallable(shell: DesktopShellArchiveManifest, envelope: DesktopEnvelope): void {
    if (shell.kind !== envelope) throw new Error(`Shell archive 为 ${shell.kind}，命令选择为 ${envelope}。`);
    if (shell.platform !== "windows-x64") throw new Error("远端 Desktop shell archive 只支持 Windows x64。" );
}

/** 校验壳 depot 不含 Product 等其他 owner，并验证 Envelope 内容摘要。 */
export async function verifyDesktopShellPayload(root: string, shell: DesktopShellArchiveManifest): Promise<void> {
    const topLevel = await readdir(root, {withFileTypes: true});
    const unexpected = topLevel
        .map((entry) => entry.name)
        .filter((name) => name !== "manifest.json" && name !== "desktop");
    if (unexpected.length > 0) throw new Error(`远端 shell archive 包含禁止的顶层内容：${unexpected.join(", ")}`);
    const envelopePath = join(root, shell.envelopePath);
    if (!await pathExists(envelopePath)) throw new Error(`远端 shell archive 缺少 Envelope：${shell.envelopePath}`);
    if (await sha256File(envelopePath) !== shell.envelopeSha256.slice("sha256:".length)) {
        throw new Error("远端 shell Envelope checksum 不匹配。" );
    }
}

/** 在解压内容进入安装事务前固定 Envelope 身份和 clean Product 要求。 */
export function assertDesktopPortableInstallable(portable: PortableArchiveManifest, envelope: DesktopEnvelope): void {
    if (portable.kind !== envelope) {
        throw new Error(`Portable envelope 为 ${portable.kind}，命令选择为 ${envelope}。`);
    }
    if (portable.product.dirty) throw new Error("Desktop 用户级安装拒绝 dirty Product Portable。" );
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
export async function writeManagerWrappers(
    root: string,
    manifest: {components: Pick<InstallationComponents, "manager" | "managerRuntime">},
): Promise<void> {
    const runtime = manifest.components.managerRuntime;
    if (runtime.provider !== "managed") throw new Error("Desktop 用户级安装必须携带 managed Bun Runtime。");
    const manager = manifest.components.manager.path.replaceAll("/", "\\");
    const bun = runtime.path.replaceAll("/", "\\");
    const wrapperRoot = join(root, ".runtime", "bin");
    await ensureDirectory(wrapperRoot);
    await writeFile(join(wrapperRoot, "neuro-book.cmd"), `@echo off\r\n"%~dp0..\\..\\${bun}" "%~dp0..\\..\\${manager}" %*\r\n`, "utf8");
    await writeFile(join(wrapperRoot, "neuro-book.ps1"), `& (Join-Path $PSScriptRoot "..\\..\\${bun}") (Join-Path $PSScriptRoot "..\\..\\${manager}") @args\r\n`, "utf8");
}

/** 在把候选移入用户级 Installation Root 前复核所有可执行组件身份。 */
export async function verifyDesktopPortablePayload(
    root: string,
    manifest: {components: InstallationComponents},
    portable: PortableArchiveManifest,
    envelope: DesktopEnvelope,
): Promise<void> {
    const product = manifest.components.product;
    if (!product || product.provider === "container") throw new Error("Desktop Portable 缺少宿主 Product Runtime Image。" );
    if (product.imageId !== portable.product.imageId) throw new Error("Desktop Portable Product imageId 与 Installation Manifest 不一致。" );
    await verifyInstalledProductRuntimeImage(root, product);
    const manager = manifest.components.manager;
    if (await sha256File(join(root, manager.path)) !== manager.bundleSha256) throw new Error("Desktop Portable Manager CLI checksum 不匹配。" );
    const runtime = manifest.components.managerRuntime;
    if (runtime.provider !== "managed" || await sha256File(join(root, runtime.path)) !== runtime.executableSha256) {
        throw new Error("Desktop Portable Bun Runtime checksum 不匹配。" );
    }
    const envelopePath = envelope === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    if (portable.runtime.envelopePath !== envelopePath) throw new Error(`Desktop Portable Envelope 路径与命令选择不一致：${portable.runtime.envelopePath}`);
    if (!await pathExists(join(root, envelopePath))) throw new Error(`Desktop Portable 缺少 Envelope：${envelopePath}`);
    const toolPack = manifest.components.tools;
    const rg = toolPack.rg;
    if (!rg || rg.provider !== "managed" || await sha256File(join(root, rg.path)) !== rg.executableSha256) {
        throw new Error("Desktop Portable ripgrep checksum 不匹配。" );
    }
    const git = toolPack.git;
    if (!git || git.provider !== "managed" || await sha256File(join(root, git.path)) !== git.gitSha256
        || await sha256File(join(root, git.bashPath)) !== git.bashSha256) {
        throw new Error("Desktop Portable PortableGit checksum 不匹配。" );
    }
    if (portable.toolPack.digest !== `sha256:${git.archiveSha256}`) {
        throw new Error("Desktop Portable Tool Pack digest 与 Installation Manifest 不一致。" );
    }
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

/** 生成不携带本地 Product 的远端 Desktop 安装清单。 */
function createRemoteDesktopInstallationManifest(
    options: DesktopLocalDepot,
    shell: DesktopShellArchiveManifest,
): DesktopInstallationManifest {
    if (options.connection.mode !== "remote") throw new Error("远端 Desktop 清单必须使用 remote connection。" );
    const envelopeId = options.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const now = new Date().toISOString();
    return parseDesktopInstallationManifest({
        schema: "nbook.desktop-installation/v1",
        installationId: randomUUID(),
        envelope: options.envelope,
        channel: options.channel,
        connection: options.connection,
        components: [{id: envelopeId, version: shell.envelopeVersion, path: shell.envelopePath, sha256: shell.envelopeSha256}],
        addCliToUserPath: options.addCliToUserPath,
        installedAt: now,
        updatedAt: now,
    });
}

/** 注册用户级开始菜单、桌面快捷方式、卸载项和 neurobook:// 协议。 */
export async function registerWindowsDesktop(root: string, manifest: DesktopInstallationManifest, addCliToUserPath: boolean): Promise<void> {
    const envelopeId = manifest.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const envelope = manifest.components.find((component) => component.id === envelopeId);
    if (!envelope) throw new Error(`Desktop Installation Manifest 缺少 ${envelopeId}。`);
    const executable = join(root, envelope.path);
    const manager = join(root, ".runtime", "bin", "neuro-book.cmd");
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const startMenu = join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "NeuroBook");
    const desktop = join(process.env.USERPROFILE ?? homedir(), "Desktop");
    const shortcutPaths = [join(startMenu, "NeuroBook.lnk"), join(desktop, "NeuroBook.lnk")];
    const uninstallKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook";
    const protocolKey = "HKCU\\Software\\Classes\\neurobook";
    const previousPath = addCliToUserPath ? await readUserPath() : null;
    try {
        await ensureDirectory(startMenu);
        await ensureDirectory(desktop);
        await createShortcut(shortcutPaths[0]!, executable, root);
        await createShortcut(shortcutPaths[1]!, executable, root);
        await regAdd(uninstallKey, "DisplayName", "NeuroBook");
        await regAdd(uninstallKey, "InstallLocation", root);
        const uninstallCommand = await pathExists(manager)
            ? `"${manager}" uninstall --yes`
            : `neuro-book desktop uninstall --dir "${root}" --yes`;
        await regAdd(uninstallKey, "UninstallString", uninstallCommand);
        await regAdd(protocolKey, "", "URL:NeuroBook Protocol");
        await regAdd(protocolKey, "URL Protocol", "");
        await regAdd(`${protocolKey}\\shell\\open\\command`, "", `"${executable}" "%1"`);
        if (addCliToUserPath) await addUserPath(dirname(manager));
    } catch (error) {
        await removeWindowsDesktopRegistration(root, manifest, previousPath).catch(() => undefined);
        throw error;
    }
}

/** 卸载时删除 Manager 创建的 Windows 注册项、快捷方式和可选 PATH 项。 */
export async function removeWindowsDesktopRegistration(
    root: string,
    manifest: DesktopInstallationManifest,
    previousPath?: string[] | null,
): Promise<void> {
    assertWindowsDesktopHost();
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const shortcutPaths = [
        join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "NeuroBook", "NeuroBook.lnk"),
        join(process.env.USERPROFILE ?? homedir(), "Desktop", "NeuroBook.lnk"),
    ];
    await Promise.all(shortcutPaths.map((path) => rm(path, {force: true})));
    await regDelete("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook");
    await regDelete("HKCU\\Software\\Classes\\neurobook");
    if (manifest.addCliToUserPath) {
        if (previousPath) await writeUserPath(previousPath);
        else await removeUserPath(dirname(join(root, ".runtime", "bin", "neuro-book.cmd")));
    }
}

/** 卸载只含远端 Envelope 的用户级 Desktop；默认保留 State Root。 */
export async function uninstallRemoteDesktopInstallation(
    installationRoot: string,
    deleteData = false,
): Promise<{stateRoot: string}> {
    assertWindowsDesktopHost();
    const root = resolve(installationRoot);
    const roots = resolveInstallationRoots(root, INSTALLED_WINDOWS_ROOT_LOCATORS);
    const manifest = await readDesktopInstallationManifest(root, INSTALLED_WINDOWS_ROOT_LOCATORS);
    if (!manifest || manifest.connection.mode !== "remote") {
        throw new Error(`目录不是远端 Desktop 安装：${root}`);
    }
    await removeWindowsDesktopRegistration(root, manifest);
    await rm(root, {recursive: true, force: true});
    await Promise.all([
        rm(roots.cache, {recursive: true, force: true}),
        rm(roots.desktop, {recursive: true, force: true}),
        rm(roots.webview, {recursive: true, force: true}),
        ...(deleteData ? [rm(roots.state, {recursive: true, force: true})] : []),
    ]);
    return {stateRoot: roots.state};
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
    const entries = await readUserPath();
    if (entries.some((value) => value.toLocaleLowerCase() === directory.toLocaleLowerCase())) return;
    await regAdd("HKCU\\Environment", "Path", [...entries, directory].join(";"));
}

async function readUserPath(): Promise<string[]> {
    const existing = await runCapture("reg.exe", ["QUERY", "HKCU\\Environment", "/v", "Path"]).catch(() => "");
    const match = existing.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/imu);
    return (match?.[1] ?? "").split(";").map((value) => value.trim()).filter(Boolean);
}

async function writeUserPath(entries: string[]): Promise<void> {
    if (entries.length === 0) {
        await regDelete("HKCU\\Environment", "/v", "Path");
        return;
    }
    await regAdd("HKCU\\Environment", "Path", entries.join(";"));
}

async function removeUserPath(directory: string): Promise<void> {
    const entries = (await readUserPath()).filter((value) => value.toLocaleLowerCase() !== directory.toLocaleLowerCase());
    await writeUserPath(entries);
}

async function regDelete(key: string, ...extra: string[]): Promise<void> {
    await run("reg.exe", ["DELETE", key, ...extra, "/f"], {stdio: "ignore"}).catch(() => undefined);
}

export function parseDesktopPortableManifest(value: unknown): PortableArchiveManifest {
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
    const dirty = (product as Record<string, unknown>).dirty;
    const envelopeVersion = (runtime as Record<string, unknown>).envelopeVersion;
    const envelopePath = (runtime as Record<string, unknown>).envelopePath;
    const toolDigest = (toolPack as Record<string, unknown>).digest;
    if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("Portable Product imageId 无效。");
    if (typeof dirty !== "boolean") throw new Error("Portable Product dirty 标记无效。");
    if (typeof envelopeVersion !== "string" || !envelopeVersion.trim()) throw new Error("Portable Envelope version 缺失。");
    if (typeof envelopePath !== "string" || !envelopePath.trim()) throw new Error("Portable Envelope 路径缺失。");
    if (typeof toolDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(toolDigest)) throw new Error("Portable Tool Pack digest 无效。");
    return {
        schema: "nbook.desktop-portable/v1",
        kind: root.kind,
        platform: "windows-x64",
        product: {imagePath: ".output", dirty, imageId},
        runtime: {bunPath: "runtime/bun.exe", envelopePath, envelopeVersion},
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
