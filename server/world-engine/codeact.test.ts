/**
 * CodeAct Integration Tests
 *
 * 测试完整的 World Engine + CodeAct 查询流程。
 */

import {afterAll, afterEach, beforeEach, describe, expect, test} from "vitest";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {WorldEngineFacade} from "./world-engine.facade";

const createdProjects: string[] = [];

describe("CodeAct Integration", {timeout: 30_000}, () => {
    let facade: WorldEngineFacade;
    let testProjectPath: string;

    beforeEach(async () => {
        const slug = `codeact-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        testProjectPath = `workspace/${slug}`;
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), slug);

        mkdirSync(join(projectRoot, "world-engine/schema"), {recursive: true});

        writeFileSync(
            join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: CodeAct Test\nsummary: ''\n",
            "utf-8",
        );
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), zodSchemaFixture(), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/calendar.ts"), calendarFixture(), "utf-8");

        createdProjects.push(testProjectPath);
        await openProjectForTest(testProjectPath);
        facade = new WorldEngineFacade(resolveRuntimeWorkspaceRoot());
    }, 30_000);

    afterEach(async () => {
        await closeProjectForTest(testProjectPath).catch(() => undefined);
        await facade.closeProject(testProjectPath);
    }, 30_000);

    afterAll(async () => {
        for (const projectPath of createdProjects) {
            const projectRoot = join(
                resolveRuntimeWorkspaceRoot(),
                projectPath.slice("workspace/".length),
            );
            await removeProjectRoot(projectRoot);
        }
        createdProjects.splice(0);
    }, 60_000);

    test("Execute simple query with world.subject.get()", async () => {
        const createResult = await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        expect(createResult.subjectId).toBe("hero");

        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "设置英雄属性",
            patches: [
                {subjectId: "hero", path: "/name", op: "replace", value: "张三"},
                {subjectId: "hero", path: "/hp", op: "replace", value: 100},
                {subjectId: "hero", path: "/level", op: "replace", value: 1},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const hero = await world.subject.get("hero");
            return hero;
        `);

        expect(result).toEqual({
            name: "张三",
            hp: 100,
            level: 1,
            inventory: [],
        });
    });

    test("Execute batch query with world.subject.gets()", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "设置英雄属性",
            patches: [
                {subjectId: "hero", path: "/name", op: "replace", value: "张三"},
                {subjectId: "hero", path: "/hp", op: "replace", value: 100},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            return await world.subject.gets(["hero", "missing"]);
        `);

        expect(result).toEqual([
            {
                name: "张三",
                hp: 100,
                level: 1,
                inventory: [],
            },
            null,
        ]);
    });

    test("Execute query with deref", async () => {
        await facade.createSubject(testProjectPath, {
            id: "village",
            type: "location",
            name: "新手村",
            at: BigInt(1000),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "设置地点属性",
            patches: [
                {subjectId: "village", path: "/name", op: "replace", value: "新手村"},
                {subjectId: "village", path: "/description", op: "replace", value: "冒险开始的地方"},
            ],
        });

        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1002),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1003),
            title: "到达新手村",
            patches: [
                {subjectId: "hero", path: "/name", op: "replace", value: "张三"},
                {subjectId: "hero", path: "/hp", op: "replace", value: 100},
                {subjectId: "hero", path: "/level", op: "replace", value: 1},
                {subjectId: "hero", path: "/location", op: "replace", value: "subject://village"},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const hero = await world.subject.get("hero", { deref: true });
            return hero;
        `);

        expect(result).toMatchObject({
            name: "张三",
            hp: 100,
            level: 1,
            inventory: [],
            location: {
                __ref: "subject://village",
                name: "新手村",
                description: "冒险开始的地方",
            },
        });
    });

    test("findRefs 返回 JSON Pointer 路径", async () => {
        await facade.createSubject(testProjectPath, {
            id: "village",
            type: "location",
            name: "新手村",
            at: BigInt(1000),
        });
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1001),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1002),
            title: "到达新手村",
            patches: [
                {subjectId: "hero", path: "/location", op: "replace", value: "subject://village"},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            return await world.subject.findRefs("village", "character");
        `);

        expect(result).toEqual([{subjectId: "hero", attr: "/location"}]);
    });

    test("slices withPatches 返回 patchId", async () => {
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1000),
            title: "英雄登场",
            patches: [
                {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 90},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const slices = await world.slice.list({withPatches: true});
            return slices.map((slice) => ({
                title: slice.title,
                patchId: slice.patches.find((patch) => patch.path === "/hp").patchId,
            }));
        `);

        expect(result).toEqual([{title: "英雄登场", patchId: expect.any(String)}]);
    });

    test("world.slice.list 支持按 subjectIds 查询相关切面", async () => {
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1000),
            title: "双人登场",
            patches: [
                {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 90},
                {subjectId: "village", type: "location", name: "村庄", path: "/name", op: "replace", value: "村庄"},
            ],
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "英雄独行",
            patches: [
                {subjectId: "hero", path: "/level", op: "replace", value: 2},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const any = await world.slice.list({subjectIds: ["hero"], withPatches: true});
            const all = await world.slice.list({subjectIds: ["hero", "village"], subjectMode: "all"});
            const solo = any.find((slice) => slice.title === "英雄独行");
            return {
                any: any.map((slice) => slice.title).sort(),
                all: all.map((slice) => slice.title),
                soloHeroPatchCount: solo.patches.filter((patch) => patch.subjectId === "hero").length,
            };
        `);

        expect(result).toEqual({
            any: ["双人登场", "英雄独行"],
            all: ["双人登场"],
            soloHeroPatchCount: 1,
        });
    });

    test("executeCodeActWorld 删除切面后同脚本查询返回重算状态", async () => {
        const result = await facade.executeCodeActWorld(testProjectPath, `
            const first = await world.slice.write({
                time: world.time.parse("测试纪元1日 00:30:00"),
                title: "英雄受伤",
                patches: [
                    {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 50},
                ],
            });
            const second = await world.slice.write({
                time: world.time.parse("测试纪元1日 00:31:00"),
                title: "英雄恢复",
                patches: [
                    {subjectId: "hero", path: "/hp", op: "replace", value: 80},
                ],
            });
            await world.slice.delete(second.sliceId);
            const hero = await world.subject.get("hero");
            const slices = await world.slice.list({subjectIds: ["hero"]});
            return {hp: hero.hp, titles: slices.map((slice) => slice.title)};
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hp: 50,
                titles: ["英雄受伤"],
            },
            issues: [],
        });
    });

    test("calendar.ts 修改后同 facade 再读使用新内容", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        expect(await facade.parseTime(testProjectPath, "测试纪元1日 00:00:00")).toBe(0n);

        writeFileSync(join(projectRoot, "world-engine/calendar.ts"), [
            "export default {",
            "    type: 'simple',",
            "    eraBefore: '新纪元',",
            "    eraAfter: '新纪元',",
            "    baseUnit: 'second',",
            "    units: [",
            "        {name: 'minute', parent: 'second', ratio: 60},",
            "        {name: 'hour', parent: 'minute', ratio: 60},",
            "        {name: 'day', parent: 'hour', ratio: 24},",
            "    ],",
            "    format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
            "};",
            "",
        ].join("\n"), "utf-8");

        expect(await facade.parseTime(testProjectPath, "新纪元1日 00:00:00")).toBe(0n);
        await expect(facade.parseTime(testProjectPath, "测试纪元1日 00:00:00")).rejects.toThrow();
    });

    test("schema/index.ts 修改后同 facade 再读使用新内容", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        const before = await facade.getWorldSchema(testProjectPath);
        expect(before.subjectTypes.find((item) => item.type === "character")?.attrs.map((attr) => attr.name)).not.toContain("mana");

        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), zodSchemaWithManaFixture(), "utf-8");

        const after = await facade.getWorldSchema(testProjectPath);
        expect(after.subjectTypes.find((item) => item.type === "character")?.attrs.map((attr) => attr.name)).toContain("mana");
    });

    test("schema/index.ts 支持 TS-only 语法和 nbook helper，并走 runtime artifact cache", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        const oldCalendarCache = join(projectRoot, "world-engine", ".runtime-artifact-import-cache");
        const oldSchemaCache = join(projectRoot, "world-engine", "schema", ".runtime-artifact-import-cache");
        mkdirSync(join(oldCalendarCache, "world-engine-calendar"), {recursive: true});
        mkdirSync(join(oldSchemaCache, "world-engine-schema"), {recursive: true});
        writeFileSync(join(oldCalendarCache, "world-engine-calendar", "old.mjs"), "export {};\n", "utf-8");
        writeFileSync(join(oldSchemaCache, "world-engine-schema", "old.mjs"), "export {};\n", "utf-8");
        const schemaSource = [
            'import {z} from "zod";',
            'import {Ref, EmbeddingText} from "nbook/world-engine/schema";',
            "",
            "type CharacterName = string;",
            "const defaultName: CharacterName = '未命名';",
            "const tagDefaults = ['traveler'] as const;",
            "",
            "const Character = z.object({",
            "    name: z.string().default(defaultName),",
            "    location: Ref('location').optional(),",
            "    tags: z.array(z.string()).unique().default([...tagDefaults]),",
            "    memory: z.record(z.string(), EmbeddingText).default({}),",
            "    events: z.array(EmbeddingText).default([]),",
            "});",
            "const Location = z.object({name: z.string().optional()});",
            "",
            "export const WorldSchema = {",
            "    character: Character,",
            "    location: Location,",
            "} satisfies Record<string, z.ZodObject<any>>;",
            "",
        ].join("\n");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), schemaSource, "utf-8");

        const schema = await facade.getWorldSchema(testProjectPath);
        const character = schema.subjectTypes.find((item) => item.type === "character");
        expect(character?.attrs.map((attr) => attr.name)).toEqual(expect.arrayContaining(["name", "location", "tags", "memory", "events"]));

        await facade.parseTime(testProjectPath, "测试纪元1日 00:00:00");
        expect(listWorldEngineTempFiles(join(projectRoot, "world-engine"))).toEqual([]);
        expect(listWorldEngineTempFiles(join(projectRoot, "world-engine/schema"))).toEqual([]);
        expect(listWorldEngineTempFiles(join(projectRoot, ".nbook", "runtime-artifact-import-cache", ".staging"))).toEqual([]);
        expect(listRuntimeArtifactCacheFiles(projectRoot, "world-engine-calendar")).toContain(`${sourceHash(calendarFixture())}.mjs`);
        expect(listRuntimeArtifactCacheFiles(projectRoot, "world-engine-schema")).toContain(`${sourceHash(schemaSource)}.mjs`);
        expect(existsSync(oldCalendarCache)).toBe(false);
        expect(existsSync(oldSchemaCache)).toBe(false);
    });

    test("calendar.ts 使用 Project 本地相对 import 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/calendar-config.ts"), [
            "export default {",
            "    type: 'simple',",
            "    eraBefore: '拆分纪元',",
            "    eraAfter: '拆分纪元',",
            "    baseUnit: 'second',",
            "    units: [",
            "        {name: 'minute', parent: 'second', ratio: 60},",
            "        {name: 'hour', parent: 'minute', ratio: 60},",
            "        {name: 'day', parent: 'hour', ratio: 24},",
            "    ],",
            "    format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
            "};",
            "",
        ].join("\n"), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/calendar.ts"), [
            "import config from './calendar-config';",
            "export default config;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.parseTime(testProjectPath, "拆分纪元1日 00:00:00"))
            .rejects.toThrow("calendar 配置必须是单文件");
        await expect(facade.parseTime(testProjectPath, "拆分纪元1日 00:00:00"))
            .rejects.toThrow("./calendar-config");
    });

    test("schema/index.ts 使用 Project 本地相对 import 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/character.ts"), [
            'import {z} from "zod";',
            "export const Character = z.object({",
            "    name: z.string().optional(),",
            "});",
            "",
        ].join("\n"), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            "import {Character} from './character';",
            "export const WorldSchema = {character: Character} as const;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("schema 配置必须是单文件");
        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("./character");
    });

    test("schema/index.ts 使用 Project 本地 import type 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/types.ts"), [
            "export type CharacterName = string;",
            "",
        ].join("\n"), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            "import type {CharacterName} from './types';",
            "const fallbackName: CharacterName = '未命名';",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        name: z.string().default(fallbackName),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("schema 配置必须是单文件");
        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("./types");
    });

    test("schema/index.ts 使用 TS import type expression 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/types.ts"), [
            "export type CharacterName = string;",
            "",
        ].join("\n"), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            "type CharacterName = import('./types').CharacterName;",
            "const fallbackName: CharacterName = '未命名';",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        name: z.string().default(fallbackName),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("schema 配置必须是单文件");
        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("./types");
    });

    test("schema/index.ts 使用 file URL import 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        const typesPath = join(projectRoot, "world-engine/schema/types.ts");
        const typesUrl = pathToFileURL(typesPath).href;
        writeFileSync(typesPath, [
            "export type CharacterName = string;",
            "",
        ].join("\n"), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            `import type {CharacterName} from "${typesUrl}";`,
            "const fallbackName: CharacterName = '未命名';",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        name: z.string().default(fallbackName),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("不支持本地文件、绝对路径或 URL import/export");
        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("file:");
    });

    test("schema/index.ts 使用 Windows 或 POSIX 绝对路径 import 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        for (const specifier of ["C:/world-engine-helper.ts", "/world-engine-helper.ts"]) {
            writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
                'import {z} from "zod";',
                `import {Character} from "${specifier}";`,
                "export const WorldSchema = {",
                "    character: Character ?? z.object({}),",
                "} as const;",
                "",
            ].join("\n"), "utf-8");

            await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("不支持本地文件、绝对路径或 URL import/export");
            await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow(specifier);
        }
    });

    test("schema/index.ts 使用非静态 dynamic import 时加载失败", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            "const helperPath = './character';",
            "await import(helperPath);",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        name: z.string().optional(),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("动态 import/require 必须使用静态字符串");
        await expect(facade.getWorldSchema(testProjectPath)).rejects.toThrow("动态 import(<non-literal>)");
    });

    test("schema/index.ts 允许 zod 与 nbook/world-engine/schema 包级 import", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            'import {Ref, EmbeddingText} from "nbook/world-engine/schema";',
            "",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        location: Ref('location').optional(),",
            "        events: z.array(EmbeddingText).default([]),",
            "    }),",
            "    location: z.object({",
            "        name: z.string().optional(),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        const schema = await facade.getWorldSchema(testProjectPath);
        const characterAttrs = schema.subjectTypes.find((item) => item.type === "character")?.attrs.map((attr) => attr.name);
        expect(characterAttrs).toEqual(expect.arrayContaining(["location", "events"]));
    });

    test("schema/index.ts 允许 node: 内置模块 import", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), [
            'import {z} from "zod";',
            'import {basename} from "node:path";',
            "",
            "export const WorldSchema = {",
            "    character: z.object({",
            "        name: z.string().default(basename('hero.md', '.md')),",
            "    }),",
            "} as const;",
            "",
        ].join("\n"), "utf-8");

        const schema = await facade.getWorldSchema(testProjectPath);
        const characterAttrs = schema.subjectTypes.find((item) => item.type === "character")?.attrs.map((attr) => attr.name);
        expect(characterAttrs).toEqual(expect.arrayContaining(["name"]));
    });

    test("Failed code rejects", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        await expect(
            facade.executeCodeActQuery(testProjectPath, `
                const hero = await world.subject.get("hero");
                return hero.name + (;
            `),
        ).rejects.toThrow();
    });

    test("Execute query with world.subject.list()", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero1",
            type: "character",
            name: "英雄1",
            at: BigInt(1000),
        });
        await facade.createSubject(testProjectPath, {
            id: "hero2",
            type: "character",
            name: "英雄2",
            at: BigInt(1001),
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const characters = await world.subject.list("character");
            return characters;
        `);

        expect(result).toEqual([
            {id: "hero1", name: "英雄1", type: "character"},
            {id: "hero2", name: "英雄2", type: "character"},
        ]);
    });

    test("Execute query with world.time.now()", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const currentTime = world.time.now();
            return currentTime;
        `);

        expect(typeof result).toBe("bigint");
        expect(result).toBeGreaterThanOrEqual(BigInt(1000));
    });

    test("executeCodeActWorld 读写合一并统一返回 issues", async () => {
        const result = await facade.executeCodeActWorld(testProjectPath, `
            const time = world.time.parse("测试纪元1日 00:20:00");
            const written = await world.slice.write({
                time,
                title: "英雄登场",
                patches: [
                    {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 88},
                ],
            });
            const hero = await world.subject.get("hero");
            const slice = await world.slice.get(written.sliceId);
            return {
                hp: hero.hp,
                formatted: world.time.format(time),
                patchId: slice.patches.find((patch) => patch.path === "/hp").patchId,
            };
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hp: 88,
                formatted: "测试纪元1日 00:20:00",
                patchId: expect.any(String),
            },
            issues: [],
        });
    });

    test("executeCodeActWorld 支持用户提供形态的 Gregorian calendar 与基础 schema", async () => {
        const projectRoot = join(resolveRuntimeWorkspaceRoot(), testProjectPath.slice("workspace/".length));
        writeFileSync(join(projectRoot, "world-engine/calendar.ts"), userGregorianCalendarFixture(), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), userBasicSchemaFixture(), "utf-8");

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const time = world.time.parse("公元2026年6月1日 08:30");
            await world.slice.write({
                time,
                title: "用户配置 smoke",
                patches: [
                    {subjectId: "hero", type: "character", path: "/name", op: "replace", value: "用户配置主角"},
                    {subjectId: "hero", path: "/events", op: "replace", value: []},
                    {subjectId: "hero", path: "/events", op: "append", value: {text: "首次写入"}},
                ],
            });
            return {hero: await world.subject.get("hero"), formatted: world.time.format(time)};
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hero: {
                    hp: 100,
                    power_level: 0,
                    hypnosis_level: 0,
                    events: [{text: "首次写入"}],
                    name: "用户配置主角",
                },
                formatted: "公元2026年6月1日 08:30",
            },
            issues: [],
        });
    });

    test("executeCodeActWorld slice.editPatches 精确修正 patch", async () => {
        const result = await facade.executeCodeActWorld(testProjectPath, `
            const written = await world.slice.write({
                time: world.time.parse("测试纪元1日 00:21:00"),
                title: "误写 HP",
                patches: [
                    {subjectId: "hero", type: "character", name: "英雄", path: "/HP", op: "replace", value: 77},
                ],
            });
            const before = await world.slice.get(written.sliceId);
            const wrong = before.patches.find((patch) => patch.path === "/HP");
            await world.slice.editPatches(written.sliceId, [
                {patchId: wrong.patchId, set: {path: "/hp", summary: "修正 hp 路径"}},
            ]);
            const after = await world.slice.get(written.sliceId);
            const hero = await world.subject.get("hero");
            return {
                hp: hero.hp,
                beforePatchId: wrong.patchId,
                afterPatchId: after.patches.find((patch) => patch.summary === "修正 hp 路径").patchId,
                path: after.patches.find((patch) => patch.summary === "修正 hp 路径").path,
            };
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hp: 77,
                beforePatchId: expect.any(String),
                afterPatchId: expect.any(String),
                path: "/hp",
            },
            issues: [],
        });
        const data = result.data as {beforePatchId: string; afterPatchId: string};
        expect(data.afterPatchId).not.toBe(data.beforePatchId);
    });

    test("executeCodeActWorld throw 后回滚写入", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            await world.slice.write({
                time: world.time.parse("测试纪元1日 00:22:00"),
                title: "应回滚",
                patches: [
                    {subjectId: "rollback", type: "character", name: "回滚者", path: "/hp", op: "replace", value: 1},
                ],
            });
            throw new Error("主动回滚");
        `, "readwrite")).rejects.toThrow("主动回滚");

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.subject.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });

    test("executeCodeActWorld operationId 在同一事务保存结果，重试不重复执行", async () => {
        const operationId = "rp-turn:test-idempotent:world-commit";
        const first = await facade.executeCodeActWorld(testProjectPath, `
            await world.slice.write({
                time: world.time.parse("测试纪元1日 00:24:00"),
                title: "首次提交",
                patches: [
                    {subjectId: "idempotent", type: "character", name: "幂等角色", path: "/hp", op: "replace", value: 88},
                ],
            });
            return {committed: true};
        `, "readwrite", {operationId});

        const retried = await facade.executeCodeActWorld(testProjectPath, `
            throw new Error("同 operationId 不应再次执行代码");
        `, "readwrite", {operationId});

        expect(retried).toEqual(first);
        const instant = await facade.parseTime(testProjectPath, "测试纪元1日 00:24:00");
        await expect(facade.listSlices(testProjectPath, {from: instant, to: instant})).resolves.toHaveLength(1);
    });

    test("executeCodeActWorld 失败事务不会占用 operationId", async () => {
        const operationId = "rp-turn:test-retry-after-failure:world-commit";
        await expect(facade.executeCodeActWorld(testProjectPath, `
            await world.slice.write({
                time: world.time.parse("测试纪元1日 00:26:00"),
                title: "失败尝试",
                patches: [
                    {subjectId: "retryable", type: "character", name: "重试角色", path: "/hp", op: "replace", value: 1},
                ],
            });
            throw new Error("模拟提交失败");
        `, "readwrite", {operationId})).rejects.toThrow("模拟提交失败");

        const retried = await facade.executeCodeActWorld(testProjectPath, `
            await world.slice.write({
                time: world.time.parse("测试纪元1日 00:26:00"),
                title: "重试成功",
                patches: [
                    {subjectId: "retryable", type: "character", name: "重试角色", path: "/hp", op: "replace", value: 99},
                ],
            });
            return (await world.subject.get("retryable")).hp;
        `, "readwrite", {operationId});

        expect(retried.data).toBe(99);
        const instant = await facade.parseTime(testProjectPath, "测试纪元1日 00:26:00");
        const slices = await facade.listSlices(testProjectPath, {from: instant, to: instant});
        expect(slices).toHaveLength(1);
        expect(slices[0]?.title).toBe("重试成功");
    });

    test("executeCodeActWorld 同 instant 冲突后回滚事务内临时 slice", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            const time = world.time.parse("测试纪元1日 00:25:00");
            await world.slice.write({
                time,
                title: "事务内第一条",
                patches: [
                    {subjectId: "same-instant-rollback", type: "character", name: "同刻回滚", path: "/hp", op: "replace", value: 1},
                ],
            });
            await world.slice.write({
                time,
                title: "事务内第二条",
                patches: [
                    {subjectId: "same-instant-rollback", path: "/events", op: "append", value: "第二条同刻写入"},
                ],
            });
            return "不应到达";
        `, "readwrite")).rejects.toThrow("请读取 existingSliceId 并合并 patches");

        const instant = await facade.parseTime(testProjectPath, "测试纪元1日 00:25:00");
        const slices = await facade.listSlices(testProjectPath, {from: instant, to: instant, withPatches: true});

        expect(slices).toEqual([]);
    });

    test("executeCodeActWorld 超时后回滚写入", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            await world.slice.write({
                time: world.time.parse("测试纪元1日 00:23:00"),
                title: "超时回滚",
                patches: [
                    {subjectId: "timeout-rollback", type: "character", name: "超时者", path: "/hp", op: "replace", value: 1},
                ],
            });
            await new Promise((resolve) => setTimeout(resolve, 200));
            return "done";
        `, "readwrite", {timeout: 50})).rejects.toThrow("执行超时");

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.subject.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });

    test("executeCodeActWorld 超时关闭事务后后台写入不能落库", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            setTimeout(async () => {
                try {
                    await world.slice.write({
                        time: world.time.parse("测试纪元1日 00:24:00"),
                        title: "后台写入应失败",
                        patches: [
                            {subjectId: "late-timeout-write", type: "character", name: "迟到写入", path: "/hp", op: "replace", value: 1},
                        ],
                    });
                } catch {
                    // 预期：外层超时后事务已关闭，后台写入会失败。
                }
            }, 100);
            await new Promise((resolve) => setTimeout(resolve, 250));
            return "done";
        `, "readwrite", {timeout: 50})).rejects.toThrow("执行超时");

        await new Promise((resolve) => setTimeout(resolve, 250));

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.subject.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });
});

function zodSchemaFixture(): string {
    return [
        'import {z} from "zod";',
        "",
        "function Ref(targetType: string) {",
        "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
        "}",
        "",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        name: z.string().optional().describe('姓名'),",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        level: z.number().int().default(1).describe('等级'),",
        "        inventory: z.array(z.string()).default([]).describe('背包'),",
        "        location: Ref('location').optional().describe('当前位置'),",
        "    }),",
        "    location: z.object({",
        "        name: z.string().optional().describe('地点名称'),",
        "        description: z.string().optional().describe('地点描述'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function zodSchemaWithManaFixture(): string {
    return [
        'import {z} from "zod";',
        "",
        "function Ref(targetType: string) {",
        "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
        "}",
        "",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        name: z.string().optional().describe('姓名'),",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        level: z.number().int().default(1).describe('等级'),",
        "        mana: z.number().int().default(7).describe('魔力'),",
        "        inventory: z.array(z.string()).default([]).describe('背包'),",
        "        location: Ref('location').optional().describe('当前位置'),",
        "    }),",
        "    location: z.object({",
        "        name: z.string().optional().describe('地点名称'),",
        "        description: z.string().optional().describe('地点描述'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarFixture(): string {
    return [
        "export default {",
        "    type: 'simple',",
        "    eraBefore: '测试纪元',",
        "    eraAfter: '测试纪元',",
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

/** 用户报告中提供的公历 calendar 形态。 */
function userGregorianCalendarFixture(): string {
    return [
        "// 公历日历",
        "// 故事时间：2026年6月~7月，当代都市背景",
        "export default {",
        "  type: 'gregorian',",
        "  eraBefore: '公元前',",
        "  eraAfter: '公元',",
        "  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'",
        "};",
        "",
    ].join("\n");
}

/** 用户报告中提供的基础 Zod schema 形态。 */
function userBasicSchemaFixture(): string {
    return [
        'import {z} from "zod";',
        "",
        "const World = z.object({",
        "    era: z.string().default('公元'),",
        "    year: z.number().int().default(2026),",
        "    events: z.array(z.object({text: z.string()})).default([]),",
        "});",
        "",
        "const Character = z.object({",
        "    name: z.string().optional(),",
        "    age: z.number().int().optional(),",
        "    sex: z.string().optional(),",
        "    hp: z.number().int().default(100),",
        "    location: z.string().optional(),",
        "    mind: z.string().optional(),",
        "    job_title: z.string().optional(),",
        "    power_level: z.number().int().default(0),",
        "    hypnosis_level: z.number().int().default(0),",
        "    hypnotist: z.string().optional(),",
        "    faction: z.string().optional(),",
        "    events: z.array(z.object({text: z.string()})).default([]),",
        "});",
        "",
        "const Location = z.object({",
        "    name: z.string().optional(),",
        "    events: z.array(z.object({text: z.string()})).default([]),",
        "});",
        "",
        "const Faction = z.object({",
        "    name: z.string().optional(),",
        "    members: z.array(z.string()).default([]),",
        "    events: z.array(z.object({text: z.string()})).default([]),",
        "});",
        "",
        "const Item = z.object({",
        "    name: z.string().optional(),",
        "    owner: z.string().optional(),",
        "    events: z.array(z.object({text: z.string()})).default([]),",
        "});",
        "",
        "export const WorldSchema = {",
        "    world: World,",
        "    character: Character,",
        "    location: Location,",
        "    faction: Faction,",
        "    item: Item,",
        "};",
        "",
    ].join("\n");
}

async function removeProjectRoot(projectRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

function listWorldEngineTempFiles(directory: string): string[] {
    try {
        return readdirSync(directory)
            .filter((name) => /^\.world-engine-.+\.(?:ts|mjs)$/.test(name))
            .sort();
    } catch {
        return [];
    }
}

/** 计算 loader 入口内容 hash，必须与生产 loader 的 cache key 保持一致。 */
function sourceHash(source: string): string {
    return createHash("sha256").update(Buffer.from(source, "utf-8")).digest("hex").slice(0, 16);
}

/** 读取统一 runtime artifact cache 中某个 namespace 的文件列表。 */
function listRuntimeArtifactCacheFiles(projectRoot: string, namespace: string): string[] {
    try {
        return readdirSync(join(projectRoot, ".nbook", "runtime-artifact-import-cache", namespace)).sort();
    } catch {
        return [];
    }
}
