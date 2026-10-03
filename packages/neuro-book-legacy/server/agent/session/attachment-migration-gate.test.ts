import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH,
    AttachmentMigrationGate,
    AttachmentMigrationInProgressError,
} from "nbook/server/agent/session/attachment-migration-gate";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("AttachmentMigrationGate", () => {
    let root: AbsoluteFsPath;

    beforeEach(() => {
        root = absoluteFsPath(testHostPath("attachment-migration-gate-test", randomUUID()));
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("没有 sentinel 时允许写入", async () => {
        const gate = new AttachmentMigrationGate(root);

        await expect(gate.assertWritable()).resolves.toBeUndefined();
        expect(gate.lockPath).toBe(join(root, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH));
    });

    it("sentinel 存在时 fail closed，且不依赖 lock 内容", async () => {
        const gate = new AttachmentMigrationGate(root);
        await mkdir(gate.lockDirectory, {recursive: true});
        await writeFile(gate.lockPath, "not-json", "utf8");

        await expect(gate.assertWritable()).rejects.toBeInstanceOf(AttachmentMigrationInProgressError);
        await expect(gate.assertWritable()).rejects.toMatchObject({
            code: "ATTACHMENT_MIGRATION_IN_PROGRESS",
        });
    });

    it("sentinel 路径被目录占用时同样 fail closed", async () => {
        const gate = new AttachmentMigrationGate(root);
        await mkdir(gate.lockPath, {recursive: true});

        await expect(gate.assertWritable()).rejects.toBeInstanceOf(AttachmentMigrationInProgressError);
    });
});
