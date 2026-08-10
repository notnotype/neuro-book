import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";

import {INSTALLATION_SCOPED_ROOT_LOCATORS, resolveInstallationRoots} from "#manager/root-locators";
import type {InstallationRootLocators} from "#manager/types";

/** Manager 的标准目录集合。 */
export type InstallationPaths = {
    root: string;
    deploy: string;
    runtime: string;
    state: string;
    cache: string;
    desktop: string;
    webview: string;
    managerState: string;
    manifest: string;
    staging: string;
    backups: string;
    operations: string;
};

/** 解析 Manager 固定目录与 Manifest 声明的四类数据根。 */
export function installationPaths(
    root: string,
    locators: InstallationRootLocators = INSTALLATION_SCOPED_ROOT_LOCATORS,
): InstallationPaths {
    const absoluteRoot = resolve(root);
    const deploy = join(absoluteRoot, ".deploy");
    const resolvedRoots = resolveInstallationRoots(absoluteRoot, locators);
    const managerState = locators.desktop.base === "installation-root"
        ? deploy
        : join(resolvedRoots.desktop, "manager");
    return {
        root: absoluteRoot,
        deploy,
        runtime: join(absoluteRoot, ".runtime"),
        ...resolvedRoots,
        managerState,
        manifest: join(deploy, "installation.json"),
        staging: join(deploy, "staging"),
        backups: join(managerState, "backups"),
        operations: join(managerState, "operations"),
    };
}

/** 从当前目录向上寻找 installation.json 或 Git checkout。 */
export function discoverInstallationRoot(start = process.cwd()): string {
    let current = resolve(start);
    while (true) {
        if (existsSync(join(current, ".deploy", "installation.json")) || existsSync(join(current, ".git"))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return resolve(start);
}

/** Stage 0 与 Manager 使用的用户级 cache。 */
export function managerCacheRoot(): string {
    if (process.platform === "win32") {
        return resolve(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "NeuroBook", "manager");
    }
    return resolve(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "neuro-book-manager");
}
