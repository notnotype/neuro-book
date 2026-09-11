import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {RECOVERY_MATERIAL_MAX_TOTAL_TOKENS, createRecoveryMaterialTracker, materializeRecoveryMaterials, recoveryMaterialKey} from "nbook/server/agent/harness/recovery-materials";
import {estimateStoredMessageTokens} from "nbook/server/agent/messages/stored-message-tokens";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import {closeAllProjects, openProject, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("recovery materials", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;
    let project: ReadyProjectSessionRef;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = await mkdtemp(join(tmpdir(), "nbook-recovery-materials-test-"));
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        const projectRef = projectWorkspaceRef("book");
        await writeProjectManifest(workspaceRoot, projectRef, {
            kind: "novel",
            title: "Recovery Materials Test",
            summary: "",
        });
        project = await openProject(projectRef, {kind: "job", source: "recovery-materials-test"}, workspaceRoot);
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        await rm(tempRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    });

    it("合并同一文件的成功操作来源，并以最新版本作为候选", async () => {
        const path = "notes.md";
        const absolutePath = join(workspaceRoot, "book", path);
        await writeFile(absolutePath, "before\n", "utf8");
        const target = (await authorizeFileOperation({workspaceRoot, currentProject: project}, path, "read")).target;
        const tracker = createRecoveryMaterialTracker();
        const before = await stat(absolutePath);

        tracker.recordSuccess({
            target,
            source: "read",
            content: "before\n",
            mtimeMs: before.mtimeMs,
        });
        tracker.recordSuccess({
            target,
            source: "edit",
            content: "after\n",
            mtimeMs: before.mtimeMs + 1,
        });

        expect(tracker.snapshot()).toEqual([expect.objectContaining({
            path,
            projectRoot: "book",
            projectGeneration: project.generation,
            sources: ["read", "edit"],
            version: {
                size: Buffer.byteLength("after\n", "utf8"),
                mtimeMs: before.mtimeMs + 1,
                sha256: expect.any(String),
            },
            capturedText: "after\n",
        })]);
    });

    it("只注入授权且版本未变化的引用和有界正文，并去重已注入版本", async () => {
        const path = "manuscript/scene.md";
        const absolutePath = join(workspaceRoot, "book", path);
        await mkdir(join(workspaceRoot, "book", "manuscript"), {recursive: true});
        await writeFile(absolutePath, "scene body\n", "utf8");
        const target = (await authorizeFileOperation({workspaceRoot, currentProject: project}, path, "read")).target;
        const version = await stat(absolutePath);
        const tracker = createRecoveryMaterialTracker();
        tracker.recordSuccess({
            target,
            source: "read",
            content: await readFile(absolutePath, "utf8"),
            mtimeMs: version.mtimeMs,
        });

        const first = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: project,
            injectedKeys: new Set(),
        });
        expect(first.skipped).toEqual([]);
        expect(first.accepted).toHaveLength(1);
        expect(messageText(first.message as never)).toContain("book/manuscript/scene.md");
        expect(messageText(first.message as never)).toContain("scene body");

        const injectedKeys = new Set(first.accepted.map(recoveryMaterialKey));
        const duplicate = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: project,
            injectedKeys,
        });
        expect(duplicate.accepted).toEqual([]);
        expect(duplicate.message).toBeUndefined();
    });

    it("中型文本只恢复引用，最终临时消息不超过总 token 预算", async () => {
        const path = "manuscript/long-scene.md";
        const absolutePath = join(workspaceRoot, "book", path);
        await mkdir(join(workspaceRoot, "book", "manuscript"), {recursive: true});
        const content = "long scene ".repeat(8_000);
        await writeFile(absolutePath, content, "utf8");
        const target = (await authorizeFileOperation({workspaceRoot, currentProject: project}, path, "read")).target;
        const version = await stat(absolutePath);
        const tracker = createRecoveryMaterialTracker();
        tracker.recordSuccess({target, source: "read", content, mtimeMs: version.mtimeMs});

        const materialized = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: project,
            injectedKeys: new Set(),
        });

        expect(materialized.accepted).toHaveLength(1);
        expect(messageText(materialized.message as never)).toContain("book/manuscript/long-scene.md");
        expect(messageText(materialized.message as never)).not.toContain("<recovery-file");
        expect(estimateStoredMessageTokens(materialized.message as never)).toBeLessThanOrEqual(RECOVERY_MATERIAL_MAX_TOTAL_TOKENS);
    });

    it("超过哈希复核上限的当前文件不恢复", async () => {
        const path = "notes.md";
        const absolutePath = join(workspaceRoot, "book", path);
        await writeFile(absolutePath, "small\n", "utf8");
        const target = (await authorizeFileOperation({workspaceRoot, currentProject: project}, path, "read")).target;
        const version = await stat(absolutePath);
        const tracker = createRecoveryMaterialTracker();
        tracker.recordSuccess({target, source: "read", content: "small\n", mtimeMs: version.mtimeMs});
        await writeFile(absolutePath, "x".repeat(256 * 1024 + 1), "utf8");

        const materialized = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: project,
            injectedKeys: new Set(),
        });

        expect(materialized.accepted).toEqual([]);
        expect(materialized.skipped).toContainEqual({path, reason: "verification_too_large"});
    });

    it("文件版本变化、越界路径和旧 Project generation 都 fail closed", async () => {
        const path = "notes.md";
        const absolutePath = join(workspaceRoot, "book", path);
        await writeFile(absolutePath, "original\n", "utf8");
        const target = (await authorizeFileOperation({workspaceRoot, currentProject: project}, path, "read")).target;
        const version = await stat(absolutePath);
        const tracker = createRecoveryMaterialTracker();
        tracker.recordSuccess({
            target,
            source: "read",
            content: "original\n",
            mtimeMs: version.mtimeMs,
        });

        await writeFile(absolutePath, "changed after compaction\n", "utf8");
        const changed = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: project,
            injectedKeys: new Set(),
        });
        expect(changed.accepted).toEqual([]);
        expect(changed.skipped).toContainEqual({path, reason: "version_changed"});

        const escaped = await materializeRecoveryMaterials({
            candidates: [{
                ...tracker.snapshot()[0]!,
                path: "../outside.md",
            }],
            workspaceRoot,
            currentProject: project,
            injectedKeys: new Set(),
        });
        expect(escaped.accepted).toEqual([]);
        expect(escaped.skipped).toContainEqual({path: "../outside.md", reason: "authorization_failed"});

        await closeAllProjects();
        const reopened = await openProject(projectWorkspaceRef("book"), {kind: "job", source: "recovery-materials-generation-test"}, workspaceRoot);
        expect(reopened).not.toBe(project);
        const stale = await materializeRecoveryMaterials({
            candidates: tracker.snapshot(),
            workspaceRoot,
            currentProject: reopened,
            injectedKeys: new Set(),
        });
        expect(stale.accepted).toEqual([]);
        expect(stale.skipped).toContainEqual({path, reason: "project_generation_unavailable"});
    });
});
