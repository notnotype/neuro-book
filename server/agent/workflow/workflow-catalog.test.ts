import {mkdir, rm, stat, utimes, writeFile} from "node:fs/promises";
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

/**
 * WorkflowCatalog：双根覆盖 + workflow.ts 转译加载 + 内联编译边界。
 */
describe("WorkflowCatalog", () => {
    const root = resolve(".agent", "tmp", "workflow-catalog-test", randomUUID());
    const systemRoot = join(root, "system");
    const userRoot = join(root, "user");
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

    /** 构造一次 ProjectSession generation 捕获的结构化 Workspace。 */
    function projectWorkspaceForTest(): ResolvedProjectWorkspace {
        const workspaceRoot = absoluteFsPath(root);
        const ref = projectWorkspaceRef("project");
        return resolvedProjectWorkspace(
            ref,
            absoluteFsPath(projectRoot),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
    }

    test("双根覆盖：用户同名目录覆盖系统；目录名是稳定 key", async () => {
        await writeWorkflow(systemRoot, "alpha", "系统版");
        await writeWorkflow(systemRoot, "beta", "系统 beta");
        await writeWorkflow(userRoot, "alpha", "用户版");
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
        const items = await catalog.list();
        expect(items.map((i) => `${i.key}:${i.title}:${i.source}`)).toEqual([
            "alpha:用户版:user",
            "beta:系统 beta:system",
        ]);
        // 文件内 key 被目录名覆盖
        expect((await catalog.get("alpha"))?.def.key).toBe("alpha");
    });

    test("Project Workspace 同名目录覆盖 user/system，且项目独有 workflow 可见", async () => {
        await writeWorkflow(systemRoot, "alpha", "系统版");
        await writeWorkflow(userRoot, "alpha", "用户版");
        await writeWorkflow(join(projectRoot, ".nbook", "agent", "workflows"), "alpha", "项目版");
        await writeWorkflow(join(projectRoot, ".nbook", "agent", "workflows"), "brainstorm-opening", "开篇脑暴");
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
        const project = projectWorkspaceForTest();

        expect((await catalog.get("alpha", project))?.title).toBe("项目版");
        expect((await catalog.get("alpha", project))?.source).toBe("project");
        expect((await catalog.list(project)).map((item) => item.key)).toContain("brainstorm-opening");
        expect(await catalog.get("brainstorm-opening")).toBeNull();
    });

    test("Project workflow 不跨 ProjectSession generation 复用缓存", async () => {
        const workflowsRoot = join(projectRoot, ".nbook", "agent", "workflows");
        const entryPath = join(workflowsRoot, "generation", "workflow.ts");
        await writeWorkflow(workflowsRoot, "generation", "第一代");
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
        expect((await catalog.get("generation", projectWorkspaceForTest()))?.title).toBe("第一代");

        const timestamp = await stat(entryPath);
        await writeWorkflow(workflowsRoot, "generation", "第二代");
        await utimes(entryPath, timestamp.atime, timestamp.mtime);

        expect((await catalog.get("generation", projectWorkspaceForTest()))?.title).toBe("第二代");
    });

    test("compileInline：注入 Type 构造 JSON Schema；require 仍被拒绝", () => {
        const catalog = new WorkflowCatalog(systemRoot, userRoot);
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
        // 注意：未使用的 import 会被 TS 转译消除，必须真的使用才会触发 require 拒绝
        expect(() => catalog.compileInline(`import fs from "node:fs";\nexport default {key: "x", data: fs.constants, run: async () => 1};`))
            .toThrow(/不允许 import/);
        expect(() => catalog.compileInline(`export default {key: "x"};`)).toThrow(/run 函数/);
        expect(() => catalog.compileInline(`export default {key: "x", argsHint: [{name: "x"}], run: async () => 1};`))
            .toThrow(/argsHint/);
    });

    test("bundled 系统 workflow 均可加载，且目录元数据完整", async () => {
        const catalog = new WorkflowCatalog(resolve("assets", "workspace", ".nbook", "agent", "workflows"), join(root, "nope"));
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
