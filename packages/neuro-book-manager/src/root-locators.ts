import {homedir} from "node:os";
import {resolve} from "node:path";

import {assertAbsolutePathWithin, installationRelativePath} from "#manager/installation-path";
import type {
    InstallProfile,
    InstallationRootLocators,
    ResolvedInstallationRoots,
    RootLocator,
} from "#manager/types";

/** Portable 数据全部跟随 Installation Root 移动。 */
export const PORTABLE_ROOT_LOCATORS: InstallationRootLocators = {
    state: {base: "installation-root", path: "data"},
    cache: {base: "installation-root", path: ".cache"},
    desktop: {base: "installation-root", path: "data/.desktop"},
    webview: {base: "installation-root", path: "data/.desktop/webview"},
};

/** Installed Windows 数据与可替换的程序文件分离。 */
export const INSTALLED_WINDOWS_ROOT_LOCATORS: InstallationRootLocators = {
    state: {base: "local-app-data", path: "NeuroBook/data"},
    cache: {base: "local-app-data", path: "NeuroBook/cache"},
    desktop: {base: "local-app-data", path: "NeuroBook/desktop"},
    webview: {base: "local-app-data", path: "NeuroBook/desktop/webview"},
};

/** macOS 用户级安装的固定数据布局；应用程序本体仍在 Application Support/installation。 */
export const INSTALLED_MACOS_ROOT_LOCATORS: InstallationRootLocators = {
    state: {base: "user-app-data", path: "NeuroBook/data"},
    cache: {base: "user-cache", path: "NeuroBook"},
    desktop: {base: "user-app-data", path: "NeuroBook/desktop"},
    webview: {base: "user-app-data", path: "NeuroBook/desktop/webview"},
};

/**
 * 非桌面安装仍使用 Installation Root 内的明确子目录。
 *
 * 旧布局把 State Root 等同于 Installation Root；locator 禁止指向基准根本身，
 * 因此统一收敛到 `data/`，同时继续保持源码/容器部署的 installation-local 特性。
 */
export const INSTALLATION_SCOPED_ROOT_LOCATORS: InstallationRootLocators = {
    state: {base: "installation-root", path: "data"},
    cache: {base: "installation-root", path: ".cache"},
    desktop: {base: "installation-root", path: ".desktop"},
    webview: {base: "installation-root", path: ".desktop/webview"},
};

/** local-app-data 基准 Adapter 的输入，便于测试不同宿主而不触达真实用户目录。 */
export type LocalAppDataEnvironment = {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
};

export type UserDataEnvironment = LocalAppDataEnvironment;

/**
 * 返回当前宿主的用户级应用数据基准。
 *
 * Windows 遵循 LOCALAPPDATA；POSIX 仅用于解析显式 local-app-data locator，默认
 * installation-scoped Profile 不会使用该位置。
 */
export function localAppDataRoot(input: LocalAppDataEnvironment = {}): string {
    const platform = input.platform ?? process.platform;
    const environment = input.environment ?? process.env;
    const homeDirectory = input.homeDirectory ?? homedir();
    if (platform === "win32") {
        return resolve(environment.LOCALAPPDATA ?? resolve(homeDirectory, "AppData", "Local"));
    }
    return resolve(environment.XDG_DATA_HOME ?? resolve(homeDirectory, ".local", "share"));
}

/** macOS Application Support 根；仅用于 Desktop 用户级合同，不影响 Linux 默认布局。 */
export function userAppDataRoot(input: UserDataEnvironment = {}): string {
    const platform = input.platform ?? process.platform;
    const environment = input.environment ?? process.env;
    const homeDirectory = input.homeDirectory ?? homedir();
    if (platform === "darwin") return resolve(environment.HOME ?? homeDirectory, "Library", "Application Support");
    return localAppDataRoot(input);
}

/** macOS Caches 根；可重建内容不得落入 Application Support。 */
export function userCacheRoot(input: UserDataEnvironment = {}): string {
    const platform = input.platform ?? process.platform;
    const environment = input.environment ?? process.env;
    const homeDirectory = input.homeDirectory ?? homedir();
    if (platform === "darwin") return resolve(environment.HOME ?? homeDirectory, "Library", "Caches");
    return resolve(environment.XDG_CACHE_HOME ?? resolve(homeDirectory, ".cache"));
}

/** macOS 用户级 Envelope 的不可变应用/运行时安装根。 */
export function macosDesktopInstallationRoot(homeDirectory = homedir()): string {
    return resolve(homeDirectory, "Library", "Application Support", "NeuroBook", "installation");
}

/** 新安装按发行身份选择唯一 locator 集合。 */
export function installationRootLocators(
    profile: InstallProfile,
    platform: NodeJS.Platform = process.platform,
): InstallationRootLocators {
    if (profile === "windows-portable") return PORTABLE_ROOT_LOCATORS;
    if (profile === "product-bun" && platform === "win32") return INSTALLED_WINDOWS_ROOT_LOCATORS;
    if (profile === "product-bun" && platform === "darwin") return INSTALLED_MACOS_ROOT_LOCATORS;
    return INSTALLATION_SCOPED_ROOT_LOCATORS;
}

/** 将清单 locator 一次性解析成调用方使用的绝对路径。 */
export function resolveInstallationRoots(
    installationRoot: string,
    locators: InstallationRootLocators,
    localDataRoot = localAppDataRoot(),
    userRoots: {userAppDataRoot?: string; userCacheRoot?: string} = {},
): ResolvedInstallationRoots {
    const absoluteInstallationRoot = resolve(installationRoot);
    const absoluteLocalDataRoot = resolve(localDataRoot);
    const absoluteUserAppDataRoot = resolve(userRoots.userAppDataRoot ?? userAppDataRoot());
    const absoluteUserCacheRoot = resolve(userRoots.userCacheRoot ?? userCacheRoot());
    return {
        state: resolveRootLocator(absoluteInstallationRoot, absoluteLocalDataRoot, locators.state, "State Root", absoluteUserAppDataRoot, absoluteUserCacheRoot),
        cache: resolveRootLocator(absoluteInstallationRoot, absoluteLocalDataRoot, locators.cache, "Cache Root", absoluteUserAppDataRoot, absoluteUserCacheRoot),
        desktop: resolveRootLocator(absoluteInstallationRoot, absoluteLocalDataRoot, locators.desktop, "Desktop Local Root", absoluteUserAppDataRoot, absoluteUserCacheRoot),
        webview: resolveRootLocator(absoluteInstallationRoot, absoluteLocalDataRoot, locators.webview, "WebView Root", absoluteUserAppDataRoot, absoluteUserCacheRoot),
    };
}

/** 严格解析一个 locator，拒绝空路径、dot、绝对路径和向上逃逸。 */
export function resolveRootLocator(
    installationRoot: string,
    localDataRoot: string,
    locator: RootLocator,
    label = "Root locator",
    userAppDataRootPath = userAppDataRoot(),
    userCacheRootPath = userCacheRoot(),
): string {
    const relativePath = installationRelativePath(locator.path);
    const baseRoot = locator.base === "installation-root"
        ? resolve(installationRoot)
        : locator.base === "local-app-data"
            ? resolve(localDataRoot)
            : locator.base === "user-app-data"
                ? resolve(userAppDataRootPath)
                : resolve(userCacheRootPath);
    const target = resolve(baseRoot, relativePath);
    return assertAbsolutePathWithin(baseRoot, target, label);
}

/** 判断两个 locator 集合是否逐字段完全一致。 */
export function rootLocatorsEqual(left: InstallationRootLocators, right: InstallationRootLocators): boolean {
    return (Object.keys(left) as Array<keyof InstallationRootLocators>).every((key) => (
        left[key].base === right[key].base && left[key].path === right[key].path
    ));
}

/** 返回 Git checkout 中由数据 root 占用、可忽略的 Installation-relative 路径。 */
export function installationRootDataPaths(locators: InstallationRootLocators): string[] {
    const paths = Object.values(locators)
        .filter((locator) => locator.base === "installation-root")
        .map((locator) => installationRelativePath(locator.path))
        .sort((left, right) => left.length - right.length);
    return paths.filter((path, index) => !paths.slice(0, index).some((parent) => path.startsWith(`${parent}/`)));
}
