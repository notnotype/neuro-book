import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {
    parseDesktopDelegatedUninstallReceipt,
    removeDesktopMachineUninstallLauncher,
    waitForWindowsUninstallHostResult,
} from "nbook/desktop/shared/src/windows-uninstall-result";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Desktop uninstall final result", () => {
    it("parses only the completed and scheduled Manager CLI receipts", () => {
        expect(parseDesktopDelegatedUninstallReceipt({
            kind: "complete",
            action: "uninstall",
            status: "completed",
        })).toEqual({status: "completed"});
        expect(parseDesktopDelegatedUninstallReceipt({
            kind: "complete",
            action: "uninstall",
            status: "scheduled",
            resultPath: "C:\\result.json",
        })).toEqual({status: "scheduled", resultPath: "C:\\result.json"});
        expect(parseDesktopDelegatedUninstallReceipt({kind: "stage"})).toBeNull();
        expect(() => parseDesktopDelegatedUninstallReceipt({
            kind: "complete",
            action: "uninstall",
            status: "scheduled",
        })).toThrow("回执无效");
    });

    it("waits for an atomic Host success and rejects failed or escaped results", async () => {
        const root = await fixtureRoot("desktop-uninstall-result-");
        const localAppData = join(root, "LocalAppData");
        const resultRoot = join(localAppData, "NeuroBook", "uninstall-results");
        await mkdir(resultRoot, {recursive: true});
        const installationRoot = "C:\\Program Files\\NeuroBook";
        const successToken = randomUUID();
        const successPath = join(resultRoot, `${successToken}.json`);
        const writeSuccess = (async () => {
            await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 20));
            await writeFile(successPath, JSON.stringify({
                ok: true,
                token: successToken,
                installationRoot,
                completedAt: new Date().toISOString(),
            }), "utf8");
        })();
        await Promise.all([
            waitForWindowsUninstallHostResult(successPath, installationRoot, {
                localAppData,
                timeoutMs: 1_000,
            }),
            writeSuccess,
        ]);

        const failureToken = randomUUID();
        const failurePath = join(resultRoot, `${failureToken}.json`);
        await writeFile(failurePath, JSON.stringify({
            ok: false,
            token: failureToken,
            error: "host failed",
            completedAt: new Date().toISOString(),
        }), "utf8");
        await expect(waitForWindowsUninstallHostResult(failurePath, installationRoot, {
            localAppData,
            timeoutMs: 1_000,
        })).rejects.toThrow("host failed");
        await expect(waitForWindowsUninstallHostResult(join(root, `${randomUUID()}.json`), installationRoot, {
            localAppData,
            timeoutMs: 1_000,
        })).rejects.toThrow("越出受管结果目录");
    });

    it("cleans only the current installation launcher ordinary directory", async () => {
        const root = await fixtureRoot("desktop-uninstall-launcher-");
        const localAppData = join(root, "LocalAppData");
        const installationId = "installation-1";
        const launcherRoot = join(localAppData, "NeuroBook", "manager", "uninstall", installationId);
        await mkdir(launcherRoot, {recursive: true});
        await writeFile(join(launcherRoot, "uninstall.ps1"), "fixture", "utf8");

        await removeDesktopMachineUninstallLauncher(installationId, localAppData);
        await expect(stat(launcherRoot)).rejects.toMatchObject({code: "ENOENT"});

        await mkdir(join(launcherRoot, ".."), {recursive: true});
        await writeFile(launcherRoot, "not a directory", "utf8");
        await expect(removeDesktopMachineUninstallLauncher(installationId, localAppData))
            .rejects.toThrow("普通目录");
        await expect(readFile(launcherRoot, "utf8")).resolves.toBe("not a directory");
    });
});

async function fixtureRoot(prefix: string): Promise<string> {
    // 仓库根：`desktop/shared/src/` 向上三级；不依赖 process.cwd()。
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const base = join(repoRoot, ".agent", "tmp");
    await mkdir(base, {recursive: true});
    const root = await mkdtemp(join(base, prefix));
    roots.push(root);
    return root;
}
