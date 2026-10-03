import {access, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    executeSessionTransaction,
} from "nbook/server/agent/session/migrations/shared/transaction";
import type {
    SessionFileMigrationPlan,
    SessionFileTransactionAdapter,
    SessionFileTransactionStatuses,
    SessionMigrationFileState,
} from "nbook/server/agent/session/migrations/shared/types";
import {sha256} from "nbook/server/agent/session/migrations/shared/durable-file";

type TestStatus =
    | "pending"
    | "backed_up"
    | "prepared"
    | "staged"
    | "publishing"
    | "published"
    | "verified"
    | "rollback_pending"
    | "rollback_publishing"
    | "rolled_back";

const status: SessionFileTransactionStatuses<TestStatus> = {
    pending: "pending",
    backedUp: "backed_up",
    prepared: "prepared",
    staged: "staged",
    publishing: "publishing",
    published: "published",
    verified: "verified",
    rollbackPending: "rollback_pending",
    rollbackPublishing: "rollback_publishing",
    rolledBack: "rolled_back",
};

describe("shared Session file transaction lease gates", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("backup前失去lease时不创建backup，也不进入后续artifact阶段", async () => {
        const root = await nextRoot();
        const sourcePath = join(root, "sessions", "1.jsonl");
        const sourceText = "source\n";
        await mkdir(join(root, "sessions"), {recursive: true});
        await writeFile(sourcePath, sourceText, "utf8");
        const session = sessionState(root, sourceText, "pending");
        const compromised = new Error("lease compromised before backup");
        const assertHealthy = failOnSecondCheck(compromised);
        const prepareArtifacts = vi.fn(async () => undefined);

        await expect(executeSessionTransaction({
            rootWorkspace: root,
            session,
            status,
            adapter: adapter(sourceText, prepareArtifacts),
            transition: async () => undefined,
            assertHealthy,
        })).rejects.toBe(compromised);

        await expect(pathExists(join(root, session.backupPath))).resolves.toBe(false);
        expect(prepareArtifacts).not.toHaveBeenCalled();
    });

    it("artifact前失去lease时不创建blob", async () => {
        const root = await nextRoot();
        const sourceText = "backup\n";
        const session = sessionState(root, sourceText, "backed_up");
        await mkdir(join(root, "migrations", "backups"), {recursive: true});
        await writeFile(join(root, session.backupPath), sourceText, "utf8");
        const blobPath = join(root, "attachments", "blob");
        const compromised = new Error("lease compromised before artifact");
        const prepareArtifacts = vi.fn(async () => {
            await mkdir(join(root, "attachments"), {recursive: true});
            await writeFile(blobPath, "blob", "utf8");
        });

        await expect(executeSessionTransaction({
            rootWorkspace: root,
            session,
            status,
            adapter: adapter(sourceText, prepareArtifacts),
            transition: async () => undefined,
            assertHealthy: failOnSecondCheck(compromised),
        })).rejects.toBe(compromised);

        expect(prepareArtifacts).not.toHaveBeenCalled();
        await expect(pathExists(blobPath)).resolves.toBe(false);
    });

    it("stage前失去lease时不创建stage", async () => {
        const root = await nextRoot();
        const sourceText = "prepared\n";
        const session = sessionState(root, sourceText, "prepared");
        await mkdir(join(root, "migrations", "backups"), {recursive: true});
        await writeFile(join(root, session.backupPath), sourceText, "utf8");
        const compromised = new Error("lease compromised before stage");

        await expect(executeSessionTransaction({
            rootWorkspace: root,
            session,
            status,
            adapter: adapter(sourceText, vi.fn(async () => undefined)),
            transition: async () => undefined,
            assertHealthy: failOnSecondCheck(compromised),
        })).rejects.toBe(compromised);

        await expect(pathExists(join(root, session.stagePath))).resolves.toBe(false);
    });

    async function nextRoot(): Promise<string> {
        const root = await mkdtemp(testHostPath("nbook-session-transaction-"));
        roots.push(root);
        return root;
    }
});

function sessionState(
    root: string,
    sourceText: string,
    currentStatus: TestStatus,
): SessionMigrationFileState<TestStatus> {
    const sourceHash = sha256(sourceText);
    return {
        sourcePath: "sessions/1.jsonl",
        backupPath: "migrations/backups/1.jsonl",
        stagePath: "migrations/stages/1.jsonl",
        rollbackPath: "migrations/rollbacks/1.jsonl",
        sourceHash,
        targetHash: sha256(`${sourceText}target`),
        changed: true,
        status: currentStatus,
    };
}

function adapter(
    sourceText: string,
    prepareArtifacts: (session: SessionMigrationFileState<TestStatus>, plan: SessionFileMigrationPlan) => Promise<void>,
): SessionFileTransactionAdapter<SessionFileMigrationPlan, SessionMigrationFileState<TestStatus>, TestStatus> {
    const plan: SessionFileMigrationPlan = {
        changed: true,
        sourceHash: sha256(sourceText),
        targetHash: sha256(`${sourceText}target`),
    };
    return {
        loadPlan: async () => plan,
        assertPlan: () => undefined,
        prepareArtifacts,
        verifyTarget: async () => undefined,
        targetText: () => `${sourceText}target`,
    };
}

function failOnSecondCheck(error: Error): () => void {
    let checks = 0;
    return () => {
        checks += 1;
        if (checks === 2) throw error;
    };
}

async function pathExists(path: string): Promise<boolean> {
    return access(path).then(() => true, () => false);
}
