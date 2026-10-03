import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    closeAllProjects,
    requireReadyModuleHandle,
    requireReadyProject,
    resetProjectSessionsForTest,
} from "nbook/server/runtime/product-project";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest as writeProjectManifestAtRoot} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot, setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    projectWorkspaceRef,
    resolveProjectWorkspaceRoot,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    type ProjectFileIndexHandle,
} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";
import {
    USER_LOCAL_ACTOR,
    batchWorkspacePathsTracked,
    convertWorkspaceFileToDirectoryTracked,
    createWorkspaceDirectoryTracked,
    createWorkspaceFileTracked,
    deleteWorkspacePathTracked,
    recordUploadedFiles,
    renameWorkspacePathTracked,
    writeWorkspaceTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";

/** 测试Adapter：复用当前隔离Runtime Workspace Root，不恢复生产旧resolver。 */
function resolveProjectAbsolutePath(projectRoot: string) {
    return resolveProjectWorkspaceRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot));
}

async function writeProjectManifest(projectRoot: string, manifest: Parameters<typeof writeProjectManifestAtRoot>[2]) {
    return writeProjectManifestAtRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot), manifest);
}

type OpenProjectFixture = {
    projectRoot: WorkspaceRelativePath;
    target: Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;
    history: ProjectHistoryHandle;
    fileIndex: ProjectFileIndexHandle;
};

describe("tracked-workspace-files 写面记账", () => {
    let tempRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        setHistoryEnabledOverrideForTest(true);
        tempRoot = testHostPath(`neuro-book-tracked-files-test-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: join(tempRoot, "workspace")});
        // 测试只将 Runtime Workspace Root 指到临时根，Project identity 保持单段 root。
        vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await closeAllProjects().catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    /** 建立ready Project generation并取得写面所需的精确target与History handle。 */
    async function openTempProject(slug: string): Promise<OpenProjectFixture> {
        const projectRoot = projectWorkspaceRef(slug).projectRoot;
        await writeProjectManifest(projectRoot, {kind: "novel", title: slug, summary: ""});
        await openProjectForTest(projectRoot);
        const ready = requireReadyProject(projectWorkspaceRef(projectRoot));
        const history = requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN);
        const fileIndex = requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN);
        return {
            projectRoot,
            target: {
                kind: "project-workspace",
                root: resolveProjectAbsolutePath(projectRoot),
                projectRoot,
            },
            history,
            fileIndex,
        };
    }

    it("批量复制父子选择只复制外层目录，附件字节和 History 保留，同名失败后继续", async () => {
        const project = await openTempProject("batch-copy");
        await mkdir(join(project.target.root, "source"), {recursive: true});
        await writeFile(join(project.target.root, "source", "index.md"), "saved body", "utf8");
        const attachment = Buffer.from([0, 1, 255, 4]);
        await writeFile(join(project.target.root, "source", "image.png"), attachment);
        await writeFile(join(project.target.root, "other.md"), "other", "utf8");
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({
            target: project.target, history: project.history, kind: "copy",
            sources: ["source/index.md", "source/"], destination: "copies", actor: USER_LOCAL_ACTOR,
        }));
        expect(result).toEqual([{source: "source", target: "copies/source", status: "success"}]);
        expect(await readFile(join(project.target.root, "copies/source/index.md"), "utf8")).toBe("saved body");
        expect(await readFile(join(project.target.root, "copies/source/image.png"))).toEqual(attachment);
        const history = (await project.history.history)!;
        expect((await history.timeline("copies/source/index.md")).map(item => item.entry.operation.type)).toEqual(["file.create"]);
        const repeated = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({
            target: project.target, history: project.history, kind: "copy",
            sources: ["source/", "other.md"], destination: "copies", actor: USER_LOCAL_ACTOR,
        }));
        expect(repeated.map(item => item.status)).toEqual(["failed", "success"]);
        expect(await readFile(join(project.target.root, "copies/other.md"), "utf8")).toBe("other");
    });

    it("批量移动保留文件 rename 时间线且移除源目录项", async () => {
        const project = await openTempProject("batch-move");
        await createWorkspaceFileTracked({target: project.target, history: project.history,
            filePath: "source/index.md", content: "move body", actor: USER_LOCAL_ACTOR});
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({
            target: project.target, history: project.history, kind: "move",
            sources: ["source/"], destination: "moved", actor: USER_LOCAL_ACTOR,
        }));
        expect(result).toEqual([{source: "source", target: "moved/source", status: "success"}]);
        await expect(readFile(join(project.target.root, "source/index.md"))).rejects.toMatchObject({code: "ENOENT"});
        expect(await readFile(join(project.target.root, "moved/source/index.md"), "utf8")).toBe("move body");
        const history = (await project.history.history)!;
        expect((await history.timeline("moved/source/index.md", {followRenames: true})).map(item => item.entry.operation.type))
            .toEqual(["file.create", "file.rename"]);
    });

    it("批次物理绑定失效后保留已完成项并停止剩余项", async () => {
        const project = await openTempProject("batch-invalid");
        await writeFile(join(project.target.root, "first.md"), "first");
        await writeFile(join(project.target.root, "second.md"), "second");
        let valid = true;
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({
            target: project.target, history: project.history, kind: "copy",
            sources: ["first.md", "second.md"], destination: "copies", actor: USER_LOCAL_ACTOR,
            revalidateTarget: async () => {
                if (!valid) throw new Error("root replaced");
                valid = false;
            },
        }));
        expect(result.map(item => [item.status, item.stopReason])).toEqual([["success", undefined], ["not-executed", "binding"]]);
        expect(await readFile(join(project.target.root, "copies/first.md"), "utf8")).toBe("first");
        await expect(readFile(join(project.target.root, "copies/second.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("同路径来源被替换后拒绝该项，仍处理独立项", async () => {
        const project = await openTempProject("batch-source-replaced");
        const first = join(project.target.root, "first.md");
        await writeFile(first, "old");
        await writeFile(join(project.target.root, "second.md"), "second");
        const original = await stat(first);
        await rename(first, join(project.target.root, "original.md"));
        await writeFile(first, "new");
        const second = await stat(join(project.target.root, "second.md"));
        const identity = (stat: typeof original) => ({dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs, size: stat.size});
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({target: project.target, history: project.history,
            kind: "move", sources: ["first.md", "second.md"], destination: "moved", actor: USER_LOCAL_ACTOR,
            expectedSources: {"first.md": identity(original), "second.md": identity(second)},
        }));
        expect(result.map(item => item.status)).toEqual(["failed", "success"]);
        await expect(readFile(first, "utf8")).resolves.toBe("new");
        await expect(readFile(join(project.target.root, "moved/second.md"), "utf8")).resolves.toBe("second");
    });

    it("Storage 授权失败停止后续项并标明原因", async () => {
        const project = await openTempProject("batch-authorization");
        await writeFile(join(project.target.root, "safe.md"), "safe");
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({target: project.target, history: project.history,
            kind: "copy", sources: [".nbook/storage/records", "safe.md"], destination: "copies", actor: USER_LOCAL_ACTOR,
        }));
        expect(result.map(item => [item.status, item.stopReason])).toEqual([["failed", "authorization"], ["not-executed", "authorization"]]);
        await expect(readFile(join(project.target.root, "copies/safe.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("部分复制失败保留残留文件及其创建历史", async () => {
        const project = await openTempProject("batch-partial");
        await mkdir(join(project.target.root, "source"));
        await mkdir(join(project.target.root, "linked-target"));
        await writeFile(join(project.target.root, "source", "a.md"), "copied before failure");
        await symlink(join(project.target.root, "linked-target"), join(project.target.root, "source", "z-link"), process.platform === "win32" ? "junction" : "dir");
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({
            target: project.target, history: project.history, kind: "copy",
            sources: ["source"], destination: "copies", actor: USER_LOCAL_ACTOR,
        }));
        expect(result[0]?.status).toBe("failed");
        expect(result[0]?.residualPaths).toContain("copies/source/a.md");
        expect(await readFile(join(project.target.root, "copies/source/a.md"), "utf8")).toBe("copied before failure");
        const history = (await project.history.history)!;
        expect((await history.timeline("copies/source/a.md")).map(item => item.entry.operation.type)).toEqual(["file.create"]);
    });

    it("目录复制残留的History句柄异常不丢失逐项结果", async () => {
        const project = await openTempProject("batch-partial-history");
        await mkdir(join(project.target.root, "source"));
        await mkdir(join(project.target.root, "linked-target"));
        await writeFile(join(project.target.root, "source", "a.md"), "retained");
        await writeFile(join(project.target.root, "other.md"), "other");
        await symlink(join(project.target.root, "linked-target"), join(project.target.root, "source", "z-link"), process.platform === "win32" ? "junction" : "dir");
        const brokenHistory = {...project.history, waitForWarmup: async () => {throw new Error("history unavailable");}};
        const result = await project.fileIndex.mutate(() => batchWorkspacePathsTracked({target: project.target, history: brokenHistory,
            kind: "copy", sources: ["source", "other.md"], destination: "copies", actor: USER_LOCAL_ACTOR,
        }));
        expect(result[0]).toMatchObject({status: "failed", residualPaths: expect.arrayContaining(["copies/source/a.md"])});
        expect(result[1]).toMatchObject({source: "other.md", status: "success"});
        await expect(readFile(join(project.target.root, "copies/source/a.md"), "utf8")).resolves.toBe("retained");
        await expect(readFile(join(project.target.root, "copies/other.md"), "utf8")).resolves.toBe("other");
    });

    it("写文件：首写补 before 建 create 账，二写复用 knownBefore 记 edit", async () => {
        const project = await openTempProject("write");
        await writeWorkspaceTextFileTracked({
            target: project.target, history: project.history, filePath: "manuscript/ch1.md",
            content: "正文 v1", actor: USER_LOCAL_ACTOR,
        });
        // 冲突检测路径：调用方已读到旧内容，作为 knownBefore 传入（不再读盘）
        await writeWorkspaceTextFileTracked({
            target: project.target, history: project.history, filePath: "manuscript/ch1.md",
            content: "正文 v2", actor: USER_LOCAL_ACTOR, knownBefore: "正文 v1",
        });

        const history = (await project.history.history)!;
        const timeline = await history.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.edit"]);
        expect(timeline[1]!.entry.actor).toEqual(USER_LOCAL_ACTOR);
        expect(timeline[1]!.bodyAvailable).toEqual({before: true, after: true});
    });

    it("convert 文件转目录 = 一条 rename：时间线跨转换连续", async () => {
        const project = await openTempProject("convert");
        await createWorkspaceFileTracked({target: project.target, history: project.history, filePath: "lorebook/hero.md", content: "英雄设定", actor: USER_LOCAL_ACTOR});
        await convertWorkspaceFileToDirectoryTracked({target: project.target, history: project.history, filePath: "lorebook/hero.md", actor: USER_LOCAL_ACTOR});

        const history = (await project.history.history)!;
        const timeline = await history.timeline("lorebook/hero/index.md", {followRenames: true});
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.rename"]);
        expect(timeline[0]!.pathAtThatTime).toBe("lorebook/hero.md");
        // 旧路径不算删除（活在新名下）
        expect(await history.deletedFiles()).toEqual([]);
    });

    it("目录 rename 展开为目录内逐文件 rename", async () => {
        const project = await openTempProject("rename-dir");
        await createWorkspaceFileTracked({target: project.target, history: project.history, filePath: "lorebook/npc/a.md", content: "甲", actor: USER_LOCAL_ACTOR});
        await createWorkspaceFileTracked({target: project.target, history: project.history, filePath: "lorebook/npc/b.md", content: "乙", actor: USER_LOCAL_ACTOR});
        await project.fileIndex.mutate(() => renameWorkspacePathTracked({
            target: project.target,
            history: project.history,
            fromPath: "lorebook/npc",
            toPath: "lorebook/cast",
            actor: USER_LOCAL_ACTOR,
        }));

        const history = (await project.history.history)!;
        for (const name of ["a.md", "b.md"]) {
            const timeline = await history.timeline(`lorebook/cast/${name}`, {followRenames: true});
            expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.rename"]);
        }
    });

    it("目录删除展开为逐文件 delete：before 快照可找回", async () => {
        const project = await openTempProject("delete-dir");
        await createWorkspaceFileTracked({target: project.target, history: project.history, filePath: "lorebook/npc/a.md", content: "正文A", actor: USER_LOCAL_ACTOR});
        await createWorkspaceFileTracked({target: project.target, history: project.history, filePath: "lorebook/npc/b.md", content: "正文B", actor: USER_LOCAL_ACTOR});
        await deleteWorkspacePathTracked({target: project.target, history: project.history, filePath: "lorebook/npc", recursive: true, actor: USER_LOCAL_ACTOR});

        const history = (await project.history.history)!;
        expect((await history.deletedFiles()).map((f) => f.path).sort()).toEqual(["lorebook/npc/a.md", "lorebook/npc/b.md"]);

        const timeline = await history.timeline("lorebook/npc/a.md");
        const last = timeline[timeline.length - 1]!;
        expect(last.entry.operation.type).toBe("file.delete");
        if (last.entry.operation.type !== "file.delete") {
            throw new Error("unreachable");
        }
        const body = await history.snapshotBody(last.entry.operation.beforeHash);
        expect(new TextDecoder().decode(body!)).toBe("正文A");
    });

    it("createDirectory 附带 index 内容记账（目录本身不是账面对象）", async () => {
        const project = await openTempProject("mkdir");
        await createWorkspaceDirectoryTracked({target: project.target, history: project.history, dirPath: "lorebook/组织", indexContent: "# 组织", actor: USER_LOCAL_ACTOR});

        const history = (await project.history.history)!;
        const timeline = await history.timeline("lorebook/组织/index.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create"]);
    });

    it("upload 记账：仅 written 入账，二进制自动降级 hash-only", async () => {
        const project = await openTempProject("upload");
        const absoluteRoot = project.target.root;
        await mkdir(join(absoluteRoot, "upload"), {recursive: true});
        await writeFile(join(absoluteRoot, "upload", "a.md"), "文本内容", "utf-8");
        await writeFile(join(absoluteRoot, "upload", "b.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));

        await recordUploadedFiles({
            target: project.target,
            history: project.history,
            files: [
                {path: "upload/a.md", size: 12, action: "written"},
                {path: "upload/b.png", size: 4, action: "written"},
                {path: "upload/skip.md", size: 2, action: "skipped"},
            ],
            actor: USER_LOCAL_ACTOR,
        });

        const history = (await project.history.history)!;
        const textTimeline = await history.timeline("upload/a.md");
        expect(textTimeline).toHaveLength(1);
        expect(textTimeline[0]!.bodyAvailable.after).toBe(true);
        // 含 NUL 字节 → 模块只记 hash 行，不存 body
        const binaryTimeline = await history.timeline("upload/b.png");
        expect(binaryTimeline).toHaveLength(1);
        expect(binaryTimeline[0]!.bodyAvailable.after).toBe(false);
        expect(await history.timeline("upload/skip.md")).toHaveLength(0);
    });
});
