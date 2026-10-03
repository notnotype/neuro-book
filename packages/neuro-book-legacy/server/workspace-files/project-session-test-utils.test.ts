import {access, mkdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    openProjectForTest,
    removeProjectWorkspaceForTest,
} from "nbook/server/workspace-files/project-session-test-utils";
import {closeAllProjects, resetProjectSessionsForTest} from "nbook/server/runtime/product-project";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

describe("Project Session测试边界", () => {
    let tempRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = testHostPath(`nbook-project-test-utils-${randomUUID()}`);
        await mkdir(tempRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest(null);
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        await rm(tempRoot, {recursive: true, force: true});
    });

    it("未声明隔离Workspace Root时在打开Project前拒绝", async () => {
        await expect(openProjectForTest("must-not-open")).rejects.toThrow(
            "Project测试必须先设置隔离WorkspaceRuntimeRootContext",
        );
        await expect(access(join(tempRoot, "must-not-open"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("删除只作用于隔离Workspace Root内的指定Project", async () => {
        const workspaceRoot = join(tempRoot, "workspace");
        const projectRoot = join(workspaceRoot, "project");
        const outsideSentinel = join(tempRoot, "outside", "keep.txt");
        await mkdir(projectRoot, {recursive: true});
        await mkdir(join(tempRoot, "outside"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Test\nsummary: ''\n", "utf8");
        await writeFile(outsideSentinel, "keep\n", "utf8");
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});

        await expect(removeProjectWorkspaceForTest("../outside")).rejects.toThrow();
        await openProjectForTest("project");
        await removeProjectWorkspaceForTest("project");

        await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(outsideSentinel)).resolves.toBeUndefined();
    });
});
