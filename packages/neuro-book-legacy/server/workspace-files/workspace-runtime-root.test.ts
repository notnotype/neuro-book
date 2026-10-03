import {mkdir, mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    resolveRuntimeWorkspaceRoot,
    resolveUserNbookRoot,
    setWorkspaceRuntimeRootContextForTest,
} from "nbook/server/workspace-files/workspace-runtime-root";

const roots: string[] = [];

afterEach(async () => {
    setWorkspaceRuntimeRootContextForTest(null);
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Workspace runtime root", () => {
    it("显式State Root不被祖先workspace目录覆盖", async () => {
        const root = await mkdtemp(testHostPath("nbook-workspace-parent-"));
        roots.push(root);
        const applicationRoot = join(root, "workspace", "portable");
        const stateRoot = join(applicationRoot, "data");
        await mkdir(stateRoot, {recursive: true});
        const previousApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
        const previousStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        try {
            expect(resolveRuntimeWorkspaceRoot(applicationRoot)).toBe(resolve(stateRoot, "workspace"));
            expect(resolveUserNbookRoot(applicationRoot)).toBe(resolve(stateRoot, "workspace", ".nbook"));
        } finally {
            restoreEnv("NEURO_BOOK_APPLICATION_ROOT", previousApplicationRoot);
            restoreEnv("NEURO_BOOK_STATE_ROOT", previousStateRoot);
        }
    });

    it("测试Adapter只覆盖用户Runtime Root", async () => {
        const root = await mkdtemp(testHostPath("nbook-runtime-root-context-"));
        roots.push(root);
        const workspaceRoot = join(root, "workspace");
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});

        expect(resolveRuntimeWorkspaceRoot(root)).toBe(workspaceRoot);
        expect(resolveUserNbookRoot(root)).toBe(join(workspaceRoot, ".nbook"));
    });
});

/** 恢复测试前的进程环境。 */
function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
