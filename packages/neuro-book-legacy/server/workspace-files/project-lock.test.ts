import {createHash} from "node:crypto";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import fs, {access, mkdir, mkdtemp, readFile, readdir, realpath, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {createInterface} from "node:readline";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ProjectLifecycle, projectWorkspaceRef} from "nbook/server/workspace-files/project-lifecycle";
import {
    PROJECT_LOCK_STALE_MS,
    ProjectLockModule,
    ProjectLockReleaseFailedError,
    type ProjectLockAdapter,
} from "nbook/server/workspace-files/project-lock";

const roots: string[] = [];

type ChildExit = {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
};

/** 等待child输出精确协议行，同时把提前退出与超时转换成可解释的测试失败。 */
async function expectChildLine(
    lines: AsyncIterator<string>,
    childClosed: Promise<ChildExit>,
    expected: string,
    stderr: () => string,
): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const outcome = await Promise.race([
        lines.next().then((result) => ({kind: "line" as const, result})),
        childClosed.then((exit) => ({kind: "exit" as const, exit})),
        new Promise<{readonly kind: "timeout"}>((resolve) => {
            timeout = setTimeout(() => resolve({kind: "timeout"}), 10_000);
        }),
    ]);
    if (timeout) {
        clearTimeout(timeout);
    }
    if (outcome.kind === "timeout") {
        throw new Error(`等待child输出 ${expected} 超时；stderr=${stderr()}`);
    }
    if (outcome.kind === "exit") {
        throw new Error(
            `child在输出 ${expected} 前退出：code=${String(outcome.exit.code)} signal=${String(outcome.exit.signal)} stderr=${stderr()}`,
        );
    }
    if (outcome.result.done || outcome.result.value !== expected) {
        throw new Error(`child协议行不匹配：期望 ${expected}，收到 ${String(outcome.result.value)}；stderr=${stderr()}`);
    }
}

/** 有界等待child退出；返回null表示仍需由测试finally终止。 */
async function waitForChildExit(childClosed: Promise<ChildExit>, timeoutMs: number): Promise<ChildExit | null> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
        childClosed,
        new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), timeoutMs);
        }),
    ]);
    if (timeout) {
        clearTimeout(timeout);
    }
    return result;
}

/** Parent异常退出时先请求协作释放，超时后只终止本测试创建的child。 */
async function stopChild(
    child: ChildProcessWithoutNullStreams,
    childClosed: Promise<ChildExit>,
): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    if (!child.stdin.destroyed) {
        child.stdin.end();
    }
    if (await waitForChildExit(childClosed, 2_000)) {
        return;
    }
    child.kill();
    await waitForChildExit(childClosed, 2_000);
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("ProjectLockModule", () => {
    it("Occupancy Lock 对同一 canonical Project fail-fast，并只暴露 opaque artifact", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "occupied"));
        const firstModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const secondModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("occupied");
        let firstRelease: (() => Promise<void>) | null = null;
        let secondRelease: (() => Promise<void>) | null = null;

        try {
            const firstHandle = await firstModule.acquireOccupancy(ref);
            firstRelease = () => firstHandle.release();

            const startedAt = Date.now();
            await expect(secondModule.acquireOccupancy(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
                projectRoot: "occupied",
            });
            expect(Date.now() - startedAt).toBeLessThan(500);

            const lockDirectory = path.join(workspaceRoot, ".nbook", "locks", "projects");
            const lockEntries = await readdir(lockDirectory);
            const ownershipEntries = lockEntries.filter((entry) => entry.endsWith(".lock"));
            const metadataEntries = lockEntries.filter((entry) => entry.endsWith(".metadata.json"));
            expect(ownershipEntries).toHaveLength(1);
            expect(metadataEntries).toHaveLength(1);
            expect(ownershipEntries[0]).not.toContain("occupied");
            expect(metadataEntries[0]).not.toContain("occupied");
            expect(JSON.parse(await readFile(path.join(lockDirectory, metadataEntries[0]), "utf8"))).toMatchObject({
                version: 1,
                pid: process.pid,
                projectRoot: "occupied",
                acquiredAt: expect.any(String),
            });

            await firstHandle.release();
            await firstHandle.release();
            firstRelease = null;

            const secondHandle = await secondModule.acquireOccupancy(ref);
            secondRelease = () => secondHandle.release();
            await secondHandle.release();
            secondRelease = null;
            expect(await readdir(lockDirectory)).toEqual([]);
        } finally {
            await secondRelease?.();
            await firstRelease?.();
        }
    });

    it("目标目录不存在时 prospective Occupancy 仍能预占同一 Project locator", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        const firstModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const secondModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const canonicalRef = projectWorkspaceRef("future-project");
        const competingRef = projectWorkspaceRef(process.platform === "win32" ? "FUTURE-PROJECT" : "future-project");
        const firstHandle = await firstModule.acquireOccupancy(canonicalRef);
        let secondHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expect(secondModule.acquireOccupancy(competingRef)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
            });
            await expect(access(path.join(workspaceRoot, "future-project"))).rejects.toMatchObject({code: "ENOENT"});

            await firstHandle.release();
            await mkdir(path.join(workspaceRoot, "future-project"));
            secondHandle = await secondModule.acquireOccupancy(canonicalRef);
        } finally {
            await secondHandle?.release();
            await firstHandle.release();
        }
    });

    it("真实过期的 proper-lockfile Occupancy artifact 可由公开接口恢复并释放", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-stale-"));
        roots.push(workspaceRoot);
        const ref = projectWorkspaceRef("stale-occupancy");
        const lockDirectory = path.join(workspaceRoot, ".nbook", "locks", "projects");
        const discoveryModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const discoveryHandle = await discoveryModule.acquireOccupancy(ref);
        const lockName = (await readdir(lockDirectory)).find((entry) => entry.endsWith(".lock"));
        expect(lockName).toBeDefined();
        await discoveryHandle.release();

        const staleLockPath = path.join(lockDirectory, lockName!);
        await mkdir(staleLockPath);
        const staleAt = new Date(Date.now() - PROJECT_LOCK_STALE_MS - 5_000);
        await fs.utimes(staleLockPath, staleAt, staleAt);

        const recoveryModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const recoveredHandle = await recoveryModule.acquireOccupancy(ref);
        try {
            expect(() => recoveredHandle.assertHealthy()).not.toThrow();
            await expect(access(staleLockPath)).resolves.toBeUndefined();
        } finally {
            await recoveredHandle.release();
        }
        await expect(access(staleLockPath)).rejects.toMatchObject({code: "ENOENT"});
        expect(await readdir(lockDirectory)).toEqual([]);
    });

    it("两个真实进程竞争不存在target的prospective Occupancy时只允许一个owner", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-process-"));
        roots.push(workspaceRoot);
        const projectRoot = "future-cross-process";
        const fixturePath = path.resolve(
            process.cwd(),
            "server",
            "workspace-files",
            "fixtures",
            "project-occupancy-holder.ts",
        );
        const bunExecutable = "bun" in process.versions ? process.execPath : "bun";
        const child = spawn(bunExecutable, [fixturePath], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NBOOK_TEST_WORKSPACE_ROOT: workspaceRoot,
                NBOOK_TEST_PROJECT_ROOT: projectRoot,
            },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        let childStderr = "";
        child.stderr.on("data", (chunk: string) => {
            childStderr += chunk;
        });
        const output = createInterface({input: child.stdout, crlfDelay: Infinity});
        const lines = output[Symbol.asyncIterator]();
        const childClosed = new Promise<ChildExit>((resolve) => {
            child.once("close", (code, signal) => resolve({code, signal}));
        });
        const parentModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef(projectRoot);
        let parentHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expectChildLine(lines, childClosed, "NBOOK_OCCUPANCY_READY", () => childStderr);
            await expect(access(path.join(workspaceRoot, projectRoot))).rejects.toMatchObject({code: "ENOENT"});

            const lockDirectory = path.join(workspaceRoot, ".nbook", "locks", "projects");
            const metadataName = (await readdir(lockDirectory)).find((entry) => entry.endsWith(".metadata.json"));
            expect(metadataName).toBeDefined();
            const childMetadata = JSON.parse(await readFile(path.join(lockDirectory, metadataName!), "utf8"));
            expect(childMetadata).toMatchObject({
                pid: expect.any(Number),
                projectRoot,
                kind: "project-occupancy",
            });
            expect(childMetadata.pid).not.toBe(process.pid);

            const startedAt = Date.now();
            await expect(parentModule.acquireOccupancy(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
                projectRoot,
            });
            expect(Date.now() - startedAt).toBeLessThan(1_000);

            child.stdin.end();
            await expectChildLine(lines, childClosed, "NBOOK_OCCUPANCY_RELEASED", () => childStderr);
            const childExit = await waitForChildExit(childClosed, 5_000);
            expect(childExit).toEqual({code: 0, signal: null});

            parentHandle = await parentModule.acquireOccupancy(ref);
            await parentHandle.release();
            parentHandle = null;
            expect(await readdir(lockDirectory)).toEqual([]);
        } finally {
            await parentHandle?.release();
            output.close();
            await stopChild(child, childClosed);
        }
    }, 20_000);

    it("Project key 与 Occupancy artifact 使用冻结的 canonical locator digest", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-digest-"));
        roots.push(workspaceRoot);
        const projectRoot = "Digest-Project";
        await mkdir(path.join(workspaceRoot, projectRoot));
        const ref = projectWorkspaceRef(projectRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const prepared = await lifecycle.prepareOpen(ref);
        const resolved = prepared.workspace;

        try {
            const canonicalWorkspaceRoot = await realpath(workspaceRoot);
            const normalizedWorkspaceRoot = process.platform === "win32"
                ? canonicalWorkspaceRoot.toLocaleLowerCase("en-US")
                : canonicalWorkspaceRoot;
            const normalizedProjectRoot = process.platform === "win32"
                ? resolved.ref.projectRoot.toLocaleLowerCase("en-US")
                : resolved.ref.projectRoot;
            const expectedHash = createHash("sha256")
                .update(normalizedWorkspaceRoot)
                .update("\0")
                .update(normalizedProjectRoot)
                .digest("hex");

            expect.soft(Symbol.keyFor(resolved.key)).toBe(`nbook.project-workspace.v1:${expectedHash}`);
            expect.soft(await readdir(path.join(workspaceRoot, ".nbook", "locks", "projects")))
                .toContain(`${expectedHash}.lock`);
        } finally {
            await prepared.occupancy.release();
            await lifecycle.close();
        }
    });

    it("Workspace mutation lock 有界等待并在前一 handle release 后串行进入", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        const firstModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const secondModule = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const firstHandle = await firstModule.acquireMutation();
        let secondEntered = false;
        let secondHandle: Awaited<ReturnType<ProjectLockModule["acquireMutation"]>> | null = null;

        try {
            const waiting = secondModule.acquireMutation().then((handle) => {
                secondHandle = handle;
                secondEntered = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(secondEntered).toBe(false);

            await firstHandle.release();
            await waiting;
            expect(secondEntered).toBe(true);
        } finally {
            await secondHandle?.release();
            await firstHandle.release();
        }
    });

    it("compromised 会同步关闭提交门禁并保留 typed failure", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        let compromise: ((error: Error) => void) | null = null;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                compromise = options.onCompromised ?? null;
                return acquireFileLock(file, options);
            },
        };
        const module = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const handle = await module.acquireOccupancy(projectWorkspaceRef("compromised"));

        try {
            expect(() => handle.assertHealthy()).not.toThrow();
            compromise?.(new Error("heartbeat lost"));

            expect(() => handle.assertHealthy()).toThrow(expect.objectContaining({
                code: "PROJECT_LOCK_COMPROMISED",
            }));
            await expect(handle.compromised).resolves.toMatchObject({
                code: "PROJECT_LOCK_COMPROMISED",
            });
        } finally {
            await handle.release();
        }
    });

    it("release failure 进入 terminal 状态且旧 handle 不清理新 owner sidecar", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        let acquisition = 0;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                acquisition += 1;
                const current = acquisition;
                return async () => {
                    await release();
                    if (current === 1) {
                        throw Object.assign(new Error("injected release failure"), {code: "EIO"});
                    }
                };
            },
        };
        const firstModule = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const secondModule = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const ref = projectWorkspaceRef("release-failure");
        const first = await firstModule.acquireOccupancy(ref);
        const firstFailure = await first.release().catch((error: unknown) => error);
        expect(firstFailure).toMatchObject({code: "PROJECT_LOCK_RELEASE_FAILED"});
        const lockDirectory = path.join(workspaceRoot, ".nbook", "locks", "projects");
        const firstMetadataNames = (await readdir(lockDirectory))
            .filter((entry) => entry.endsWith(".metadata.json"));
        expect(firstMetadataNames).toHaveLength(1);
        const firstMetadataName = firstMetadataNames[0]!;
        const firstMetadata = JSON.parse(await readFile(path.join(lockDirectory, firstMetadataName), "utf8"));

        const second = await secondModule.acquireOccupancy(ref);
        try {
            const metadataNames = (await readdir(lockDirectory))
                .filter((entry) => entry.endsWith(".metadata.json"));
            expect(metadataNames).toHaveLength(2);
            const secondMetadataName = metadataNames.find((entry) => entry !== firstMetadataName);
            expect(secondMetadataName).toBeDefined();
            const secondMetadata = JSON.parse(
                await readFile(path.join(lockDirectory, secondMetadataName!), "utf8"),
            );
            expect(secondMetadata.token).not.toBe(firstMetadata.token);

            const repeatedFailure = await first.release().catch((error: unknown) => error);
            expect(repeatedFailure).toBe(firstFailure);
            expect(JSON.parse(await readFile(path.join(lockDirectory, firstMetadataName), "utf8"))).toMatchObject({
                token: firstMetadata.token,
            });
            expect(JSON.parse(await readFile(path.join(lockDirectory, secondMetadataName!), "utf8"))).toMatchObject({
                token: secondMetadata.token,
            });
        } finally {
            await second.release();
        }
    });

    it("metadata写入与release同时失败时保留typed顶层和两个原始cause", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lock-"));
        roots.push(workspaceRoot);
        const metadataFailure = Object.assign(new Error("injected metadata failure"), {code: "ENOSPC"});
        const releaseFailure = Object.assign(new Error("injected release failure"), {code: "EIO"});
        const release = vi.fn(async () => {
            throw releaseFailure;
        });
        const adapter: ProjectLockAdapter = {
            acquire: async () => release,
        };
        const openSpy = vi.spyOn(fs, "open").mockRejectedValueOnce(metadataFailure);
        const module = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});

        try {
            const failure = await module
                .acquireOccupancy(projectWorkspaceRef("metadata-release-failure"))
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                kind: "project-occupancy",
                projectRoot: "metadata-release-failure",
                staleMs: 30_000,
            });
            expect(release).toHaveBeenCalledTimes(1);
            if (!(failure instanceof ProjectLockReleaseFailedError)) {
                throw new Error("期望ProjectLockReleaseFailedError");
            }
            expect(failure.cause).toBeInstanceOf(AggregateError);
            if (!(failure.cause instanceof AggregateError)) {
                throw new Error("期望AggregateError cause");
            }
            expect(failure.cause.errors).toHaveLength(2);
            expect(failure.cause.errors[0]).toBe(metadataFailure);
            expect(failure.cause.errors[1]).toBe(releaseFailure);
        } finally {
            openSpy.mockRestore();
        }
    });
});
