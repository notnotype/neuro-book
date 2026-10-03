import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {mkdir, rm, stat, utimes, writeFile, cp} from "node:fs/promises";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {afterAll, describe, expect, test} from "vitest";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";

describe("WorkflowCatalog", () => {
    const root = testHostPath("tmp", "workflow-catalog-test", randomUUID());
    const installRoot = join(root, "install");
    const projectRoot = join(root, "project");

    afterAll(async () => {
        await rm(root, {recursive: true, force: true});
    });

    async function writeWorkflow(base: string, key: string, title: string): Promise<void> {
        await mkdir(join(base, key), {recursive: true});
        await writeFile(join(base, key, "workflow.ts"), [
            `export default {`,
            `    key: "whatever-inner-key",`,
            `    title: ${JSON.stringify(title)},`,
            `    description: "测试 workflow",`,
            `    whenToUse: "测试",`,
            `    run: async (wf: any) => ({ok: true}),`,
            `};`,
        ].join("\n"), "utf8");
    }

    function projectWorkspaceForTest(): ResolvedProjectWorkspace {
        const workspaceRoot = absoluteFsPath(root);
        const ref = projectWorkspaceRef("project");
        return resolvedProjectWorkspace(
            ref,
            absoluteFsPath(projectRoot),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
    }

    test("Install 同名目录被当前 Project 整体覆盖；目录名是稳定 key", async () => {
        await writeWorkflow(installRoot, "alpha", "Install 版");
        await writeWorkflow(installRoot, "beta", "Install beta");
        await writeWorkflow(join(projectRoot, ".nbook", "agent", "workflows"), "alpha", "Project 版");
        const catalog = new WorkflowCatalog(installRoot);
        const project = projectWorkspaceForTest();
        const items = await catalog.list(project);

        expect(items.map((item) => `${item.key}:${item.title}:${item.source}`)).toEqual([
            "alpha:Project 版:project",
            "beta:Install beta:install",
        ]);
        expect((await catalog.get("alpha", project))?.def.key).toBe("alpha");
    });

    test("Project Workspace 可见独有 workflow，解绑后不可见", async () => {
        await writeWorkflow(installRoot, "alpha", "Install 版");
        await writeWorkflow(join(projectRoot, ".nbook", "agent", "workflows"), "alpha", "Project 版");
        await writeWorkflow(join(projectRoot, ".nbook", "agent", "workflows"), "brainstorm-opening", "开篇脑暴");
        const catalog = new WorkflowCatalog(installRoot);
        const project = projectWorkspaceForTest();

        expect((await catalog.get("alpha", project))?.title).toBe("Project 版");
        expect((await catalog.get("alpha", project))?.source).toBe("project");
        expect((await catalog.list(project)).map((item) => item.key)).toContain("brainstorm-opening");
        expect(await catalog.get("brainstorm-opening")).toBeNull();
    });

    test("Project workflow 不跨 ProjectSession generation 复用缓存", async () => {
        const workflowsRoot = join(projectRoot, ".nbook", "agent", "workflows");
        const entryPath = join(workflowsRoot, "generation", "workflow.ts");
        await writeWorkflow(workflowsRoot, "generation", "第一代");
        const catalog = new WorkflowCatalog(installRoot);
        const project = projectWorkspaceForTest();
        expect((await catalog.get("generation", project))?.title).toBe("第一代");

        const timestamp = await stat(entryPath);
        await writeWorkflow(workflowsRoot, "generation", "第二代");
        await utimes(entryPath, timestamp.atime, timestamp.mtime);

        expect((await catalog.get("generation", project))?.title).toBe("第二代");
    });

    test("compileInline：注入 Type 构造 JSON Schema；require 仍被拒绝", () => {
        const catalog = new WorkflowCatalog(installRoot);
        const def = catalog.compileInline(`export default {key: "adhoc", run: async () => 1};`);
        expect(def.key).toBe("adhoc");
        const typed = catalog.compileInline([
            `const outputSchema = Type.Object({answer: Type.String()}, {additionalProperties: false});`,
            `export default {key: "typed", outputSchema, run: async () => 1};`,
        ].join("\n"));
        expect(Reflect.get(typed, "outputSchema")).toMatchObject({
            type: "object",
            properties: {answer: {type: "string"}},
            additionalProperties: false,
        });
        expect(() => catalog.compileInline(`import fs from "node:fs";\nexport default {key: "x", data: fs.constants, run: async () => 1};`))
            .toThrow(/不允许 import/);
        expect(() => catalog.compileInline(`export default {key: "x"};`)).toThrow(/run 函数/);
        expect(() => catalog.compileInline(`export default {key: "x", argsHint: [{name: "x"}], run: async () => 1};`))
            .toThrow(/argsHint/);
    });

    test("bundled workflow 投影到隔离 Install Root 后可加载", async () => {
        const bundledInstallRoot = join(root, "bundled-install");
        await cp(resolve("assets", "workspace", ".nbook", "agent", "workflows"), bundledInstallRoot, {recursive: true});
        const catalog = new WorkflowCatalog(bundledInstallRoot);
        const items = await catalog.list();

        expect(items.map((item) => item.key)).toEqual(expect.arrayContaining([
            "book-deconstruct",
            "chapter-write-review-revise",
            "character-qa-fanout",
            "consistency-audit",
            "parallel-brainstorm",
            "split-book",
            "write-review-loop",
        ]));
        expect(items.every((item) => item.source === "install")).toBe(true);
        expect(items.every((item) => item.entryPath.replaceAll("\\", "/").includes("bundled-install/"))).toBe(true);

        const expectedPhases = {
            "book-deconstruct": ["collect", "analyze", "synthesize"],
            "chapter-write-review-revise": ["write", "review", "revise", "finalize"],
            "character-qa-fanout": ["fanout", "merge"],
            "consistency-audit": ["collect", "audit", "merge"],
            "parallel-brainstorm": ["fanout", "merge"],
            "split-book": ["read", "brief", "analyze"],
            "write-review-loop": ["draft", "review", "revise", "finalize"],
        };
        for (const [key, phases] of Object.entries(expectedPhases)) {
            const item = await catalog.get(key);
            expect(item, key).not.toBeNull();
            expect(item!.title, key).not.toBe(key);
            expect(item!.description, key).toBeTruthy();
            expect(item!.whenToUse, key).toBeTruthy();
            expect(item!.argsHint.length, key).toBeGreaterThan(0);
            expect(item!.def.phases?.map((phase) => phase.key), key).toEqual(phases);
            expect(typeof item!.def.run, key).toBe("function");
        }
    });
});
