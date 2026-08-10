import {createHash} from "node:crypto";
import * as nodeFileSystem from "node:fs";
import {homedir} from "node:os";
import {isAbsolute, join, relative, resolve} from "node:path";

import {parseDesktopInstallationManifest} from "nbook/shared/desktop-contract";

export type ManagerLaunchReceipt = {
    installationRoot: string;
    installationId: string;
    installationScope: "user" | "machine";
    manifestPath: string;
    manifestSha256: string;
    executablePath: string;
    executableSha256: string;
    applicationPath: string;
    applicationSha256: string;
};

export type ManagerLaunchReceiptFileSystem = Pick<
    typeof nodeFileSystem,
    "existsSync" | "lstatSync" | "readFileSync"
>;

/** 安装完成后的唯一自动启动依据，同时绑定 Chromium executable 与 app.asar。 */
export async function createManagerLaunchReceipt(
    rootInput: string,
    environment: NodeJS.ProcessEnv = process.env,
    physicalFileSystem: ManagerLaunchReceiptFileSystem = nodeFileSystem,
): Promise<ManagerLaunchReceipt> {
    const installationRoot = resolve(rootInput);
    const localAppData = environment.LOCALAPPDATA
        ?? join(environment.USERPROFILE ?? environment.HOME ?? homedir(), "AppData", "Local");
    const manifestPath = join(localAppData, "NeuroBook", "desktop", "desktop-installation.json");
    if (!physicalFileSystem.existsSync(manifestPath)) throw new Error("安装完成回执缺少 Desktop Installation Manifest。");
    const manifestText = physicalFileSystem.readFileSync(manifestPath, "utf8");
    const manifest = parseDesktopInstallationManifest(JSON.parse(manifestText) as unknown);
    const expectedRoot = defaultInstallationRoot(manifest.installationScope, environment);
    if (!sameWindowsPath(installationRoot, expectedRoot)) {
        throw new Error("安装完成回执的 Installation Root 与 manifest scope 不一致。");
    }
    if (manifest.envelope !== "electron") {
        throw new Error("安装完成回执不是 Electron Installation Manifest。");
    }
    const executable = verifyComponent(
        installationRoot,
        manifest.components.find((item) => item.id === "electron-envelope"),
        "Electron Envelope",
        physicalFileSystem,
    );
    const application = verifyComponent(
        installationRoot,
        manifest.components.find((item) => item.id === "electron-application"),
        "Electron application",
        physicalFileSystem,
    );
    return {
        installationRoot,
        installationId: manifest.installationId,
        installationScope: manifest.installationScope,
        manifestPath: resolve(manifestPath),
        manifestSha256: sha256Text(manifestText),
        executablePath: executable.path,
        executableSha256: executable.sha256,
        applicationPath: application.path,
        applicationSha256: application.sha256,
    };
}

export function sameManagerLaunchReceipt(
    left: ManagerLaunchReceipt,
    right: ManagerLaunchReceipt,
): boolean {
    return sameWindowsPath(left.installationRoot, right.installationRoot)
        && left.installationId === right.installationId
        && left.installationScope === right.installationScope
        && left.manifestSha256 === right.manifestSha256
        && left.executableSha256 === right.executableSha256
        && left.applicationSha256 === right.applicationSha256
        && sameWindowsPath(left.executablePath, right.executablePath)
        && sameWindowsPath(left.applicationPath, right.applicationPath);
}

function verifyComponent(
    installationRoot: string,
    component: {path: string; sha256: string} | undefined,
    label: string,
    physicalFileSystem: ManagerLaunchReceiptFileSystem,
): {path: string; sha256: string} {
    if (!component) throw new Error(`安装完成回执缺少安全的 ${label} component。`);
    const path = resolve(installationRoot, ...component.path.split("/"));
    const relativePath = relative(installationRoot, path);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`安装完成回执中的 ${label} 越出 Installation Root。`);
    }
    let info;
    try {
        info = physicalFileSystem.lstatSync(path);
    } catch {
        throw new Error(`安装完成回执中的 ${label} 不存在。`);
    }
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`安装完成回执中的 ${label} 不是普通文件。`);
    }
    const sha256 = `sha256:${createHash("sha256").update(physicalFileSystem.readFileSync(path)).digest("hex")}`;
    if (sha256 !== component.sha256) {
        throw new Error(`安装完成回执中的 ${label} checksum 不匹配。`);
    }
    return {path, sha256};
}

function defaultInstallationRoot(
    scope: "user" | "machine",
    environment: NodeJS.ProcessEnv,
): string {
    if (scope === "machine") {
        return resolve(environment.ProgramFiles ?? join(environment.SystemDrive ?? "C:", "Program Files"), "NeuroBook");
    }
    return resolve(
        environment.LOCALAPPDATA
            ?? join(environment.USERPROFILE ?? environment.HOME ?? homedir(), "AppData", "Local"),
        "Programs",
        "NeuroBook",
    );
}

function sameWindowsPath(left: string, right: string): boolean {
    return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function sha256Text(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
