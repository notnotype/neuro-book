import fs from "node:fs/promises";
import path from "node:path";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {createBuiltinTools} from "nbook/server/agent/tools";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    closeProjectForTest,
    openProjectForTest,
    removeProjectWorkspaceForTest,
} from "nbook/server/workspace-files/project-session-test-utils";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createIsolatedWorkspaceAssets,
    type IsolatedWorkspaceAssets,
} from "nbook/server/workspace-files/test-workspace-fixture";

describe("world engine agent tools", {timeout: 30_000}, () => {
    let assets: IsolatedWorkspaceAssets;
    let projectRoot: string;
    let projectDirectory: string;
    let invocationReady: ReadyProjectSessionRef;
    let context: ToolExecutionContext;

    beforeAll(async () => {
        assets = await createIsolatedWorkspaceAssets({purpose: "world-engine-tools-tests"});
    });

    beforeEach(async () => {
        projectRoot = await createProject();
        projectDirectory = path.join(resolveRuntimeWorkspaceRoot(), projectRoot);
        invocationReady = await openProjectForTest(projectRoot);
        context = {
            harness: {
                projectForInvocation: vi.fn(() => invocationReady),
            } as unknown as ToolExecutionContext["harness"],
            sessionId: 1,
            profileKey: "leader.default",
            workspaceRoot: resolveRuntimeWorkspaceRoot(),
            currentProject: invocationReady,
            invocationId: "world-engine-tools-test-invocation",
        };
    }, 30_000);

    afterEach(async () => {
        await removeProjectWorkspaceForTest(projectRoot);
    }, 30_000);

    afterAll(async () => {
        await assets.dispose();
    });

    it("内置工具注册只暴露 execute_world", () => {
        const builtinKeys = createBuiltinTools().map((tool) => tool.key);
        const worldKeys = createWorldEngineTools().map((tool) => tool.key);

        expect(worldKeys).toEqual(["execute_world"]);
        expect(builtinKeys).toContain("execute_world");
        expect(builtinKeys).not.toContain("execute_world_query");
        expect(builtinKeys).not.toContain("write_world_slice");
        expect(builtinKeys).not.toContain("delete_world_slice");
    });

    it("execute_world description 暴露当前 slice 查询和 issue 契约", () => {
        const tool = createWorldEngineTools().find((item) => item.key === "execute_world");
        const description = tool?.description ?? "";

        expect(description).toContain("current Project Workspace World Engine");
        expect(description).toContain("optional projectRoot argument");
        expect(description).toContain("subjectIds?: string[]");
        expect(description).toContain('subjectMode?: "any" | "all"');
        expect(description).toContain("title/message/explanation");
        expect(description).toContain("human-readable string summary");
        expect(description).toContain("returns attrs directly");
        expect(description).toContain("hero.hp, not hero.attrs.hp");
        expect(description).toContain("One instant can have only one slice");
        expect(description).toContain("world.slice.list({from: time, to: time, withPatches: true})");
        expect(description).toContain("world.slice.editPatches(existingSliceId, [{add:{...}}])");
        expect(description).toContain("world.slice.editPatches({add}) does not register new subjects");
        expect(description).not.toContain("specified Project Workspace World Engine");
        expect(description).not.toContain("先删除已有切面");
    });

    it("execute_world 省略 projectRoot 时复用 invocation 的当前 Project generation", async () => {
        const result = await executeWorld(context, undefined, `return "current-project";`);

        expect(result.details).toEqual({data: "current-project", issues: []});
    });

    it("execute_world 在一个脚本内写入并查询，统一返回 data 和 issues", async () => {
        const result = await executeWorld(context, projectRoot, `
            const time = world.time.parse("复兴纪元1日 00:00:10");
            const written = await world.slice.write({
                time,
                title: "城北遭遇",
                summary: "艾莉娜在城北遭遇伏击",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "increment", value: -30, summary: "伏击受伤"},
                    {subjectId: "erina", path: "/events", op: "append", value: "城北遭遇伏击", summary: "记录遭遇"},
                ],
            });
            const erina = await world.subject.get("erina");
            const slices = await world.slice.list({limit: 10, withPatches: true});
            return {written, hp: erina.hp, events: erina.events, patchId: slices[0].patches[0].patchId};
        `);

        expect(result.details).toEqual({
            data: {
                written: {sliceId: expect.any(String), issues: []},
                hp: 70,
                events: ["城北遭遇伏击"],
                patchId: expect.any(String),
            },
            issues: [],
        });
        expect(readText(result)).toContain('"hp": 70');
    });

    it("execute_world 字符串 data 直接作为工具文本返回", async () => {
        const result = await executeWorld(context, projectRoot, `
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:13"),
                title: "艾莉娜状态记录",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 70},
                ],
            });
            const erina = await world.subject.get("erina");
            return \`艾莉娜：HP \${erina.hp}\`;
        `);

        expect(result.details).toEqual({data: "艾莉娜：HP 70", issues: []});
        expect(readText(result)).toBe("艾莉娜：HP 70");
    });

    it("execute_world 字符串 data 带 issues 时保留 issue 明细", async () => {
        const result = await executeWorld(context, projectRoot, `
            const first = await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:14"),
                title: "初始生命值",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
                ],
            });
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:15"),
                title: "受伤",
                patches: [
                    {subjectId: "erina", path: "/hp", op: "increment", value: -10},
                ],
            });
            const slice = await world.slice.get(first.sliceId);
            const hpPatch = slice.patches.find((patch) => patch.path === "/hp");
            await world.slice.editPatches(first.sliceId, [
                {patchId: hpPatch.patchId, set: {value: 80}},
            ]);
            return "已修正艾莉娜初始生命值。";
        `);

        expect(readText(result)).toContain("已修正艾莉娜初始生命值。");
        expect(readText(result)).toContain("base-shifted");
        expect(result.details).toEqual({
            data: "已修正艾莉娜初始生命值。",
            issues: [expect.objectContaining({code: "base-shifted", severity: "advisory"})],
        });
    });

    it("execute_world 支持 collection 按值 remove", async () => {
        const result = await executeWorld(context, projectRoot, `
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:11"),
                title: "获得旧剑",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "old-sword"},
                    {subjectId: "erina", path: "/inventory", op: "append", value: "old-sword"},
                    {subjectId: "erina", path: "/inventory", op: "append", value: "coin"},
                ],
            });
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:12"),
                title: "交出旧剑",
                patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "old-sword"}],
            });
            const erina = await world.subject.get("erina");
            return erina.inventory;
        `);

        expect(result.details).toEqual({data: ["coin"], issues: []});
    });

    it("slice.editPatches 能精确修正已有 patch path，编辑后 patchId 失效需重读", async () => {
        const result = await executeWorld(context, projectRoot, `
            const written = await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:20"),
                title: "误写 HP",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/HP", op: "replace", value: 40, summary: "误写大写路径"},
                ],
            });
            const before = await world.slice.get(written.sliceId);
            const wrongPatch = before.patches.find((patch) => patch.path === "/HP");
            await world.slice.editPatches(written.sliceId, [
                {patchId: wrongPatch.patchId, set: {path: "/hp", summary: "修正为标准 hp 路径"}},
            ]);
            const after = await world.slice.get(written.sliceId);
            const erina = await world.subject.get("erina");
            return {
                hp: erina.hp,
                beforePatchId: wrongPatch.patchId,
                afterPatchId: after.patches.find((patch) => patch.summary === "修正为标准 hp 路径").patchId,
                path: after.patches.find((patch) => patch.summary === "修正为标准 hp 路径").path,
            };
        `);

        expect(result.details).toEqual({
            data: {
                hp: 40,
                beforePatchId: expect.any(String),
                afterPatchId: expect.any(String),
                path: "/hp",
            },
            issues: [],
        });
        const data = (result.details as {data: {beforePatchId: string; afterPatchId: string}}).data;
        expect(data.afterPatchId).not.toBe(data.beforePatchId);
    });

    it("脚本 throw 会回滚前面已经执行的写入", async () => {
        await expect(executeWorld(context, projectRoot, `
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:30"),
                title: "应回滚",
                patches: [{subjectId: "rollback", type: "character", name: "回滚者", path: "/hp", op: "replace", value: 1}],
            });
            throw new Error("主动回滚");
        `)).rejects.toThrow("主动回滚");

        const result = await executeWorld(context, projectRoot, `
            const subjects = await world.subject.list("character");
            return subjects.map((item) => item.id);
        `);
        expect(result.details).toEqual({data: [], issues: []});
    });

    it("writer profile 下 execute_world 保持只读", async () => {
        const writerContext = {...context, profileKey: "writer"};

        await expect(executeWorld(writerContext, projectRoot, `
            return typeof world.slice.write;
        `)).resolves.toMatchObject({
            details: {data: "undefined", issues: []},
        });
        await expect(executeWorld(writerContext, projectRoot, `
            await world.slice.write({
                time: world.time.parse("复兴纪元1日 00:00:40"),
                title: "writer 不应写入",
                patches: [{subjectId: "bad", type: "character", path: "/hp", op: "replace", value: 1}],
            });
        `)).rejects.toThrow();
    });

    it("execute_world 失败时保留原始错误且不在 gate 外写调试文件", async () => {
        try {
            await executeWorld(context, projectRoot, `
                const hero = await world.subject.get("erina");
                return hero.name + (;
            `);
            throw new Error("测试期望 execute_world 抛错");
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            expect(error.message).toContain("世界引擎脚本执行失败");
            expect(error.cause).toBeInstanceOf(Error);
        }
        await expect(fs.stat(path.join(projectDirectory, ".temp"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("同路径 reopen 后拒绝旧 invocation generation", async () => {
        await closeProjectForTest(projectRoot);
        const reopened = await openProjectForTest(projectRoot);
        expect(reopened).not.toBe(invocationReady);

        await expect(executeWorld(context, projectRoot, `return "不应改查新 generation";`))
            .rejects.toThrow("世界引擎脚本执行失败");
    });

    it("显式跨 Project override 的脚本执行期间持有目标 operation gate", async () => {
        const targetProjectRoot = await createProject();
        try {
            await executeWorld(context, targetProjectRoot, `return "target-warmed";`);
            const execution = executeWorld(context, targetProjectRoot, `
                await new Promise((resolve) => setTimeout(resolve, 250));
                return "target-finished";
            `);
            await new Promise((resolve) => setTimeout(resolve, 50));
            const closing = closeProjectForTest(targetProjectRoot);
            const closeState = await Promise.race([
                closing.then(() => "closed" as const),
                new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
            ]);

            expect(closeState).toBe("pending");
            await expect(execution).resolves.toMatchObject({details: {data: "target-finished"}});
            await closing;
        } finally {
            await removeProjectWorkspaceForTest(targetProjectRoot);
        }
    });
});

async function executeWorld(context: ToolExecutionContext, projectRoot: string | undefined, code: string): Promise<NeuroToolResult> {
    const tool = createWorldEngineTools().find((item) => item.key === "execute_world");
    if (!tool?.executeWithContext) {
        throw new Error("missing world engine tool: execute_world");
    }
    return tool.executeWithContext(context, "execute_world-call", {
        ...(projectRoot === undefined ? {} : {projectRoot}),
        code,
    });
}

function readText(result: NeuroToolResult): string {
    const item = result.content[0];
    if (!item || item.type !== "text") {
        throw new Error("测试期望工具返回 text content");
    }
    return item.text;
}

async function createProject(): Promise<string> {
    const slug = `world-tools-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const root = path.join(resolveRuntimeWorkspaceRoot(), slug);
    await fs.mkdir(path.join(root, "world-engine/schema"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Tools Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine/schema/index.ts"), schemaFixture(), "utf-8");
    await fs.writeFile(path.join(root, "world-engine/calendar.ts"), calendarFixture(), "utf-8");
    await openProjectForTest(slug);
    return slug;
}

function schemaFixture(): string {
    return [
        'import {z} from "zod";',
        "",
        'declare module "zod" {',
        '    interface ZodArray<T extends z.ZodTypeAny, Cardinality extends z.ArrayCardinality = "many"> {',
        "        unique(): this;",
        "    }",
        "}",
        "z.ZodArray.prototype.unique = function() {",
        "    (this as any)._def.unique = true;",
        "    return this;",
        "};",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        inventory: z.array(z.string()).unique().default([]).describe('背包'),",
        "        events: z.array(z.string()).default([]).describe('经历'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarFixture(): string {
    return [
        "export default {",
        "    type: 'simple',",
        "    eraBefore: '复兴纪元',",
        "    eraAfter: '复兴纪元',",
        "    baseUnit: 'second',",
        "    units: [",
        "        {name: 'minute', parent: 'second', ratio: 60},",
        "        {name: 'hour', parent: 'minute', ratio: 60},",
        "        {name: 'day', parent: 'hour', ratio: 24},",
        "    ],",
        "    format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
        "};",
        "",
    ].join("\n");
}
