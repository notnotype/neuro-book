import {mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {AttachmentMigrationGate} from "nbook/server/agent/session/attachment-migration-gate";

describe("Attachment runtime lease", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("runtime 生命周期租约阻止 migration apply 取得同一 Workspace Root", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-runtime-lease-"));
        roots.push(root);
        const gate = new AttachmentMigrationGate(root);
        const releaseRuntime = gate.acquireRuntimeLeaseSync();

        await expect(gate.acquireRuntimeLease()).rejects.toMatchObject({code: "ELOCKED"});

        releaseRuntime();
        const releaseMigration = await gate.acquireRuntimeLease();
        await releaseMigration();
    });
});
