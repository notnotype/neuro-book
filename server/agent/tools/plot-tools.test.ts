import {describe, expect, it, vi} from "vitest";
import path from "node:path";
import {Value} from "typebox/value";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const {
    plotFacade,
    currentReady,
    overrideReady,
    requireActiveReadyProjectMock,
    activateReadyProjectModuleMock,
    runReadyProjectOperationMock,
} = vi.hoisted(() => {
    const facade = {
        getChapterWriterBrief: vi.fn(),
        getSceneWorldContext: vi.fn(),
        getStorySceneDetailDto: vi.fn(),
        getStoryThreadDetailDto: vi.fn(),
        updateStoryChapter: vi.fn(),
        updateStoryScene: vi.fn(),
        listStoryPromises: vi.fn(),
        getStoryPromiseDetailDto: vi.fn(),
        createStoryPromise: vi.fn(),
        updateStoryPromise: vi.fn(),
        setPromiseBeat: vi.fn(),
        removePromiseBeat: vi.fn(),
        listStoryDecisions: vi.fn(),
        getStoryDecisionDto: vi.fn(),
        createStoryDecision: vi.fn(),
        updateStoryDecision: vi.fn(),
    };
    const current = {generation: 1, workspace: {ref: {projectRoot: "novel-1"}}} as ReadyProjectSessionRef;
    const override = {generation: 2, workspace: {ref: {projectRoot: "novel-2"}}} as ReadyProjectSessionRef;
    return {
        plotFacade: facade,
        currentReady: current,
        overrideReady: override,
        requireActiveReadyProjectMock: vi.fn(() => override),
        activateReadyProjectModuleMock: vi.fn(async () => ({plot: facade})),
        runReadyProjectOperationMock: vi.fn(async (_ready, operation) => operation(new AbortController().signal)),
    };
});

vi.mock("nbook/server/plot", () => {
    return {
        PROJECT_PLOT_WORLD_MODULE_TOKEN: {name: "plot-world", kind: "lazy"},
    };
});

vi.mock("nbook/server/workspace-files/project-session", () => ({
    requireActiveReadyProject: requireActiveReadyProjectMock,
    activateReadyProjectModule: activateReadyProjectModuleMock,
    runReadyProjectOperation: runReadyProjectOperationMock,
}));

describe("plot tools", () => {
    it("save_story_scene 的 refs.note 可以省略", () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_scene");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectRoot: "novel-1",
            action: "create",
            threadId: "2",
            title: "Scene",
            refs: [{
                relation: "mentions",
                target: "lorebook/character/foo/",
                visibility: "author",
            }],
        })).toBe(true);
    });

    it("save_story_scene action=create 接受 World Anchor", () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_scene");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectRoot: "novel-1",
            action: "create",
            threadId: "2",
            title: "Scene",
            worldAnchor: {
                startTime: null,
                endTime: null,
                startInstant: null,
                endInstant: null,
                subjectIds: ["hero"],
                locationSubjectId: "temple",
            },
        })).toBe(true);
    });

    it("save_* 工具的 action 必填", () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_scene");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectRoot: "novel-1",
            threadId: "2",
            title: "Scene",
        })).toBe(false);
    });

    it("读写元数据：写工具标注 mutatesWorkspace、读工具不标（只读模式硬门控依据，Task 97 D8）", () => {
        const tools = createPlotTools();
        const mutating = tools.filter((item) => item.mutatesWorkspace).map((item) => item.key).sort();
        const readonly = tools.filter((item) => !item.mutatesWorkspace).map((item) => item.key).sort();

        expect(mutating).toEqual([
            "bootstrap_carrier_tree",
            "save_promise_beat",
            "save_story_act",
            "save_story_chapter",
            "save_story_decision",
            "save_story_promise",
            "save_story_scene",
            "save_story_thread",
        ]);
        expect(readonly).toEqual([
            "get_chapter_writer_brief",
            "get_scene_world_context",
            "get_story_chapter",
            "get_story_decision",
            "get_story_promise",
            "get_story_scene_context",
            "get_story_thread",
            "get_story_tree",
        ]);
    });

    it("save_story_act action=update 缺少 actId 时返回可读中文诊断", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_act");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "update",
            title: "第一卷",
        })).rejects.toThrow("action=update 必须提供 actId");
    });

    it("save_story_chapter action=create 缺少 name/title 时返回可读中文诊断", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_chapter");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "create",
            title: "开篇",
        })).rejects.toThrow("action=create 必须提供 name 和 title");
    });

    it("save_story_chapter action=update 透传 ChapterBrief 信息控制字段（F1 修复链路）", async () => {
        const plotFacadeMock = plotFacade as {
            updateStoryChapter: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.updateStoryChapter.mockResolvedValueOnce({
            id: "7",
            name: "001-opening",
            title: "开篇",
            brief: {mustHide: "薇洛丝不知道项链是前作遗物"},
        });
        const tool = createPlotTools().find((item) => item.key === "save_story_chapter");

        const result = await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "update",
            chapterId: "7",
            brief: {
                readerKnows: "读者已知封印松动",
                mustHide: "薇洛丝不知道项链是前作遗物",
            },
        });

        expect(plotFacadeMock.updateStoryChapter).toHaveBeenCalledWith(7, {
            brief: {
                readerKnows: "读者已知封印松动",
                mustHide: "薇洛丝不知道项链是前作遗物",
            },
        });
        expect(result.details).toMatchObject({id: "7", brief: {mustHide: "薇洛丝不知道项链是前作遗物"}});
    });

    it("save_story_scene action=archive 把 status 置为 archived", async () => {
        const plotFacadeMock = plotFacade as {
            updateStoryScene: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.updateStoryScene.mockResolvedValueOnce({id: "20", threadId: "2", status: "archived"});
        const tool = createPlotTools().find((item) => item.key === "save_story_scene");

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "archive",
            sceneId: "20",
        });

        expect(plotFacadeMock.updateStoryScene).toHaveBeenCalledWith(20, {status: "archived"});
    });

    it("save_story_thread action=archive 与显式 status 冲突时返回可读中文诊断", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_thread");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "archive",
            threadId: "2",
            status: "active",
        })).rejects.toThrow("action=archive 会把 status 置为 archived");
    });

    it("save_story_promise action=create 缺少 name/title 时返回可读中文诊断", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_promise");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "create",
            title: "银钥匙之谜",
        })).rejects.toThrow("action=create 必须提供 name 和 title");
    });

    it("save_story_promise action=abandon 置 status=abandoned;与显式 status 冲突时报诊断", async () => {
        const plotFacadeMock = plotFacade as {
            updateStoryPromise: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.updateStoryPromise.mockResolvedValueOnce({id: "5", status: "abandoned"});
        const tool = createPlotTools().find((item) => item.key === "save_story_promise");

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "abandon",
            promiseId: "5",
        });
        expect(plotFacadeMock.updateStoryPromise).toHaveBeenCalledWith(5, {status: "abandoned"});

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "fulfill",
            promiseId: "5",
            status: "open",
        })).rejects.toThrow("action=fulfill 会把 status 置为 fulfilled");
    });

    it("save_promise_beat action=set 缺少 kind 时返回可读中文诊断;action=remove 拒绝多余字段", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_promise_beat");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "set",
            promiseId: "5",
            sceneId: "20",
        })).rejects.toThrow("action=set 必须提供 kind");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "remove",
            promiseId: "5",
            sceneId: "20",
            kind: "payoff",
        })).rejects.toThrow("action=remove 只需要 promiseId 与 sceneId");
    });

    it("get_story_promise 无 promiseId 走列表模式,有 promiseId 走详情", async () => {
        const plotFacadeMock = plotFacade as {
            listStoryPromises: ReturnType<typeof vi.fn>;
            getStoryPromiseDetailDto: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.listStoryPromises.mockResolvedValueOnce([{id: "5", status: "open"}]);
        plotFacadeMock.getStoryPromiseDetailDto.mockResolvedValueOnce({id: "5", beats: []});
        const tool = createPlotTools().find((item) => item.key === "get_story_promise");

        const listResult = await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
        });
        expect(plotFacadeMock.listStoryPromises).toHaveBeenCalledWith();
        expect(listResult.details).toMatchObject([{id: "5"}]);

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            promiseId: "5",
        });
        expect(plotFacadeMock.getStoryPromiseDetailDto).toHaveBeenCalledWith(5);
    });

    it("get_story_decision 无 decisionId 走列表模式,有 decisionId 走详情", async () => {
        const plotFacadeMock = plotFacade as {
            listStoryDecisions: ReturnType<typeof vi.fn>;
            getStoryDecisionDto: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.listStoryDecisions.mockResolvedValueOnce([{id: "8", status: "open"}]);
        plotFacadeMock.getStoryDecisionDto.mockResolvedValueOnce({id: "8", options: []});
        const tool = createPlotTools().find((item) => item.key === "get_story_decision");

        const listResult = await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
        });
        expect(plotFacadeMock.listStoryDecisions).toHaveBeenCalledWith();
        expect(listResult.details).toMatchObject([{id: "8"}]);

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            decisionId: "8",
        });
        expect(plotFacadeMock.getStoryDecisionDto).toHaveBeenCalledWith(8);
    });

    it("save_story_decision action=create 拒绝 decided 态字段并要求 name/title/question", async () => {
        const tool = createPlotTools().find((item) => item.key === "save_story_decision");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "create",
            name: "d-liya-truth",
            title: "莉雅误召真相",
            question: "何时揭示?",
            risk: "提前写死",
        })).rejects.toThrow("action=create 建立 open 态决策");

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "create",
            name: "d-liya-truth",
            title: "莉雅误召真相",
        })).rejects.toThrow("必须提供 name、title 和 question");
    });

    it("save_story_decision action=decide 置 status=decided;与显式 status 冲突时报诊断;action=drop 置 dropped", async () => {
        const plotFacadeMock = plotFacade as {
            updateStoryDecision: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.updateStoryDecision.mockResolvedValue({id: "8", status: "decided"});
        const tool = createPlotTools().find((item) => item.key === "save_story_decision");

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "decide",
            decisionId: "8",
            decision: "第15章揭示",
            motivation: "同场收束",
            risk: "前置章需微量提示",
            chosenOption: "第15章揭示",
        });
        expect(plotFacadeMock.updateStoryDecision).toHaveBeenCalledWith(8, expect.objectContaining({
            status: "decided",
            decision: "第15章揭示",
            risk: "前置章需微量提示",
            chosenOption: "第15章揭示",
        }));

        await expect(tool?.executeWithContext?.(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "decide",
            decisionId: "8",
            status: "open",
        })).rejects.toThrow("action=decide 会把 status 置为 decided");

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-1", {
            projectRoot: "novel-1",
            action: "drop",
            decisionId: "8",
            note: "子情节删除,问题失效",
        });
        expect(plotFacadeMock.updateStoryDecision).toHaveBeenLastCalledWith(8, expect.objectContaining({
            status: "dropped",
            note: "子情节删除,问题失效",
        }));
    });

    it("省略 threadId/sceneId 时不会跨 Project 复用 plot.selection", async () => {
        const harness = {
            async readSessionContext() {
                return {
                    customState: {
                        [PLOT_SELECTION_STATE_KEY]: {
                            projectRoot: "novel-1",
                            threadId: "10",
                            sceneId: "20",
                        },
                    },
                };
            },
        } as unknown as NeuroAgentHarness;
        const tool = createPlotTools().find((item) => item.key === "save_story_thread");

        await expect(tool?.executeWithContext?.(testContext(harness), "plot-1", {
            projectRoot: "novel-2",
            action: "update",
            title: "Other novel thread",
        })).rejects.toThrow("plot.selection 属于 projectRoot=novel-1");
    });

    it("get_scene_world_context 返回 Scene 的 World Engine 上下文并更新 selection", async () => {
        const appended: unknown[] = [];
        const plotFacadeMock = plotFacade as {
            getSceneWorldContext: ReturnType<typeof vi.fn>;
            getStorySceneDetailDto: ReturnType<typeof vi.fn>;
            getStoryThreadDetailDto: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getSceneWorldContext.mockResolvedValueOnce({
            slices: [{id: "slice-1", time: "第1日", title: "祭坛苏醒", summary: "火焰亮起。", kind: "scene", patchCount: 2}],
            subjectStates: [{subjectId: "hero", type: "character", name: "主角", attrs: {hp: 8}}],
            unresolvedSubjectIds: ["future-subject"],
        });
        const harness = {
            async readSessionContext() {
                return {customState: {}};
            },
            async appendCustomState(_sessionId: number, key: string, value: unknown) {
                appended.push({key, value});
                return {};
            },
        } as unknown as NeuroAgentHarness;
        const tool = createPlotTools().find((item) => item.key === "get_scene_world_context");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectRoot: "novel-1",
            sceneId: "20",
        })).toBe(true);
        const result = await tool!.executeWithContext!(testContext(harness, "writer"), "plot-1", {
            projectRoot: "novel-1",
            sceneId: "20",
        });

        expect(plotFacadeMock.getSceneWorldContext).toHaveBeenCalledWith(20);
        expect(result.details).toEqual({
            slices: [expect.objectContaining({id: "slice-1"})],
            subjectStates: [expect.objectContaining({subjectId: "hero"})],
            unresolvedSubjectIds: ["future-subject"],
        });
        expect(appended).toEqual([{
            key: PLOT_SELECTION_STATE_KEY,
            value: expect.objectContaining({
                projectRoot: "novel-1",
                sceneId: "20",
            }),
        }]);
    });

    it("get_chapter_writer_brief 返回 markdown text 和完整 details，且不读写 plot.selection", async () => {
        const plotFacadeMock = plotFacade as {
            getChapterWriterBrief: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getChapterWriterBrief.mockResolvedValueOnce({
            chapter: {id: "7", name: "001-opening", title: "开篇"},
            mode: "autonomous",
            status: "ready",
            scenes: [],
            totalScenes: 0,
            suggestedReading: [],
            warnings: [],
            suggestedBriefMarkdown: "# Brief\n\n写作交接。",
        });
        const harness = {
            readSessionContext: vi.fn(async () => ({customState: {}})),
            appendCustomState: vi.fn(async () => ({})),
        } as unknown as NeuroAgentHarness & {
            readSessionContext: ReturnType<typeof vi.fn>;
            appendCustomState: ReturnType<typeof vi.fn>;
        };
        const tool = createPlotTools().find((item) => item.key === "get_chapter_writer_brief");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectRoot: "novel-1",
            chapterId: "7",
        })).toBe(true);
        const result = await tool!.executeWithContext!(testContext(harness), "plot-brief-1", {
            projectRoot: "novel-1",
            chapterId: "7",
        });

        expect(plotFacadeMock.getChapterWriterBrief).toHaveBeenCalledWith(7, "autonomous");
        expect(result.content).toEqual([{type: "text", text: "# Brief\n\n写作交接。"}]);
        expect(result.details).toMatchObject({
            chapter: {id: "7", name: "001-opening"},
            status: "ready",
            suggestedBriefMarkdown: "# Brief\n\n写作交接。",
        });
        expect(harness.readSessionContext).not.toHaveBeenCalled();
        expect(harness.appendCustomState).not.toHaveBeenCalled();
    });

    it("同路径 reopen 后拒绝旧 invocation generation，不查询 latest", async () => {
        const staleReady = {generation: 1, workspace: {ref: {projectRoot: "novel-1"}}} as ReadyProjectSessionRef;
        const harness = emptyHarness() as NeuroAgentHarness & {
            projectForInvocation: ReturnType<typeof vi.fn>;
        };
        harness.projectForInvocation = vi.fn(() => staleReady);
        requireActiveReadyProjectMock.mockClear();
        runReadyProjectOperationMock.mockImplementationOnce(async (ready) => {
            if (ready === staleReady) {
                throw new Error("stale Project generation");
            }
            throw new Error("unexpected generation");
        });
        const tool = createPlotTools().find((item) => item.key === "get_chapter_writer_brief");

        await expect(tool!.executeWithContext!({
            ...testContext(harness),
            currentProject: staleReady,
        }, "plot-stale-generation", {
            projectRoot: "novel-1",
            chapterId: "7",
        })).rejects.toThrow("stale Project generation");
        expect(requireActiveReadyProjectMock).not.toHaveBeenCalled();
    });

    it("省略 projectRoot 时复用当前 exact generation，不查询全局 ready session", async () => {
        const plotFacadeMock = plotFacade as {
            getChapterWriterBrief: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getChapterWriterBrief.mockResolvedValueOnce({
            suggestedBriefMarkdown: "# Current",
        });
        requireActiveReadyProjectMock.mockClear();
        runReadyProjectOperationMock.mockClear();
        const tool = createPlotTools().find((item) => item.key === "get_chapter_writer_brief");

        expect(Value.Check(tool!.parameters, {chapterId: "7"})).toBe(true);
        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-current-project", {
            chapterId: "7",
        });

        expect(requireActiveReadyProjectMock).not.toHaveBeenCalled();
        expect(runReadyProjectOperationMock).toHaveBeenCalledWith(currentReady, expect.any(Function));
        expect(activateReadyProjectModuleMock).toHaveBeenCalledWith(currentReady, expect.anything());
    });

    it("显式跨 Project override 在目标 generation operation 内执行", async () => {
        const plotFacadeMock = plotFacade as {
            getChapterWriterBrief: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getChapterWriterBrief.mockResolvedValueOnce({
            suggestedBriefMarkdown: "# Override",
        });
        requireActiveReadyProjectMock.mockClear();
        runReadyProjectOperationMock.mockClear();
        const tool = createPlotTools().find((item) => item.key === "get_chapter_writer_brief");

        await tool!.executeWithContext!(testContext(emptyHarness()), "plot-cross-project", {
            projectRoot: "novel-2",
            chapterId: "7",
        });

        expect(requireActiveReadyProjectMock).toHaveBeenCalledWith({projectRoot: "novel-2"});
        expect(runReadyProjectOperationMock).toHaveBeenCalledWith(overrideReady, expect.any(Function));
        expect(activateReadyProjectModuleMock).toHaveBeenCalledWith(overrideReady, expect.anything());
    });
});

/**
 * 构造工具执行上下文。
 */
function testContext(harness: NeuroAgentHarness, profileKey = "leader.default"): ToolExecutionContext {
    if (!("projectForInvocation" in harness)) {
        Object.assign(harness, {
            projectForInvocation: vi.fn(() => currentReady),
        });
    }
    return {
        harness,
        sessionId: 1,
        profileKey,
        workspaceRoot: absoluteFsPath(path.resolve(".agent", "plot-tools-test")),
        currentProject: currentReady,
        invocationId: "plot-tools-test-invocation",
    };
}

/**
 * 空 plot.selection 的最小 harness mock；appendCustomState 静默吞掉 selection 写入。
 */
function emptyHarness(): NeuroAgentHarness {
    return {
        async readSessionContext() {
            return {customState: {}};
        },
        async appendCustomState() {
            return {};
        },
    } as unknown as NeuroAgentHarness;
}
