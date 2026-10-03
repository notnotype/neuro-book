import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {Type} from "typebox";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {createProfileArtifactPathContextResolver} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {defineAgentProfile, normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {closeAllProjects,
    closeProject,
    openProject,
    requireReadyModuleHandle} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {PROJECT_FILE_INDEX_MODULE_TOKEN} from "nbook/server/workspace-files/project-file-index";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    setHistoryEnabledOverrideForTest,
} from "nbook/server/workspace-history/project-history";
import memoryCuratorProfileDefinition from "../../../assets/workspace/.nbook/agent/profiles/builtin/memory.curator.profile";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {
    applySubjectMemoryPatch,
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
} from "nbook/server/agent/tools/subject-memory";

const memoryCuratorProfile = normalizeAgentProfile(memoryCuratorProfileDefinition);

describe("subject memory tools", () => {
    let root: string;
    let workspaceRoot: string;
    let harness: NeuroAgentHarness;
    let context: ToolExecutionContext;
    let faux: FauxModelsFixture;
    let invocationReady: ReadyProjectSessionRef;
    const projectRef = projectWorkspaceRef("demo");

    beforeEach(async () => {
        setHistoryEnabledOverrideForTest(true);
        root = await mkdtemp(testHostPath("nbook-subject-memory-tools-test-"));
        workspaceRoot = join(root, "workspace");
        await mkdir(join(workspaceRoot, "demo"), {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(resolve(".")),
            stateRoot: absoluteFsPath(root),
        });
        faux = createFauxModels({
            models: [{
                id: "subject-memory-faux",
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        const fauxModel = faux.getModel();
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({models: {
            default: `faux/${fauxModel.id}`,
            providers: [{
                id: "faux",
                name: "Faux",
                enabled: true,
                modelApi: fauxModel.api,
                options: {apiKey: "", baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                models: [{id: fauxModel.id, name: fauxModel.name, enabled: true, api: fauxModel.api, contextWindowTokens: fauxModel.contextWindow, maxTokens: fauxModel.maxTokens}],
            }],
        }}), "utf8");
        const profiles = new AgentProfileCatalog(
            join(root, "missing-system-profiles"),
            undefined,
            undefined,
            undefined,
            createProfileArtifactPathContextResolver(runtimePaths.applicationRoot),
            {install: "workspace/.nbook/agent/profiles"},
        );
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(runtimePaths.workspaceRoot),
            runtimePaths,
            profiles,
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness.profiles.register(memoryCuratorProfile, false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.subject-memory-tools",
                name: "Subject Memory Tools Test",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        invocationReady = await openProject(projectRef, {kind: "job", source: "subject-memory-tools-test"}, absoluteFsPath(workspaceRoot));
        const session = await harness.createAgent({
            profileKey: "test.subject-memory-tools",
            initial: {},
            currentProjectRoot: "demo",
        });
        context = {
            harness,
            sessionId: session.sessionId,
            profileKey: "test.subject-memory-tools",
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject: invocationReady,
            invocationId: "subject-memory-tools-test-invocation",
        };
    });

    afterEach(async () => {
        await closeAllProjects();
        await harness.drainBackgroundTasks();
        await harness.dispose();
        setHistoryEnabledOverrideForTest(null);
        await rm(root, {recursive: true, force: true});
    });

    it("解析 events.jsonl 并拒绝空 text", () => {
        expect(parseSubjectEventsJsonl([
            "{\"tick\":\"000001\",\"time\":\"早晨\",\"text\":\"我被粉色头发的女孩子帮了一把。\"}",
            "{\"text\":\"我还不知道她叫什么。\"}",
        ].join("\n"))).toEqual([
            {tick: "000001", time: "早晨", text: "我被粉色头发的女孩子帮了一把。"},
            {text: "我还不知道她叫什么。"},
        ]);

        expect(() => parseSubjectEventsJsonl("{\"text\":\"\"}")).toThrow("text 不能为空");
    });

    it("解析 memory.jsonl，支持长 view 并拒绝重复 topic", () => {
        const longView = "艾琳娜是我的同班同学。".repeat(120);

        expect(parseSubjectMemoriesJsonl(JSON.stringify({
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子"],
            view: longView,
        }))).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子"],
            view: longView,
        }]);

        expect(() => parseSubjectMemoriesJsonl([
            "{\"topic\":\"艾琳娜\",\"view\":\"同学。\"}",
            "{\"topic\":\"艾琳娜\",\"view\":\"朋友。\"}",
        ].join("\n"))).toThrow("重复 topic");
    });

    it("应用 JSON Patch 后仍校验 memory 结构", () => {
        const updated = applySubjectMemoryPatch([
            {topic: "粉色头发的女孩子", aliases: ["早上帮过我的女孩"], view: "她早上帮过我。"},
            {topic: "艾琳娜", view: "她是同班同学。"},
        ], [
            {op: "replace", path: "/1", value: {
                topic: "艾琳娜",
                aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
                view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
            }},
            {op: "remove", path: "/0"},
        ]);

        expect(updated).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
            view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
        }]);
    });

    it("subject工具只接受当前已打开Project内的规范subjectPath", async () => {
        const tool = mustTool("subject_event_append", harness);
        await expect(tool.executeWithContext?.(context, "absolute-subject", {
            subjectPath: join(workspaceRoot, "demo", "simulation", "subjects", "heroine"),
            events: [{text: "不应写入。"}],
        })).rejects.toThrow("subjectPath必须是当前Project内");
        await expect(tool.executeWithContext?.(context, "cross-project-subject", {
            subjectPath: "workspace/beta/simulation/subjects/heroine",
            events: [{text: "不应写入。"}],
        })).rejects.toThrow("subjectPath必须是当前Project内");

        await closeProject(projectRef, "shutdown");
        await expect(tool.executeWithContext?.(context, "closed-project-subject", {
            subjectPath: "simulation/subjects/heroine",
            events: [{text: "不应写入。"}],
        })).rejects.toThrow("Project未打开");
        await openProject(projectRef, {kind: "job", source: "subject-memory-tools-test"}, absoluteFsPath(workspaceRoot));

        await expect(tool.executeWithContext?.(context, "reopened-project-subject", {
            subjectPath: "simulation/subjects/heroine",
            events: [{text: "不应写入新 generation。"}],
        })).rejects.toThrow("Project未打开");
        await expect(readFile(
            join(workspaceRoot, "demo", "simulation", "subjects", "heroine", "events.jsonl"),
            "utf-8",
        )).rejects.toMatchObject({code: "ENOENT"});
    });

    it("subject写工具声明Workspace变更，RAG查询保持运行时写入语义", () => {
        expect(mustTool("subject_event_append", harness).mutatesWorkspace).toBe(true);
        expect(mustTool("subject_memory_update", harness).mutatesWorkspace).toBe(true);
        expect(mustTool("subject_rag_search", harness).mutatesWorkspace).not.toBe(true);
    });

    it("subject_event_append 追加 JSONL 并标记 RAG dirty", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"旧事件。\"}\n", "utf-8");
        const fileIndex = requireReadyModuleHandle(invocationReady, PROJECT_FILE_INDEX_MODULE_TOKEN);
        const beforeNode = await vi.waitFor(async () => {
            const node = (await fileIndex.read()).nodes.find((candidate) => (
                candidate.path === "simulation/subjects/heroine/events.jsonl"
            ));
            if (!node) throw new Error("Project File Index 尚未收敛到外部创建的 events.jsonl");
            return node;
        });
        const tool = mustTool("subject_event_append", harness);

        await tool.executeWithContext?.(context, "append-events", {
            subjectPath: "simulation/subjects/heroine",
            events: [
                {tick: "000002", text: "我确认艾琳娜就是早上帮过我的女孩。"},
            ],
        });

        await expect(readFile(join(subjectRoot, "events.jsonl"), "utf-8")).resolves.toBe([
            "{\"text\":\"旧事件。\"}",
            "{\"text\":\"我确认艾琳娜就是早上帮过我的女孩。\",\"tick\":\"000002\"}",
            "",
        ].join("\n"));
        const afterNode = (await fileIndex.read()).nodes.find((node) => (
            node.path === "simulation/subjects/heroine/events.jsonl"
        ));
        expect(afterNode?.size).toBeGreaterThan(beforeNode!.size);
        const history = await requireReadyModuleHandle(invocationReady, PROJECT_HISTORY_MODULE_TOKEN).history;
        expect(history).not.toBeNull();
        const agentEntries = (await history!.timeline("simulation/subjects/heroine/events.jsonl"))
            .filter((item) => item.entry.actor.kind === "agent");
        expect(agentEntries.at(-1)?.entry.actor).toEqual({
            kind: "agent",
            sessionId: String(context.sessionId),
        });
        expect(agentEntries.at(-1)?.entry.operation.type).toBe("file.edit");
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("subject_event_append 硬切 JSONL，不导入旧 events.md", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.md"), "## 旧经历\n\n她曾经在雨夜帮我带路。", "utf-8");
        const tool = mustTool("subject_event_append", harness);

        await tool.executeWithContext?.(context, "append-events-hard-cut", {
            subjectPath: "simulation/subjects/heroine",
            events: [
                {text: "我今天再次想起那次雨夜带路。"},
            ],
        });

        const events = parseSubjectEventsJsonl(await readFile(join(subjectRoot, "events.jsonl"), "utf-8"));
        expect(events).toEqual([
            {text: "我今天再次想起那次雨夜带路。"},
        ]);
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("subject_rag_search 未配置 embedding 时明确失败且不做关键词 fallback", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search", {
            subjectPath: "simulation/subjects/heroine",
            query: "艾琳娜",
            sources: ["events"],
        })).rejects.toThrow("不会执行关键词 fallback");
    });

    it("subject_rag_search 必须显式指定 sources，不提供时不会默认双搜", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search-missing-sources", {
            subjectPath: "simulation/subjects/heroine",
            query: "艾琳娜",
        })).rejects.toThrow("必须显式指定且只能指定一个 source");
    });

    it("subject_rag_search 不允许一次同时搜索 events 和 memory", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        const tool = mustTool("subject_rag_search", harness);

        await expect(tool.executeWithContext?.(context, "rag-search-two-sources", {
            subjectPath: "simulation/subjects/heroine",
            query: "艾琳娜",
            sources: ["events", "memory"],
        })).rejects.toThrow("必须显式指定且只能指定一个 source");
    });

    it("subject_event_append 后立刻 search 会同步重建 dirty events 索引", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"旧事件只提到了王都学院走廊。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"艾琳娜是我的同班同学。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 3,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "utf-8");
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text.includes("艾琳娜") || text.includes("粉色头发")
                        ? [1, 0, 0]
                        : [0, 1, 0],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;
        try {
            const appendTool = mustTool("subject_event_append", harness);
            const searchTool = mustTool("subject_rag_search", harness);

            await appendTool.executeWithContext?.(context, "append-before-search", {
            subjectPath: "simulation/subjects/heroine",
                events: [
                    {text: "我刚刚确认艾琳娜就是早上帮我的粉色头发女孩。"},
                ],
            });
            const result = await searchTool.executeWithContext?.(context, "search-after-append", {
            subjectPath: "simulation/subjects/heroine",
                query: "艾琳娜 粉色头发",
                sources: ["events"],
                limit: 3,
            });
            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";

            expect(text).toContain("粉色头发女孩");
            expect(text).not.toContain("旧事件只提到了王都学院走廊");
            expect(result?.details).toEqual({
            subjectPath: "simulation/subjects/heroine",
                source: "events",
                count: 1,
            });
            await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.not.toContain("\"events\"");
            await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag.sqlite"))).resolves.toBeInstanceOf(Buffer);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_rag_search 内部过滤不会误杀中等相关候选", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), [
            "{\"text\":\"艾琳娜曾在早晨帮我避开迟到。\"}",
            "{\"text\":\"王都学院走廊今天很安静。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"艾琳娜是我的同班同学。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 2,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "utf-8");
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text === "艾琳娜"
                        ? [1, 0]
                        : text.includes("艾琳娜")
                        ? [0.55, 0.83]
                        : [0, 1],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;
        try {
            const tool = mustTool("subject_rag_search", harness);

            const result = await tool.executeWithContext?.(context, "rag-search-medium-match", {
            subjectPath: "simulation/subjects/heroine",
                query: "艾琳娜",
                sources: ["events"],
                limit: 2,
            });
            const text = result?.content[0]?.type === "text" ? result.content[0].text : "";

            expect(text).toContain("避开迟到");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_rag_search 的 embedding 请求超时会明确失败", async () => {
        const originalFetch = globalThis.fetch;
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(subjectRoot, "events.jsonl"), "{\"text\":\"艾琳娜帮过我。\"}\n", "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"她帮过我。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "slow-embed",
                dimensions: 3,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
                timeoutMs: 1,
                requestOptions: {},
            },
        }), "utf-8");
        const timeoutFetch: typeof fetch = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            await new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("This operation was aborted", "AbortError"));
                });
            });
            throw new Error("unreachable");
        }, {preconnect: originalFetch.preconnect});
        globalThis.fetch = timeoutFetch;
        try {
            const tool = mustTool("subject_rag_search", harness);

            await expect(tool.executeWithContext?.(context, "rag-search-timeout", {
            subjectPath: "simulation/subjects/heroine",
                query: "艾琳娜",
                sources: ["events"],
                limit: 1,
            })).rejects.toThrow("embedding 请求超时");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("subject_memory_update 调用真实 memory.curator profile，应用 JSON Patch 并标记 dirty", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "memory.jsonl"), [
            "{\"topic\":\"粉色头发的女孩子\",\"aliases\":[\"早上帮过我的女孩\"],\"view\":\"她早上帮过我。\"}",
            "{\"topic\":\"艾琳娜\",\"view\":\"她是同班同学。\"}",
            "",
        ].join("\n"), "utf-8");
        const fileIndex = requireReadyModuleHandle(invocationReady, PROJECT_FILE_INDEX_MODULE_TOKEN);
        const beforeNode = await vi.waitFor(async () => {
            const node = (await fileIndex.read()).nodes.find((candidate) => (
                candidate.path === "simulation/subjects/heroine/memory.jsonl"
            ));
            if (!node) throw new Error("Project File Index 尚未收敛到外部创建的 memory.jsonl");
            return node;
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "patch ready",
                    data: {
                        patch: [
                            {
                                op: "replace",
                                path: "/1",
                                value: {
                                    topic: "艾琳娜",
                                    aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
                                    view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
                                },
                            },
                            {op: "remove", path: "/0"},
                        ],
                    },
                }, {id: "curator-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update", {
            subjectPath: "simulation/subjects/heroine",
            facts: ["我确认艾琳娜就是早上帮过我的粉色头发女孩。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "updated",
            summary: "patch ready",
            dirty: true,
        }));
        const memoryText = await readFile(join(subjectRoot, "memory.jsonl"), "utf-8");
        expect(parseSubjectMemoriesJsonl(memoryText)).toEqual([{
            topic: "艾琳娜",
            aliases: ["粉色头发的女孩子", "早上帮过我的女孩"],
            view: "我已经意识到艾琳娜就是早上帮过我的粉色头发女孩。",
        }]);
        const afterNode = (await fileIndex.read()).nodes.find((node) => (
            node.path === "simulation/subjects/heroine/memory.jsonl"
        ));
        expect(afterNode?.size).toBe(Buffer.byteLength(memoryText));
        expect(afterNode?.size).not.toBe(beforeNode!.size);
        const history = await requireReadyModuleHandle(invocationReady, PROJECT_HISTORY_MODULE_TOKEN).history;
        expect(history).not.toBeNull();
        const agentEntries = (await history!.timeline("simulation/subjects/heroine/memory.jsonl"))
            .filter((item) => item.entry.actor.kind === "agent");
        expect(agentEntries.at(-1)?.entry.actor).toEqual({
            kind: "agent",
            sessionId: String(context.sessionId),
        });
        expect(agentEntries.at(-1)?.entry.operation.type).toBe("file.edit");
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("subject_memory_update 硬切 JSONL，不导入旧 knowledge.md", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        await writeFile(join(subjectRoot, "knowledge.md"), "## 艾琳娜\n\n我知道艾琳娜曾经帮过我。", "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "patch ready",
                    data: {
                        patch: [{
                            op: "add",
                            path: "/-",
                            value: {
                                topic: "艾琳娜",
                                view: "我今天确认自己仍然记得艾琳娜帮过我。",
                            },
                        }],
                    },
                }, {id: "curator-hard-cut-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update-hard-cut", {
            subjectPath: "simulation/subjects/heroine",
            facts: ["我今天确认自己仍然记得艾琳娜帮过我。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "updated",
            summary: "patch ready",
        }));
        expect(parseSubjectMemoriesJsonl(await readFile(join(subjectRoot, "memory.jsonl"), "utf-8"))).toEqual([{
            topic: "艾琳娜",
            view: "我今天确认自己仍然记得艾琳娜帮过我。",
        }]);
        await expect(readFile(join(workspaceRoot, "demo", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("subject_memory_update patch 校验失败会重试一次，仍失败则 needs_review 且不写文件", async () => {
        const subjectRoot = join(workspaceRoot, "demo", "simulation", "subjects", "heroine");
        await mkdir(subjectRoot, {recursive: true});
        const original = "{\"topic\":\"艾琳娜\",\"view\":\"她是同班同学。\"}\n";
        await writeFile(join(subjectRoot, "memory.jsonl"), original, "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad patch",
                    data: {
                        patch: [{op: "replace", path: "/0/view", value: ""}],
                    },
                }, {id: "curator-bad-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad patch again",
                    data: {
                        patch: [{op: "add", path: "/-", value: {topic: "", view: "x"}}],
                    },
                }, {id: "curator-bad-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const tool = mustTool("subject_memory_update", harness);

        const result = await tool.executeWithContext?.(context, "subject-memory-update-bad", {
            subjectPath: "simulation/subjects/heroine",
            facts: ["事实需要更新，但 curator patch 不合法。"],
        });

        expect(result?.details).toEqual(expect.objectContaining({
            status: "needs_review",
            attempts: 2,
        }));
        await expect(readFile(join(subjectRoot, "memory.jsonl"), "utf-8")).resolves.toBe(original);
    });
});

function mustTool(key: string, harness: NeuroAgentHarness) {
    const tool = harness.tools.get(key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing tool ${key}`);
    }
    return tool;
}
