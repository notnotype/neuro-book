import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    authorizeFileOperation,
    authorizeProcessCwd,
    type FileOperationContext,
} from "nbook/server/workspace-files/authorized-file-operation";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    closeAllProjects,
    closeProject,
    openProject,
    ProjectNotOpenError,
} from "nbook/server/runtime/product-project";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

describe("Authorized File Operation", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        for (const root of roots.splice(0)) {
            await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
        }
    });

    it("read/write/edit 共用真实路径 containment，拒绝父目录 junction 逃逸", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = join(root, "workspace");
        const outsideRoot = join(root, "outside");
        await mkdir(workspaceRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await writeFile(join(outsideRoot, "secret.md"), "secret", "utf8");
        await symlink(outsideRoot, join(workspaceRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
        const context: FileOperationContext = {
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject: null,
        };

        for (const operation of ["read", "write", "edit"] as const) {
            await expect(authorizeFileOperation(context, "escape/secret.md", operation))
                .rejects.toThrow("真实路径越过文件系统根");
        }
    });

    it("exact Current Project 失效后拒绝文件操作，ready 时允许文件与 bash cwd", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = absoluteFsPath(join(root, "workspace"));
        const ready = await openReady(workspaceRoot, "novel");
        const context: FileOperationContext = {workspaceRoot, currentProject: ready};

        await expect(authorizeFileOperation(context, "manuscript/chapter.md", "write")).resolves.toMatchObject({
            target: {
                kind: "relative",
                project: ready,
                relativePath: "manuscript/chapter.md",
            },
        });
        await expect(authorizeFileOperation(context, join(workspaceRoot, "novel", "manuscript", "chapter.md"), "read"))
            .resolves.toMatchObject({
                target: {kind: "absolute", project: ready, relativePath: "manuscript/chapter.md"},
            });
        await expect(authorizeProcessCwd(context)).resolves.toMatchObject({root: ready.workspace.root});

        await closeProject(ready.workspace.ref, "shutdown");
        await expect(authorizeFileOperation(context, "manuscript/chapter.md", "write"))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("跨 Project 路径必须捕获目标 exact ready generation", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = absoluteFsPath(join(root, "workspace"));
        const alpha = await openReady(workspaceRoot, "alpha");
        await createProjectDirectory(workspaceRoot, "beta");
        const context: FileOperationContext = {workspaceRoot, currentProject: alpha};

        await expect(authorizeFileOperation(context, "workspace/beta/lorebook/index.md", "read"))
            .rejects.toMatchObject({projectRoot: "beta"});
        const beta = await openProject(projectWorkspaceRef("beta"), {kind: "job", source: "authorized-file-operation-test"}, workspaceRoot);
        await expect(authorizeFileOperation(context, "workspace/beta/lorebook/index.md", "write"))
            .resolves.toMatchObject({
                target: {
                    kind: "project",
                    project: beta,
                    relativePath: "lorebook/index.md",
                },
            });
    });

    it("绝对路径不推断其他 Project 身份，相对路径仍不能通过链接越界", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = absoluteFsPath(join(root, "workspace"));
        const alpha = await openReady(workspaceRoot, "alpha");
        const betaRoot = join(workspaceRoot, "beta");
        await mkdir(join(betaRoot, "lorebook"), {recursive: true});
        await writeFile(join(betaRoot, "lorebook", "index.md"), "beta", "utf8");
        await symlink(betaRoot, join(alpha.workspace.root, "linked-beta"), process.platform === "win32" ? "junction" : "dir");
        const context: FileOperationContext = {workspaceRoot, currentProject: alpha};

        for (const operation of ["read", "write", "edit", "apply_patch"] as const) {
            await expect(authorizeFileOperation(context, join(betaRoot, "lorebook", "index.md"), operation))
                .resolves.toMatchObject({
                    operation,
                    target: {kind: "absolute", project: null},
                    containmentRoot: null,
                });
        }
        await expect(authorizeFileOperation(context, "linked-beta/lorebook/index.md", "read"))
            .rejects.toThrow("真实路径越过文件系统根");
    });

    it("Workspace Root control 路径不携带 Project 身份", async () => {
        const root = await temporaryRoot();
        const workspaceRoot = absoluteFsPath(join(root, "workspace"));
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});

        await expect(authorizeFileOperation(
            {workspaceRoot, currentProject: null},
            "workspace/.nbook/config.json",
            "read",
        )).resolves.toMatchObject({
            target: {
                kind: "workspace-control",
                project: null,
                relativePath: "config.json",
            },
        });
    });

    async function openReady(workspaceRoot: ReturnType<typeof absoluteFsPath>, projectRoot: string): Promise<ReadyProjectSessionRef> {
        await createProjectDirectory(workspaceRoot, projectRoot);
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        return openProject(projectWorkspaceRef(projectRoot), {kind: "job", source: "authorized-file-operation-test"}, workspaceRoot);
    }

    async function createProjectDirectory(workspaceRoot: string, projectRoot: string): Promise<void> {
        const root = join(workspaceRoot, projectRoot);
        await mkdir(root, {recursive: true});
        await writeFile(join(root, "project.yaml"), `kind: novel\ntitle: ${projectRoot}\nsummary: ''\n`, "utf8");
    }

    async function temporaryRoot(): Promise<string> {
        const root = await mkdtemp(testHostPath("nbook-authorized-file-operation-"));
        roots.push(root);
        return root;
    }
});
