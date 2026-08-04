import {createHash, randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    observeAgentSessionStoreRuntimeCompromised,
    requireReadyAgentSessionStore,
    startAgentSessionStoreRuntime,
    stopAgentSessionStoreRuntime,
} from "nbook/server/agent/session/agent-session-store-runtime";
import {
    acquireAgentSessionStoreExclusiveLease,
    acquireReadyAgentSessionStore,
    agentSessionStoreSentinelPath,
    type AgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";

const lockAdapter = vi.hoisted(() => ({
    held: false,
    releaseAttempts: 0,
    remainingReleaseFailures: 0,
    releaseBarrier: null as Promise<void> | null,
    compromise: null as ((error: Error) => void) | null,
    compromiseOnRelease: null as Error | null,
    lock: vi.fn<(
        path: string,
        options?: {onCompromised?: (error: Error) => void},
    ) => Promise<() => Promise<void>>>(),
}));

vi.mock("proper-lockfile", () => ({lock: lockAdapter.lock}));

describe("Agent Session Store release failure", () => {
    const roots: string[] = [];
    const releaseFailure = new Error("injected physical release failure");

    beforeEach(() => {
        lockAdapter.held = false;
        lockAdapter.releaseAttempts = 0;
        lockAdapter.remainingReleaseFailures = 0;
        lockAdapter.releaseBarrier = null;
        lockAdapter.compromise = null;
        lockAdapter.compromiseOnRelease = null;
        lockAdapter.lock.mockReset();
        lockAdapter.lock.mockImplementation(async (_path, options) => {
            lockAdapter.compromise = options?.onCompromised ?? null;
            if (lockAdapter.held) {
                throw Object.assign(new Error("Lock file is already being held"), {code: "ELOCKED"});
            }
            lockAdapter.held = true;
            return async () => {
                lockAdapter.releaseAttempts += 1;
                if (lockAdapter.compromiseOnRelease) {
                    const cause = lockAdapter.compromiseOnRelease;
                    lockAdapter.compromiseOnRelease = null;
                    lockAdapter.compromise?.(cause);
                }
                if (lockAdapter.remainingReleaseFailures > 0) {
                    lockAdapter.remainingReleaseFailures -= 1;
                    throw releaseFailure;
                }
                if (lockAdapter.releaseBarrier) {
                    await lockAdapter.releaseBarrier;
                }
                lockAdapter.held = false;
            };
        });
    });

    afterEach(async () => {
        lockAdapter.held = false;
        lockAdapter.releaseBarrier = null;
        lockAdapter.compromiseOnRelease = null;
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("并发release共享同一失败，原owner重试成功前exclusive始终fail closed", async () => {
        const root = await readyRoot();
        lockAdapter.remainingReleaseFailures = 1;
        const runtime = await acquireReadyAgentSessionStore(root);

        const [first, second] = await Promise.allSettled([runtime.release(), runtime.release()]);

        expect(first).toEqual({status: "rejected", reason: releaseFailure});
        expect(second).toEqual({status: "rejected", reason: releaseFailure});
        expect(lockAdapter.releaseAttempts).toBe(1);
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});

        await runtime.release();
        expect(lockAdapter.releaseAttempts).toBe(2);
        const releaseExclusive = await acquireAgentSessionStoreExclusiveLease(root);
        await releaseExclusive();
    });

    it("并发release都等待同一次物理解锁完成", async () => {
        const root = await readyRoot();
        let finishPhysicalRelease: () => void = () => undefined;
        lockAdapter.releaseBarrier = new Promise<void>((resolveBarrier) => {
            finishPhysicalRelease = resolveBarrier;
        });
        const runtime = await acquireReadyAgentSessionStore(root);
        let firstSettled = false;
        let secondSettled = false;
        const first = runtime.release().then(() => {
            firstSettled = true;
        });
        const second = runtime.release().then(() => {
            secondSettled = true;
        });

        try {
            await vi.waitFor(() => expect(lockAdapter.releaseAttempts).toBe(1));
            expect(firstSettled).toBe(false);
            expect(secondSettled).toBe(false);
        } finally {
            finishPhysicalRelease();
            await Promise.allSettled([first, second]);
        }

        expect(lockAdapter.releaseAttempts).toBe(1);
        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
    });

    it("compromised只解析一次且旧release不再触碰失效锁", async () => {
        const root = await readyRoot();
        const runtime = await acquireReadyAgentSessionStore(root);
        const firstCause = new Error("heartbeat lost");
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);

        try {
            expect(() => lockAdapter.compromise?.(firstCause)).not.toThrow();
            lockAdapter.compromise?.(new Error("second compromise"));

            await expect(runtime.compromised).resolves.toMatchObject({
                code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
                leasePath: expect.stringContaining("runtime.lease"),
                cause: firstCause,
            });
            await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
            expect(unhandled).toEqual([]);
            await runtime.release();
            await runtime.release();
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }

        expect(lockAdapter.releaseAttempts).toBe(0);
    });

    it("多个runtime owner共享同一个compromised Promise", async () => {
        const root = await readyRoot();
        const first = await acquireReadyAgentSessionStore(root);
        const second = await acquireReadyAgentSessionStore(root);
        const cause = new Error("heartbeat lost for shared owners");

        expect(first.compromised).toBe(second.compromised);
        lockAdapter.compromise?.(cause);

        const firstError = await first.compromised;
        await expect(second.compromised).resolves.toBe(firstError);
        expect(firstError).toMatchObject({code: "AGENT_SESSION_STORE_LEASE_COMPROMISED", cause});
        await first.release();
        await second.release();
    });

    it("release失败不覆盖compromised的原始原因", async () => {
        const root = await readyRoot();
        const runtime = await acquireReadyAgentSessionStore(root);
        const cause = new Error("heartbeat lost during release");
        lockAdapter.compromiseOnRelease = cause;
        lockAdapter.remainingReleaseFailures = 1;

        await expect(runtime.release()).resolves.toBeUndefined();
        await expect(runtime.compromised).resolves.toMatchObject({cause});
        expect(lockAdapter.releaseAttempts).toBe(1);
    });

    it("compromised后同进程不能重新取得同一runtime lease", async () => {
        const root = await readyRoot();
        const runtime = await acquireReadyAgentSessionStore(root);
        const cause = new Error("heartbeat lost before retry");

        lockAdapter.compromise?.(cause);

        await expect(acquireReadyAgentSessionStore(root)).rejects.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
            cause,
        });
        expect(lockAdapter.lock).toHaveBeenCalledTimes(1);

        await runtime.release();
    });

    it("active capability在compromised后同步fail closed且runtime不能重启", async () => {
        const root = await readyRoot();
        await startAgentSessionStoreRuntime(root);
        const cause = new Error("heartbeat lost while active");

        lockAdapter.compromise?.(cause);

        await expect(observeAgentSessionStoreRuntimeCompromised(root)).resolves.toMatchObject({cause});
        let readyFailure: unknown;
        try {
            requireReadyAgentSessionStore(root);
        } catch (error) {
            readyFailure = error;
        }
        expect(readyFailure).toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
            cause,
        });
        await expect(startAgentSessionStoreRuntime(root)).rejects.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
            cause,
        });

        await stopAgentSessionStoreRuntime(root);
        await expect(startAgentSessionStoreRuntime(root)).rejects.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
            cause,
        });
    });

    /** 创建当前schema complete sentinel的隔离Workspace Root。 */
    async function readyRoot(): Promise<string> {
        const root = resolve(".agent", "agent-session-store-release-test", randomUUID());
        roots.push(root);
        const path = agentSessionStoreSentinelPath(root);
        const sentinel: AgentSessionStoreSentinel = {
            sentinelVersion: 1,
            state: "complete",
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            runId: "release-test",
            manifestPath: ".nbook/agent/migrations/session-v2/release-test/manifest.json",
            manifestHash: "c".repeat(64),
            checkpointCursor: 1,
        };
        const manifestPath = resolve(root, ...sentinel.manifestPath.split("/"));
        const manifestText = `${JSON.stringify({
            runId: sentinel.runId,
            appliedSeq: sentinel.checkpointCursor,
            status: "report_written",
        })}\n`;
        await mkdir(dirname(manifestPath), {recursive: true});
        await writeFile(manifestPath, manifestText, "utf8");
        sentinel.manifestHash = createHash("sha256").update(manifestText).digest("hex");
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, JSON.stringify(sentinel), "utf8");
        return root;
    }
});
