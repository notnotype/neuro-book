import {createHash, randomUUID} from "node:crypto";
import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {basename, dirname, isAbsolute, join, relative, resolve, sep, win32} from "node:path";

import {
    DESKTOP_INSTALLATION_SCHEMA,
    parseDesktopCapability,
    parseDesktopDistributionManifest,
    parseDesktopInstallationManifest,
    parseDesktopPortableManifest,
    parseDesktopShellArchiveManifest,
    desktopRemoteOrigin,
    type DesktopCapability,
    type DesktopConnection,
    type DesktopDistributionManifest,
    type DesktopEnvelope,
    type DesktopInstallationManifest,
    type DesktopInstallationScope,
    type DesktopPortableArchiveManifest,
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
import {
    prepareInstalledApplication,
    type InstallationApplicationPreparation,
} from "#manager/migration-operation";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, resolveInstallationRoots} from "#manager/root-locators";
import {writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {parseInstallationManifest} from "#manager/schema";
import {run, runCaptureResult, type RunCaptureResult} from "#manager/process";
import {verifyInstalledProductRuntimeImage} from "#manager/product";
import {writeManagedToolWrappers} from "#manager/tools";
import type {
    ApplicationRuntimeComponent,
    InstallationComponents,
    InstallationManifest,
    InstallationRootLocators,
    ToolComponents,
} from "#manager/types";
import {parseBootConfigText} from "nbook/server/config/boot-config";
import {
    DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
    DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
    DESKTOP_AGGREGATE_DEPOT_MANIFEST,
    verifyDesktopAggregateDepot,
    verifyDesktopAggregateDepotArchive,
} from "nbook/desktop/shared/src/desktop-aggregate-depot";

const DESKTOP_RUNTIME_SCHEMA = "nbook.desktop-installation-runtime/v1" as const;
const DESKTOP_INSTALLATION_FILE = "desktop-installation.json";
const DEFAULT_INSTALLATION_ROOT = "Programs\\NeuroBook";
const DESKTOP_DEFAULT_ADMIN_USERNAME = "admin";

export type DesktopLocalDepot = {
    /** 本地模式使用完整 Product Portable；远端模式改用 shellArchivePath。 */
    archivePath?: string;
    /** Electron 离线聚合 Depot ZIP；必须带同目录 sidecar，并从内置 distribution manifest 解析 Portable。 */
    aggregateDepotPath?: string;
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
    gitProvider?: "managed" | "system";
    rgProvider?: "managed" | "system";
    /** 本地 Product 首次安装时创建管理员；远端连接不允许携带该值。 */
    adminPassword?: string;
    /** 当前 Manager CLI 自身入口；远端 shell 的卸载注册由它生成稳定 launcher。 */
    managerExecutable?: string;
    /** CLI/GUI 只消费白名单阶段；安装副作用仍由本 Module 独占。 */
    onStage?: (stage: DesktopInstallStage) => void;
};

export type DesktopInstallStage =
    | "extracting"
    | "verifying"
    | "installing"
    | "registering"
    | "migration-health"
    | "configuring-auth";

export type DesktopInstallResult = {
    installationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manifest: DesktopInstallationManifest;
    applicationManifest?: InstallationManifest;
    applicationPreparation?: InstallationApplicationPreparation;
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

/** 从本地 depot 安装 Windows Desktop；远端模式只安装壳并探测服务端能力。 */
export async function installDesktopFromLocalDepot(options: DesktopLocalDepot): Promise<DesktopInstallResult> {
    assertWindowsDesktopHost();
    if (options.connection.mode === "remote") return installDesktopShellFromLocalDepot(options);
    if (options.shellArchivePath !== undefined) throw new Error("本地 Desktop 安装必须使用完整 Portable archive，不接受 shell archive。" );
    const localSources = [
        options.archivePath,
        options.aggregateDepotPath,
        options.distributionManifestPath,
        options.distributionManifestUrl,
    ].filter((value) => value !== undefined);
    if (localSources.length !== 1) {
        throw new Error("本地 Desktop 安装必须且只能提供 Portable archive、aggregate Depot 或 distribution manifest。" );
    }
    const installationScope = options.installationScope ?? "user";
    const installationRoot = resolve(options.installationRoot ?? defaultDesktopInstallationRoot(installationScope));
    await assertInstallationScopeWritable(installationRoot, installationScope);
    if (await pathExists(installationRoot)) {
        throw new Error(`Desktop Installation Root 已存在，更新请使用 Manager update：${installationRoot}`);
    }
    await assertNoConflictingCanonicalDesktopRoot(installationRoot);
    const resolvedDepot = await resolveDepotArchive(options, options.envelope === "electron" ? "electron-envelope" : "tauri-envelope");
    const archivePath = resolvedDepot.archivePath;
    const installationParent = dirname(installationRoot);
    let staging: string | undefined;
    let movedToInstallation = false;
    const createdRoots: string[] = [];
    let uninstallLauncher: string | undefined;
    let desktopManifest: DesktopInstallationManifest | undefined;
    let registration: WindowsDesktopRegistrationReceipt | undefined;
    try {
        if (!await pathExists(archivePath)) throw new Error(`Desktop Portable archive 不存在：${archivePath}`);
        await ensureDirectory(installationParent);
        staging = await mkdtemp(join(installationParent, `.neurobook-stage-${randomUUID()}-`));
        options.onStage?.("extracting");
        await extractZip(archivePath, staging);
        const portable = parseDesktopPortableManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopPortableInstallable(portable, options.envelope);
        const portableApplicationManifest = await readPortableApplicationManifest(staging);
        if (portableApplicationManifest.channel !== options.channel) {
            throw new Error(`Desktop Portable 通道为 ${portableApplicationManifest.channel}，命令选择为 ${options.channel}。`);
        }
        options.onStage?.("verifying");
        await verifyDesktopPortablePayload(staging, portableApplicationManifest, portable, options.envelope);
        const providers = await createDesktopInstallationProviders(options, portableApplicationManifest);
        const applicationManifest = await prepareInstalledManifest(staging, portableApplicationManifest, providers);
        await removeUnselectedManagedPayload(staging, providers);
        const roots = resolveInstallationRoots(installationRoot, applicationManifest.roots);
        const preexistingRoots = await assertFreshDesktopRoots(roots);
        await removePortableDataRoots(staging);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        movedToInstallation = true;
        options.onStage?.("installing");
        await ensureTrackedDirectory(roots.state, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.cache, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.desktop, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.webview, createdRoots, preexistingRoots);
        if (!(await pathExists(join(roots.state, "config.yaml")))) {
            await writeFile(join(roots.state, "config.yaml"), "auth:\n    enabled: false\n", "utf8");
        }
        await writeDesktopRuntimeConfig(installationRoot);
        await writeDesktopRuntimeWrappers(installationRoot, applicationManifest);
        desktopManifest = await createDesktopInstallationManifest(
            options,
            installationRoot,
            applicationManifest,
            portable,
            providers,
        );
        await writeJsonAtomic(join(roots.desktop, DESKTOP_INSTALLATION_FILE), desktopManifest);
        if (desktopManifest.installationScope === "machine") {
            const managerRuntime = applicationManifest.components.managerRuntime;
            if (managerRuntime.provider !== "managed") {
                throw new Error("Desktop machine 安装需要 managed Manager Runtime。");
            }
            uninstallLauncher = await writeMachineUninstallLauncher(
                installationRoot,
                desktopManifest.installationId,
                applicationManifest.components.manager.path,
                managerRuntime.path,
            );
        }
        options.onStage?.("registering");
        registration = await registerWindowsDesktop(
            installationRoot,
            desktopManifest,
            options.addCliToUserPath,
            uninstallLauncher,
        );
        options.onStage?.("migration-health");
        const applicationPreparation = await prepareInstalledApplication(installationRoot);
        if (options.adminPassword !== undefined) {
            options.onStage?.("configuring-auth");
            await createAdmin(installationRoot, applicationManifest, DESKTOP_DEFAULT_ADMIN_USERNAME, options.adminPassword);
            await enableAuthentication(roots.state);
        }
        return {
            installationRoot,
            stateRoot: roots.state,
            cacheRoot: roots.cache,
            desktopRoot: roots.desktop,
            manifest: desktopManifest,
            applicationManifest,
            applicationPreparation,
        };
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        if (registration && desktopManifest) {
            await removeWindowsDesktopRegistration(
                installationRoot,
                desktopManifest,
                registration.previousUserPath,
            )
                .catch((rollbackError) => rollbackErrors.push(rollbackError));
        }
        if (movedToInstallation) {
            await rm(installationRoot, {recursive: true, force: true})
                .catch((rollbackError) => rollbackErrors.push(rollbackError));
        }
        if (uninstallLauncher) {
            await rm(dirname(uninstallLauncher), {recursive: true, force: true})
                .catch((rollbackError) => rollbackErrors.push(rollbackError));
        }
        await removeCreatedDesktopRoots(createdRoots, rollbackErrors);
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                "Desktop 安装失败，且一个或多个本事务路径无法完整回滚。",
            );
        }
        throw error;
    } finally {
        if (staging) await rm(staging, {recursive: true, force: true});
        await resolvedDepot.cleanup();
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
    if (options.aggregateDepotPath !== undefined) throw new Error("远端 Desktop 安装不能使用本地 Product aggregate Depot。" );
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
    await assertNoConflictingCanonicalDesktopRoot(installationRoot);
    const resolvedDepot = await resolveDepotArchive(options, options.envelope === "electron" ? "electron-envelope" : "tauri-envelope");
    const archivePath = resolvedDepot.archivePath;
    const installationParent = dirname(installationRoot);
    let staging: string | undefined;
    let movedToInstallation = false;
    const createdRoots: string[] = [];
    try {
        if (!await pathExists(archivePath)) throw new Error(`Desktop shell archive 不存在：${archivePath}`);
        await ensureDirectory(installationParent);
        staging = await mkdtemp(join(installationParent, `.neurobook-stage-remote-${randomUUID()}-`));
        await extractZip(archivePath, staging);
        const shell = parseDesktopShellArchiveManifest(await readJson(join(staging, "manifest.json")));
        assertDesktopShellInstallable(shell, options.envelope);
        await verifyDesktopShellPayload(staging, shell);
        const roots = resolveInstallationRoots(installationRoot, INSTALLED_WINDOWS_ROOT_LOCATORS);
        const preexistingRoots = await assertFreshDesktopRoots(roots);
        await ensureDirectory(dirname(installationRoot));
        await rename(staging, installationRoot);
        movedToInstallation = true;
        await ensureTrackedDirectory(roots.state, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.cache, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.desktop, createdRoots, preexistingRoots);
        await ensureTrackedDirectory(roots.webview, createdRoots, preexistingRoots);
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
        if (staging) await rm(staging, {recursive: true, force: true});
        await resolvedDepot.cleanup();
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
    if (shell.kind === "electron") {
        const applicationPath = join(root, shell.applicationPath);
        if (!await pathExists(applicationPath)) {
            throw new Error(`远端 shell 缺少 Electron application：${shell.applicationPath}`);
        }
        if (await sha256File(applicationPath) !== shell.applicationSha256.slice("sha256:".length)) {
            throw new Error("远端 shell Electron application checksum 不匹配。");
        }
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
export function assertDesktopPortableInstallable(portable: DesktopPortableArchiveManifest, envelope: DesktopEnvelope): void {
    if (portable.kind !== envelope) {
        throw new Error(`Portable envelope 为 ${portable.kind}，命令选择为 ${envelope}。`);
    }
    if (portable.product.dirty) throw new Error("Desktop 用户级安装拒绝 dirty Product Portable。" );
}

/** 在改写前读取 Portable 自带的完整 Application Manifest。 */
async function readPortableApplicationManifest(staging: string): Promise<InstallationManifest> {
    const portable = parseInstallationManifest(await readJson(join(staging, ".deploy", "installation.json")));
    if (portable.profile !== "windows-portable") throw new Error("Desktop 本地 depot 必须来自 windows-portable Product 包。");
    return portable;
}

/** 将 Portable Application Manifest 切换为 Installed locators 与实际 provider。 */
async function prepareInstalledManifest(
    staging: string,
    portable: InstallationManifest,
    providers: DesktopInstallationProviders,
): Promise<InstallationManifest> {
    const path = join(staging, ".deploy", "installation.json");
    const installed: InstallationManifest = {
        ...portable,
        profile: "product-bun",
        roots: INSTALLED_WINDOWS_ROOT_LOCATORS,
        components: projectInstalledApplicationComponents(portable.components, providers),
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    parseInstallationManifest(installed);
    await writeInstallationManifest(path, installed);
    return installed;
}

/** Product、Manager 与 Desktop Manifest 必须消费同一 provider 选择。 */
function projectInstalledApplicationComponents(
    components: InstallationComponents,
    providers: DesktopInstallationProviders,
): InstallationComponents {
    let applicationRuntime: ApplicationRuntimeComponent;
    if (providers.applicationRuntime.provider === "managed") {
        if (components.applicationRuntime.provider !== "managed"
            || components.applicationRuntime.path !== providers.applicationRuntime.path
            || components.applicationRuntime.executableSha256 !== providers.applicationRuntime.sha256.slice("sha256:".length)) {
            throw new Error("Desktop managed Product Bun provider 与 Portable Application Manifest 不一致。");
        }
        applicationRuntime = components.applicationRuntime;
    } else {
        applicationRuntime = {
            provider: "system",
            version: providers.applicationRuntime.version,
            executable: providers.applicationRuntime.executable,
        };
    }
    const tools: ToolComponents = {
        ...components.tools,
        rg: providers.tools.rg.provider === "managed"
            ? components.tools.rg
            : {
                provider: "system",
                version: providers.tools.rg.version,
                executable: providers.tools.rg.executable,
            },
        git: providers.tools.git.provider === "managed"
            ? components.tools.git
            : {
                provider: "system",
                version: providers.tools.git.version,
                executable: providers.tools.git.executable,
            },
    };
    if (!tools.rg || !tools.git) throw new Error("Desktop Application Manifest 缺少 Git 或 rg provider。");
    return {...components, applicationRuntime, tools};
}

/** 两个工具都由系统提供时，不把未被 manifest 引用的完整 Tool Pack 留在安装根。 */
async function removeUnselectedManagedPayload(
    staging: string,
    providers: DesktopInstallationProviders,
): Promise<void> {
    if (providers.tools.git.provider === "system" && providers.tools.rg.provider === "system") {
        await rm(join(staging, "tools"), {recursive: true, force: true});
    }
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

/** 写入 Manager、Bun 与 managed tools 的稳定入口；PowerShell 入口不携带 secret。 */
export async function writeDesktopRuntimeWrappers(
    root: string,
    manifest: {components: Pick<InstallationComponents, "manager" | "managerRuntime" | "tools">},
): Promise<void> {
    const runtime = manifest.components.managerRuntime;
    if (runtime.provider !== "managed") throw new Error("Desktop 用户级安装必须携带 managed Bun Runtime。");
    await writeRuntimeWrapper(root, runtime);
    await writeManagedToolWrappers(root, manifest.components.tools);
    await writeManagerWrapper(root, manifest.components.manager, runtime);

    const wrapperRoot = join(root, ".runtime", "bin");
    await ensureDirectory(wrapperRoot);
    await writeFile(
        join(wrapperRoot, "neuro-book.ps1"),
        "& (Join-Path $PSScriptRoot \"neuro-book.cmd\") @args\r\nexit $LASTEXITCODE\r\n",
        "utf8",
    );
}

/** 在把候选移入用户级 Installation Root 前复核所有可执行组件身份。 */
export async function verifyDesktopPortablePayload(
    root: string,
    manifest: {components: InstallationComponents},
    portable: DesktopPortableArchiveManifest,
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
    if (portable.kind === "electron") {
        const applicationPath = portable.runtime.applicationPath;
        const applicationSha256 = portable.runtime.applicationSha256;
        if (applicationPath !== "desktop/resources/app.asar" || !applicationSha256) {
            throw new Error("Desktop Portable 缺少 Electron application identity。");
        }
        if (!await pathExists(join(root, applicationPath))) {
            throw new Error(`Desktop Portable 缺少 Electron application：${applicationPath}`);
        }
        if (`sha256:${await sha256File(join(root, applicationPath))}` !== applicationSha256) {
            throw new Error("Desktop Portable Electron application checksum 不匹配。");
        }
    }
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
    portable: DesktopPortableArchiveManifest,
    providers: DesktopInstallationProviders,
): Promise<DesktopInstallationManifest> {
    const now = new Date().toISOString();
    const envelopePath = options.envelope === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    const envelopeId = options.envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const manager = applicationManifest.components.manager;
    const managerRuntime = applicationManifest.components.managerRuntime;
    if (managerRuntime.provider !== "managed") throw new Error("Desktop 安装需要 managed Bun Runtime。" );
    const installationScope = options.installationScope ?? "user";
    const components = [
        {id: "product" as const, version: applicationManifest.appVersion, path: ".output", sha256: portable.product.imageId},
        {id: "bun" as const, version: managerRuntime.version, path: managerRuntime.path, sha256: `sha256:${managerRuntime.executableSha256}`},
        {id: "manager-cli" as const, version: manager.version, path: manager.path, sha256: `sha256:${manager.bundleSha256}`},
        ...(providers.tools.git.provider === "managed" || providers.tools.rg.provider === "managed"
            ? [{id: "tool-pack" as const, version: "portable", path: "tools", sha256: portable.toolPack.digest}]
            : []),
        {id: envelopeId as "electron-envelope" | "tauri-envelope", version: portable.runtime.envelopeVersion, path: envelopePath, sha256: await fileSha256(root, envelopePath)},
        ...(portable.kind === "electron"
            ? [{
                id: "electron-application" as const,
                version: applicationManifest.appVersion,
                path: "desktop/resources/app.asar",
                sha256: await fileSha256(root, "desktop/resources/app.asar"),
            }]
            : []),
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
    const components = [
        {id: envelopeId as "electron-envelope" | "tauri-envelope", version: shell.envelopeVersion, path: shell.envelopePath, sha256: shell.envelopeSha256},
        ...(shell.kind === "electron"
            ? [{
                id: "electron-application" as const,
                version: shell.applicationVersion,
                path: shell.applicationPath,
                sha256: shell.applicationSha256,
            }]
            : []),
    ];
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

type WindowsDesktopRegistrationReceipt = {
    previousUserPath: UserPathValue | null;
};

/** 注册开始菜单、桌面快捷方式、卸载项和 neurobook:// 协议。 */
export async function registerWindowsDesktop(
    root: string,
    manifest: DesktopInstallationManifest,
    addCliToUserPath: boolean,
    uninstallLauncher?: string,
): Promise<WindowsDesktopRegistrationReceipt> {
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
        return {previousUserPath: previousPath};
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

async function fileSha256(root: string, relativePath: string): Promise<string> {
    const digest = createHash("sha256").update(await readFile(join(root, relativePath))).digest("hex");
    return `sha256:${digest}`;
}

/** 为 machine-scope Programs and Features 注册项建立安装根外的轻量提升 launcher。 */
export async function writeMachineUninstallLauncher(
    installationRoot: string,
    installationId: string,
    managerRelativePath = "manager/neuro-book.mjs",
    managerRuntimeRelativePath = "runtime/bun.exe",
): Promise<string> {
    const normalizedManagerPath = machineLauncherRelativePath(managerRelativePath, "Manager");
    const normalizedRuntimePath = machineLauncherRelativePath(managerRuntimeRelativePath, "Manager Runtime");
    const managerWindowsPath = normalizedManagerPath.replaceAll("/", "\\");
    const runtimeWindowsPath = normalizedRuntimePath.replaceAll("/", "\\");
    const launcherRoot = join(managerDesktopUninstallRoot(), installationId);
    await ensureDirectory(launcherRoot);
    const launcher = join(launcherRoot, "uninstall.ps1");
    const script = String.raw`param(
    [Parameter(Mandatory=$true)][string]$Root
)
$ErrorActionPreference = "Stop"
$manager = Join-Path $Root "${managerWindowsPath}"
$bun = Join-Path $Root "${runtimeWindowsPath}"
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

function machineLauncherRelativePath(path: string, label: string): string {
    const normalized = path.replaceAll("\\", "/");
    if (
        !normalized
        || normalized.startsWith("/")
        || /^[A-Za-z]:/u.test(normalized)
        || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
        || /['"\r\n]/u.test(normalized)
    ) {
        throw new Error(`Machine uninstall launcher 的 ${label} 路径必须是安全的相对路径：${path}`);
    }
    return normalized;
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
    const rg = options.rgProvider === "system"
        ? await resolveSystemProvider("rg", "ripgrep")
        : managedRipgrep(tools);
    const git = options.gitProvider === "system"
        ? await systemGitProvider()
        : managedGit(tools);
    return {
        managerRuntime: managedManagerRuntime,
        applicationRuntime,
        tools: {rg, git},
    };
}

/**
 * Repair 重新建立 Envelope 启动所需的 locator、Manager wrappers 与 Windows 注册。
 *
 * Desktop manifest 仍是安装身份真值；它缺失或与 canonical root 不一致时拒绝猜测。
 */
export async function repairDesktopRuntimeState(
    installationRootInput: string,
    applicationManifest: InstallationManifest,
): Promise<InstallationManifest> {
    assertWindowsDesktopHost();
    const installationRoot = resolve(installationRootInput);
    const desktopManifest = await readDesktopInstallationManifest(installationRoot, applicationManifest.roots);
    if (!desktopManifest) {
        throw new Error("Desktop repair 缺少 nbook.desktop-installation/v3 manifest，不能重建运行 locator。");
    }
    const expectedRoot = resolve(defaultDesktopInstallationRoot(desktopManifest.installationScope));
    if (installationRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
        throw new Error("Desktop repair 的 Installation Root 与 manifest scope 不一致。");
    }
    await verifyDesktopInstalledEnvelope(installationRoot, desktopManifest);
    const managerRuntime = applicationManifest.components.managerRuntime;
    const desktopManagerRuntime = desktopManifest.providers.managerRuntime;
    if (managerRuntime.provider !== "managed"
        || desktopManagerRuntime.provider !== "managed"
        || managerRuntime.path !== desktopManagerRuntime.path
        || managerRuntime.executableSha256 !== desktopManagerRuntime.sha256.slice("sha256:".length)) {
        throw new Error("Desktop repair 的 managed Manager Runtime 与 Installation Manifest v3 不一致。");
    }
    const projectedManifest: InstallationManifest = {
        ...applicationManifest,
        components: projectInstalledApplicationComponents(
            applicationManifest.components,
            desktopManifest.providers,
        ),
    };
    parseInstallationManifest(projectedManifest);
    if (JSON.stringify(projectedManifest.components) !== JSON.stringify(applicationManifest.components)) {
        projectedManifest.updatedAt = new Date().toISOString();
        await writeInstallationManifest(
            join(installationRoot, ".deploy", "installation.json"),
            projectedManifest,
        );
    }
    await writeDesktopRuntimeConfig(installationRoot);
    await writeDesktopRuntimeWrappers(installationRoot, projectedManifest);
    let uninstallLauncher: string | undefined;
    if (desktopManifest.installationScope === "machine") {
        uninstallLauncher = await writeMachineUninstallLauncher(
            installationRoot,
            desktopManifest.installationId,
            projectedManifest.components.manager.path,
            managerRuntime.path,
        );
    }
    await registerWindowsDesktop(
        installationRoot,
        desktopManifest,
        desktopManifest.addCliToUserPath,
        uninstallLauncher,
    );
    return projectedManifest;
}

/** Repair 与安装后启动都必须验证壳可执行文件和 Electron app.asar。 */
export async function verifyDesktopInstalledEnvelope(
    installationRootInput: string,
    manifest: DesktopInstallationManifest,
): Promise<void> {
    const installationRoot = resolve(installationRootInput);
    const requiredIds = manifest.envelope === "electron"
        ? ["electron-envelope", "electron-application"] as const
        : ["tauri-envelope"] as const;
    for (const id of requiredIds) {
        const component = manifest.components.find((candidate) => candidate.id === id);
        if (!component) throw new Error(`Desktop Installation Manifest 缺少 ${id}。`);
        const path = join(installationRoot, component.path);
        const info = await lstat(path).catch(() => null);
        if (!info?.isFile() || info.isSymbolicLink()) {
            throw new Error(`Desktop ${id} 不存在或不是普通文件：${component.path}`);
        }
        const actual = `sha256:${await sha256File(path)}`;
        if (actual !== component.sha256) {
            throw new Error(`Desktop ${id} checksum 不匹配。`);
        }
    }
}

function managedRipgrep(tools: InstallationComponents["tools"]): DesktopToolProviderLocator {
    if (!tools.rg || tools.rg.provider !== "managed") {
        throw new Error("Desktop Portable 缺少 managed ripgrep，不能按 managed rg provider 安装。" );
    }
    return {
        provider: "managed",
        version: tools.rg.version,
        path: tools.rg.path,
        sha256: `sha256:${tools.rg.executableSha256}`,
    };
}

function managedGit(tools: InstallationComponents["tools"]): DesktopInstallationProviders["tools"]["git"] {
    if (!tools.git || tools.git.provider !== "managed") {
        throw new Error("Desktop Portable 缺少 managed PortableGit，不能按 managed Git provider 安装。" );
    }
    return {
        provider: "managed",
        version: tools.git.version,
        path: tools.git.path,
        sha256: `sha256:${tools.git.gitSha256}`,
        bashPath: tools.git.bashPath,
    };
}

async function systemGitProvider(): Promise<DesktopInstallationProviders["tools"]["git"]> {
    const git = await resolveSystemProvider("git", "Git");
    const bash = await resolveSystemProvider("bash", "Git Bash");
    return {...git, bashExecutable: bash.executable};
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
    validateSystemProviderVersion(command, version, label);
    return {provider: "system", version, executable: command};
}

function validateSystemProviderVersion(command: string, version: string, label: string): void {
    if (command === "bun") {
        const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
        if (!match) throw new Error(`${label} 返回的版本格式无效：${version}`);
        const current = match.slice(1, 4).map(Number);
        const minimum = [1, 3, 0];
        const supported = current.some((part, index) =>
            part > minimum[index]!
            && current.slice(0, index).every((prefix, prefixIndex) => prefix === minimum[prefixIndex]))
            || current.every((part, index) => part === minimum[index]);
        if (!supported) throw new Error(`${label} 版本过低：${version}；至少需要 1.3.0。`);
        return;
    }
    const patterns: Record<string, RegExp> = {
        git: /^git version \d+\.\d+(?:\.\d+)?(?:[.\w-]*)?$/u,
        bash: /^GNU bash, version \d+\.\d+(?:\.\d+)?(?:[^\r\n]*)$/u,
        rg: /^ripgrep \d+\.\d+(?:\.\d+)?(?:[^\r\n]*)$/u,
    };
    const pattern = patterns[command];
    if (!pattern?.test(version)) throw new Error(`${label} 返回的版本格式无效：${version}`);
}

type DesktopInstallRoots = {
    state: string;
    cache: string;
    desktop: string;
    webview: string;
};

async function assertFreshDesktopRoots(roots: DesktopInstallRoots): Promise<Set<string>> {
    const existing = [];
    const reusable = new Set<string>();
    for (const [name, path] of Object.entries(roots)) {
        if (!await pathExists(path)) continue;
        if (name === "state" && await isReusableStateRoot(path)) {
            reusable.add(desktopRootKey(path));
            continue;
        }
        existing.push(`${name}=${path}`);
    }
    if (existing.length > 0) {
        throw new Error(`Desktop 用户 Root 已存在但 Installation Root 尚未建立；拒绝覆盖：${existing.join(", ")}`);
    }
    return reusable;
}

async function isReusableStateRoot(path: string): Promise<boolean> {
    const root = await lstat(path).catch(() => null);
    if (!root?.isDirectory() || root.isSymbolicLink()) return false;
    if ((await readdir(path)).length === 0) return true;
    const marker = await lstat(join(path, "config.yaml")).catch(() => null);
    if (!marker?.isFile() || marker.isSymbolicLink()) return false;
    try {
        const config = parseBootConfigText(await readFile(join(path, "config.yaml"), "utf8"));
        return ["auth", "server", "database"].some((key) => Object.hasOwn(config, key));
    } catch {
        return false;
    }
}

async function ensureTrackedDirectory(
    path: string,
    createdRoots: string[],
    preexistingRoots: Set<string>,
): Promise<void> {
    if (preexistingRoots.has(desktopRootKey(path))) {
        if (!await isReusableStateRoot(path)) {
            throw new Error(`Desktop State Root 在安装事务期间发生变化；拒绝继续：${path}`);
        }
        return;
    }
    await ensureDirectory(dirname(path));
    try {
        await mkdir(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`Desktop 用户 Root 在安装事务期间被其它进程创建；拒绝接管：${path}`);
        }
        throw error;
    }
    createdRoots.push(path);
}

function desktopRootKey(path: string): string {
    const normalized = resolve(path);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function removeCreatedDesktopRoots(
    createdRoots: string[],
    rollbackErrors?: unknown[],
): Promise<void> {
    for (const path of [...createdRoots].reverse()) {
        await rm(path, {recursive: true, force: true})
            .catch((error) => rollbackErrors?.push(error));
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

/**
 * user 与 machine 安装共享同一 State/Cache/Desktop Root，不能并存两个程序根。
 *
 * 发现另一 scope 的有效或残留程序目录时交给 Repair/Uninstall 处理，不依据内容猜测
 * 或静默接管；非 canonical 测试/Portable 根不参与该 Installed-only 约束。
 */
async function assertNoConflictingCanonicalDesktopRoot(installationRoot: string): Promise<void> {
    const target = desktopRootKey(installationRoot);
    const userRoot = defaultDesktopInstallationRoot("user");
    const machineRoot = defaultDesktopInstallationRoot("machine");
    const canonical = [userRoot, machineRoot].map(desktopRootKey);
    if (!canonical.includes(target)) return;
    const conflicting = target === desktopRootKey(userRoot) ? machineRoot : userRoot;
    if (await pathExists(conflicting)) {
        throw new Error(
            `检测到另一安装范围的 NeuroBook 程序根：${conflicting}。`
            + "user 与 machine 安装共享用户数据，不能并存；请先通过 Manager Repair 或卸载处理现有安装。",
        );
    }
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

type ResolvedDesktopDepotArchive = {
    archivePath: string;
    cleanup: () => Promise<void>;
};

/** 从本地 distribution manifest 解析并校验所选 Envelope 的 ZIP。 */
async function resolveDepotArchive(
    options: DesktopLocalDepot,
    componentId: "electron-envelope" | "tauri-envelope",
): Promise<ResolvedDesktopDepotArchive> {
    const aggregate = options.aggregateDepotPath
        ? await materializeDesktopAggregateDepot(options.aggregateDepotPath)
        : undefined;
    const cleanup = async (): Promise<void> => {
        if (!aggregate) return;
        await rm(aggregate.root, {recursive: true, force: true}).catch((error) => {
            console.warn(`Desktop aggregate Depot 临时展开目录未能清理：${aggregate.root}\n${error instanceof Error ? error.message : String(error)}`);
        });
    };
    if (!aggregate && !options.distributionManifestPath && !options.distributionManifestUrl) {
        const archivePath = options.archivePath ?? options.shellArchivePath;
        if (!archivePath) throw new Error("Desktop depot 缺少 archive 路径。" );
        return {archivePath: resolve(archivePath), cleanup};
    }
    try {
        const manifestPath = aggregate?.manifestPath ?? (options.distributionManifestPath
            ? resolve(options.distributionManifestPath)
            : await downloadDistributionManifest(options.distributionManifestUrl!));
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
            const cachedDigest = cached?.isFile() && !cached.isSymbolicLink() && cached.size === component.archive.bytes
                ? await sha256File(archivePath)
                : null;
            if (cachedDigest?.toLowerCase() !== digest.toLowerCase()) {
                await downloadVerified(component.archive.location, archivePath, digest);
            }
            const info = await lstat(archivePath);
            if (!info.isFile() || info.isSymbolicLink() || info.size !== component.archive.bytes) {
                throw new Error(`Desktop distribution 下载结果字节数不匹配：${archivePath}`);
            }
            if ((await sha256File(archivePath)).toLowerCase() !== digest.toLowerCase()) {
                throw new Error(`Desktop distribution 下载结果 checksum 不匹配：${archivePath}`);
            }
            return {archivePath, cleanup};
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
        return {archivePath, cleanup};
    } catch (error) {
        await cleanup();
        throw error;
    }
}

/**
 * 验证并展开 Electron 聚合 Depot。
 *
 * ZIP 与邻接 sidecar 在解压前先核对摘要；解压结果只允许共享合同登记的五个普通文件。
 * 本地用户已持有原始 Depot，嵌套 Portable 只做本次事务的短期展开；成功或失败后
 * 都删除，避免每次安装额外遗留一份约 390 MiB 的长期缓存。
 */
async function materializeDesktopAggregateDepot(
    archiveInput: string,
): Promise<{manifestPath: string; root: string}> {
    const archivePath = resolve(archiveInput);
    if (basename(archivePath) !== DESKTOP_AGGREGATE_DEPOT_ARCHIVE) {
        throw new Error(`Desktop aggregate Depot 文件名必须为 ${DESKTOP_AGGREGATE_DEPOT_ARCHIVE}。`);
    }
    const manifestPath = join(dirname(archivePath), DESKTOP_AGGREGATE_DEPOT_MANIFEST);
    const manifest = await verifyDesktopAggregateDepotArchive({archivePath, manifestPath});
    const digest = manifest.archive.sha256.slice("sha256:".length);
    const cacheParent = join(managerDesktopCacheRoot(), "depots");
    await ensureDirectory(cacheParent);
    const staging = await mkdtemp(join(cacheParent, `.aggregate-${digest}-`));
    try {
        await extractZip(archivePath, staging);
        await verifyDesktopAggregateDepot({stagingRoot: staging, archivePath, manifestPath});
        return {
            manifestPath: join(staging, DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST),
            root: staging,
        };
    } catch (error) {
        await rm(staging, {recursive: true, force: true});
        throw error;
    }
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
