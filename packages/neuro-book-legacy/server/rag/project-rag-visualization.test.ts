import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseSubjectEventsJsonl, parseSubjectMemoriesJsonl} from "nbook/server/agent/tools/subject-memory";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectRagTarget} from "nbook/server/rag/project-rag-visualization";

type ProjectRagVisualizationService = typeof import("nbook/server/rag/project-rag-visualization");
type ProjectSessionTestUtils = typeof import("nbook/server/workspace-files/project-session-test-utils");

const createdRoots: string[] = [];

describe("project RAG visualization service", () => {
    let root: string;
    let originalCwd: string;
    let originalFetch: typeof fetch;
    let service: ProjectRagVisualizationService;
    let sessionUtils: ProjectSessionTestUtils | null = null;
    let resetRuntimeRootContext: (() => void) | null = null;
    let target: ProjectRagTarget;
    const projectPath = "rag-visual-test";

    beforeEach(async () => {
        originalCwd = process.cwd();
        originalFetch = globalThis.fetch;
        root = await mkdtemp(testHostPath("nbook-project-rag-visual-test-"));
        process.chdir(root);
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        vi.resetModules();
        service = await import("nbook/server/rag/project-rag-visualization");
        sessionUtils = await import("nbook/server/workspace-files/project-session-test-utils");
        const runtimeRoot = await import("nbook/server/workspace-files/workspace-runtime-root");
        runtimeRoot.setWorkspaceRuntimeRootContextForTest({workspaceRoot: join(root, "workspace")});
        resetRuntimeRootContext = () => runtimeRoot.setWorkspaceRuntimeRootContextForTest(null);
        await mkdir(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", "project.yaml"), "kind: novel\ntitle: RAG Test\nsummary: ''\n", "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "subject.md"), [
            "---",
            "id: heroine",
            "name: 艾琳娜",
            "kind: npc",
            "profile: simulator.actor",
            "controlledBy: simulator",
            "canonicalSource: lorebook/characters/erina/index.md",
            "---",
            "",
            "# Subject",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "soul.md"), "# Soul\n", "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "mind.md"), "# Mind\n", "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "state.md"), "# State\n", "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), [
            "{\"time\":\"早晨\",\"text\":\"我被艾琳娜帮助，没有迟到。\"}",
            "{\"time\":\"午休\",\"text\":\"我还不确定艾琳娜是否就是粉色头发女孩。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "memory.jsonl"), [
            "{\"topic\":\"艾琳娜\",\"aliases\":[\"粉色头发女孩\"],\"view\":\"她帮过我，我对她有感谢。\"}",
            "",
        ].join("\n"), "utf-8");
        const ready = await sessionUtils.openProjectForTest(projectPath);
        target = Object.freeze({
            workspaceRoot: absoluteFsPath(join(root, "workspace")),
            project: ready,
        });
    });

    afterEach(async () => {
        await sessionUtils?.closeProjectForTest(projectPath).catch(() => undefined);
        const {closeAllProjects, resetProjectSessionsForTest} = await import("nbook/server/runtime/product-project");
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        collectReleasedSqliteHandles({force: true});
        resetRuntimeRootContext?.();
        resetRuntimeRootContext = null;
        globalThis.fetch = originalFetch;
        process.chdir(originalCwd);
        vi.resetModules();
        createdRoots.push(root);
        sessionUtils = null;
    });

    afterAll(async () => {
        for (const createdRoot of createdRoots.splice(0)) {
            await removeTempRoot(createdRoot);
        }
    });

    it("读取 Project 级 subject RAG 概览和详情", async () => {
        const overview = await service.readProjectRagOverview(target);
        expect(overview.subjects).toHaveLength(1);
        expect(overview.subjects[0]).toMatchObject({
            subjectPath: "simulation/subjects/heroine",
            metadata: {
                id: "heroine",
                name: "艾琳娜",
                kind: "npc",
                profile: "simulator.actor",
                controlledBy: "simulator",
                canonicalSource: "lorebook/characters/erina/index.md",
                frontmatterError: null,
            },
            eventCount: 2,
            memoryCount: 1,
            subjectFileExists: true,
            soulFileExists: true,
            mindFileExists: true,
            stateFileExists: true,
        });

        const detail = await service.readProjectRagSubject(target, "simulation/subjects/heroine");
        expect(detail.events[0]).toMatchObject({line: 1, time: "早晨"});
        expect(detail.memories[0]).toMatchObject({line: 1, topic: "艾琳娜"});
    });

    it("无 subjects 时返回空概览", async () => {
        const emptyProjectPath = "empty-rag-project";
        await mkdir(join(root, "workspace", "empty-rag-project"), {recursive: true});
        await writeFile(join(root, "workspace", "empty-rag-project", "project.yaml"), "kind: novel\ntitle: Empty RAG\nsummary: ''\n", "utf-8");

        const ready = await sessionUtils.openProjectForTest(emptyProjectPath);
        try {
            const overview = await service.readProjectRagOverview(Object.freeze({
                workspaceRoot: target.workspaceRoot,
                project: ready,
            }));

            expect(overview.subjects).toEqual([]);
        } finally {
            await sessionUtils.closeProjectForTest(emptyProjectPath);
        }
    });

    it("旧 ready generation 在 close/reopen 后拒绝写入，不会转投新 generation", async () => {
        const {ProjectNotReadyError} = await import("nbook/server/workspace-files/project-session-runtime");
        const oldTarget = target;
        const eventsPath = join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl");
        const before = await readFile(eventsPath, "utf-8");
        await sessionUtils.closeProjectForTest(projectPath);
        const ready = await sessionUtils.openProjectForTest(projectPath);
        target = Object.freeze({
            workspaceRoot: oldTarget.workspaceRoot,
            project: ready,
        });

        expect(target.project.generation).not.toBe(oldTarget.project.generation);
        await expect(service.createProjectRagEvent(oldTarget, {
            subjectPath: "simulation/subjects/heroine",
            event: {text: "不应进入新 generation。"},
        })).rejects.toBeInstanceOf(ProjectNotReadyError);
        await expect(readFile(eventsPath, "utf-8")).resolves.toBe(before);
    });

    it("events CRUD 会写回 JSONL 并标记 dirty", async () => {
        await service.createProjectRagEvent(target, {
            subjectPath: "simulation/subjects/heroine",
            event: {time: "放学", text: "我向艾琳娜道谢。"},
        });
        await service.reorderProjectRagEvent(target, {
            subjectPath: "simulation/subjects/heroine",
            fromIndex: 2,
            toIndex: 0,
        });
        await service.deleteProjectRagEvent(target, {
            subjectPath: "simulation/subjects/heroine",
            index: 1,
        });

        const eventsText = await readFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), "utf-8");
        expect(parseSubjectEventsJsonl(eventsText).map((event) => event.text)).toEqual([
            "我向艾琳娜道谢。",
            "我还不确定艾琳娜是否就是粉色头发女孩。",
        ]);
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("并发新增 event 在同一 mutation gate 内读改写，不丢失任一结果", async () => {
        await Promise.all([
            service.createProjectRagEvent(target, {
                subjectPath: "simulation/subjects/heroine",
                event: {text: "并发事件 A"},
            }),
            service.createProjectRagEvent(target, {
                subjectPath: "simulation/subjects/heroine",
                event: {text: "并发事件 B"},
            }),
        ]);

        const eventsText = await readFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), "utf-8");
        const texts = parseSubjectEventsJsonl(eventsText).map((event) => event.text);
        expect(texts).toContain("并发事件 A");
        expect(texts).toContain("并发事件 B");
    });

    it("memory CRUD 使用 topic 定位并标记 dirty", async () => {
        await service.createProjectRagMemory(target, {
            subjectPath: "simulation/subjects/heroine",
            memory: {topic: "王都学院", view: "这是我上学的地方。"},
        });
        await service.updateProjectRagMemory(target, {
            subjectPath: "simulation/subjects/heroine",
            topic: "王都学院",
            memory: {topic: "王都学院", aliases: ["学院"], view: "这是我学习和生活的地方。"},
        });

        const memoriesText = await readFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "memory.jsonl"), "utf-8");
        expect(parseSubjectMemoriesJsonl(memoriesText).find((memory) => memory.topic === "王都学院")).toMatchObject({
            aliases: ["学院"],
            view: "这是我学习和生活的地方。",
        });
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("坏 JSONL 禁止 CRUD 覆盖", async () => {
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), "{\"text\":\"ok\"}\n{bad}\n", "utf-8");

        await expect(service.createProjectRagEvent(target, {
            subjectPath: "simulation/subjects/heroine",
            event: {text: "不应写入。"},
        })).rejects.toThrow("events.jsonl 无效");
    });

    it("CRUD 不会创建不存在的 subject", async () => {
        await expect(service.createProjectRagEvent(target, {
            subjectPath: "simulation/subjects/new-subject",
            event: {text: "不应创建新 subject。"},
        })).rejects.toThrow("subject 不存在");
    });

    it("embedding 未配置时重建索引返回 subject 级错误", async () => {
        await writeRepoGlobalConfig({
            embedding: {
                enabled: false,
            },
        });

        const result = await service.rebuildProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
        });

        expect(result).toMatchObject({
            rebuiltSubjects: 0,
            skippedSubjects: 1,
            results: [{
                subjectPath: "simulation/subjects/heroine",
                ok: false,
            }],
        });
        expect(result.results[0]?.message).toContain("embedding");
    });

    it("搜索使用真实 subject RAG 链路并消费 dirty", async () => {
        await configureEmbedding();
        mockEmbeddingFetch();

        await service.createProjectRagEvent(target, {
            subjectPath: "simulation/subjects/heroine",
            event: {text: "艾琳娜后来成为我信任的人。"},
        });
        const result = await service.searchProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
            query: "艾琳娜 信任",
            sources: ["events"],
            limit: 3,
        });

        expect(result.candidates.some((candidate) => candidate.text.includes("信任"))).toBe(true);
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag.sqlite"))).resolves.toBeInstanceOf(Buffer);

        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), [
            "{\"time\":\"早晨\",\"text\":\"我被艾琳娜帮助，没有迟到。\"}",
            "{\"time\":\"午休\",\"text\":\"我还不确定艾琳娜是否就是粉色头发女孩。\"}",
            "{\"text\":\"我直接通过文件编辑器追加了新经历。\"}",
            "",
        ].join("\n"), "utf-8");
        const detail = await service.readProjectRagSubject(target, "simulation/subjects/heroine");
        expect(detail.sourceStatuses.find((status) => status.source === "events")?.status).toBe("dirty");
    });

    it("Inspector 能读取 chunk 级 embedding 元数据和向量预览", async () => {
        await configureEmbedding();
        mockEmbeddingFetch();

        await service.rebuildProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
        });
        const inspector = await service.readProjectRagInspector(target, {
            subjectPath: "simulation/subjects/heroine",
            sources: ["events"],
            limit: 100,
        });

        expect(inspector.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 3,
            apiKeyConfigured: true,
            baseURLConfigured: true,
            baseURLLabel: "https://embedding.test",
        });
        expect(inspector.index).toMatchObject({
            dbExists: true,
            embeddingProvider: "openai-compatible",
            embeddingModel: "project-embed",
            embeddingDimensions: 3,
            metaMatchesEffectiveConfig: true,
            readError: null,
        });
        expect(inspector.selectedSubject?.chunkSourceCounts).toEqual({events: 2, memory: 1});
        expect(inspector.selectedSubject?.chunks.every((chunk) => chunk.source === "events")).toBe(true);
        expect(inspector.selectedSubject?.chunks[0]?.vector).toMatchObject({
            exists: true,
            dimensions: 3,
            preview: [1, 0, 0],
            previewDimensions: 3,
            embeddingProvider: "openai-compatible",
            embeddingModel: "project-embed",
            embeddingDimensions: 3,
        });
        expect(inspector.selectedSubject?.chunks[0]?.vector.embeddingIndexedAt).toEqual(expect.any(String));
    });

    it("Inspector 兼容旧版 chunk schema 并展示已有正文", async () => {
        await configureEmbedding();
        mockEmbeddingFetch();

        await service.rebuildProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
        });
        await dropLegacyEmbeddingColumns();

        const inspector = await service.readProjectRagInspector(target, {
            subjectPath: "simulation/subjects/heroine",
            sources: ["events", "memory"],
            limit: 100,
        });

        expect(inspector.selectedSubject?.chunkSourceCounts).toEqual({events: 2, memory: 1});
        expect(inspector.selectedSubject?.chunks).toHaveLength(3);
        expect(inspector.selectedSubject?.chunks[0]).toMatchObject({
            text: expect.stringContaining("艾琳娜"),
            vector: {
                embeddingProvider: null,
                embeddingModel: null,
                embeddingDimensions: null,
                embeddingIndexedAt: null,
            },
        });
    });

    it("Inspector 在 SQLite 读取失败时返回 readError 和可展示空状态", async () => {
        await mkdir(join(root, "workspace", "rag-visual-test", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag.sqlite"), "not a sqlite database", "utf-8");

        const inspector = await service.readProjectRagInspector(target, {
            subjectPath: "simulation/subjects/heroine",
        });

        expect(inspector.index.dbExists).toBe(true);
        expect(inspector.index.readError).toEqual(expect.any(String));
        expect(inspector.selectedSubject?.chunkSourceCounts).toEqual({events: 0, memory: 0});
        expect(inspector.selectedSubject?.chunks).toEqual([]);
    });

    it("Inspector debug 操作只影响 RAG 缓存或 dirty state", async () => {
        await configureEmbedding();
        mockEmbeddingFetch();
        await service.rebuildProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
        });

        const markResult = await service.debugProjectRag(target, {
            action: "mark-dirty",
            subjectPath: "simulation/subjects/heroine",
            sources: ["memory"],
        });
        expect(markResult.message).toContain("memory");
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");

        const deleteResult = await service.debugProjectRag(target, {
            action: "delete-subject-index",
            subjectPath: "simulation/subjects/heroine",
        });
        expect(deleteResult.message).toContain("heroine");
        const afterDelete = await service.readProjectRagInspector(target, {
            subjectPath: "simulation/subjects/heroine",
        });
        expect(afterDelete.selectedSubject?.chunks).toEqual([]);

        await service.rebuildProjectSubjectRag(target, {
            subjectPath: "simulation/subjects/heroine",
        });
        const clearResult = await service.debugProjectRag(target, {
            action: "clear-index-cache",
        });
        expect(clearResult.message).toContain("已清空");
        const afterClear = await service.readProjectRagInspector(target, {
            subjectPath: "simulation/subjects/heroine",
        });
        expect(afterClear.index.dbExists).toBe(false);
    });

    it("删除 subject index 失败时抛错而不是返回成功", async () => {
        await mkdir(join(root, "workspace", "rag-visual-test", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag.sqlite"), "not a sqlite database", "utf-8");

        await expect(service.debugProjectRag(target, {
            action: "delete-subject-index",
            subjectPath: "simulation/subjects/heroine",
        })).rejects.toThrow();
    });

    async function configureEmbedding(): Promise<void> {
        await writeRepoGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 1536,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
            },
        });
        await mkdir(join(root, "workspace", "rag-visual-test", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "project-embed",
                dimensions: 3,
            },
        }), "utf-8");
    }

    async function writeRepoGlobalConfig(value: unknown): Promise<void> {
        await mkdir(join(root, "workspace", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", ".nbook", "config.json"), JSON.stringify(value), "utf-8");
    }

    function mockEmbeddingFetch(): void {
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text.includes("艾琳娜") ? [1, 0, 0] : [0, 1, 0],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;
    }

    async function dropLegacyEmbeddingColumns(): Promise<void> {
        const sqlite = await import("node:sqlite") as unknown as {
            DatabaseSync: new (path: string) => {
                exec(sql: string): void;
                close(): void;
            };
        };
        const db = new sqlite.DatabaseSync(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag.sqlite"));
        try {
            db.exec("ALTER TABLE subject_rag_chunks DROP COLUMN embedding_provider");
            db.exec("ALTER TABLE subject_rag_chunks DROP COLUMN embedding_model");
            db.exec("ALTER TABLE subject_rag_chunks DROP COLUMN embedding_dimensions");
            db.exec("ALTER TABLE subject_rag_chunks DROP COLUMN embedding_indexed_at");
        } finally {
            db.close();
        }
    }

    async function removeTempRoot(target: string): Promise<void> {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            collectReleasedSqliteHandles({force: true});
            try {
                await rm(target, {recursive: true, force: true});
                return;
            } catch (error) {
                if (!isBusyFileError(error)) {
                    throw error;
                }
                if (attempt === 19) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }

    function isBusyFileError(error: unknown): boolean {
        return Boolean(typeof error === "object" && error !== null && "code" in error && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error.code)));
    }
});
