import fs from "node:fs/promises";
import path from "node:path";
import {createClient} from "@libsql/client";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {
    PROJECT_PLOT_WORLD_MODULE_TOKEN,
    type ProjectPlotWorldHandle,
} from "nbook/server/plot";
import {resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {activateReadyProjectModule, requireActiveReadyProject} from "nbook/server/runtime/product-project";
import {
    openProjectForTest,
    removeProjectWorkspaceForTest,
} from "nbook/server/workspace-files/project-session-test-utils";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    createIsolatedWorkspaceAssets,
    type IsolatedWorkspaceAssets,
} from "nbook/server/workspace-files/test-workspace-fixture";

vi.unmock("nbook/server/plot");

vi.mock("h3", async () => {
    const actual = await vi.importActual<typeof import("h3")>("h3");
    return {
        ...actual,
        readBody: async (event: {body?: unknown}) => event.body,
        getQuery: (event: {query?: Record<string, unknown>}) => event.query ?? {},
    };
});

const createdProjects: string[] = [];

describe("/api/projects/plot", {timeout: 30_000}, () => {
    let assets: IsolatedWorkspaceAssets;

    beforeAll(async () => {
        assets = await createIsolatedWorkspaceAssets({purpose: "plot-api-tests"});
    });

    beforeEach(() => {
        Object.assign(globalThis, {
            defineEventHandler: (handler: unknown) => handler,
            defineRouteMeta: () => undefined,
            readBody: (event: {body?: unknown}) => event.body,
            getQuery: (event: {query?: Record<string, unknown>}) => event.query ?? {},
            createError: (input: {statusCode?: number; message?: string}) => {
                const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
                error.statusCode = input.statusCode;
                return error;
            },
        });
    }, 30_000);

    afterEach(async () => {
        for (const projectRootName of createdProjects.splice(0)) {
            await removeProjectWorkspaceForTest(projectRootName);
        }
    });

    afterAll(async () => {
        await assets.dispose();
    });

    it("GET /scenes/:sceneId/world-context 返回已解析 subject 上下文和 unresolved 占位", async () => {
        const projectRootName = await createProject();
        const {world: worldEngineFacade} = await plotWorldForProject(projectRootName);
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        await worldEngineFacade.writeSlice({
            instant: 120n,
            title: "抵达神殿",
            summary: "主角进入神殿，发现灯火昏暗。",
            patches: [
                {subjectId: "hero", type: "character", name: "主角", path: "/hp", op: "replace", value: 8},
                {subjectId: "temple", type: "location", name: "荒野神殿", path: "/light", op: "replace", value: "dim"},
            ],
        });
        await worldEngineFacade.writeSlice({
            instant: 140n,
            title: "远方商队",
            patches: [{subjectId: "merchant", type: "character", name: "商人", path: "/hp", op: "replace", value: 10}],
        });

        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "神殿相遇",
            worldAnchor: {
                startTime: "复兴纪元1日 00:01:40",
                endTime: "复兴纪元1日 00:03:20",
                startInstant: null,
                endInstant: null,
                subjectIds: ["hero", "future-ally"],
                locationSubjectId: "temple",
            },
        });

        const context = await callApi(handler, projectRootName, "GET", `scenes/${readId(scene)}/world-context`);

        expect(context).toMatchObject({
            unresolvedSubjectIds: ["future-ally"],
            slices: [
                {
                    title: "抵达神殿",
                    summary: "主角进入神殿，发现灯火昏暗。",
                    patchCount: expect.any(Number),
                },
            ],
            subjectStates: [
                {subjectId: "hero", type: "character", name: "主角", attrs: {hp: 8}},
                {subjectId: "temple", type: "location", name: "荒野神殿", attrs: {light: "dim"}},
            ],
        });
    });

    it("GET /chapter-writer-brief 返回章节 Scene / World Context brief", async () => {
        const projectRootName = await createProject();
        const {world: worldEngineFacade} = await plotWorldForProject(projectRootName);
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const chapter = await callApi(handler, projectRootName, "POST", "chapters", {
            name: "001-opening",
            title: "开篇",
            brief: {mustHide: "薇洛丝不知道项链是前作遗物"},
        });
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
            summary: "主线推进到神殿。",
            writingTip: "保持紧张。",
        });
        await worldEngineFacade.writeSlice({
            instant: 120n,
            title: "神殿灯火",
            summary: "神殿灯火变暗。",
            patches: [
                {subjectId: "hero", type: "character", name: "主角", path: "/hp", op: "replace", value: 8},
                {subjectId: "temple", type: "location", name: "荒野神殿", path: "/light", op: "replace", value: "dim"},
            ],
        });
        await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            chapterId: readId(chapter),
            title: "神殿相遇",
            summary: "主角在神殿遇到未来盟友。",
            purpose: "建立同盟关系。",
            writingTip: "突出压迫感。",
            worldAnchor: {
                startTime: "复兴纪元1日 00:01:40",
                endTime: "复兴纪元1日 00:03:20",
                startInstant: null,
                endInstant: null,
                subjectIds: ["hero"],
                locationSubjectId: "temple",
            },
        });

        const brief = await callApi(handler, projectRootName, "GET", "chapter-writer-brief", undefined, {chapterId: readId(chapter)});

        expect(brief).toMatchObject({
            chapter: {
                name: "001-opening",
                title: "开篇",
            },
            mode: "autonomous",
            status: "ready",
            totalScenes: 1,
            scenes: [
                {
                    title: "神殿相遇",
                    threadSummary: "主线推进到神殿。",
                    writingTip: "突出压迫感。",
                    worldContext: {
                        slices: [
                            {
                                title: "神殿灯火",
                            },
                        ],
                    },
                },
            ],
            suggestedBriefMarkdown: expect.stringContaining("神殿相遇"),
        });
        // autonomous 默认:只给查询提示,不展开状态切面。
        expect((brief as {suggestedBriefMarkdown: string}).suggestedBriefMarkdown).toContain("World 查询提示");
        expect((brief as {suggestedBriefMarkdown: string}).suggestedBriefMarkdown).not.toContain("神殿灯火");

        // curated:同一章展开 World Context 状态摘要,供 leader 投喂。
        const curated = await callApi(handler, projectRootName, "GET", "chapter-writer-brief", undefined, {chapterId: readId(chapter), mode: "curated"});
        expect((curated as {mode: string}).mode).toBe("curated");
        expect((curated as {suggestedBriefMarkdown: string}).suggestedBriefMarkdown).toContain("神殿灯火");
        expect((curated as {suggestedBriefMarkdown: string}).suggestedBriefMarkdown).not.toContain("\"hp\"");
    });

    it("缺 projectRoot query 时返回 400", async () => {
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;

        await expect(handler({
            method: "GET",
            path: "/api/projects/plot/story",
            query: {},
            context: {params: {segments: "story"}},
        })).rejects.toMatchObject({
            statusCode: 400,
            data: {code: "INVALID_PROJECT_ROOT"},
        });
    });

    it("未 open 的 Project 返回 PROJECT_NOT_OPEN", async () => {
        const projectRootName = await createProject({open: false});
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;

        await expect(callApi(handler, projectRootName, "GET", "story")).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectRoot: projectRootName,
            },
        });
    });

    it("非法 sceneId 返回 400", async () => {
        const projectRootName = await createProject();
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;

        await expect(callApi(handler, projectRootName, "GET", "scenes/not-a-number/world-context")).rejects.toMatchObject({
            statusCode: 400,
            message: "sceneId 必须是正整数",
        });
    });

    it("Scene 不存在时返回 404", async () => {
        const projectRootName = await createProject();
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;

        await expect(callApi(handler, projectRootName, "GET", "scenes/999/world-context")).rejects.toMatchObject({
            statusCode: 404,
            message: "剧情场景不存在",
        });
    });

    it("Scene 时间未连接时返回 400", async () => {
        const projectRootName = await createProject();
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "未定时间",
            worldAnchor: {
                startTime: null,
                endTime: null,
                startInstant: null,
                endInstant: null,
                subjectIds: ["future-hero"],
                locationSubjectId: null,
            },
        });

        await expect(callApi(handler, projectRootName, "GET", `scenes/${readId(scene)}/world-context`)).rejects.toMatchObject({
            statusCode: 400,
            message: "Scene 尚未设置完整 World Engine 时间范围",
        });
    });

    it("全部 subject 都是占位时返回空上下文和 unresolved 列表", async () => {
        const projectRootName = await createProject();
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "未来伏笔",
            worldAnchor: {
                startTime: "复兴纪元1日 00:01:40",
                endTime: "复兴纪元1日 00:03:20",
                startInstant: null,
                endInstant: null,
                subjectIds: ["future-hero"],
                locationSubjectId: "future-place",
            },
        });

        await expect(callApi(handler, projectRootName, "GET", `scenes/${readId(scene)}/world-context`)).resolves.toEqual({
            slices: [],
            subjectStates: [],
            unresolvedSubjectIds: ["future-hero", "future-place"],
        });
    });

    it("Project 缺少 calendar.ts 时 GET tree 和 workbench 仍可读取 Plot", async () => {
        const projectRootName = await createProject({withCalendar: false});
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "未来伏笔",
            worldAnchor: {
                startTime: null,
                endTime: null,
                startInstant: null,
                endInstant: null,
                subjectIds: ["future-hero"],
                locationSubjectId: "future-place",
            },
        });

        await expect(callApi(handler, projectRootName, "GET", "tree")).resolves.toMatchObject({
            ungroupedThreads: [
                {
                    scenes: [
                        {
                            id: readId(scene),
                            worldAnchor: {
                                subjects: [{id: "future-hero", name: "future-hero", type: "unknown", resolved: false}],
                                locationSubject: {id: "future-place", name: "future-place", type: "unknown", resolved: false},
                                unresolvedSubjectIds: ["future-hero", "future-place"],
                            },
                        },
                    ],
                },
            ],
        });
        await expect(callApi(handler, projectRootName, "GET", "workbench")).resolves.toMatchObject({
            ungroupedThreads: [
                {
                    scenes: [
                        {
                            id: readId(scene),
                            worldAnchor: {
                                unresolvedSubjectIds: ["future-hero", "future-place"],
                            },
                        },
                    ],
                },
            ],
        });
    });

    it("Project 缺少 calendar.ts 且 Scene 已有 raw instant 时保留 raw 时间并降级 formatted time", async () => {
        const projectRootName = await createProject({withCalendar: false});
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "旧数据 Scene",
        });
        await updateSceneRawInstants(projectRootName, readId(scene), 100n, 200n);

        await expect(callApi(handler, projectRootName, "GET", "tree")).resolves.toMatchObject({
            ungroupedThreads: [
                {
                    scenes: [
                        {
                            id: readId(scene),
                            worldAnchor: {
                                startInstant: "100",
                                endInstant: "200",
                                startTime: null,
                                endTime: null,
                            },
                        },
                    ],
                },
            ],
        });
    });

    it("calendar.ts 损坏且 Scene 需要格式化 raw instant 时继续返回配置错误", async () => {
        const projectRootName = await createProject({calendarSource: brokenCalendarSource()});
        const handler = (await import("nbook/server/api/projects/plot/[...segments]")).default;
        const thread = await callApi(handler, projectRootName, "POST", "threads", {
            name: "main",
            title: "主线",
        });
        const scene = await callApi(handler, projectRootName, "POST", "scenes", {
            threadId: readId(thread),
            title: "坏日历 Scene",
        });
        await updateSceneRawInstants(projectRootName, readId(scene), 100n, 200n);

        await expect(callApi(handler, projectRootName, "GET", "tree")).rejects.toThrow("calendar.ts 加载失败");
    });
});

async function createProject(options: {withCalendar?: boolean; calendarSource?: string; open?: boolean} = {}): Promise<string> {
    const slug = `plot-api-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectRootName = slug;
    const root = projectDirectory(projectRootName);
    await fs.mkdir(path.join(root, "world-engine", "schema"), {recursive: true});
    await fs.mkdir(path.join(root, "manuscript", "001", "001-opening"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: Plot API Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "manuscript", "001", "001-opening", "index.md"), "---\ntitle: 开篇\n---\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "schema", "index.ts"), schemaSource(), "utf-8");
    if (options.withCalendar !== false) {
        await fs.writeFile(path.join(root, "world-engine", "calendar.ts"), options.calendarSource ?? calendarSource(), "utf-8");
    }
    createdProjects.push(projectRootName);
    if (options.open !== false) {
        await openProjectForTest(projectRootName);
    }
    return projectRootName;
}

/** 取得测试Project当前generation的Plot/World lazy handle。 */
async function plotWorldForProject(projectRootName: string): Promise<ProjectPlotWorldHandle> {
    const ready = requireActiveReadyProject(projectWorkspaceRef(projectRootName));
    return activateReadyProjectModule(
        ready,
        PROJECT_PLOT_WORLD_MODULE_TOKEN,
    );
}

async function callApi(
    handler: (event: unknown) => Promise<unknown>,
    projectRootName: string,
    method: string,
    segments: string,
    body?: unknown,
    query: Record<string, unknown> = {},
): Promise<unknown> {
    return handler({
        method,
        path: `/api/projects/plot/${segments}`,
        query: {projectRoot: projectRootName, ...query},
        body,
        context: {params: {segments}},
    });
}

function readId(input: unknown): string {
    if (typeof input === "object" && input !== null && "id" in input && typeof input.id === "string") {
        return input.id;
    }
    throw new Error("测试没有拿到 id");
}

async function updateSceneRawInstants(projectRootName: string, sceneId: string, startInstant: bigint, endInstant: bigint): Promise<void> {
    const client = createClient({
        url: toSqliteFileUrl(resolveProjectDatabasePath(
            resolveRuntimeWorkspaceRoot(),
            projectWorkspaceRef(projectRootName),
        )),
    });
    try {
        await client.execute({
            sql: `UPDATE "StoryScene" SET "startInstant" = ?, "endInstant" = ? WHERE "id" = ?`,
            args: [startInstant, endInstant, Number(sceneId)],
        });
    } finally {
        client.close();
        collectReleasedSqliteHandles();
    }
}

function projectDirectory(projectRootName: string): string {
    return path.join(resolveRuntimeWorkspaceRoot(), projectRootName);
}

function schemaSource(): string {
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
        "        hp: z.number().int().default(10).describe('生命值'),",
        "    }),",
        "    location: z.object({",
        "        light: z.string().default('normal').describe('光线'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarSource(): string {
    return [
        "export default {",
        "  type: 'simple',",
        "  eraBefore: '复兴纪元',",
        "  eraAfter: '复兴纪元',",
        "  baseUnit: 'second',",
        "  units: [",
        "    {name: 'minute', parent: 'second', ratio: 60},",
        "    {name: 'hour', parent: 'minute', ratio: 60},",
        "    {name: 'day', parent: 'hour', ratio: 24},",
        "  ],",
        "  format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
        "};",
        "",
    ].join("\n");
}

function brokenCalendarSource(): string {
    return [
        "export default {",
        "  type: 'broken',",
        "};",
        "",
    ].join("\n");
}
