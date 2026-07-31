import {afterAll, afterEach, describe, expect, it} from "vitest";
import {createClient} from "@libsql/client";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import type {JsonValue} from "nbook/server/world-engine/types";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {resolveProjectDatabasePath, resolveProjectRpWorldDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

const createdProjects: string[] = [];
const createdFacades: WorldEngineFacade[] = [];

describe("WorldEngineFacade", {timeout: 30_000}, () => {
    afterEach(cleanupCreatedProjects, 30_000);
    afterAll(cleanupCreatedProjects, 30_000);

    it("未 open 的 Project 拒绝创建 World Engine client", async () => {
        const projectPath = await createProject(undefined, {open: false});
        const facade = createFacade();

        await expect(facade.listSubjects(projectPath)).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("首写自动创建 subject，并应用 schema default 与 4-op patch", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const result = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            summary: "艾莉娜在祭坛醒来并拿到旧剑",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 80},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "increment", value: -20},
                {subjectId: "erina", path: "/events", op: "append", value: "在祭坛醒来"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "events", "inventory"]});
        const subjects = await facade.listSubjects(projectPath);
        const slice = await facade.getSlice(projectPath, result.sliceId);
        const slices = await facade.listSlices(projectPath);

        expect(result.issues).toEqual([]);
        expect(slice.summary).toBe("艾莉娜在祭坛醒来并拿到旧剑");
        expect(slices.find((item) => item.id === result.sliceId)?.summary).toBe("艾莉娜在祭坛醒来并拿到旧剑");
        expect(subjects).toEqual(expect.arrayContaining([
            {id: "erina", type: "character", name: "艾莉娜"},
            {id: "old-sword", type: "item", name: "旧剑"},
        ]));
        expect(state.subjects[0]?.attrs).toEqual({
            hp: 80,
            events: ["在祭坛醒来"],
            inventory: ["subject://old-sword"],
        });
    });

    it("worldKey=rp 使用独立世界线：惰性建库、数据与 main 完全隔离、同 instant 互不冲突", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        // rp 世界线的 schema/calendar 配置根独立于写作模式：rp/world-engine/
        await writeRpWorldConfig(projectPath);

        // main 世界线写入
        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "写作模式事件",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 90}],
        });

        // rp 库文件此时尚未创建
        const rpDatabasePath = resolveProjectRpWorldDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath);
        await expect(fs.access(rpDatabasePath)).rejects.toBeTruthy();

        // rp 世界线写入：同 instant、同 subjectId，互不冲突
        const rpResult = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "RP 模式事件",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜(RP)", path: "/hp", op: "replace", value: 55}],
        }, "rp");
        expect(rpResult.issues).toEqual([]);
        await expect(fs.access(rpDatabasePath)).resolves.toBeUndefined();

        // 各自世界线只看到自己的数据
        const mainState = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]});
        const rpState = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp"]}, "rp");
        expect(mainState.subjects[0]?.attrs.hp).toBe(90);
        expect(rpState.subjects[0]?.attrs.hp).toBe(55);

        const mainSlices = await facade.listSlices(projectPath);
        const rpSlices = await facade.listSlices(projectPath, {}, "rp");
        expect(mainSlices.map((slice) => slice.title)).toEqual(["写作模式事件"]);
        expect(rpSlices.map((slice) => slice.title)).toEqual(["RP 模式事件"]);

        const mainSubjects = await facade.listSubjects(projectPath);
        const rpSubjects = await facade.listSubjects(projectPath, {}, "rp");
        expect(mainSubjects.find((subject) => subject.id === "erina")?.name).toBe("艾莉娜");
        expect(rpSubjects.find((subject) => subject.id === "erina")?.name).toBe("艾莉娜(RP)");

        // CodeAct 沙盒同样按世界线隔离
        const codeActResult = await facade.executeCodeActWorld(projectPath, "const s = await world.subject.get(\"erina\"); return s.hp;", "readonly", {worldKey: "rp"});
        expect(codeActResult.data).toBe(55);
        expect(typeof codeActResult.instant).toBe("bigint");
    });

    it("worldKey=rp 缺少 rp/world-engine 配置根时明确报错，不回退写作模式配置", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.listSlices(projectPath, {}, "rp")).rejects.toThrow();
        // main 世界线不受影响
        await expect(facade.listSlices(projectPath)).resolves.toEqual([]);
    });

    it("世界状态只有在 schema 与 calendar 真实加载成功后才标记 initialized", async () => {
        const projectPath = await createProject();
        const facade = createFacade();
        const missing = await facade.getWorldStatus(projectPath, "rp");
        expect(missing).toMatchObject({initialized: false, missing: ["rp/world-engine/schema/index.ts", "rp/world-engine/calendar.ts"], errors: []});

        const rpConfigRoot = path.join(projectRoot(projectPath), "rp", "world-engine");
        await fs.mkdir(path.join(rpConfigRoot, "schema"), {recursive: true});
        await fs.writeFile(path.join(rpConfigRoot, "schema", "index.ts"), "import {z} from 'zod'; export const Character = z.object({name: z.string()});\n", "utf-8");
        await fs.writeFile(path.join(rpConfigRoot, "calendar.ts"), "export const CALENDAR_CONFIG = {};\n", "utf-8");
        const invalid = await facade.getWorldStatus(projectPath, "rp");
        expect(invalid.initialized).toBe(false);
        expect(invalid.errors.map((error) => error.path)).toEqual(["rp/world-engine/schema/index.ts", "rp/world-engine/calendar.ts"]);

        await writeRpWorldConfig(projectPath);
        await expect(facade.getWorldStatus(projectPath, "rp")).resolves.toMatchObject({initialized: true, missing: [], errors: []});
    });

    it("同 instant 写入冲突提示合并 patches", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
            ],
        });

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "同刻补充地点",
            patches: [
                {subjectId: "erina", path: "/events", op: "append", value: "同一时刻补充地点登记"},
            ],
        })).rejects.toThrow("请读取 existingSliceId 并合并 patches");
    });

    it("editSlice 移动到已有 instant 时提示合并 patches", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
            ],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "艾莉娜观察祭坛",
            patches: [
                {subjectId: "erina", path: "/events", op: "append", value: "观察祭坛"},
            ],
        });

        await expect(facade.editSlice(projectPath, first.sliceId, {
            instant: 20n,
            title: "移动到已占用时间",
            patches: [
                {subjectId: "erina", path: "/hp", op: "replace", value: 100},
            ],
        })).rejects.toThrow("请读取 existingSliceId 并合并 patches");
    });

    it("createSubject 初始化撞上非 init slice 时提示显式合并初始化 patches", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "普通事件切面",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
            ],
        });

        await expect(facade.createSubject(projectPath, {
            id: "moran",
            type: "character",
            name: "莫兰",
            at: 10n,
        })).rejects.toThrow("请读取 existingSliceId 并显式合并初始化 patches");
    });

    it("EmbeddingText 空容器 default 能初始化后继续写入单条内容", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        const result = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: {text: "在祭坛醒来"}},
                {subjectId: "erina", path: "/memory/师门", op: "replace", value: {text: "她信任师门留下的线索"}},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["events", "memory"]});
        const slice = await facade.getSlice(projectPath, result.sliceId);

        expect(result.issues).toEqual([]);
        expect(state.subjects[0]?.attrs).toEqual({
            events: [{text: "在祭坛醒来"}],
            memory: {"师门": {text: "她信任师门留下的线索"}},
        });
        expect(slice.patches).toEqual(expect.arrayContaining([
            expect.objectContaining({path: "/events", op: "replace", value: []}),
            expect.objectContaining({path: "/memory", op: "replace", value: {}}),
            expect.objectContaining({path: "/events", op: "append", value: {text: "在祭坛醒来"}}),
            expect.objectContaining({path: "/memory/师门", op: "replace", value: {text: "她信任师门留下的线索"}}),
        ]));
    });

    it("EmbeddingText 非空整块 replace 仍被拒绝", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        const input = {
            instant: 10n,
            title: "错误整块写入经历",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "replace", value: [{text: "在祭坛醒来"}]},
            ],
        };
        await expect(facade.writeSlice(projectPath, input)).rejects.toThrow("embedding 字段 /events 禁止整块 replace");

        let thrown: unknown;
        try {
            await facade.writeSlice(projectPath, input);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toMatchObject({
            data: {
                code: "embedding-whole-replace",
                label: "E5",
                severity: "error",
                title: expect.any(String),
                explanation: expect.objectContaining({
                    whatHappened: expect.any(String),
                    whyItMatters: expect.any(String),
                    suggestedAction: expect.any(String),
                }),
            },
        });
    });

    it("EmbeddingText 单条写入拒绝手写 vector/model", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误手写 vector",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: {text: "在祭坛醒来", vector: [0.1, 0.2]}},
            ],
        })).rejects.toThrow("vector");

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误手写 model",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/memory/师门", op: "replace", value: {text: "她信任师门", model: "manual"}},
            ],
        })).rejects.toThrow("model");
    });

    it("EmbeddingText 单条写入必须是唯一 text 非空字符串", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();
        const invalidEventValues: JsonValue[] = [
            {},
            {text: 123},
            {text: ""},
            {text: "   "},
            {text: "在祭坛醒来", source: "manual"},
        ];

        for (const [index, value] of invalidEventValues.entries()) {
            await expect(facade.writeSlice(projectPath, {
                instant: BigInt(20 + index),
                title: "错误 EmbeddingText events 写入",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value},
                ],
            })).rejects.toThrow("只接受 {text:");
        }

        await expect(facade.writeSlice(projectPath, {
            instant: 40n,
            title: "错误 EmbeddingText memory 写入",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/memory/师门", op: "replace", value: {}},
            ],
        })).rejects.toThrow("只接受 {text:");
    });

    it("EmbeddingText 拒绝通过内部路径绕过托管字段", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "初始化经历与记忆",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: {text: "在祭坛醒来"}},
                {subjectId: "erina", path: "/memory/师门", op: "replace", value: {text: "她信任师门"}},
            ],
        });

        await expect(facade.writeSlice(projectPath, {
            instant: 11n,
            title: "错误改写 events 内部元素",
            patches: [
                {subjectId: "erina", path: "/events/0", op: "replace", value: {text: "改写经历", vector: [0.1, 0.2]}},
            ],
        })).rejects.toThrow("EmbeddingText array 字段 /events 只支持");

        await expect(facade.writeSlice(projectPath, {
            instant: 12n,
            title: "错误改写 memory vector",
            patches: [
                {subjectId: "erina", path: "/memory/师门/vector", op: "replace", value: [0.1, 0.2]},
            ],
        })).rejects.toThrow("EmbeddingText record 字段 /memory 的真实文本必须按 key");
    });

    it("已有 subject 缺少数组基准时 append 自动插入显式 replace 空数组", async () => {
        const projectPath = await createProject(optionalListSchemaSource());
        const facade = createFacade();

        await facade.listSubjects(projectPath);
        await insertRawWorldSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜"});
        const firstAppend = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "补第一条笔记",
            patches: [{subjectId: "erina", path: "/notes", op: "append", value: "第一次记录"}],
        });
        const secondAppend = await facade.writeSlice(projectPath, {
            instant: 30n,
            title: "补第二条笔记",
            patches: [{subjectId: "erina", path: "/notes", op: "append", value: "第二次记录"}],
        });
        const firstSlice = await facade.getSlice(projectPath, firstAppend.sliceId);
        const secondSlice = await facade.getSlice(projectPath, secondAppend.sliceId);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["notes"]});

        expect(firstAppend.issues).toEqual([]);
        expect(firstSlice.patches.map((patch) => ({path: patch.path, op: patch.op, value: patch.value}))).toEqual([
            {path: "/notes", op: "replace", value: []},
            {path: "/notes", op: "append", value: "第一次记录"},
        ]);
        expect(secondSlice.patches.map((patch) => ({path: patch.path, op: patch.op, value: patch.value}))).toEqual([
            {path: "/notes", op: "append", value: "第二次记录"},
        ]);
        expect(state.subjects[0]?.attrs).toEqual({notes: ["第一次记录", "第二次记录"]});
    });

    it("editSlice 添加 append 时同样自动补数组基准并保持顺序", async () => {
        const projectPath = await createProject(optionalListSchemaSource());
        const facade = createFacade();

        await facade.listSubjects(projectPath);
        await insertRawWorldSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜"});
        const draft = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "待改切面",
            patches: [{subjectId: "erina", path: "/name", op: "replace", value: "艾莉娜"}],
        });
        const edited = await facade.editSlice(projectPath, draft.sliceId, {
            instant: 20n,
            title: "编辑补笔记",
            patches: [{subjectId: "erina", path: "/notes", op: "append", value: "编辑补记"}],
        });
        const slice = await facade.getSlice(projectPath, edited.sliceId);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["notes"]});

        expect(edited.issues).toEqual([]);
        expect(slice.patches.map((patch) => ({path: patch.path, op: patch.op, value: patch.value}))).toEqual([
            {path: "/notes", op: "replace", value: []},
            {path: "/notes", op: "append", value: "编辑补记"},
        ]);
        expect(state.subjects[0]?.attrs).toEqual({notes: ["编辑补记"]});
    });

    it("append 遇到历史非数组基准时不自动覆盖并继续返回定位 issue", async () => {
        const projectPath = await createProject(optionalListSchemaSource());
        const facade = createFacade();

        await facade.listSubjects(projectPath);
        await insertRawWorldSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜"});
        await insertRawWorldPatch(projectPath, {
            sliceId: "raw-bad-notes-slice",
            patchId: "raw-bad-notes-patch",
            instant: 20n,
            title: "历史坏 notes",
            subjectId: "erina",
            path: "/notes",
            op: "replace",
            valueJson: JSON.stringify("坏值"),
        });
        const written = await facade.writeSlice(projectPath, {
            instant: 30n,
            title: "追加 notes",
            patches: [{subjectId: "erina", path: "/notes", op: "append", value: "新记录"}],
        });
        const slice = await facade.getSlice(projectPath, written.sliceId);

        expect(slice.patches.map((patch) => ({path: patch.path, op: patch.op, value: patch.value}))).toEqual([
            {path: "/notes", op: "append", value: "新记录"},
        ]);
        expect(written.issues).toEqual([expect.objectContaining({
            code: "broken-relative",
            sliceId: written.sliceId,
            patchId: expect.any(String),
            subjectId: "erina",
            path: "/notes",
            op: "append",
            message: "append /notes 基准不是数组，实际：string",
        })]);
    });

    it("executeCodeActWorld 连续写入时对同一持久 issue 去重但保留不同 patch", async () => {
        const projectPath = await createProject(optionalListSchemaSource());
        const facade = createFacade();

        await facade.listSubjects(projectPath);
        await insertRawWorldSubject(projectPath, {id: "erina", type: "character", name: "艾莉娜"});
        await insertRawWorldPatch(projectPath, {
            sliceId: "raw-missing-notes-slice-1",
            patchId: "raw-missing-notes-patch-1",
            instant: 20n,
            title: "历史坏 notes 1",
            subjectId: "erina",
            path: "/notes",
            op: "append",
            valueJson: JSON.stringify("孤立记录 1"),
        });
        await insertRawWorldPatch(projectPath, {
            sliceId: "raw-missing-notes-slice-2",
            patchId: "raw-missing-notes-patch-2",
            instant: 21n,
            title: "历史坏 notes 2",
            subjectId: "erina",
            path: "/notes",
            op: "append",
            valueJson: JSON.stringify("孤立记录 2"),
        });

        const result = await facade.executeCodeActWorld(projectPath, `
            await world.slice.write({
                time: 30n,
                title: "第一次脚本写入",
                patches: [{subjectId: "erina", path: "/name", op: "replace", value: "艾莉娜一"}],
            });
            await world.slice.write({
                time: 40n,
                title: "第二次脚本写入",
                patches: [{subjectId: "erina", path: "/name", op: "replace", value: "艾莉娜二"}],
            });
            return "done";
        `, "readwrite");

        expect(result.issues).toEqual([
            expect.objectContaining({patchId: "raw-missing-notes-patch-1", sliceId: "raw-missing-notes-slice-1"}),
            expect.objectContaining({patchId: "raw-missing-notes-patch-2", sliceId: "raw-missing-notes-slice-2"}),
        ]);
    });

    it("collection append 去重，remove 可按值删除且幂等", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "获得物品",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 90},
                {subjectId: "key", type: "item", name: "钥匙", path: "/durability", op: "replace", value: 100},
                {subjectId: "coin", type: "item", name: "金币", path: "/durability", op: "replace", value: 100},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://key"},
            ],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "交出旧剑",
            patches: [
                {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://coin"},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});

        expect(state.subjects[0]?.attrs.inventory).toEqual(["subject://key"]);
    });

    it("编辑 collection remove 的 value 会重新计算下游 advisory", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "获得物品",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 90},
                {subjectId: "key", type: "item", name: "钥匙", path: "/durability", op: "replace", value: 100},
                {subjectId: "coin", type: "item", name: "金币", path: "/durability", op: "replace", value: 100},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://key"},
            ],
        });
        const removal = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "交出旧剑",
            patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"}],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 30n,
            title: "获得金币",
            patches: [{subjectId: "erina", path: "/inventory", op: "append", value: "subject://coin"}],
        });
        const edited = await facade.editSlice(projectPath, removal.sliceId, {
            instant: 20n,
            title: "交出钥匙",
            patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "subject://key"}],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});

        expect(edited.issues).toEqual([expect.objectContaining({
            code: "base-shifted",
            label: "A1",
            severity: "advisory",
            sliceId: downstream.sliceId,
            patchId: expect.any(String),
            subjectId: "erina",
            attr: "inventory",
            title: expect.any(String),
            explanation: expect.objectContaining({suggestedAction: expect.any(String)}),
        })]);
        expect(state.subjects[0]?.attrs.inventory).toEqual(["subject://old-sword", "subject://coin"]);
    });

    it("list 拒绝按值 remove，保持时间顺序语义", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误删除经历",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "remove", value: "在祭坛醒来"},
            ],
        })).rejects.toThrow("只有 collection 支持按值 remove");
    });

    it("queryState 支持内部全量查询，同时 attrs 投影和 listLimit 生效", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "初始化世界",
            patches: [
                {subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元"},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: "醒来"},
                {subjectId: "erina", path: "/events", op: "append", value: "拿到旧剑"},
            ],
        });
        const full = await facade.queryState(projectPath, {});
        const narrowed = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["events"], listLimit: 1});

        expect(full.instant).toBe(10n);
        expect(full.subjects.map((subject) => subject.subjectId).sort()).toEqual(["erina", "world"]);
        expect(narrowed.subjects[0]?.attrs).toEqual({events: ["拿到旧剑"]});
    });

    it("编辑过去绝对 patch 会返回 base-shifted，删除基准后显形 broken-relative", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const base = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "体力基准",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "受伤",
            patches: [{subjectId: "erina", path: "/hp", op: "increment", value: -10}],
        });
        const edited = await facade.editSlice(projectPath, base.sliceId, {
            instant: 10n,
            title: "体力基准修正",
            patches: [{subjectId: "erina", path: "/hp", op: "replace", value: 80}],
        });
        const deleted = await facade.deleteSlice(projectPath, base.sliceId);

        expect(edited.issues).toEqual([expect.objectContaining({code: "base-shifted", label: "A1", severity: "advisory", subjectId: "erina", attr: "hp"})]);
        expect(deleted.issues).toEqual([expect.objectContaining({code: "broken-relative", label: "E1", severity: "error", patchId: expect.any(String), subjectId: "erina", attr: "hp"})]);
    });

    it("ref 目标缺失在查询时报告 dangling-ref，并归属写入切面", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const place = await facade.writeSlice(projectPath, {
            instant: 5n,
            title: "地点存在",
            patches: [{subjectId: "old-place", type: "location", name: "旧地点", path: "/name", op: "replace", value: "旧地点"}],
        });
        const relation = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误地点",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/location", op: "replace", value: "subject://old-place"}],
        });
        await facade.deleteSlice(projectPath, place.sliceId);
        await deleteWorldSubject(projectPath, "old-place");
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["location"]});

        expect(state.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", label: "E2", severity: "error", sliceId: relation.sliceId, subjectId: "erina", attr: "location"}),
        ]);
    });

    it("listSlices subject filter 支持 any/all，deleteSlice 会回退状态", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100}],
        });
        const second = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "双人同行",
            patches: [
                {subjectId: "erina", path: "/events", op: "append", value: "遇见莫然"},
                {subjectId: "moran", type: "character", name: "莫然", path: "/events", op: "append", value: "遇见艾莉娜"},
            ],
        });
        const any = await facade.listSlices(projectPath, {subjectIds: ["erina"], subjectMode: "any", withPatches: true});
        const all = await facade.listSlices(projectPath, {subjectIds: ["erina", "moran"], subjectMode: "all"});
        await facade.deleteSlice(projectPath, second.sliceId);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "events"]});

        expect(any.map((slice) => slice.title)).toEqual(["艾莉娜登场", "双人同行"]);
        expect(all.map((slice) => slice.title)).toEqual(["双人同行"]);
        expect(state.subjects[0]?.attrs).toEqual({hp: 100, events: []});
    });

    it("语义搜索在请求 embedding 前拒绝没有 EmbeddingText 能力的 schema", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.searchText(projectPath, "祭坛")).rejects.toThrow("没有声明 EmbeddingText 字段");
    });

    it("语义搜索拒绝未知 type 与非 EmbeddingText attr，不静默返回空结果", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        await expect(facade.searchText(projectPath, "祭坛", {types: ["unknown"]})).rejects.toThrow("schema 未声明 subject type：unknown");
        await expect(facade.searchText(projectPath, "祭坛", {attrs: ["hp"]})).rejects.toThrow("attr 不是当前搜索范围内的 EmbeddingText 字段：hp");
        await expect(facade.searchText(projectPath, "祭坛", {types: []})).rejects.toThrow("types 不能为空");
        await expect(facade.searchText(projectPath, "祭坛", {attrs: []})).rejects.toThrow("attrs 不能为空");
    });

    it("语义搜索校验 k/threshold，空查询也不绕过 scope 校验", async () => {
        const projectPath = await createProject(embeddingSchemaSource());
        const facade = createFacade();

        await expect(facade.searchText(projectPath, "祭坛", {k: 0})).rejects.toThrow("k 必须是安全正整数");
        await expect(facade.searchText(projectPath, "祭坛", {k: -1})).rejects.toThrow("k 必须是安全正整数");
        await expect(facade.searchText(projectPath, "祭坛", {threshold: 1.1})).rejects.toThrow("threshold 必须是 -1..1");
        await expect(facade.searchText(projectPath, "祭坛", {threshold: Number.NaN})).rejects.toThrow("threshold 必须是 -1..1");
        await expect(facade.searchText(projectPath, "", {attrs: ["hp"]})).rejects.toThrow("attr 不是当前搜索范围内的 EmbeddingText 字段：hp");
    });

    it("删除 subject 的唯一切面后保留稳定身份", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const written = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "测试实体登场",
            patches: [{subjectId: "stable-identity", type: "character", name: "稳定身份", path: "/hp", op: "replace", value: 100}],
        });

        await facade.deleteSlice(projectPath, written.sliceId);

        expect(await facade.listSubjects(projectPath)).toContainEqual({
            id: "stable-identity",
            type: "character",
            name: "稳定身份",
        });
        expect(await facade.listSlices(projectPath, {subjectIds: ["stable-identity"]})).toEqual([]);
    });

    it("calendar 可格式化和解析同一个 instant", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const formatted = await facade.formatTime(projectPath, 3661n);
        const parsed = await facade.parseTime(projectPath, formatted);

        expect(formatted).toBe("复兴纪元1日 01:01:01");
        expect(parsed).toBe(3661n);
    });

    it("Project SQLite 使用 WorldPatch 表，不再创建 WorldMutation", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "建表验证",
            patches: [{subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元"}],
        });

        expect(await tableExists(projectPath, "WorldPatch")).toBe(true);
        expect(await tableExists(projectPath, "WorldMutation")).toBe(false);
    });
});

function createFacade(): WorldEngineFacade {
    const facade = new WorldEngineFacade(resolveRuntimeWorkspaceRoot());
    createdFacades.push(facade);
    return facade;
}

async function cleanupCreatedProjects(): Promise<void> {
    const facades = createdFacades.splice(0);
    const projectPaths = createdProjects.splice(0);
    for (const facade of facades) {
        await facade.closeProject("workspace/__test__");
    }
    for (const projectPath of projectPaths) {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await removeProjectRoot(projectPath);
    }
}

async function createProject(schema = schemaSource(), options: {open?: boolean} = {}): Promise<string> {
    const slug = `world-engine-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const root = projectRoot(projectPath);
    await fs.mkdir(path.join(root, "world-engine", "schema"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Engine Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "schema", "index.ts"), schema, "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "calendar.ts"), calendarSource(), "utf-8");
    createdProjects.push(projectPath);
    if (options.open !== false) {
        await openProjectForTest(projectPath);
    }
    return projectPath;
}

function projectRoot(projectPath: string): string {
    return path.join(resolveRuntimeWorkspaceRoot(), projectPath.slice("workspace/".length));
}

/** 为 rp 世界线写入独立配置根（rp/world-engine/），与写作模式配置完全分离。 */
async function writeRpWorldConfig(projectPath: string, schema = schemaSource()): Promise<void> {
    const rpConfigRoot = path.join(projectRoot(projectPath), "rp", "world-engine");
    await fs.mkdir(path.join(rpConfigRoot, "schema"), {recursive: true});
    await fs.writeFile(path.join(rpConfigRoot, "schema", "index.ts"), schema, "utf-8");
    await fs.writeFile(path.join(rpConfigRoot, "calendar.ts"), calendarSource(), "utf-8");
}

async function tableExists(projectPath: string, table: string): Promise<boolean> {
    const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath))});
    const client = new PrismaClient({adapter});
    try {
        const rows = await client.$queryRawUnsafe<Array<{name: string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);
        return rows.length > 0;
    } finally {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles();
    }
}

async function deleteWorldSubject(projectPath: string, subjectId: string): Promise<void> {
    const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath))});
    const client = new PrismaClient({adapter});
    try {
        const patchCount = await client.worldPatch.count({where: {subjectId}});
        if (patchCount !== 0) {
            throw new Error(`测试辅助函数拒绝删除非空 WorldSubject：${subjectId} 仍有 ${String(patchCount)} 条 WorldPatch`);
        }
        await client.worldSubject.delete({where: {id: subjectId}});
    } finally {
        await client.$disconnect();
        adapter.closeTrackedClients();
        collectReleasedSqliteHandles();
    }
}

async function insertRawWorldSubject(projectPath: string, input: {id: string; type: string; name: string}): Promise<void> {
    const client = createClient({url: toSqliteFileUrl(resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath))});
    try {
        await client.execute({
            sql: `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, ?, ?)`,
            args: [input.id, input.type, input.name],
        });
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

async function insertRawWorldPatch(projectPath: string, input: {
    sliceId: string;
    patchId: string;
    instant: bigint;
    title: string;
    subjectId: string;
    path: string;
    op: string;
    valueJson: string;
}): Promise<void> {
    const client = createClient({url: toSqliteFileUrl(resolveProjectDatabasePath(resolveRuntimeWorkspaceRoot(), projectPath))});
    try {
        await client.execute({
            sql: `INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES (?, ?, ?, ?, ?)`,
            args: [input.sliceId, input.instant, input.title, "", "event"],
        });
        await client.execute({
            sql: `INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value", "summary", "text", "vector", "model") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [input.patchId, input.sliceId, input.subjectId, input.instant, 0, input.path, input.op, input.valueJson, null, null, null, null],
        });
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

async function removeProjectRoot(projectPath: string): Promise<void> {
    const root = projectRoot(projectPath);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        collectReleasedSqliteHandles({force: true});
        try {
            await fs.rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!isBusyError(error) || attempt === 29) {
                throw error;
            }
            await delay(100);
        }
    }
}

function isBusyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY";
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        "function Ref(targetType: string) {",
        "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
        "}",
        "export const WorldSchema = {",
        "    world: z.object({",
        "        era: z.string().default('复兴纪元').describe('纪元'),",
        "        events: z.array(z.string()).default([]).describe('世界事件'),",
        "    }),",
        "    character: z.object({",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        events: z.array(z.string()).default([]).describe('经历'),",
        "        inventory: z.array(Ref('item')).unique().default([]).describe('背包'),",
        "        location: Ref('location').optional().describe('当前位置'),",
        "    }),",
        "    item: z.object({",
        "        durability: z.number().int().default(100).describe('耐久'),",
        "    }),",
        "    location: z.object({",
        "        name: z.string().optional().describe('名称'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function optionalListSchemaSource(): string {
    return [
        'import {z} from "zod";',
        "",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        name: z.string().optional().describe('姓名'),",
        "        notes: z.array(z.string()).optional().describe('无 default 的笔记列表'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function embeddingSchemaSource(): string {
    return [
        'import {z} from "zod";',
        "",
        "const EmbeddingText = () => z.object({",
        "    text: z.string().describe('文本内容'),",
        "    vector: z.array(z.number()).optional().describe('向量，为空表示未向量化'),",
        "    model: z.string().optional().describe('向量化模型'),",
        "});",
        "",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        events: z.array(EmbeddingText()).default([]).describe('经历'),",
        "        memory: z.record(z.string(), EmbeddingText()).default({}).describe('记忆'),",
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
