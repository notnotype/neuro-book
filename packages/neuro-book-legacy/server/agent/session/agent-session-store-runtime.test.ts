import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {createHash} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {mkdir, readFile, rm, stat, utimes, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    acquireAgentSessionStoreLease,
    AGENT_SESSION_STORE_LEASE_STALE_MS,
    AgentSessionStoreLeaseHeldError,
    agentSessionStoreLeasePath,
} from "nbook/server/agent/session/agent-session-store-lease";
import {
    acquireAgentSessionStoreExclusiveLease,
    agentSessionStoreSentinelPath,
    type AgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";
import {
    requireReadyAgentSessionStore,
    startAgentSessionStoreRuntime,
    stopAgentSessionStoreRuntime,
} from "nbook/server/agent/session/agent-session-store-runtime";

describe("Agent Session Store runtime owner", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await stopAgentSessionStoreRuntime();
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("未启动时拒绝提供ready capability", async () => {
        const root = await readyRoot();

        expect(() => requireReadyAgentSessionStore(root)).toThrow("尚未完成启动");
    });

    it("同root并发启动共享owner并持有lease到显式stop", async () => {
        const root = await readyRoot();
        const [first, second] = await Promise.all([
            startAgentSessionStoreRuntime(root),
            startAgentSessionStoreRuntime(root),
        ]);

        expect(first).toBe(second);
        expect(requireReadyAgentSessionStore(root)).toBe(first);
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});

        await stopAgentSessionStoreRuntime(root);
        const releaseMigration = await acquireAgentSessionStoreExclusiveLease(root);
        await releaseMigration();
    });

    it("不同Workspace Root各自独立持有capability与lease", async () => {
        const first = await readyRoot();
        const second = await readyRoot();

        const firstReady = await startAgentSessionStoreRuntime(first);
        const secondReady = await startAgentSessionStoreRuntime(second);

        expect(firstReady).not.toBe(secondReady);
        expect(requireReadyAgentSessionStore(first)).toBe(firstReady);
        expect(requireReadyAgentSessionStore(second)).toBe(secondReady);

        // 单独关闭一个root不影响另一个root的capability与物理锁。
        await stopAgentSessionStoreRuntime(first);
        expect(() => requireReadyAgentSessionStore(first)).toThrow("尚未完成启动");
        expect(requireReadyAgentSessionStore(second)).toBe(secondReady);
        const releaseFirst = await acquireAgentSessionStoreExclusiveLease(first);
        await releaseFirst();
        await expect(acquireAgentSessionStoreExclusiveLease(second)).rejects.toMatchObject({code: "ELOCKED"});
    });

    it("start-stop-start严格按调用顺序重新取得lease，不发布已释放handle", async () => {
        const root = await readyRoot();
        const firstStart = startAgentSessionStoreRuntime(root);
        const stopping = stopAgentSessionStoreRuntime(root);
        const secondStart = startAgentSessionStoreRuntime(root);

        await Promise.all([firstStart, stopping, secondStart]);
        expect(requireReadyAgentSessionStore(root)).toBe(await secondStart);
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});
    });

    it("场景 1：同进程旧实例慢停止，新实例就绪前等待且不抢占租约", async () => {
        const root = await readyRoot();
        const releaseOld = await acquireAgentSessionStoreLease(root, "runtime");
        const owner = await readFile(agentSessionStoreLeasePath(root), "utf8");
        let settled = false;
        const starting = startAgentSessionStoreRuntime(root, {
            waitForSameProcessRuntimeLease: true,
            leaseHandoffTimeoutMs: 2_000,
            leaseHandoffPollMs: 5,
        }).finally(() => { settled = true; });
        try {
            await sleep(20);
            expect(settled).toBe(false);
            expect(await readFile(agentSessionStoreLeasePath(root), "utf8")).toBe(owner);
        } finally {
            await releaseOld();
        }
        const ready = await starting;
        expect(requireReadyAgentSessionStore(root)).toBe(ready);
        expect(await readFile(agentSessionStoreLeasePath(root), "utf8")).not.toBe(owner);
    });

    it("同 PID 旧 worker 的残留锁心跳已过期，新实例无需等到交接期限即可取得租约", async () => {
        const root = await readyRoot();
        const path = agentSessionStoreLeasePath(root);
        const leaseId = randomUUID();
        const staleTime = new Date(Date.now() - AGENT_SESSION_STORE_LEASE_STALE_MS - 1_000);
        await writeFile(path, JSON.stringify({
            schema: "nbook.agent-session-store-lease-owner/v1", leaseId, kind: "runtime",
            pid: process.pid, acquiredAt: staleTime.toISOString(), runtime: "node", runtimeVersion: process.versions.node,
        }));
        await mkdir(`${path}.lock`);
        await utimes(`${path}.lock`, staleTime, staleTime);
        const ready = await startAgentSessionStoreRuntime(root, {
            waitForSameProcessRuntimeLease: true, leaseHandoffTimeoutMs: 100, leaseHandoffPollMs: 5,
        });
        expect(requireReadyAgentSessionStore(root)).toBe(ready);
        expect(JSON.parse(await readFile(path, "utf8")).leaseId).not.toBe(leaseId);
    });

    it("场景 2：同进程旧runtime未释放时超时且不删除lease，释放后可重试", async () => {
        const root = await readyRoot();
        const releaseOld = await acquireAgentSessionStoreLease(root, "runtime");

        await expect(startAgentSessionStoreRuntime(root, {
            waitForSameProcessRuntimeLease: true,
            leaseHandoffTimeoutMs: 30,
            leaseHandoffPollMs: 5,
        })).rejects.toMatchObject({
            code: "ELOCKED",
            handoffTimeoutMs: 30,
            owner: {kind: "runtime", pid: process.pid},
        });

        const held = await acquireAgentSessionStoreLease(root, "runtime").catch((error: unknown) => error);
        expect(held).toBeInstanceOf(AgentSessionStoreLeaseHeldError);
        await releaseOld();
        await expect(startAgentSessionStoreRuntime(root, {waitForSameProcessRuntimeLease: true})).resolves.toBeDefined();
    });

    it("场景 3：migration owner立即失败，不把迁移锁当作HMR交接", async () => {
        const root = await readyRoot();
        const releaseMigration = await acquireAgentSessionStoreLease(root, "migration");
        const startedAt = Date.now();

        await expect(startAgentSessionStoreRuntime(root, {
            waitForSameProcessRuntimeLease: true,
            leaseHandoffTimeoutMs: 200,
            leaseHandoffPollMs: 5,
        })).rejects.toMatchObject({
            code: "ELOCKED",
            owner: {kind: "migration"},
        });
        expect(Date.now() - startedAt).toBeLessThan(100);
        await releaseMigration();
    });

    it("场景 3：另一进程的 runtime owner 立即失败，不等待也不改锁", async () => {
        const root = await readyRoot();
        const release = await acquireAgentSessionStoreLease(root, "runtime");
        const path = agentSessionStoreLeasePath(root);
        const owner = JSON.parse(await readFile(path, "utf8")) as {pid: number};
        owner.pid = process.pid + 1;
        await writeFile(path, JSON.stringify(owner), "utf8");
        const heartbeat = (await stat(`${path}.lock`)).mtimeMs;
        try {
            await expect(startAgentSessionStoreRuntime(root, {
                waitForSameProcessRuntimeLease: true,
                leaseHandoffTimeoutMs: 2_000,
                leaseHandoffPollMs: 500,
            })).rejects.toMatchObject({code: "ELOCKED", owner: {pid: owner.pid}, handoffTimeoutMs: undefined});
            expect((await stat(`${path}.lock`)).mtimeMs).toBe(heartbeat);
        } finally {
            await release();
        }
    });

    it.each([false, true])("开发交接等待=%s 时停止仍释放锁并保留 owner 诊断 metadata", async (waitForSameProcessRuntimeLease) => {
        const root = await readyRoot();
        await startAgentSessionStoreRuntime(root, {waitForSameProcessRuntimeLease});
        const owner = await readFile(agentSessionStoreLeasePath(root), "utf8");
        await stopAgentSessionStoreRuntime(root);
        expect(await readFile(agentSessionStoreLeasePath(root), "utf8")).toBe(owner);
        await expect(stat(`${agentSessionStoreLeasePath(root)}.lock`)).rejects.toMatchObject({code: "ENOENT"});
        const release = await acquireAgentSessionStoreExclusiveLease(root);
        await release();
    });


    it("并发stop共享线性化关闭边界", async () => {
        const root = await readyRoot();
        await startAgentSessionStoreRuntime(root);

        await Promise.all([stopAgentSessionStoreRuntime(root), stopAgentSessionStoreRuntime(root)]);
        expect(() => requireReadyAgentSessionStore(root)).toThrow("尚未完成启动");
        const releaseMigration = await acquireAgentSessionStoreExclusiveLease(root);
        await releaseMigration();
    });

    it("无参stop关闭本进程全部owner", async () => {
        const first = await readyRoot();
        const second = await readyRoot();
        await startAgentSessionStoreRuntime(first);
        await startAgentSessionStoreRuntime(second);

        await stopAgentSessionStoreRuntime();

        expect(() => requireReadyAgentSessionStore(first)).toThrow("尚未完成启动");
        expect(() => requireReadyAgentSessionStore(second)).toThrow("尚未完成启动");
        for (const root of [first, second]) {
            const release = await acquireAgentSessionStoreExclusiveLease(root);
            await release();
        }
    });

    /** 创建带schema v2 complete sentinel的隔离Workspace Root。 */
    async function readyRoot(): Promise<string> {
        const root = testHostPath("agent-session-store-runtime-test", randomUUID());
        roots.push(root);
        const path = agentSessionStoreSentinelPath(root);
        await mkdir(dirname(path), {recursive: true});
        const sentinel: AgentSessionStoreSentinel = {
            sentinelVersion: 1,
            state: "complete",
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            runId: "runtime-test",
            manifestPath: ".nbook/agent/migrations/session-v2/runtime-test/manifest.json",
            manifestHash: "b".repeat(64),
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
        await writeFile(path, JSON.stringify(sentinel), "utf8");
        return root;
    }
});
