import {createHash} from "node:crypto";
import {open, realpath} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";

import {lock} from "proper-lockfile";

import {ensureDirectory, pathExists} from "#manager/files";
import {readInstallationManifest} from "#manager/manifest-store";
import {recoverInterruptedOperations} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {localAppDataRoot} from "#manager/root-locators";
import type {InstallProfile, InstallationManifest} from "#manager/types";
import {pendingWindowsUninstall, type WindowsUninstallIntent} from "#manager/windows-uninstall-host";

const LEASE_STALE_MS = 60_000;
const LEASE_UPDATE_MS = 20_000;

/** 锁内唯一可信的现有安装上下文。 */
export type InstallationMutation = Readonly<{
    root: string;
    manifest: InstallationManifest;
}>;

/** 卸载 Module 在锁内获得的安装身份与可选 durable intent。 */
export type UninstallationMutation = InstallationMutation & Readonly<{
    /** 非空表示外置 Windows Host 曾获准删除该安装，只能继续卸载。 */
    pendingUninstall: WindowsUninstallIntent | null;
}>;

/** 锁内确认尚未提交 Manifest 的新安装上下文。 */
export type FreshInstallationMutation = Readonly<{
    root: string;
    profile: InstallProfile;
}>;

/**
 * 在用户级外置 lease 内恢复 Operation，并从磁盘重读唯一可信 Manifest。
 *
 * 调用方在加锁前持有的 Manifest 只能用于定位 Installation Root，不能进入业务判断。
 */
export async function mutateInstallation<T>(
    root: string,
    task: (mutation: InstallationMutation) => Promise<T>,
): Promise<T> {
    return mutateExistingInstallation(root, false, task);
}

/**
 * 卸载专用入口允许在同一 lease 内恢复 durable Windows intent。
 *
 * 普通调用方不能使用该入口；它暴露 pending intent 只是为了继续同一个删除决定，
 * 不允许改变 deleteData 或 owner roots。
 */
export async function mutateUninstallation<T>(
    root: string,
    task: (mutation: UninstallationMutation) => Promise<T>,
): Promise<T> {
    return mutateExistingInstallation(root, true, task);
}

/** 打开既有安装；pending intent 在此集中阻断所有非卸载 mutation。 */
async function mutateExistingInstallation<T>(
    root: string,
    allowPendingUninstall: boolean,
    task: (mutation: UninstallationMutation) => Promise<T>,
): Promise<T> {
    const installationRoot = resolve(root);
    if (!await pathExists(installationRoot)) {
        throw new Error(`Installation Manifest不存在，拒绝修改未受管目录：${installationRoot}`);
    }
    return withInstallationLease(installationRoot, async () => {
        const pendingUninstall = await pendingWindowsUninstall(installationRoot);
        if (pendingUninstall && !allowPendingUninstall) {
            throw new Error(`Windows 卸载已安排，拒绝执行其他 Manager 操作：${installationRoot}`);
        }
        if (!pendingUninstall) await recoverInterruptedOperations(installationRoot);
        const manifest = await readInstallationManifest(installationPaths(installationRoot).manifest);
        if (!manifest) {
            throw new Error(`Installation Manifest不存在，拒绝修改未受管目录：${installationRoot}`);
        }
        assertInstalledRoot(installationRoot, manifest);
        return task(Object.freeze({root: installationRoot, manifest, pendingUninstall}));
    });
}

/** 在同一外置 lease 内恢复旧操作并确认目标仍是 Fresh Installation。 */
export async function mutateFreshInstallation<T>(
    root: string,
    profile: InstallProfile,
    task: (mutation: FreshInstallationMutation) => Promise<T>,
): Promise<T> {
    const installationRoot = resolve(root);
    assertFreshInstalledRoot(installationRoot, profile);
    await ensureDirectory(installationRoot);
    return withInstallationLease(installationRoot, async () => {
        if (await pendingWindowsUninstall(installationRoot)) {
            throw new Error(`Windows 卸载已安排，拒绝重新安装：${installationRoot}`);
        }
        await recoverInterruptedOperations(installationRoot);
        if (await readInstallationManifest(installationPaths(installationRoot).manifest)) {
            throw new Error("Installation Root 已由 NeuroBook Manager 管理，请使用 neuro-book update。");
        }
        return task(Object.freeze({root: installationRoot, profile}));
    });
}

/** 返回外置 lease target；Portable/Source 先 realpath 消除 junction/symlink 别名再哈希。 */
export async function installationLeasePath(root: string): Promise<string> {
    const installationRoot = resolve(root);
    const canonicalRoot = await realpath(installationRoot);
    const canonicalInstalledRoot = resolve(localAppDataRoot(), "Programs", "NeuroBook");
    const canonicalMachineRoot = canonicalWindowsMachineRoot();
    const leaseRoot = resolve(localAppDataRoot(), "NeuroBook", "manager-leases");
    if (isSameOrWithin(installationRoot, leaseRoot)) {
        throw new Error(`Manager 用户级 lease 不能位于 Installation Root 内：${leaseRoot}`);
    }
    const identity = samePath(installationRoot, canonicalInstalledRoot)
        ? "installed-v1"
        : samePath(installationRoot, canonicalMachineRoot)
            ? "installed-machine-v2"
        : createHash("sha256").update(normalizedPath(canonicalRoot)).digest("hex");
    return join(leaseRoot, identity);
}

/** proper-lockfile heartbeat 位于 Installation Root 外，卸载和目录切换都不会删除它。 */
async function withInstallationLease<T>(root: string, task: () => Promise<T>): Promise<T> {
    const leasePath = await installationLeasePath(root);
    await ensureDirectory(dirname(leasePath));
    const leaseHandle = await open(leasePath, "a");
    await leaseHandle.close();
    let release: (() => Promise<void>) | undefined;
    try {
        release = await lock(leasePath, {
            lockfilePath: `${leasePath}.lock`,
            realpath: false,
            stale: LEASE_STALE_MS,
            update: LEASE_UPDATE_MS,
            retries: 0,
        });
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
            throw new Error(`另一个 NeuroBook Manager 操作正在执行：${root}`, {cause: error});
        }
        throw error;
    }
    let outcome: {ok: true; value: T} | {ok: false; error: unknown};
    try {
        outcome = {ok: true, value: await task()};
    } catch (error) {
        outcome = {ok: false, error};
    }
    let releaseError: unknown;
    try {
        await release();
    } catch (error) {
        releaseError = error;
    }
    if (!outcome.ok && releaseError) {
        throw new AggregateError([outcome.error, releaseError], "Manager 操作失败，释放 Installation lease 也失败。" );
    }
    if (!outcome.ok) throw outcome.error;
    if (releaseError) throw releaseError;
    return outcome.value;
}

/** 已存在的 Windows Installed 必须同时满足固定 Profile、locator 与 user/machine 程序根。 */
function assertInstalledRoot(root: string, manifest: InstallationManifest): void {
    const installed = Object.values(manifest.roots).some((locator) => locator.base === "local-app-data");
    if (!installed) return;
    if (process.platform !== "win32" || manifest.profile !== "product-bun") {
        throw new Error("Windows Installed 只支持 Windows product-bun Profile。");
    }
    assertCanonicalWindowsRoot(root);
}

/** Windows product-bun 新安装会选择 Installed locator，因而只能写入唯一 user/machine 程序根。 */
function assertFreshInstalledRoot(root: string, profile: InstallProfile): void {
    if (process.platform === "win32" && profile === "product-bun") assertCanonicalWindowsRoot(root);
}

/** 拒绝把 Windows Installed 伪装成任意可移动目录，避免多 lease 与卸载所有权歧义。 */
function assertCanonicalWindowsRoot(root: string): void {
    const expected = resolve(localAppDataRoot(), "Programs", "NeuroBook");
    const machine = canonicalWindowsMachineRoot();
    if (!samePath(root, expected) && !samePath(root, machine)) {
        throw new Error(`Windows Installed 只允许固定 Installation Root：${expected} 或 ${machine}`);
    }
}

function canonicalWindowsMachineRoot(): string {
    return resolve(process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"), "NeuroBook");
}

function samePath(left: string, right: string): boolean {
    return normalizedPath(left) === normalizedPath(right);
}

function normalizedPath(path: string): string {
    const normalized = resolve(path);
    return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isSameOrWithin(root: string, target: string): boolean {
    const path = relative(resolve(root), resolve(target));
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
