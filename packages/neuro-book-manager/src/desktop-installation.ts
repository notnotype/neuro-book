import {createHash, randomUUID} from "node:crypto";
import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, isAbsolute, join, relative, resolve, sep, win32} from "node:path";

import {
    DESKTOP_INSTALLATION_SCHEMA,
    parseDesktopCapability,
    parseDesktopDistributionManifest,
    parseDesktopInstallationManifest,
    parseDesktopShellArchiveManifest,
    desktopRemoteOrigin,
    type DesktopCapability,
    type DesktopConnection,
    type DesktopDistributionManifest,
    type DesktopEnvelope,
    type DesktopInstallationManifest,
    type DesktopInstallationScope,
    type DesktopInstallationProviders,
    type DesktopProviderLocator,
    type DesktopToolProviderLocator,
    type DesktopShellArchiveManifest,
} from "nbook/shared/desktop-contract";

import {downloadVerified, extractZip} from "#manager/download";
import {createAdmin} from "#manager/app-commands";
import {enableAuthentication} from "#manager/config";
import {ensureDirectory, pathExists, readJson, sha256File, writeJsonAtomic} from "#manager/files";
import {writeInstallationManifest} from "#manager/manifest-store";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, resolveInstallationRoots} from "#manager/root-locators";
import {parseInstallationManifest} from "#manager/schema";
import {run, runCaptureResult, type RunCaptureResult} from "#manager/process";
import {verifyInstalledProductRuntimeImage} from "#manager/product";
import type {InstallationComponents, InstallationManifest, InstallationRootLocators} from "#manager/types";

const DESKTOP_RUNTIME_SCHEMA = "nbook.desktop-installation-runtime/v1" as const;
const DESKTOP_INSTALLATION_FILE = "desktop-installation.json";
const DEFAULT_INSTALLATION_ROOT = "Programs\\NeuroBook";
const DESKTOP_DEFAULT_ADMIN_USERNAME = "admin";

export type DesktopLocalDepot = {
    /** 本地模式使用完整 Product Portable；远端模式改用 shellArchivePath。 */
    archivePath?: string;
    /** 远端模式只携带 Desktop Envelope，不携带 Product、Bun 或 Tool Pack。 */
    shellArchivePath?: string;
    /** 本地 distribution manifest；archive location 必须是同一 depot 根内的相对 ZIP 路径。 */
    distributionManifestPath?: string;
    /** 在线 distribution manifest；只接受 HTTPS，正文按摘要缓存。 */
    distributionManifestUrl?: string;
    envelope: DesktopEnvelope;
    channel: "stable" | "canary";
    connection: DesktopConnection;
    installationScope?: DesktopInstallationScope;
    installationRoot?: string;
    addCliToUserPath: boolean;
    runtimeProvider?: "managed" | "system";
    toolProvider?: "managed" | "system";
    /** 本地 Product 首次安装时创建管理员；远端连接不允许携带该值。 */
    adminPassword?: string;
    /** 当前 Manager CLI 自身入口；远端 shell 的卸载注册由它生成稳定 launcher。 */
    managerExecutable?: string;
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
    runtime: {bunPath: "runtime/bun.exe"; envelopePath: string; envelopeVersion: string; envelopeSha256: string};
    toolPack: {digest: string};
};

/** 从本地 depot 安装 Windows Desktop；远端模式只安装壳并探测服务端能力。 */
export async function installDesktopFromLocalDepot(options: DesktopLocalDepot): Promise<DesktopInstallResult> {
    assertWindowsDesktopHost();
    if (options.connection.mode === "remote") return installDesktopShellFromLocalDepot(options);
    if (options.shellArchivePath !== undefined) throw new Error("本地 Desktop 安装必须使用完整 Portable archive，不接受 shell archive。" );
    if (options.archivePath !== undefined
        && (options.distributionManifestPath !== undefined || options.distributionManifestUrl !== undefined)) {
        throw new Error("本地 Desktop 安装不能同时提供 archive 和 distribution manifest。" );
    }
    if (!options.archivePath && !options.distributionManifestPath && !options.distributionManifestUrl) {
        throw new Error("本地 Desktop 安装缺少 Portable archive 或 distribution manifest。" );
    }
    if (options.distributionManifestPath !== undefined && options.distributionManifestUrl !== undefined) {
        throw new Error("本地 Desktop 安装不能同时提供本地和在线 distribution manifest。" );
    }
    const installationScope = options.installationScope ?? "user";
    const installationRoot = resolve(options.installationRoot ?? defaultDesktopInstallationRoot(installationScope));
    await assertInstallationScopeWritable(installationRoot, installationScope);
    if (await pathExists(installationRoot)) {
        throw new Error(`Desktop Installation Root 已存在，更新请使用 Manager update：${installationRoot}`);
    }
    const archivePath = await resolveDepotArchive(options, options.envelope === "electron" ? "electron-envelope" : "tauri-envelope");
    if (!await pathExists(archivePath)) throw new Error(`Desktop Portable archive 不存在：${archivePath}`);

    const installationParent = dirname(installationRoot);
    await ensureDirectory(installationParent);
    const staging = await mkdtemp(join(installationParent, `.neurobook-stage-${randomUUID()}-`));
    let movedToInstallation = false;
    const createdRoots: string[] = [];
    let uninstallLauncher: string | undefined;
    try {
        await extractZip(archivePath, staging);
        const portable = parseDesktopPortableManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopPortableInstallable(portable, options.envelope);
        const applicationManifest = await prepareInstalledManifest(staging);
        await verifyDesktopPortablePayload(staging, applicationManifest, portable, options.envelope);
        const roots = resolveInstallationRoots(installationRoot, applicationManifest.roots);
        await assertFreshDesktopRoots(roots);
        await removePortableDataRoots(staging);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        movedToInstallation = true;
        await ensureTrackedDirectory(roots.state, createdRoots);
        await ensureTrackedDirectory(roots.cache, createdRoots);
        await ensureTrackedDirectory(roots.desktop, createdRoots);
        await ensureTrackedDirectory(roots.webview, createdRoots);
        if (!(await pathExists(join(roots.state, "config.yaml")))) {
            await writeFile(join(roots.state, "config.yaml"), "auth:\n    enabled: false\n", "utf8");
        }
        await writeDesktopRuntimeConfig(installationRoot);
        await writeManagerWrappers(installationRoot, applicationManifest);
        const desktopManifest = await createDesktopInstallationManifest(options, installationRoot, applicationManifest, portable);
        await writeJsonAtomic(join(roots.desktop, DESKTOP_INSTALLATION_FILE), desktopManifest);
        if (options.connection.mode === "local") {
            if (options.adminPassword !== undefined) {
                await createAdmin(installationRoot, applicationManifest, DESKTOP_DEFAULT_ADMIN_USERNAME, options.adminPassword);
                await enableAuthentication(roots.state);
            }
        }
        if (desktopManifest.installationScope === "machine") {
            uninstallLauncher = await writeMachineUninstallLauncher(
                installationRoot,
                desktopManifest.installationId,
                applicationManifest.components.manager.path,
            );
        }
        await registerWindowsDesktop(installationRoot, desktopManifest, options.addCliToUserPath, uninstallLauncher);
        return {installationRoot, stateRoot: roots.state, cacheRoot: roots.cache, desktopRoot: roots.desktop, manifest: desktopManifest, applicationManifest};
    } catch (error) {
        if (movedToInstallation) await rm(installationRoot, {recursive: true, force: true}).catch(() => undefined);
        if (uninstallLauncher) await rm(uninstallLauncher, {force: true}).catch(() => undefined);
        await removeCreatedDesktopRoots(createdRoots);
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
    if (options.shellArchivePath !== undefined
        && (options.distributionManifestPath !== undefined || options.distributionManifestUrl !== undefined)) {
        throw new Error("远端 Desktop 安装不能同时提供 shell archive 和 distribution manifest。" );
    }
    if (!options.shellArchivePath && !options.distributionManifestPath && !options.distributionManifestUrl) {
        throw new Error("远端 Desktop 安装缺少 shell archive 或 distribution manifest。" );
    }
    if (options.addCliToUserPath) throw new Error("远端 Desktop 只安装壳，不携带 Manager CLI，不能修改用户 PATH。" );
    const capability = await probeRemoteDesktopCapability(options.connection.baseUrl, options.connection.insecureHttpAccepted);
    const installationScope = options.installationScope ?? "user";
    const installationRoot = resolve(options.installationRoot ?? defaultDesktopInstallationRoot(installationScope));
    await assertInstallationScopeWritable(installationRoot, installationScope);
    if (await pathExists(installationRoot)) {
        throw new Error(`Desktop Installation Root 已存在，更新请使用 Manager update：${installationRoot}`);
    }
    const archivePath = await resolveDepotArchive(options, options.envelope === "electron" ? "electron-envelope" : "tauri-envelope");
    if (!await pathExists(archivePath)) throw new Error(`Desktop shell archive 不存在：${archivePath}`);

    const installationParent = dirname(installationRoot);
    await ensureDirectory(installationParent);
    const staging = await mkdtemp(join(installationParent, `.neurobook-stage-remote-${randomUUID()}-`));
    let movedToInstallation = false;
    const createdRoots: string[] = [];
    try {
        await extractZip(archivePath, staging);
        const shell = parseDesktopShellArchiveManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopShellInstallable(shell, options.envelope);
        await verifyDesktopShellPayload(staging, shell);
        const roots = resolveInstallationRoots(installationRoot, INSTALLED_WINDOWS_ROOT_LOCATORS);
        await assertFreshDesktopRoots(roots);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        movedToInstallation = true;
        await ensureTrackedDirectory(roots.state, createdRoots);
        await ensureTrackedDirectory(roots.cache, createdRoots);
        await ensureTrackedDirectory(roots.desktop, createdRoots);
        await ensureTrackedDirectory(roots.webview, createdRoots);
        await writeDesktopRuntimeConfig(installationRoot);
        const desktopManifest = createRemoteDesktopInstallationManifest(options, shell);
        await writeJsonAtomic(join(roots.desktop, DESKTOP_INSTALLATION_FILE), desktopManifest);
        const uninstallLauncher = await writeRemoteManagerLauncher(options.managerExecutable);
        await registerWindowsDesktop(installationRoot, desktopManifest, options.addCliToUserPath, uninstallLauncher);
        return {
            installationRoot,
            stateRoot: roots.state,
            cacheRoot: roots.cache,
            desktopRoot: roots.desktop,
            manifest: desktopManifest,
            remoteProductVersion: capability.productVersion,
        };
    } catch (error) {
        if (movedToInstallation) await rm(installationRoot, {recursive: true, force: true}).catch(() => undefined);
        await removeCreatedDesktopRoots(createdRoots);
        throw error;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

/** 远端安装前验证服务端是否支持 DesktopBridge v2。 */
export async function probeRemoteDesktopCapability(baseUrl: string, insecureHttpAccepted = false): Promise<DesktopCapability> {
    const origin = desktopRemoteOrigin(baseUrl, insecureHttpAccepted);
    const response = await fetch(new URL("/api/app/desktop-capability", `${origin}/`), {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
    });
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
    const manifestEntry = topLevel.find((entry) => entry.name === "manifest.json");
    if (!manifestEntry) {
        throw new Error("远端 shell archive 缺少 manifest.json。" );
    }
    if (!manifestEntry.isFile()) {
        throw new Error("远端 shell archive 的 manifest.json 必须是普通文件。");
    }
    const desktopEntry = topLevel.find((entry) => entry.name === "desktop");
    if (!desktopEntry?.isDirectory()) throw new Error("远端 shell archive 缺少 desktop 目录。");
    const unexpected = topLevel
        .map((entry) => entry.name)
        .filter((name) => name !== "manifest.json" && name !== "desktop");
    if (unexpected.length > 0) throw new Error(`远端 shell archive 包含禁止的顶层内容：${unexpected.join(", ")}`);
    const entries = await collectShellEntries(join(root, "desktop"));
    const forbidden = entries.filter((entry) => entry.split("/").some((segment) => [".output", "server", "manager", "runtime", "tools", "data", ".deploy", "source"].includes(segment)));
    if (forbidden.length > 0) throw new Error(`远端 shell archive 包含禁止的 Product/Runtime owner：${forbidden.join(", ")}`);
    if (shell.kind === "tauri" && entries.some((entry) => entry !== "NeuroBook-Tauri.exe")) {
        throw new Error("Tauri shell archive 只能包含 Tauri Envelope 可执行文件。");
    }
    const envelopePath = join(root, shell.envelopePath);
    if (!await pathExists(envelopePath)) throw new Error(`远端 shell archive 缺少 Envelope：${shell.envelopePath}`);
    if (await sha256File(envelopePath) !== shell.envelopeSha256.slice("sha256:".length)) {
        throw new Error("远端 shell Envelope checksum 不匹配。" );
    }
}

/** 递归读取壳目录并拒绝符号链接，避免把其他 owner 藏在 Envelope 目录内。 */
async function collectShellEntries(root: string, prefix = ""): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true});
    const result: string[] = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`远端 shell archive 不允许符号链接：${relative}`);
        if (entry.isDirectory()) result.push(...await collectShellEntries(join(root, entry.name), relative));
        else if (entry.isFile()) result.push(relative);
        else throw new Error(`远端 shell archive 包含不受支持的文件类型：${relative}`);
    }
    return result;
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
        installedAt: new Date().toISOString(),
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
    if (`sha256:${await sha256File(join(root, envelopePath))}` !== portable.runtime.envelopeSha256) throw new Error("Desktop Portable Envelope checksum 不匹配。");
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
    const providers = await createDesktopInstallationProviders(options, applicationManifest);
    const installationScope = options.installationScope ?? "user";
    const components = [
        {id: "product" as const, version: applicationManifest.appVersion, path: ".output", sha256: portable.product.imageId},
        {id: "bun" as const, version: managerRuntime.version, path: managerRuntime.path, sha256: `sha256:${managerRuntime.executableSha256}`},
        {id: "manager-cli" as const, version: manager.version, path: manager.path, sha256: `sha256:${manager.bundleSha256}`},
        {id: "tool-pack" as const, version: "portable", path: "tools", sha256: portable.toolPack.digest},
        {id: envelopeId as "electron-envelope" | "tauri-envelope", version: portable.runtime.envelopeVersion, path: envelopePath, sha256: await fileSha256(root, envelopePath)},
    ];
    const value = {
        schema: DESKTOP_INSTALLATION_SCHEMA,
        installationId: randomUUID(),
        installationScope,
        programRoot: ".",
        userRoots: desktopUserRoots(applicationManifest.roots),
        envelope: options.envelope,
        channel: options.channel,
        connection: options.connection,
        providers,
        components,
        receipts: components.map((component) => ({...component, source: "depot" as const})),
        uninstall: {
            preserveStateRootByDefault: true as const,
            deleteStateRootRequiresExplicit: true as const,
            preserveExternalProjectWorkspace: true as const,
        },
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
    const components = [{id: envelopeId as "electron-envelope" | "tauri-envelope", version: shell.envelopeVersion, path: shell.envelopePath, sha256: shell.envelopeSha256}];
    return parseDesktopInstallationManifest({
        schema: DESKTOP_INSTALLATION_SCHEMA,
        installationId: randomUUID(),
        installationScope: options.installationScope ?? "user",
        programRoot: ".",
        userRoots: INSTALLED_WINDOWS_ROOT_LOCATORS,
        envelope: options.envelope,
        channel: options.channel,
        connection: options.connection,
        providers: {
            managerRuntime: {provider: "system", version: "remote", executable: "bun"},
            applicationRuntime: {provider: "system", version: "remote", executable: "bun"},
            tools: {
                rg: {provider: "system", version: "remote", executable: "rg"},
                git: {provider: "system", version: "remote", executable: "git", bashExecutable: "bash"},
            },
        },
        components,
        receipts: components.map((component) => ({...component, source: "depot" as const})),
        uninstall: {
            preserveStateRootByDefault: true as const,
            deleteStateRootRequiresExplicit: true as const,
            preserveExternalProjectWorkspace: true as const,
        },
        addCliToUserPath: options.addCliToUserPath,
        installedAt: now,
        updatedAt: now,
    });
}

/** 注册开始菜单、桌面快捷方式、卸载项和 neurobook:// 协议。 */
export async function registerWindowsDesktop(root: string, manifest: DesktopInstallationManifest, addCliToUserPath: boolean, uninstallLauncher?: string): Promise<void> {
    const envelopeId = manifest.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const envelope = manifest.components.find((component) => component.id === envelopeId);
    if (!envelope) throw new Error(`Desktop Installation Manifest 缺少 ${envelopeId}。`);
    const executable = join(root, envelope.path);
    const manager = join(root, ".runtime", "bin", "neuro-book.cmd");
    // Registry values are Windows command lines even when this contract is
    // exercised from a POSIX CI runner with a mocked Windows host.
    const managerCommandPath = win32.join(root, ".runtime", "bin", "neuro-book.cmd");
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const commonAppData = process.env.ProgramData ?? join(process.env.SystemDrive ?? "C:", "ProgramData");
    const startMenuBase = manifest.installationScope === "machine"
        ? join(commonAppData, "Microsoft", "Windows", "Start Menu", "Programs")
        : join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
    const desktopBase = manifest.installationScope === "machine"
        ? (process.env.PUBLIC ? join(process.env.PUBLIC, "Desktop") : join(commonAppData, "Desktop"))
        : join(process.env.USERPROFILE ?? homedir(), "Desktop");
    const startMenu = join(startMenuBase, "NeuroBook");
    const desktop = desktopBase;
    const shortcutPaths = [join(startMenu, "NeuroBook.lnk"), join(desktop, "NeuroBook.lnk")];
    const managerLauncher = join(root, "desktop", "NeuroBook-Manager.cmd");
    const managerShortcut = join(startMenu, "NeuroBook Manager.lnk");
    const registryHive = manifest.installationScope === "machine" ? "HKLM" : "HKCU";
    const uninstallKey = `${registryHive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook`;
    const protocolKey = `${registryHive}\\Software\\Classes\\neurobook`;
    const previousPath = addCliToUserPath ? await readUserPath() : null;
    try {
        await ensureDirectory(startMenu);
        await ensureDirectory(desktop);
        await createShortcut(shortcutPaths[0]!, executable, root);
        await createShortcut(shortcutPaths[1]!, executable, root);
        if (await pathExists(managerLauncher)) await createShortcut(managerShortcut, managerLauncher, root);
        await regAdd(uninstallKey, "DisplayName", "NeuroBook");
        await regAdd(uninstallKey, "InstallLocation", root);
        let uninstallCommand: string;
        if (uninstallLauncher && manifest.installationScope === "machine" && uninstallLauncher.toLowerCase().endsWith(".ps1")) {
            uninstallCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${uninstallLauncher}" -Root "${root}"`;
        } else if (uninstallLauncher) uninstallCommand = `"${uninstallLauncher}" --dir "${root}" --yes`;
        else if (await pathExists(manager)) uninstallCommand = `"${managerCommandPath}" uninstall --yes`;
        else throw new Error("Desktop 安装缺少可执行的 Manager CLI，不能创建卸载项。" );
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

/** 把当前 Manager CLI 放入用户级 cache，供没有 Manager payload 的远端壳卸载。 */
async function writeRemoteManagerLauncher(managerExecutable?: string): Promise<string> {
    const source = managerExecutable ? resolve(managerExecutable) : resolve(process.argv[1] ?? "");
    if (!source || !await pathExists(source)) throw new Error("远端 Desktop 需要可复制的 Manager CLI 入口，不能建立系统卸载项。");
    if (!source.toLowerCase().endsWith(".mjs")) throw new Error("远端 Desktop 只能复制 bundled .mjs Manager CLI 入口。");
    if (!process.versions.bun) throw new Error("远端 Desktop Manager launcher 必须由 Bun 运行。");
    const root = join(managerDesktopCacheRoot(), "remote-shell-manager");
    const bunPath = join(root, "bun.exe");
    const managerPath = join(root, "neuro-book.mjs");
    await ensureDirectory(root);
    if (resolve(process.execPath) !== resolve(bunPath)) await copyFile(process.execPath, bunPath);
    if (source !== managerPath) await copyFile(source, managerPath);
    const launcher = join(root, "neuro-book.cmd");
    await writeFile(launcher, `@echo off\r\n"%~dp0bun.exe" "%~dp0neuro-book.mjs" %*\r\n`, "utf8");
    return launcher;
}

/** 卸载时删除 Manager 创建的 Windows 注册项、快捷方式和可选 PATH 项。 */
export async function removeWindowsDesktopRegistration(
    root: string,
    manifestOrScope: DesktopInstallationManifest | DesktopInstallationScope,
    previousPath?: UserPathValue | null,
): Promise<void> {
    assertWindowsDesktopHost();
    const installationScope = typeof manifestOrScope === "string"
        ? manifestOrScope
        : manifestOrScope.installationScope;
    const addCliToUserPath = typeof manifestOrScope === "string"
        ? false
        : manifestOrScope.addCliToUserPath;
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const commonAppData = process.env.ProgramData ?? join(process.env.SystemDrive ?? "C:", "ProgramData");
    const startMenuBase = installationScope === "machine"
        ? join(commonAppData, "Microsoft", "Windows", "Start Menu", "Programs")
        : join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
    const desktopBase = installationScope === "machine"
        ? (process.env.PUBLIC ? join(process.env.PUBLIC, "Desktop") : join(commonAppData, "Desktop"))
        : join(process.env.USERPROFILE ?? homedir(), "Desktop");
    const shortcutPaths = [
        join(startMenuBase, "NeuroBook", "NeuroBook.lnk"),
        join(desktopBase, "NeuroBook.lnk"),
        join(startMenuBase, "NeuroBook", "NeuroBook Manager.lnk"),
    ];
    await Promise.all(shortcutPaths.map((path) => rm(path, {force: true})));
    const registryHive = installationScope === "machine" ? "HKLM" : "HKCU";
    await regDelete(`${registryHive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook`);
    await regDelete(`${registryHive}\\Software\\Classes\\neurobook`);
    if (addCliToUserPath) {
        if (previousPath) await writeUserPath(previousPath);
        else await removeUserPath(dirname(join(root, ".runtime", "bin", "neuro-book.cmd")));
    }
}

/**
 * 查找与指定 Installation Root 完全匹配的 Windows Desktop 注册范围。
 *
 * 旧的 product-bun 安装可能没有 desktop-installation.json，但如果它曾经
 * 注册过 Programs and Features 或 neurobook://，注册表中的 InstallLocation
 * 仍然能提供一个可验证的 owner。只有恰好一个 hive 精确匹配时才返回范围；
 * 缺失或多个匹配都 fail closed，不猜测删除范围。
 */
export async function inferWindowsDesktopInstallationScope(
    installationRoot: string,
): Promise<DesktopInstallationScope | null> {
    assertWindowsDesktopHost();
    const root = canonicalWindowsPath(installationRoot);
    const matches: DesktopInstallationScope[] = [];
    for (const [scope, hive] of [["user", "HKCU"], ["machine", "HKLM"]] as const) {
        const location = await readWindowsInstallLocation(hive);
        if (location !== null && canonicalWindowsPath(location) === root) matches.push(scope);
    }
    if (matches.length > 1) {
        throw new Error(`Windows Desktop 注册项同时匹配 user 和 machine Installation Root，拒绝猜测清理范围：${resolve(installationRoot)}`);
    }
    return matches[0] ?? null;
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
    await rm(roots.cache, {recursive: true, force: true});
    await rm(roots.desktop, {recursive: true, force: true});
    if (deleteData) await rm(roots.state, {recursive: true, force: true});
    return {stateRoot: roots.state};
}

async function createShortcut(path: string, target: string, workingDirectory: string): Promise<void> {
    const script = "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut($env:NBOOK_SHORTCUT); $s.TargetPath = $env:NBOOK_TARGET; $s.WorkingDirectory = $env:NBOOK_CWD; $s.Save()";
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: {...process.env, NBOOK_SHORTCUT: path, NBOOK_TARGET: target, NBOOK_CWD: workingDirectory},
        stdio: "ignore",
    });
}

type RegistryStringType = "REG_SZ" | "REG_EXPAND_SZ";

type UserPathValue = {
    entries: string[];
    type: RegistryStringType;
};

async function regAdd(key: string, name: string, value: string, type: RegistryStringType = "REG_SZ"): Promise<void> {
    await run("reg.exe", ["ADD", key, "/v", name, "/t", type, "/d", value, "/f"], {stdio: "ignore"});
}

async function addUserPath(directory: string): Promise<void> {
    const existing = await readUserPath();
    if (existing.entries.some((value) => value.toLocaleLowerCase() === directory.toLocaleLowerCase())) return;
    await regAdd("HKCU\\Environment", "Path", [...existing.entries, directory].join(";"), existing.type);
}

async function readUserPath(): Promise<UserPathValue> {
    let result: RunCaptureResult;
    try {
        result = await runCaptureResult("reg.exe", ["QUERY", "HKCU\\Environment", "/v", "Path"]);
    } catch (error) {
        throw new Error(`读取用户 PATH 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.signal || result.exitCode !== 0) {
        const output = `${result.stdout}\n${result.stderr}`;
        if (result.exitCode !== 1 || !/unable to find the specified registry key or value|找不到指定的注册表项或值/iu.test(output)) {
            throw new Error(`读取用户 PATH 失败：${result.stderr.trim() || result.stdout.trim() || `退出码 ${result.exitCode ?? result.signal ?? "unknown"}`}`);
        }
        return {entries: [], type: "REG_EXPAND_SZ"};
    }
    const match = result.stdout.match(/^\s*Path\s+REG_(EXPAND_SZ|SZ)\s+(.*)$/imu);
    if (!match) throw new Error("读取用户 PATH 失败：reg.exe 输出缺少 Path 类型。");
    const type = match[1] === "EXPAND_SZ" ? "REG_EXPAND_SZ" : "REG_SZ";
    return {entries: match[2].split(";").map((value) => value.trim()).filter(Boolean), type};
}

async function writeUserPath(value: UserPathValue): Promise<void> {
    if (value.entries.length === 0) {
        await regDelete("HKCU\\Environment", "/v", "Path");
        return;
    }
    await regAdd("HKCU\\Environment", "Path", value.entries.join(";"), value.type);
}

async function removeUserPath(directory: string): Promise<void> {
    const existing = await readUserPath();
    await writeUserPath({
        ...existing,
        entries: existing.entries.filter((value) => value.toLocaleLowerCase() !== directory.toLocaleLowerCase()),
    });
}

async function regDelete(key: string, ...extra: string[]): Promise<void> {
    await run("reg.exe", ["DELETE", key, ...extra, "/f"], {stdio: "ignore"}).catch(() => undefined);
}

async function readWindowsInstallLocation(hive: "HKCU" | "HKLM"): Promise<string | null> {
    const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NeuroBook`;
    let result: RunCaptureResult;
    try {
        result = await runCaptureResult("reg.exe", ["QUERY", key, "/v", "InstallLocation"]);
    } catch (error) {
        throw new Error(`读取 ${hive} Desktop 卸载项失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.signal) {
        throw new Error(`读取 ${hive} Desktop 卸载项被信号中断：${result.signal}`);
    }
    if (result.exitCode === 1) return null;
    if (result.exitCode !== 0) {
        throw new Error(`读取 ${hive} Desktop 卸载项失败：${result.stderr.trim() || result.stdout.trim() || `退出码 ${result.exitCode ?? "unknown"}`}`);
    }
    const match = result.stdout.match(/^\s*InstallLocation\s+REG_(?:SZ|EXPAND_SZ)\s+(.*?)\s*$/imu);
    return match?.[1]?.trim() || null;
}

function canonicalWindowsPath(value: string): string {
    const trimmed = value.trim();
    const normalized = /^[A-Za-z]:[\\/]|^\\\\/u.test(trimmed)
        ? win32.normalize(trimmed)
        : resolve(trimmed);
    const slashNormalized = normalized.replaceAll("\\", "/");
    return slashNormalized.length > 1
        ? slashNormalized.replace(/\/+$/u, "").toLocaleLowerCase()
        : slashNormalized.toLocaleLowerCase();
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
    const envelopeSha256 = (runtime as Record<string, unknown>).envelopeSha256;
    const toolDigest = (toolPack as Record<string, unknown>).digest;
    if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("Portable Product imageId 无效。");
    if (typeof dirty !== "boolean") throw new Error("Portable Product dirty 标记无效。");
    if (typeof envelopeVersion !== "string" || !envelopeVersion.trim()) throw new Error("Portable Envelope version 缺失。");
    if (typeof envelopePath !== "string" || !envelopePath.trim()) throw new Error("Portable Envelope 路径缺失。");
    if (typeof envelopeSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(envelopeSha256)) throw new Error("Portable Envelope checksum 无效。");
    if (typeof toolDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(toolDigest)) throw new Error("Portable Tool Pack digest 无效。");
    return {
        schema: "nbook.desktop-portable/v1",
        kind: root.kind,
        platform: "windows-x64",
        product: {imagePath: ".output", dirty, imageId},
        runtime: {bunPath: "runtime/bun.exe", envelopePath, envelopeVersion, envelopeSha256},
        toolPack: {digest: toolDigest},
    };
}

async function fileSha256(root: string, relativePath: string): Promise<string> {
    const digest = createHash("sha256").update(await readFile(join(root, relativePath))).digest("hex");
    return `sha256:${digest}`;
}

/** 为 machine-scope Programs and Features 注册项建立安装根外的轻量提升 launcher。 */
export async function writeMachineUninstallLauncher(
    installationRoot: string,
    installationId: string,
    managerRelativePath = "manager/neuro-book.mjs",
): Promise<string> {
    const normalizedManagerPath = managerRelativePath.replaceAll("\\", "/");
    if (
        !normalizedManagerPath
        || normalizedManagerPath.startsWith("/")
        || /^[A-Za-z]:/u.test(normalizedManagerPath)
        || normalizedManagerPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
        || /['"\r\n]/u.test(normalizedManagerPath)
    ) {
        throw new Error(`Machine uninstall launcher 的 Manager 路径必须是安全的相对路径：${managerRelativePath}`);
    }
    const managerWindowsPath = normalizedManagerPath.replaceAll("/", "\\");
    const launcherRoot = join(managerDesktopUninstallRoot(), installationId);
    await ensureDirectory(launcherRoot);
    const launcher = join(launcherRoot, "uninstall.ps1");
    const script = String.raw`param(
    [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = "Stop"
$manager = Join-Path $Root "${managerWindowsPath}"
$bun = Join-Path $Root "runtime\bun.exe"
if (-not (Test-Path -LiteralPath $manager) -or -not (Test-Path -LiteralPath $bun)) {
    throw "NeuroBook installation is incomplete."
}
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) { $localAppData = Join-Path $HOME "AppData\Local" }
$runRoot = Join-Path $localAppData "NeuroBook\manager\uninstall-runs\${installationId}"
$cachedManager = Join-Path $runRoot "neuro-book.mjs"
$stdoutPath = Join-Path $runRoot "uninstall.stdout.log"
$stderrPath = Join-Path $runRoot "uninstall.stderr.log"
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
Copy-Item -LiteralPath $manager -Destination $cachedManager -Force
try {
    $arguments = @("--no-install", $cachedManager, "--root", $Root, "uninstall", "--yes", "--json")
    $escapePowerShell = {
        param([string]$Value)
        return "'" + $Value.Replace("'", "''") + "'"
    }
    $elevatedCommand = "& " + (& $escapePowerShell $bun) + " --no-install " + (& $escapePowerShell $cachedManager) + " --root " + (& $escapePowerShell $Root) + " uninstall --yes --json 1> " + (& $escapePowerShell $stdoutPath) + " 2> " + (& $escapePowerShell $stderrPath) + "; exit $LASTEXITCODE"
    $elevatedEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevatedCommand))
    $child = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $elevatedEncoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($child.ExitCode -ne 0) { exit $child.ExitCode }
    $resultPath = $null
    foreach ($line in @(
        (Get-Content -LiteralPath $stdoutPath -Encoding UTF8 -ErrorAction SilentlyContinue)
        (Get-Content -LiteralPath $stderrPath -Encoding UTF8 -ErrorAction SilentlyContinue)
    )) {
        try {
            $event = $line | ConvertFrom-Json
            if ($event.kind -eq "complete" -and $event.resultPath) {
                $resultPath = [string]$event.resultPath
            }
        } catch {
            continue
        }
    }
    if (-not $resultPath) { throw "卸载命令没有返回外置 Host resultPath。" }
    $expectedResultRoot = [IO.Path]::GetFullPath((Join-Path $localAppData "NeuroBook\uninstall-results")).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $canonicalResultPath = [IO.Path]::GetFullPath($resultPath)
    if (-not $canonicalResultPath.StartsWith($expectedResultRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "卸载 Host resultPath 越出受管结果目录。"
    }
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while (-not (Test-Path -LiteralPath $canonicalResultPath)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "等待外置卸载 Host 最终回执超时。" }
        Start-Sleep -Milliseconds 200
    }
    $hostResult = Get-Content -LiteralPath $canonicalResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($hostResult.ok -ne $true) { throw "外置卸载 Host 返回失败：$([string]$hostResult.error)" }
    Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
} catch {
    throw
}
$launcherRoot = $PSScriptRoot.Replace("'", "''")
$cleanupCommand = "Start-Sleep -Milliseconds 500; Remove-Item -LiteralPath '$launcherRoot' -Recurse -Force -ErrorAction SilentlyContinue"
$cleanupEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupCommand))
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $cleanupEncoded) -WindowStyle Hidden | Out-Null
`;
    await writeFile(launcher, script, "utf8");
    return launcher;
}

async function createDesktopInstallationProviders(
    options: DesktopLocalDepot,
    applicationManifest: InstallationManifest,
): Promise<DesktopInstallationProviders> {
    const managerRuntime = applicationManifest.components.managerRuntime;
    if (managerRuntime.provider !== "managed") {
        throw new Error("Desktop 安装必须保留 managed Manager Bun Runtime。" );
    }
    const managedManagerRuntime = {
        provider: "managed" as const,
        version: managerRuntime.version,
        path: managerRuntime.path,
        sha256: `sha256:${managerRuntime.executableSha256}`,
    };
    const applicationRuntime: DesktopProviderLocator = options.runtimeProvider === "system"
        ? await resolveSystemProvider("bun", "Product Bun")
        : managedManagerRuntime;
    const tools = applicationManifest.components.tools;
    if (options.toolProvider === "system") {
        const rg = await resolveSystemProvider("rg", "ripgrep");
        const git = await resolveSystemProvider("git", "Git");
        const bash = await resolveSystemProvider("bash", "Git Bash");
        return {
            managerRuntime: managedManagerRuntime,
            applicationRuntime,
            tools: {
                rg,
                git: {...git, bashExecutable: bash.executable},
            },
        };
    }
    if (!tools.rg || tools.rg.provider !== "managed") {
        throw new Error("Desktop Portable 缺少 managed ripgrep，不能按 managed Tool provider 安装。" );
    }
    if (!tools.git || tools.git.provider !== "managed") {
        throw new Error("Desktop Portable 缺少 managed PortableGit，不能按 managed Tool provider 安装。" );
    }
    return {
        managerRuntime: managedManagerRuntime,
        applicationRuntime,
        tools: {
            rg: {
                provider: "managed",
                version: tools.rg.version,
                path: tools.rg.path,
                sha256: `sha256:${tools.rg.executableSha256}`,
            },
            git: {
                provider: "managed",
                version: tools.git.version,
                path: tools.git.path,
                sha256: `sha256:${tools.git.gitSha256}`,
                bashPath: tools.git.bashPath,
            },
        },
    };
}

async function resolveSystemProvider(
    command: string,
    label: string,
): Promise<{provider: "system"; version: string; executable: string}> {
    let result: RunCaptureResult;
    try {
        result = await runCaptureResult(command, ["--version"]);
    } catch (error) {
        throw new Error(`${label} 不可用，请先安装并加入 PATH：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.exitCode !== 0 || result.signal) {
        throw new Error(`${label} 不可用，请先安装并加入 PATH：${result.stderr.trim() || "版本检查失败"}`);
    }
    const version = result.stdout.split(/\r?\n/u)[0]?.trim();
    if (!version) throw new Error(`${label} 未返回版本信息。`);
    return {provider: "system", version, executable: command};
}

type DesktopInstallRoots = {
    state: string;
    cache: string;
    desktop: string;
    webview: string;
};

async function assertFreshDesktopRoots(roots: DesktopInstallRoots): Promise<void> {
    const existing = [];
    for (const [name, path] of Object.entries(roots)) {
        if (!await pathExists(path)) continue;
        if (name === "state" && await isReusableStateRoot(path)) continue;
        existing.push(`${name}=${path}`);
    }
    if (existing.length > 0) {
        throw new Error(`Desktop 用户 Root 已存在但 Installation Root 尚未建立；拒绝覆盖：${existing.join(", ")}`);
    }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
    const info = await lstat(path).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) return false;
    return (await readdir(path)).length === 0;
}

async function isReusableStateRoot(path: string): Promise<boolean> {
    if (await isEmptyDirectory(path)) return true;
    const marker = await lstat(join(path, "config.yaml")).catch(() => null);
    // config.yaml is the durable Boot Config written by Manager on first install.
    // Its presence proves ownership without allowing an arbitrary leftover folder
    // to be silently adopted; all other State Root contents remain untouched.
    return Boolean(marker?.isFile() && !marker.isSymbolicLink());
}

async function ensureTrackedDirectory(path: string, createdRoots: string[]): Promise<void> {
    if (await pathExists(path)) return;
    await ensureDirectory(path);
    createdRoots.push(path);
}

async function removeCreatedDesktopRoots(createdRoots: string[]): Promise<void> {
    for (const path of [...createdRoots].reverse()) {
        await rm(path, {recursive: true, force: true}).catch(() => undefined);
    }
}

function assertWindowsDesktopHost(): void {
    if (process.platform !== "win32") throw new Error("Desktop 用户级安装当前只支持 Windows；macOS 仅完成安装合同与 CI 准备。");
    if (process.arch !== "x64") throw new Error(`Desktop Windows 用户级安装只支持 x64，当前为 ${process.arch}。`);
}

export function defaultDesktopInstallationRoot(scope: "user" | "machine" = "user"): string {
    if (scope === "machine") {
        return join(process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"), "NeuroBook");
    }
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, DEFAULT_INSTALLATION_ROOT);
}

function desktopUserRoots(roots: InstallationManifest["roots"]): {
    state: {base: "local-app-data" | "user-app-data"; path: string};
    cache: {base: "local-app-data" | "user-cache"; path: string};
    desktop: {base: "local-app-data" | "user-app-data"; path: string};
    webview: {base: "local-app-data" | "user-app-data"; path: string};
} {
    const state = roots.state;
    const cache = roots.cache;
    const desktop = roots.desktop;
    const webview = roots.webview;
    if (!["local-app-data", "user-app-data"].includes(state.base)
        || !["local-app-data", "user-cache"].includes(cache.base)
        || !["local-app-data", "user-app-data"].includes(desktop.base)
        || !["local-app-data", "user-app-data"].includes(webview.base)) {
        throw new Error("Desktop 安装的用户 Root locator 必须指向用户级目录。");
    }
    return {
        state: {base: state.base as "local-app-data" | "user-app-data", path: state.path},
        cache: {base: cache.base as "local-app-data" | "user-cache", path: cache.path},
        desktop: {base: desktop.base as "local-app-data" | "user-app-data", path: desktop.path},
        webview: {base: webview.base as "local-app-data" | "user-app-data", path: webview.path},
    };
}

async function assertInstallationScopeWritable(root: string, scope: "user" | "machine"): Promise<void> {
    if (scope !== "machine") return;
    const parent = dirname(root);
    try {
        await ensureDirectory(parent);
        const probe = join(parent, `.neurobook-write-probe-${randomUUID()}`);
        await writeFile(probe, "probe\n", "utf8");
        await rm(probe, {force: true});
    } catch (error) {
        throw new Error(`全局安装需要管理员权限写入 ${parent}；请使用提升权限的 Manager GUI 重试。原因：${error instanceof Error ? error.message : String(error)}`);
    }
}

function managerDesktopCacheRoot(): string {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "NeuroBook", "manager", "desktop");
}

/** 从本地 distribution manifest 解析并校验所选 Envelope 的 ZIP。 */
async function resolveDepotArchive(
    options: DesktopLocalDepot,
    componentId: "electron-envelope" | "tauri-envelope",
): Promise<string> {
    if (!options.distributionManifestPath && !options.distributionManifestUrl) {
        const archivePath = options.archivePath ?? options.shellArchivePath;
        if (!archivePath) throw new Error("Desktop depot 缺少 archive 路径。" );
        return resolve(archivePath);
    }
    const manifestPath = options.distributionManifestPath
        ? resolve(options.distributionManifestPath)
        : await downloadDistributionManifest(options.distributionManifestUrl!);
    const manifestInfo = await lstat(manifestPath).catch(() => null);
    if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) {
        throw new Error(`Desktop distribution manifest 不存在或不是普通文件：${manifestPath}`);
    }
    const manifest: DesktopDistributionManifest = parseDesktopDistributionManifest(await readJson(manifestPath));
    if (manifest.platform !== "windows" || manifest.architecture !== "x64") {
        throw new Error("Desktop distribution manifest 只支持 Windows x64 本地 depot。" );
    }
    if (manifest.channel !== options.channel) {
        throw new Error(`Desktop distribution manifest 通道为 ${manifest.channel}，命令选择为 ${options.channel}。`);
    }
    const component = manifest.components.find((item) => item.id === componentId);
    if (!component) throw new Error(`Desktop distribution manifest 缺少 ${componentId} 组件。`);
    if (component.archive.format !== "zip") {
        throw new Error("Desktop distribution 当前只支持 ZIP 组件。" );
    }
    if (component.archive.kind === "url") {
        if (!component.archive.location.startsWith("https://")) {
            throw new Error("在线 Desktop distribution 的组件 URL 必须使用 HTTPS。" );
        }
        const digest = component.archive.sha256.slice("sha256:".length);
        const archivePath = join(managerDesktopCacheRoot(), "downloads", `${digest}.zip`);
        const cached = await lstat(archivePath).catch(() => null);
        if (!cached?.isFile() || cached.isSymbolicLink() || cached.size !== component.archive.bytes) {
            await downloadVerified(component.archive.location, archivePath, digest);
        }
        const info = await lstat(archivePath);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== component.archive.bytes) {
            throw new Error(`Desktop distribution 下载结果字节数不匹配：${archivePath}`);
        }
        return archivePath;
    }
    const depotRoot = dirname(manifestPath);
    const archivePath = resolve(depotRoot, component.archive.location);
    const escaped = relative(depotRoot, archivePath);
    if (!escaped || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
        throw new Error("Desktop distribution archive 路径越出 manifest 根目录。" );
    }
    const info = await lstat(archivePath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Desktop distribution archive 不存在或不是普通文件：${archivePath}`);
    if (info.size !== component.archive.bytes) throw new Error(`Desktop distribution archive 字节数不匹配：${archivePath}`);
    if (`sha256:${await sha256File(archivePath)}` !== component.archive.sha256) {
        throw new Error(`Desktop distribution archive checksum 不匹配：${archivePath}`);
    }
    return archivePath;
}

function managerDesktopUninstallRoot(): string {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "NeuroBook", "manager", "uninstall");
}

async function downloadDistributionManifest(urlValue: string): Promise<string> {
    let url: URL;
    try {
        url = new URL(urlValue);
    } catch {
        throw new Error("Desktop distribution manifest URL 无效。" );
    }
    if (url.protocol !== "https:") throw new Error("Desktop distribution manifest 只接受 HTTPS。" );
    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Desktop distribution manifest 下载失败：HTTP ${String(response.status)}`);
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > 2 * 1024 * 1024) throw new Error("Desktop distribution manifest 超过 2 MiB。" );
    const digest = createHash("sha256").update(text).digest("hex");
    const root = join(managerDesktopCacheRoot(), "manifests");
    const path = join(root, `${digest}.json`);
    await ensureDirectory(root);
    if (!await pathExists(path)) await writeFile(path, text, "utf8");
    return path;
}
