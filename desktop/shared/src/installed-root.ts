import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {win32 as windowsPath} from "node:path";

import {
    parseDesktopInstallationManifest,
    type DesktopInstallationManifest,
} from "nbook/shared/desktop-contract";

export type InstalledRootEnvironment = {
    localAppData?: string;
    programFiles?: string;
    systemDrive?: string;
    userProfile?: string;
    home?: string;
    LOCALAPPDATA?: string;
    ProgramFiles?: string;
    SystemDrive?: string;
    USERPROFILE?: string;
    HOME?: string;
};

/**
 * Installed roots are the only roots that may consume a user-scoped
 * Installation Manifest. Portable roots intentionally have no manifest.
 */
export function isCanonicalInstalledRoot(
    root: string,
    environment: InstalledRootEnvironment = process.env,
): boolean {
    const localAppData = environment.localAppData
        ?? environment.LOCALAPPDATA
        ?? (environment.userProfile ?? environment.USERPROFILE
            ? windowsPath.join(environment.userProfile ?? environment.USERPROFILE!, "AppData", "Local")
            : undefined)
        ?? (environment.home ?? environment.HOME
            ? windowsPath.join(environment.home ?? environment.HOME!, "AppData", "Local")
            : undefined);
    const programFiles = environment.programFiles
        ?? environment.ProgramFiles
        ?? (environment.systemDrive ?? environment.SystemDrive
            ? windowsPath.join(environment.systemDrive ?? environment.SystemDrive!, "Program Files")
            : "C:\\Program Files");
    const candidates = [
        ...(localAppData ? [windowsPath.join(localAppData, "Programs", "NeuroBook")] : []),
        windowsPath.join(programFiles, "NeuroBook"),
    ];
    const normalized = windowsPath.resolve(root).toLowerCase();
    return candidates.some((candidate) => windowsPath.resolve(candidate).toLowerCase() === normalized);
}

/**
 * A canonical installed root must have both locator and installation manifest.
 * Missing or malformed manifests stop startup so the user reaches Repair rather
 * than silently falling back to a Portable layout.
 */
export function requireInstalledManifest(
    root: string,
    desktopRoot: string,
    environment: InstalledRootEnvironment = process.env,
): DesktopInstallationManifest | null {
    if (!isCanonicalInstalledRoot(root, environment)) return null;
    const manifestPath = join(desktopRoot, "desktop-installation.json");
    if (!existsSync(manifestPath)) {
        throw new Error("Installed Desktop 缺少 desktop-installation.json，请通过 Manager Repair 修复。");
    }
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    } catch (error) {
        throw new Error(
            `Installed Desktop Installation Manifest 无法读取，请通过 Manager Repair 修复：${error instanceof Error ? error.message : String(error)}`,
        );
    }
    let manifest: DesktopInstallationManifest;
    try {
        manifest = parseDesktopInstallationManifest(value);
    } catch (error) {
        throw new Error(
            `Installed Desktop Installation Manifest 无效，请通过 Manager Repair 修复：${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const expectedRoot = manifest.installationScope === "machine"
        ? windowsPath.resolve(environment.programFiles
            ?? environment.ProgramFiles
            ?? (environment.systemDrive ?? environment.SystemDrive
                ? windowsPath.join(environment.systemDrive ?? environment.SystemDrive!, "Program Files")
                : "C:\\Program Files"), "NeuroBook")
        : windowsPath.resolve(environment.localAppData
            ?? environment.LOCALAPPDATA
            ?? (environment.userProfile ?? environment.USERPROFILE
                ? windowsPath.join(environment.userProfile ?? environment.USERPROFILE!, "AppData", "Local")
                : undefined)
            ?? (environment.home ?? environment.HOME
                ? windowsPath.join(environment.home ?? environment.HOME!, "AppData", "Local")
                : "C:\\Users\\Default\\AppData\\Local"), "Programs", "NeuroBook");
    if (windowsPath.resolve(root).toLowerCase() !== expectedRoot.toLowerCase()) {
        throw new Error("Installed Desktop Installation Manifest 的 installationScope 与 Installation Root 不一致，请通过 Manager Repair 修复。");
    }
    return manifest;
}
