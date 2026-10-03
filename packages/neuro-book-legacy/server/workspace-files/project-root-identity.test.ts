import {mkdir, mkdtemp, rename, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectRootIdentityModule} from "nbook/server/workspace-files/project-root-identity";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("ProjectRootIdentityModule", () => {
    it("普通内容变化保持root identity，同路径替换会fail closed", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-identity-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "alpha");
        const movedRoot = path.join(workspaceRoot, "alpha-moved");
        await mkdir(projectRoot);
        const identity = new ProjectRootIdentityModule(absoluteFsPath(workspaceRoot));
        const resolved = await identity.resolve(projectWorkspaceRef("alpha"));

        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: \"\"\n", "utf8");
        await identity.revalidate(resolved);

        await rename(projectRoot, movedRoot);
        await mkdir(projectRoot);
        await expect(identity.revalidate(resolved)).rejects.toMatchObject({
            code: "PROJECT_ROOT_REPLACED",
        });
    });

    it("普通目录被平台检测为reparse point时拒绝建立root identity", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-identity-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "reparse-root");
        await mkdir(projectRoot);
        const reparseDetector = vi.fn(async () => true);
        const identity = new ProjectRootIdentityModule(absoluteFsPath(workspaceRoot), {reparseDetector});

        await expect(identity.resolve(projectWorkspaceRef("reparse-root"))).rejects.toMatchObject({
            code: "PROJECT_ROOT_LINK_UNSUPPORTED",
        });
        expect(reparseDetector).toHaveBeenCalledWith(absoluteFsPath(projectRoot));
    });

    it("大小写不敏感策略把同locator的多个真实拼写判为collision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-identity-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "Alpha"));
        const readDirectoryNames = vi.fn(async () => ["Alpha", "alpha"] as const);
        const identity = new ProjectRootIdentityModule(absoluteFsPath(workspaceRoot), {
            caseMode: "insensitive",
            readDirectoryNames,
        });

        await expect(identity.resolve(projectWorkspaceRef("ALPHA"))).rejects.toMatchObject({
            code: "PROJECT_ROOT_CASE_COLLISION",
            projectRoots: ["Alpha", "alpha"],
        });
        expect(readDirectoryNames).toHaveBeenCalledTimes(1);
    });
});
