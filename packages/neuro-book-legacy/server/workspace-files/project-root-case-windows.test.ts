import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectRootIdentityModule} from "nbook/server/workspace-files/project-root-identity";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Project root case collision", () => {
    it.runIf(process.platform === "win32")(
        "真实NTFS大小写双目录共享locator并被direct resolve拒绝",
        async () => {
            const workspaceRoot = await mkdtemp(testHostPath("nbook-project-case-"));
            roots.push(workspaceRoot);
            await execFileAsync(
                "fsutil",
                ["file", "setCaseSensitiveInfo", workspaceRoot, "enable"],
                {windowsHide: true},
            );
            await mkdir(path.join(workspaceRoot, "Alpha"));
            await mkdir(path.join(workspaceRoot, "alpha"));
            expect((await readdir(workspaceRoot)).sort()).toEqual(["Alpha", "alpha"]);

            const identity = new ProjectRootIdentityModule(absoluteFsPath(workspaceRoot));
            await expect(identity.resolve(projectWorkspaceRef("ALPHA"))).rejects.toMatchObject({
                code: "PROJECT_ROOT_CASE_COLLISION",
                projectRoots: ["Alpha", "alpha"],
            });
        },
    );
});
