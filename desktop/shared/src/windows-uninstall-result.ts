import {lstat, readFile, rm} from "node:fs/promises";
import {basename, isAbsolute, relative, resolve, sep, win32} from "node:path";

export type DesktopDelegatedUninstallReceipt =
    | {status: "completed"}
    | {status: "scheduled"; resultPath: string};

export const DESKTOP_UNINSTALL_HOST_TIMEOUT_MS = 6 * 60_000;

/** 解析 Manager CLI 的最终卸载事件；其它阶段事件返回 null。 */
export function parseDesktopDelegatedUninstallReceipt(
    value: unknown,
): DesktopDelegatedUninstallReceipt | null {
    if (!isRecord(value) || value.kind !== "complete" || value.action !== "uninstall") return null;
    if (value.status === "completed") return {status: "completed"};
    if (value.status === "scheduled" && typeof value.resultPath === "string" && value.resultPath.length > 0) {
        return {status: "scheduled", resultPath: value.resultPath};
    }
    throw new Error("Desktop uninstall CLI 回执无效。");
}

/** 等待 Installation Root 外的 Windows Host 写入原子结果，并复核 token 与程序根。 */
export async function waitForWindowsUninstallHostResult(
    resultPathInput: string,
    installationRoot: string,
    options: {
        localAppData?: string;
        timeoutMs?: number;
    } = {},
): Promise<void> {
    const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("Desktop 缺少 LOCALAPPDATA，不能验证 uninstall Host 回执。");
    const resultRoot = resolve(localAppData, "NeuroBook", "uninstall-results");
    const resultPath = resolve(resultPathInput);
    const escaped = relative(resultRoot, resultPath);
    if (!escaped || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
        throw new Error("Desktop uninstall Host resultPath 越出受管结果目录。");
    }
    const token = basename(resultPath, ".json");
    if (basename(resultPath) !== `${token}.json`
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(token)) {
        throw new Error("Desktop uninstall Host resultPath 文件名无效。");
    }
    const timeoutMs = options.timeoutMs ?? DESKTOP_UNINSTALL_HOST_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        const info = await lstatIfExists(resultPath);
        if (info) {
            if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
                throw new Error("Desktop uninstall Host 回执必须是小于 64 KiB 的普通文件。");
            }
            const value = JSON.parse((await readFile(resultPath, "utf8")).replace(/^\uFEFF/u, "")) as unknown;
            assertHostResult(value, token, installationRoot);
            return;
        }
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    throw new Error(`Desktop uninstall Host 回执超时：${timeoutMs}ms`);
}

/** machine 卸载成功后只清理当前 installation ID 的外置 launcher。 */
export async function removeDesktopMachineUninstallLauncher(
    installationId: string | null,
    localAppData = process.env.LOCALAPPDATA,
): Promise<void> {
    if (!installationId || !localAppData) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(installationId)) {
        throw new Error("Desktop uninstall launcher installationId 无效。");
    }
    const launcherRoot = resolve(localAppData, "NeuroBook", "manager", "uninstall", installationId);
    const info = await lstatIfExists(launcherRoot);
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("Desktop uninstall launcher root 必须是普通目录。");
    }
    await rm(launcherRoot, {recursive: true, force: true});
}

function assertHostResult(value: unknown, token: string, installationRoot: string): void {
    if (!isRecord(value)
        || value.token !== token
        || typeof value.ok !== "boolean"
        || typeof value.completedAt !== "string") {
        throw new Error("Desktop uninstall Host 回执身份无效。");
    }
    const keys = Object.keys(value).sort();
    if (value.ok) {
        if (JSON.stringify(keys) !== JSON.stringify(["completedAt", "installationRoot", "ok", "token"])
            || typeof value.installationRoot !== "string"
            || !sameWindowsPath(value.installationRoot, installationRoot)) {
            throw new Error("Desktop uninstall Host 成功回执身份无效。");
        }
        return;
    }
    if (JSON.stringify(keys) !== JSON.stringify(["completedAt", "error", "ok", "token"])
        || typeof value.error !== "string"
        || value.error.length === 0) {
        throw new Error("Desktop uninstall Host 失败回执身份无效。");
    }
    throw new Error(`Desktop uninstall Host 返回失败：${value.error}`);
}

function sameWindowsPath(left: string, right: string): boolean {
    return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

async function lstatIfExists(path: string) {
    try {
        return await lstat(path);
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
