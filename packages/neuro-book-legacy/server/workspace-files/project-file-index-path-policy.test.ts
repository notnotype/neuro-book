import {testAbsoluteFsPath, testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import fs from "node:fs/promises";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import {
    isIgnoredProjectFileIndexWatchPath,
    projectFileIndexAdapter,
} from "nbook/server/workspace-files/project-file-index";

describe("Project File Index watcher Path Policy", () => {
    const workspaceRoot = absoluteFsPath(testHostPath("project-file-index-policy-test"));
    const ref = projectWorkspaceRef("novel-a");
    const workspace = resolvedProjectWorkspace(
        ref,
        absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
        createProjectWorkspaceKey(workspaceRoot, ref),
    );

    it("忽略 recovery、runtime 与精确 Lifecycle temp 事件，但保留普通内容事件", () => {
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp";

        expect(isIgnoredProjectFileIndexWatchPath(
            workspace,
            ".nbook/recovery/project-manifest-original.yaml",
        )).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(
            workspace,
            "world-engine/.runtime-artifact-import-cache/world-engine-schema/cache.mjs",
        )).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(workspace, lifecycleTemp)).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(
            workspace,
            `.nbook/recovery/${lifecycleTemp}`,
        )).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(
            workspace,
            "manuscript/001-volume/001-chapter/index.md",
        )).toBe(false);
    });

    it("Chokidar检查Project root本身时不忽略，也不把空相对路径送入内容Policy", () => {
        expect(isIgnoredProjectFileIndexWatchPath(workspace, "")).toBe(false);
        expect(isIgnoredProjectFileIndexWatchPath(workspace, ".")).toBe(false);
    });

    it("继续叠加 File Index 私有的 .git/.nbook/.agent 排除", () => {
        expect(isIgnoredProjectFileIndexWatchPath(workspace, ".git/HEAD")).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(workspace, ".nbook/project.sqlite-wal")).toBe(true);
        expect(isIgnoredProjectFileIndexWatchPath(workspace, ".agent/plan/draft.md")).toBe(true);
    });

    it("Project cold snapshot与watcher共用Path Policy并保留普通内容", async () => {
        const runtimeWorkspaceRoot = await fs.mkdtemp(testHostPath("nbook-project-index-policy-"));
        const runtimeRef = projectWorkspaceRef("novel-a");
        const projectRoot = path.join(runtimeWorkspaceRoot, runtimeRef.projectRoot);
        const runtimeWorkspace = resolvedProjectWorkspace(
            runtimeRef,
            absoluteFsPath(projectRoot),
            createProjectWorkspaceKey(absoluteFsPath(runtimeWorkspaceRoot), runtimeRef),
        );
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp";
        await Promise.all([
            write(projectRoot, "project.yaml", "kind: novel\ntitle: test\nsummary: ''\n"),
            write(projectRoot, "manuscript/001-volume/001-chapter/index.md", "正文"),
            write(projectRoot, ".nbook/recovery/project-manifest-original.yaml", "broken"),
            write(projectRoot, "world-engine/.runtime-artifact-import-cache/world-engine-schema/cache.mjs", "export {};"),
            write(projectRoot, lifecycleTemp, "temporary"),
            write(projectRoot, ".nbook/config.json", "{}"),
            write(projectRoot, ".agent/plan/draft.md", "draft"),
            write(projectRoot, ".git/HEAD", "ref: refs/heads/main"),
        ]);
        const handle = projectFileIndexAdapter.startProject({
            workspace: runtimeWorkspace,
            signal: new AbortController().signal,
            onRawEvents: () => undefined,
        });

        try {
            await handle.ready;
            const snapshot = await handle.read();
            const paths = snapshot.nodes.map((node) => node.path);

            expect(paths).toContain("manuscript/001-volume/001-chapter/index.md");
            expect(paths).not.toContain(lifecycleTemp);
            expect(paths.some((entry) => entry.startsWith(".nbook/"))).toBe(false);
            expect(paths.some((entry) => entry.startsWith(".agent/"))).toBe(false);
            expect(paths.some((entry) => entry.startsWith(".git/"))).toBe(false);
            expect(paths.some((entry) => entry.includes("runtime-artifact-import-cache"))).toBe(false);
        } finally {
            await handle.close();
            await fs.rm(runtimeWorkspaceRoot, {recursive: true, force: true});
        }
    }, 15_000);

    it("plain Workspace cold snapshot不应用Project Path Policy", async () => {
        const root = await fs.mkdtemp(testHostPath("nbook-plain-index-policy-"));
        const target = {kind: "workspace-root" as const, root: absoluteFsPath(root)};
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp";
        await Promise.all([
            write(root, ".nbook/recovery/project-manifest-original.yaml", "broken"),
            write(root, ".agent/plan/draft.md", "draft"),
            write(root, lifecycleTemp, "temporary"),
            write(root, "world-engine/.runtime-artifact-import-cache/world-engine-schema/cache.mjs", "export {};"),
        ]);

        try {
            const snapshot = await projectFileIndexAdapter.readPlain(target);
            const paths = snapshot.nodes.map((node) => node.path);

            expect(paths).toContain(".nbook/recovery/project-manifest-original.yaml");
            expect(paths).toContain(".agent/plan/draft.md");
            expect(paths).toContain(lifecycleTemp);
            expect(paths.some((entry) => entry.includes("runtime-artifact-import-cache"))).toBe(false);
        } finally {
            await projectFileIndexAdapter.closePlain(target);
            await fs.rm(root, {recursive: true, force: true});
        }
    });
});

/** 写入Project scan fixture并创建父目录。 */
async function write(root: string, relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, content, "utf-8");
}
