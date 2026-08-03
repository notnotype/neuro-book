import {mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    acquireAgentSessionStoreLease,
    acquireAgentSessionStoreLeaseSync,
    AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
    AgentSessionStoreLeaseHeldError,
    agentSessionStoreLeasePath,
    type AgentSessionStoreLeaseOwner,
} from "nbook/server/agent/session/agent-session-store-lease";

describe("Agent Session Store runtime lease", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("async runtime owner写入最小版本化metadata且释放后可重取", async () => {
        const root = await nextRoot();
        const path = agentSessionStoreLeasePath(root);
        const releaseRuntime = await acquireAgentSessionStoreLease(root, "runtime");
        const runtimeOwner = await readOwner(path);

        expect(runtimeOwner).toMatchObject({
            schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
            kind: "runtime",
            pid: process.pid,
        });
        expect(Object.keys(runtimeOwner).sort()).toEqual([
            "acquiredAt",
            "kind",
            "leaseId",
            "pid",
            "runtime",
            "runtimeVersion",
            "schema",
        ]);
        expect(JSON.stringify(runtimeOwner)).not.toMatch(/argv|cwd|env|token|password/iu);

        await releaseRuntime();
        const releaseMigration = await acquireAgentSessionStoreLease(root, "migration");
        expect(await readOwner(path)).toMatchObject({kind: "migration", pid: process.pid});
        await releaseMigration();
    });

    it("sync与async owner共享同一物理lease并返回稳定ELOCKED诊断", async () => {
        const root = await nextRoot();
        const path = agentSessionStoreLeasePath(root);
        const releaseRuntime = acquireAgentSessionStoreLeaseSync(root, "runtime");
        try {
            const failure = await acquireAgentSessionStoreLease(root, "migration")
                .catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError);
            expect(failure).toMatchObject({
                code: "ELOCKED",
                leasePath: path,
                owner: expect.objectContaining({kind: "runtime", pid: process.pid}),
            });
            expect((failure as AgentSessionStoreLeaseHeldError).heartbeatAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        } finally {
            releaseRuntime();
        }

        const releaseMigration = await acquireAgentSessionStoreLease(root, "migration");
        try {
            let failure: unknown;
            try {
                acquireAgentSessionStoreLeaseSync(root, "runtime");
            } catch (error) {
                failure = error;
            }
            expect(failure).toMatchObject({
                code: "ELOCKED",
                owner: expect.objectContaining({kind: "migration", pid: process.pid}),
            });
        } finally {
            await releaseMigration();
        }
    });

    it.each([
        ["旧空文件", ""],
        ["损坏metadata", "{not-json"],
    ])("%s竞争时owner降级为未知，但保留heartbeat", async (_name, metadata) => {
        const root = await nextRoot();
        const path = agentSessionStoreLeasePath(root);
        const release = await acquireAgentSessionStoreLease(root, "runtime");
        try {
            await writeFile(path, metadata, "utf8");
            const failure = await acquireAgentSessionStoreLease(root, "migration")
                .catch((error: unknown) => error) as AgentSessionStoreLeaseHeldError;

            expect(failure).toBeInstanceOf(AgentSessionStoreLeaseHeldError);
            expect(failure.owner).toBeNull();
            expect(failure.heartbeatAt).not.toBeNull();
            expect(failure.message).toContain("owner：未知");
        } finally {
            await release();
        }
    });

    it("超过30秒的遗留lock由proper-lockfile协议接管并覆盖owner", async () => {
        const root = await nextRoot();
        const path = agentSessionStoreLeasePath(root);
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, "", "utf8");
        await mkdir(`${path}.lock`);
        const staleTime = new Date(Date.now() - 31_000);
        await utimes(`${path}.lock`, staleTime, staleTime);

        const release = await acquireAgentSessionStoreLease(root, "migration");
        try {
            expect(await readOwner(path)).toMatchObject({kind: "migration", pid: process.pid});
            expect((await stat(`${path}.lock`)).mtimeMs).toBeGreaterThan(staleTime.getTime());
        } finally {
            await release();
        }
    });

    /** 为每个用例建立仓库外隔离 Workspace Root。 */
    async function nextRoot(): Promise<string> {
        const root = await mkdtemp(join(tmpdir(), "nbook-session-store-lease-"));
        roots.push(root);
        return root;
    }
});

/** 读取当前测试 owner metadata。 */
async function readOwner(path: string): Promise<AgentSessionStoreLeaseOwner> {
    return JSON.parse(await readFile(path, "utf8")) as AgentSessionStoreLeaseOwner;
}
