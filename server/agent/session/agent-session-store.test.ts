import {randomUUID} from "node:crypto";
import {createHash} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {AttachmentMigrationGate} from "nbook/server/agent/session/attachment-migration-gate";
import {
    acquireAgentSessionStoreExclusiveLease,
    acquireReadyAgentSessionStore,
    AGENT_SESSION_SCHEMA_VERSION,
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
    agentSessionStoreSentinelPath,
    parseAgentSessionStoreSentinel,
    type AgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";

describe("Agent Session Store", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("只接受exact sentinel schema与portable manifest路径", () => {
        const sentinel = completeSentinel();

        expect(parseAgentSessionStoreSentinel(sentinel)).toEqual(sentinel);
        expect(() => parseAgentSessionStoreSentinel({...sentinel, legacy: true}))
            .toThrow(AgentSessionStoreCorruptError);
        expect(() => parseAgentSessionStoreSentinel({...sentinel, manifestPath: "../outside.json"}))
            .toThrow(AgentSessionStoreCorruptError);
        expect(() => parseAgentSessionStoreSentinel({...sentinel, checkpointCursor: 1.5}))
            .toThrow(AgentSessionStoreCorruptError);
    });

    it("sentinel缺失或complete旧schema时返回migration_required并释放lease", async () => {
        const root = nextRoot();

        await expect(acquireReadyAgentSessionStore(root)).rejects.toBeInstanceOf(AgentSessionMigrationRequiredError);
        await writeSentinel(root, {...completeSentinel(), targetSchemaVersion: 1});
        await expect(acquireReadyAgentSessionStore(root)).rejects.toMatchObject({
            code: "AGENT_SESSION_MIGRATION_REQUIRED",
            actualSchemaVersion: 1,
        });

        const release = await acquireAgentSessionStoreExclusiveLease(root);
        await release();
    });

    it.each(["pending", "applying", "rollback_required"] as const)(
        "%s状态要求显式resume或rollback",
        async (state) => {
            const root = nextRoot();
            await writeSentinel(root, {...completeSentinel(), state});

            await expect(acquireReadyAgentSessionStore(root)).rejects.toBeInstanceOf(AgentSessionRecoveryRequiredError);
        },
    );

    it("损坏sentinel fail closed且不会持有迟到lease", async () => {
        const root = nextRoot();
        const path = agentSessionStoreSentinelPath(root);
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, "not-json", "utf8");

        await expect(acquireReadyAgentSessionStore(root)).rejects.toBeInstanceOf(AgentSessionStoreCorruptError);
        const release = await acquireAgentSessionStoreExclusiveLease(root);
        await release();
    });

    it("相同进程runtime共享物理lease，最后一个owner释放后migration才能进入", async () => {
        const root = nextRoot();
        await writeCommittedSentinel(root);
        const first = await acquireReadyAgentSessionStore(root);
        const second = await acquireReadyAgentSessionStore(root);

        expect(first.ready.rootWorkspace).toBe(resolve(root));
        expect(first.ready.schemaVersion).toBe(AGENT_SESSION_SCHEMA_VERSION);
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});

        await first.release();
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});
        await second.release();
        await second.release();

        const releaseMigration = await acquireAgentSessionStoreExclusiveLease(root);
        await releaseMigration();
    });

    it("旧Attachment gate与新runtime/exclusive owner在同一物理lease上双向互斥", async () => {
        const root = nextRoot();
        await writeCommittedSentinel(root);
        const legacyGate = new AttachmentMigrationGate(root);
        const releaseLegacy = legacyGate.acquireRuntimeLeaseSync();
        try {
            await expect(acquireReadyAgentSessionStore(root)).rejects.toMatchObject({code: "ELOCKED"});
            await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});
        } finally {
            releaseLegacy();
        }

        const runtime = await acquireReadyAgentSessionStore(root);
        try {
            await expect(legacyGate.acquireRuntimeLease()).rejects.toMatchObject({code: "ELOCKED"});
        } finally {
            await runtime.release();
        }

        const releaseExclusive = await acquireAgentSessionStoreExclusiveLease(root);
        try {
            let failure: unknown;
            try {
                legacyGate.acquireRuntimeLeaseSync();
            } catch (error) {
                failure = error;
            }
            expect(failure).toMatchObject({code: "ELOCKED"});
        } finally {
            await releaseExclusive();
        }
    });

    it("HMR重载后同root owner共享globalThis物理lease引用计数", async () => {
        const root = nextRoot();
        await writeCommittedSentinel(root);
        const first = await acquireReadyAgentSessionStore(root);
        vi.resetModules();
        const reloaded = await import("nbook/server/agent/session/agent-session-store");
        const second = await reloaded.acquireReadyAgentSessionStore(root);

        try {
            expect(first.compromised).toBe(second.compromised);
            await first.release();
            await expect(reloaded.acquireAgentSessionStoreExclusiveLease(root))
                .rejects.toMatchObject({code: "ELOCKED"});
            await second.release();
            const releaseMigration = await reloaded.acquireAgentSessionStoreExclusiveLease(root);
            await releaseMigration();
        } finally {
            await first.release();
            await second.release();
        }
    });

    it("complete sentinel绑定的manifest缺失或被篡改时fail closed", async () => {
        const root = nextRoot();
        const sentinel = await writeCommittedSentinel(root);
        const manifestPath = resolve(root, ...sentinel.manifestPath.split("/"));
        await writeFile(manifestPath, JSON.stringify({runId: sentinel.runId, appliedSeq: 99}), "utf8");

        await expect(acquireReadyAgentSessionStore(root)).rejects.toBeInstanceOf(AgentSessionStoreCorruptError);
    });

    /** 为当前用例分配隔离Workspace Root。 */
    function nextRoot(): string {
        const root = resolve(".agent", "agent-session-store-test", randomUUID());
        roots.push(root);
        return root;
    }
});

/** 构造严格的schema v2 complete sentinel。 */
function completeSentinel(): AgentSessionStoreSentinel {
    return {
        sentinelVersion: 1,
        state: "complete",
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        runId: "session-v2-test",
        manifestPath: ".nbook/agent/migrations/session-v2/session-v2-test/manifest.json",
        manifestHash: "a".repeat(64),
        checkpointCursor: 3,
    };
}

/** 将测试sentinel写入隔离Workspace Root。 */
async function writeSentinel(root: string, sentinel: AgentSessionStoreSentinel): Promise<void> {
    const path = agentSessionStoreSentinelPath(root);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, JSON.stringify(sentinel), "utf8");
}

/** 写入hash、runId与checkpoint相互绑定的complete sentinel和manifest。 */
async function writeCommittedSentinel(root: string): Promise<AgentSessionStoreSentinel> {
    const sentinel = completeSentinel();
    const manifestPath = resolve(root, ...sentinel.manifestPath.split("/"));
    const manifestText = `${JSON.stringify({
        runId: sentinel.runId,
        appliedSeq: sentinel.checkpointCursor,
        status: "report_written",
    })}\n`;
    await mkdir(dirname(manifestPath), {recursive: true});
    await writeFile(manifestPath, manifestText, "utf8");
    sentinel.manifestHash = createHash("sha256").update(manifestText).digest("hex");
    await writeSentinel(root, sentinel);
    return sentinel;
}
