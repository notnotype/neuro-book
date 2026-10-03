import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {isRuntimeGeneratedWorkspacePath} from "nbook/server/workspace-files/runtime-generated-path";
import {scanWorkspaceTree, validateWorkspaceContentNodes} from "nbook/server/workspace-files/workspace-files";

describe("isRuntimeGeneratedWorkspacePath", () => {
    it("识别新旧 cache 与 World Engine hash 中转文件", () => {
        expect(isRuntimeGeneratedWorkspacePath("world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs")).toBe(true);
        expect(isRuntimeGeneratedWorkspacePath(".nbook/runtime-artifact-import-cache/world-engine-schema/a.mjs")).toBe(true);
        expect(isRuntimeGeneratedWorkspacePath("agent/.staging/runtime-artifact-import-cache/profile/a.mjs")).toBe(true);
        expect(isRuntimeGeneratedWorkspacePath("world-engine/.world-engine-calendar-0123456789abcdef.mjs")).toBe(true);
        expect(isRuntimeGeneratedWorkspacePath("world-engine/schema/.world-engine-schema-fedcba9876543210.ts")).toBe(true);
    });

    it("不误伤 World Engine 源码、普通 mjs 与形似文件", () => {
        expect(isRuntimeGeneratedWorkspacePath("world-engine/calendar.ts")).toBe(false);
        expect(isRuntimeGeneratedWorkspacePath("world-engine/schema/index.ts")).toBe(false);
        expect(isRuntimeGeneratedWorkspacePath("scripts/runtime.mjs")).toBe(false);
        expect(isRuntimeGeneratedWorkspacePath("docs/runtime-artifact-import-cache/README.md")).toBe(false);
        expect(isRuntimeGeneratedWorkspacePath("notes/.runtime-artifact-import-cache-guide.md")).toBe(false);
        expect(isRuntimeGeneratedWorkspacePath("world-engine/.world-engine-calendar-guide.ts")).toBe(false);
    });
});

describe("Project Workspace File Index runtime artifact 排除", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("完整扫描保留源码与 Project Config，但隐藏新旧 runtime artifact", async () => {
        const root = await fs.mkdtemp(testHostPath("nbook-runtime-path-"));
        tempRoots.push(root);
        await write(root, "world-engine/calendar.ts", "export default {};");
        await write(root, "world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs", "export {};");
        await write(root, ".nbook/config.json", "{}");
        await write(root, ".nbook/runtime-artifact-import-cache/world-engine-calendar/a.mjs", "export {};");
        await write(root, ".gitignore", [
            "!.nbook/runtime-artifact-import-cache/**",
            "!world-engine/.runtime-artifact-import-cache/**",
            "",
        ].join("\n"));

        const nodes = await scanWorkspaceTree({root: absoluteFsPath(root)});
        const paths = nodes.map((node) => node.path);

        expect(paths).toContain("world-engine/calendar.ts");
        expect(paths).toContain(".nbook/config.json");
        expect(paths.some((entry) => entry.includes("runtime-artifact-import-cache"))).toBe(false);
    });

    it("显式 target 扫描与递归校验也不能重新纳入 runtime artifact", async () => {
        const root = await fs.mkdtemp(testHostPath("nbook-runtime-target-"));
        tempRoots.push(root);
        const artifactDirectory = ".nbook/runtime-artifact-import-cache/world-engine-calendar";
        const artifactFile = `${artifactDirectory}/a.mjs`;
        await write(root, artifactFile, "export {};");
        await write(root, `${artifactDirectory}/index.md`, "---\ntitle: runtime\ntype: note\nstatus: draft\n---\n");

        const nodes = await scanWorkspaceTree({
            root: absoluteFsPath(root),
            targets: [artifactFile],
        });
        const validation = await validateWorkspaceContentNodes({
            root: absoluteFsPath(root),
            targets: [artifactDirectory],
            recursive: true,
        });
        const missingValidation = await validateWorkspaceContentNodes({
            root: absoluteFsPath(root),
            targets: [".nbook/runtime-artifact-import-cache/world-engine-schema/missing"],
            recursive: true,
        });

        expect(nodes).toEqual([]);
        expect(validation.issues).toEqual([]);
        expect(missingValidation.issues).toEqual([]);
    });
});

/** 写入扫描 fixture，并自动创建父目录。 */
async function write(root: string, relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), {recursive: true});
    await fs.writeFile(absolutePath, content, "utf-8");
}
