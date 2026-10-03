import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    NODE_PROJECT_MANIFEST_ADAPTER,
    type ProjectManifestAdapter,
} from "nbook/server/workspace-files/project-lifecycle-manifest";
import {ProjectLifecycle} from "nbook/server/workspace-files/project-lifecycle";
import {ProjectLockModule, type ProjectLockAdapter} from "nbook/server/workspace-files/project-lock";
import {ProjectCoverStore} from "nbook/server/workspace-files/project-cover-store";
import {
    projectWorkspaceRef,
    type WorkspaceRelativePath,
} from "nbook/server/workspace-files/project-identity";

const roots: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("Project cover mutation", () => {
    it("按内容寻址保存原始 bytes、替换旧托管封面并发布 snapshot", async () => {
        const {workspaceRoot, projectRoot} = await createProject("replace-cover");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const firstBytes = Buffer.from("first original bytes");
            const first = await lifecycle.updateCover({
                ref: projectWorkspaceRef("replace-cover"),
                cover: {bytes: firstBytes, extension: "png"},
            });
            const firstPath = first.project.cover!;
            expect(firstPath).toMatch(/^assets\/project-covers\/[a-f0-9]{64}\.png$/u);
            expect(await fs.readFile(path.join(projectRoot, ...firstPath.split("/")))).toEqual(firstBytes);
            expect(await fs.readFile(path.join(projectRoot, "project.yaml"), "utf8"))
                .toContain(`cover: ${firstPath}`);

            const secondBytes = Buffer.from("second original bytes");
            const second = await lifecycle.updateCover({
                ref: projectWorkspaceRef("replace-cover"),
                cover: {bytes: secondBytes, extension: "webp"},
            });
            expect(second.revision).toBeGreaterThan(first.revision);
            expect(second.project.cover).toMatch(/^assets\/project-covers\/[a-f0-9]{64}\.webp$/u);
            await expect(fs.access(path.join(projectRoot, ...firstPath.split("/"))))
                .rejects.toMatchObject({code: "ENOENT"});
            expect(await managedFiles(projectRoot)).toEqual([path.basename(second.project.cover!)]);
        } finally {
            await lifecycle.close();
        }
    });

    it("相同原图幂等复用，清除后删除托管文件但不删除手工路径图片", async () => {
        const {workspaceRoot, projectRoot} = await createProject("clear-cover", "manual/cover.png");
        await fs.mkdir(path.join(projectRoot, "manual"));
        await fs.writeFile(path.join(projectRoot, "manual", "cover.png"), "manual image");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const upload = {bytes: Buffer.from("same original"), extension: "jpg" as const};
            const first = await lifecycle.updateCover({ref: projectWorkspaceRef("clear-cover"), cover: upload});
            const second = await lifecycle.updateCover({ref: projectWorkspaceRef("clear-cover"), cover: upload});

            expect(second.project.cover).toBe(first.project.cover);
            expect(await managedFiles(projectRoot)).toHaveLength(1);
            expect(await fs.readFile(path.join(projectRoot, "manual", "cover.png"), "utf8")).toBe("manual image");

            const cleared = await lifecycle.updateCover({ref: projectWorkspaceRef("clear-cover"), cover: null});
            expect(cleared.project.cover).toBeUndefined();
            expect(await managedFiles(projectRoot)).toEqual([]);
            expect(await fs.readFile(path.join(projectRoot, "manual", "cover.png"), "utf8")).toBe("manual image");
            expect(await fs.readFile(path.join(projectRoot, "project.yaml"), "utf8")).not.toContain("cover:");
        } finally {
            await lifecycle.close();
        }
    });

    it("manifest 已知未提交时回滚本次新原图", async () => {
        const {workspaceRoot, projectRoot} = await createProject("known-failure");
        const manifestAdapter: ProjectManifestAdapter = {
            ...NODE_PROJECT_MANIFEST_ADAPTER,
            rename: async (oldPath, newPath) => {
                if (path.basename(newPath) === "project.yaml") {
                    throw Object.assign(new Error("injected manifest failure"), {code: "EIO"});
                }
                await NODE_PROJECT_MANIFEST_ADAPTER.rename(oldPath, newPath);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        try {
            await expect(lifecycle.updateCover({
                ref: projectWorkspaceRef("known-failure"),
                cover: {bytes: Buffer.from("rollback me"), extension: "png"},
            })).rejects.toMatchObject({code: "PROJECT_MANIFEST_IO"});

            expect(await managedFiles(projectRoot)).toEqual([]);
            expect(await fs.readFile(path.join(projectRoot, "project.yaml"), "utf8")).not.toContain("cover:");
        } finally {
            await lifecycle.close();
        }
    });

    it("manifest rename 后门禁失败返回 unknown 并保留新旧文件", async () => {
        const {workspaceRoot, projectRoot} = await createProject("unknown-commit");
        let compromiseOccupancy: ((error: Error) => void) | null = null;
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    compromiseOccupancy = options.onCompromised;
                }
                return acquireFileLock(file, options);
            },
        };
        const manifestAdapter: ProjectManifestAdapter = {
            ...NODE_PROJECT_MANIFEST_ADAPTER,
            rename: async (oldPath, newPath) => {
                await NODE_PROJECT_MANIFEST_ADAPTER.rename(oldPath, newPath);
                if (path.basename(newPath) === "project.yaml") {
                    compromiseOccupancy?.(new Error("heartbeat lost after cover manifest rename"));
                }
            },
        };
        const lockModule = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter, lockModule});
        try {
            await expect(lifecycle.updateCover({
                ref: projectWorkspaceRef("unknown-commit"),
                cover: {bytes: Buffer.from("retain on unknown"), extension: "png"},
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "cover-update",
                phase: "publish-manifest",
                committed: "unknown",
            });

            const files = await managedFiles(projectRoot);
            expect(files).toHaveLength(1);
            expect(await fs.readFile(path.join(projectRoot, "project.yaml"), "utf8"))
                .toContain(`cover: assets/project-covers/${files[0]}`);
        } finally {
            await lifecycle.close();
        }
    });

    it("已提交后的旧文件清理失败只进入有界 diagnostics", async () => {
        const {workspaceRoot} = await createProject("cleanup-diagnostic");
        const coverStore = new ProjectCoverStore();
        vi.spyOn(coverStore, "converge").mockResolvedValue(Object.freeze([{
            path: "cleanup-diagnostic/assets/project-covers/stale.png" as WorkspaceRelativePath,
            error: Object.assign(new Error("cleanup denied"), {code: "EPERM"}),
        }]));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {coverStore});
        try {
            const result = await lifecycle.updateCover({
                ref: projectWorkspaceRef("cleanup-diagnostic"),
                cover: {bytes: Buffer.from("committed"), extension: "png"},
            });

            expect(result.project.cover).toBeDefined();
            expect(lifecycle.diagnostics.cleanupIssues).toContainEqual({
                kind: "transaction-cleanup",
                operation: "cover-update",
                target: "cover-file",
                phase: "remove",
                path: "cleanup-diagnostic/assets/project-covers/stale.png",
                code: "PROJECT_ROOT_IO",
                systemCode: "EPERM",
            });
        } finally {
            await lifecycle.close();
        }
    });
});

/** 建立带最小 manifest 的隔离 Project Workspace。 */
async function createProject(projectName: string, cover?: string): Promise<{
    workspaceRoot: string;
    projectRoot: string;
}> {
    const workspaceRoot = await fs.mkdtemp(testHostPath("nbook-project-cover-mutation-"));
    roots.push(workspaceRoot);
    const projectRoot = path.join(workspaceRoot, projectName);
    await fs.mkdir(projectRoot);
    await fs.writeFile(
        path.join(projectRoot, "project.yaml"),
        [
            "kind: novel",
            `title: ${projectName}`,
            'summary: ""',
            ...(cover ? [`cover: ${cover}`] : []),
            "",
        ].join("\n"),
        "utf8",
    );
    return {workspaceRoot, projectRoot};
}

/** 列出应用托管的正式封面文件；目录不存在时返回空。 */
async function managedFiles(projectRoot: string): Promise<string[]> {
    try {
        return (await fs.readdir(path.join(projectRoot, "assets", "project-covers"))).sort();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
