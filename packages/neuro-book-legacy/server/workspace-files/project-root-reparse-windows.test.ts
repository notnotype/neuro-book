import {mkdir, mkdtemp, rm, symlink} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectRootIdentityModule} from "nbook/server/workspace-files/project-root-identity";
import {detectWindowsProjectRootReparse} from "nbook/server/workspace-files/project-root-reparse-windows";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Project root reparse detector", () => {
    it.runIf(process.platform === "win32" && "bun" in process.versions)(
        "真实kernel attributes区分普通目录与junction",
        async () => {
            const workspaceRoot = await mkdtemp(testHostPath("nbook-project-reparse-"));
            roots.push(workspaceRoot);
            const normalRoot = path.join(workspaceRoot, "normal-root");
            const junctionRoot = path.join(workspaceRoot, "junction-root");
            await mkdir(normalRoot);
            await symlink(normalRoot, junctionRoot, "junction");

            await expect(detectWindowsProjectRootReparse(absoluteFsPath(normalRoot))).resolves.toBe(false);
            await expect(detectWindowsProjectRootReparse(absoluteFsPath(junctionRoot))).resolves.toBe(true);

            const identity = new ProjectRootIdentityModule(absoluteFsPath(workspaceRoot));
            await expect(identity.resolve(projectWorkspaceRef("junction-root"))).rejects.toMatchObject({
                code: "PROJECT_ROOT_LINK_UNSUPPORTED",
            });
        },
    );
});
