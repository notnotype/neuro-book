import {mkdir, rm, stat, utimes, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {installationLeasePath, mutateInstallation} from "#manager/installation-mutation";
import {writeInstallationManifest} from "#manager/manifest-store";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, PORTABLE_ROOT_LOCATORS} from "#manager/root-locators";
import type {InstallationManifest} from "#manager/types";

const cleanupRoots: string[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("InstallationMutation", () => {
    it("Portable/Source 按 canonical root SHA-256 隔离 lease", async () => {
        const sandbox = testSandbox("lease-identity");
        const first = join(sandbox, "first");
        const second = join(sandbox, "second");
        await Promise.all([mkdir(first, {recursive: true}), mkdir(second, {recursive: true})]);

        const firstLease = await installationLeasePath(first);
        const aliasLease = await installationLeasePath(join(first, "."));
        const secondLease = await installationLeasePath(second);

        expect(firstLease).toBe(aliasLease);
        expect(firstLease).not.toBe(secondLease);
        expect(firstLease).not.toContain(first);
    });

    it("Manager 配置文件位置不能把同一 Installation Root 拆成两把 lease", async () => {
        const sandbox = testSandbox("lease-config-independent");
        const root = join(sandbox, "installation");
        await mkdir(root, {recursive: true});
        const expected = await installationLeasePath(root);

        vi.stubEnv("NEURO_BOOK_MANAGER_CONFIG", join(sandbox, "other-manager", "config.json"));

        await expect(installationLeasePath(root)).resolves.toBe(expected);
    });

    it("同一 Installation Root 的并发 mutation 被外置 lease 拒绝", async () => {
        const sandbox = testSandbox("lease-concurrent");
        const root = join(sandbox, "installation");
        await prepareInstallation(root, manifest("windows-portable"));
        let releaseFirst!: () => void;
        const blocked = new Promise<void>((resolvePromise) => {
            releaseFirst = resolvePromise;
        });
        let entered!: () => void;
        const firstEntered = new Promise<void>((resolvePromise) => {
            entered = resolvePromise;
        });
        const first = mutateInstallation(root, async () => {
            entered();
            await blocked;
        });
        await firstEntered;

        await expect(mutateInstallation(root, async () => undefined)).rejects.toThrow("另一个 NeuroBook Manager 操作正在执行");

        releaseFirst();
        await first;
    });

    it("超过 60 秒且没有 owner heartbeat 的 lease 可以恢复", async () => {
        const sandbox = testSandbox("lease-stale");
        const root = join(sandbox, "installation");
        await prepareInstallation(root, manifest("windows-portable"));
        const lease = await installationLeasePath(root);
        await mkdir(`${lease}.lock`, {recursive: true});
        const stale = new Date(Date.now() - 120_000);
        await utimes(`${lease}.lock`, stale, stale);

        await expect(mutateInstallation(root, async (mutation) => mutation.manifest.profile)).resolves.toBe("windows-portable");
    });

    it("不存在的现有 Installation Root fail closed 且不创建目录", async () => {
        const sandbox = testSandbox("missing-root");
        const root = join(sandbox, "missing");

        await expect(mutateInstallation(root, async () => undefined)).rejects.toThrow("Installation Manifest不存在");

        await expect(stat(root)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("pending Windows uninstall intent 阻断普通 mutation", async () => {
        const sandbox = testSandbox("pending-uninstall");
        const root = join(sandbox, "installation");
        await prepareInstallation(root, manifest("windows-portable"));
        const intentPath = join(root, ".deploy", "uninstall-intent.json");
        await writeFile(intentPath, `${JSON.stringify({
            schemaVersion: 1,
            token: crypto.randomUUID(),
            layout: "installation-scoped",
            installationRoot: root,
            stateRoot: join(root, "data"),
            cacheRoot: join(root, ".cache"),
            desktopRoot: join(root, "data", ".desktop"),
            deleteData: false,
            createdAt: new Date().toISOString(),
        }, null, 4)}\n`, "utf8");

        await expect(mutateInstallation(root, async () => undefined)).rejects.toThrow("Windows 卸载已安排");
    });

    it.runIf(process.platform === "win32")("Windows Installed 拒绝固定 Programs/NeuroBook 之外的目录", async () => {
        const sandbox = testSandbox("installed-root");
        vi.stubEnv("LOCALAPPDATA", join(sandbox, "Local"));
        const root = join(sandbox, "arbitrary-installed-root");
        await prepareInstallation(root, manifest("product-bun"));

        await expect(mutateInstallation(root, async () => undefined)).rejects.toThrow("只允许固定 Installation Root");

        const canonicalRoot = join(sandbox, "Local", "Programs", "NeuroBook");
        await mkdir(canonicalRoot, {recursive: true});
        await expect(installationLeasePath(canonicalRoot)).resolves.toMatch(/leases[\\/]installed-v1$/u);
    });

    it.runIf(process.platform === "win32")("Installed v2 machine root 使用独立 lease 且允许 mutation", async () => {
        const sandbox = testSandbox("installed-machine-root");
        vi.stubEnv("ProgramFiles", join(sandbox, "Program Files"));
        const root = join(sandbox, "Program Files", "NeuroBook");
        await prepareInstallation(root, manifest("product-bun"));

        await expect(mutateInstallation(root, async (mutation) => mutation.manifest.profile)).resolves.toBe("product-bun");
        await expect(installationLeasePath(root)).resolves.toMatch(/leases[\\/]installed-machine-v2$/u);
    });
});

function testSandbox(name: string): string {
    const sandbox = join(process.cwd(), ".agent", `${name}-${crypto.randomUUID()}`);
    cleanupRoots.push(sandbox);
    vi.stubEnv("NEURO_BOOK_MANAGER_CONFIG", join(sandbox, "manager-user", "config.json"));
    vi.stubEnv("LOCALAPPDATA", join(sandbox, "local-app-data"));
    vi.stubEnv("XDG_DATA_HOME", join(sandbox, "xdg-data"));
    return sandbox;
}

async function prepareInstallation(root: string, value: InstallationManifest): Promise<void> {
    const path = join(root, ".deploy", "installation.json");
    await mkdir(dirname(path), {recursive: true});
    await writeInstallationManifest(path, value);
}

function manifest(profile: "windows-portable" | "product-bun"): InstallationManifest {
    const now = new Date().toISOString();
    const revision = "a".repeat(40);
    const asset = {
        archiveSha256: "b".repeat(64),
        sourceUrl: "https://example.com/asset.zip",
        license: "test",
        redistribution: "test",
    };
    return {
        schemaVersion: 5,
        profile,
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0",
        channel: "canary",
        sourceRevision: revision,
        roots: profile === "windows-portable" ? PORTABLE_ROOT_LOCATORS : INSTALLED_WINDOWS_ROOT_LOCATORS,
        components: {
            source: {provider: "release", buildId: `sha256:${"9".repeat(64)}`, version: "0.8.0", revision, path: ".", files: ["package.json"], ...asset},
            product: {provider: "release", buildId: `sha256:${"9".repeat(64)}`, version: "0.8.0", revision, path: ".output", platform: "windows-x64", ...asset, ...TEST_RUNTIME_IMAGE_IDENTITY},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: profile === "windows-portable"
                ? {provider: "managed", version: "1.3.0", path: ".runtime/bun/1.3.0/bun.exe", executableSha256: "d".repeat(64), ...asset}
                : {provider: "system", executable: "bun", version: "1.3.0"},
            applicationRuntime: profile === "windows-portable"
                ? {provider: "managed", version: "1.3.0", path: ".runtime/bun/1.3.0/bun.exe", executableSha256: "d".repeat(64), ...asset}
                : {provider: "system", executable: "bun", version: "1.3.0"},
            tools: profile === "windows-portable" ? {
                rg: {provider: "managed", version: "14.1.1", path: ".runtime/tools/rg/14.1.1/rg.exe", executableSha256: "e".repeat(64), ...asset},
                git: {provider: "managed", version: "2.49.0", path: ".runtime/tools/git/2.49.0/cmd/git.exe", distribution: "PortableGit", bashPath: ".runtime/tools/git/2.49.0/bin/bash.exe", gitSha256: "f".repeat(64), bashSha256: "1".repeat(64), ...asset},
            } : {},
        },
        installedAt: now,
        updatedAt: now,
    };
}
