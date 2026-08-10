import {resolve} from "node:path";
import {describe, expect, test} from "vitest";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {
    MemorySessionStore,
    MockAgentPort,
    WorkflowRunner,
    createMemoryWorkspace,
    type JsonValue,
    type WorkflowDefinition,
    type WorkflowEvent,
} from "nbook/server/vendor/nb-workflow/index";

/**
 * 内置 workflow 的无模型运行级回归：catalog 真编译 Type 注入源码，MockAgentPort 执行真实控制流。
 */
describe("bundled workflows", () => {
    const catalog = new WorkflowCatalog(
        resolve("assets", "workspace", ".nbook", "agent", "workflows"),
        resolve(".agent", "tmp", "workflow-builtins-test", "no-user-root"),
    );

    /** 从 catalog 取定义；缺失时让测试以明确错误失败。 */
    async function workflow(key: string): Promise<WorkflowDefinition> {
        const item = await catalog.get(key);
        if (!item) throw new Error(`测试所需 workflow 不存在：${key}`);
        return item.def;
    }

    /** 所有内置参与者都应走 adhoc，而不是借用职责不匹配的正式 profile。 */
    function expectAdhocParticipants(journal: {kind: string; fingerprint: string}[], count: number): void {
        const creates = journal.filter((record) => record.kind === "agents.create");
        expect(creates).toHaveLength(count);
        for (const record of creates) {
            const params = JSON.parse(record.fingerprint) as {
                profileKey?: string;
                ephemeral?: boolean;
                initial?: {outputSchema?: {type?: string}} | null;
            };
            expect(params.profileKey).toBe("adhoc");
            expect(params.ephemeral).toBe(true);
            expect(params.initial?.outputSchema).toMatchObject({type: "object"});
        }
    }

    test("split-book 真读 Project 文件、并发提取结构化章节摘要并汇总", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const events: WorkflowEvent[] = [];
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("请分析以下逐章摘要")) {
                return {
                    message: "全书分析完成",
                    data: {
                        theme: "选择",
                        genre: "幻想",
                        plotStages: ["启程", "对抗"],
                        characterArcs: ["主角学会承担"],
                        openHooks: ["失落钥匙"],
                    },
                };
            }
            return {
                message: "章节摘要完成",
                data: {summary: "章节概括", events: ["关键事件"], characters: ["阿青"]},
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                "manuscript/book.md": "# 第一章\n阿青出发。\n# 第二章\n阿青遇敌。",
            }),
            onEvent: (event) => events.push(event),
        });

        const view = await runner.start(await workflow("split-book"), {path: "manuscript/book.md", maxChapters: 2});

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            path: "manuscript/book.md",
            chapterCount: 2,
            briefs: [
                {chapter: "ch1", heading: "第一章", brief: {summary: "章节概括"}},
                {chapter: "ch2", heading: "第二章", brief: {summary: "章节概括"}},
            ],
            analysis: {theme: "选择", genre: "幻想"},
        });
        expectAdhocParticipants(view.journal, 3);
        const tokens = events.flatMap((event) => event.type === "chart" && event.op.op === "enter"
            && event.op.token.startsWith("ch") ? [event.op.token] : []);
        expect(tokens).toEqual(expect.arrayContaining(["ch1", "ch2"]));
    });

    test("split-book 空书稿在创建任何 Agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({"manuscript/empty.md": "  \n"}),
        });

        const view = await runner.start(await workflow("split-book"), {path: "manuscript/empty.md"});

        expect(view).toMatchObject({status: "failed", error: "书稿为空：manuscript/empty.md"});
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });

    test("chapter-digest 真读章节文件、并发提取摘要并返回写回负载", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            const chapter = turn.message?.match(/章节「(.*?)」/u)?.[1] ?? "未知";
            return {
                message: `${chapter} 摘要完成`,
                data: {summary: `${chapter} 摘要`, characters: ["阿青"], events: ["事件甲"]},
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                "manuscript/001-volume/001-chapter/index.md": "第一章 重生\n正文甲。",
                "manuscript/001-volume/002-chapter/index.md": "第二章 入学\n正文乙。",
            }),
        });

        const view = await runner.start(await workflow("chapter-digest"), {
            chapterPaths: "manuscript/001-volume/001-chapter,manuscript/001-volume/002-chapter",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            processed: 2,
            totalListed: 2,
            digests: [
                {path: "manuscript/001-volume/001-chapter", summary: "第一章 重生 摘要", characters: ["阿青"], events: ["事件甲"]},
                {path: "manuscript/001-volume/002-chapter", summary: "第二章 入学 摘要", characters: ["阿青"], events: ["事件甲"]},
            ],
        });
        expectAdhocParticipants(view.journal, 2);
    });

    test("chapter-digest 缺 chapterPaths 在创建任何 Agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {});

        const view = await runner.start(await workflow("chapter-digest"), {});

        expect(view).toMatchObject({status: "failed", error: "必须提供 chapterPaths：章节目录清单，逗号或换行分隔。"});
        expect(invokes).toBe(0);
    });

    test("chapter-digest 超出 limit 只处理前 N 章并报告总数", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        agents.register("adhoc", () => ({
            message: "摘要完成",
            data: {summary: "摘要", characters: [], events: []},
        }));
        const workspace = createMemoryWorkspace({
            "manuscript/001-chapter/index.md": "第一章\n正文。",
            "manuscript/002-chapter/index.md": "第二章\n正文。",
            "manuscript/003-chapter/index.md": "第三章\n正文。",
        });
        const runner = new WorkflowRunner({sessions, agents}, {workspace});

        const view = await runner.start(await workflow("chapter-digest"), {
            chapterPaths: ["manuscript/001-chapter", "manuscript/002-chapter", "manuscript/003-chapter"].join("\n"),
            limit: "2",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({processed: 2, totalListed: 3});
        expectAdhocParticipants(view.journal, 2);
    });

    test("book-structure-extract 按卷分批粗提取后汇总去重", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("以下是全书")) {
                return {
                    message: "全书汇总完成",
                    data: {
                        threads: [{name: "main-revenge", title: "复仇主线", description: "主角复仇线"}],
                        characters: [{name: "阿青", summary: "主角", arc: "复仇者 → 守护者"}],
                        worldFacts: [{title: "天元大陆", summary: "修炼世界", category: "location"}],
                        openHooks: [{description: "失落钥匙", seededChapter: "第 5 章"}],
                    },
                };
            }
            return {
                message: "卷提取完成",
                data: {
                    threads: [{name: "main-revenge", title: "复仇主线", description: "主角复仇线"}],
                    characters: [{name: "阿青", summary: "主角", arc: "复仇者 → 守护者"}],
                    worldFacts: [{title: "天元大陆", summary: "修炼世界", category: "location"}],
                    openHooks: [{description: "失落钥匙", seededChapter: "第 5 章"}],
                },
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {});

        const view = await runner.start(await workflow("book-structure-extract"), {
            summaries: JSON.stringify([
                {path: "manuscript/001-volume/001-chapter/", title: "第一章 重生", summary: "主角重生"},
                {path: "manuscript/002-volume/001-chapter/", title: "第一章 成长", summary: "主角修炼"},
            ]),
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            chapterCount: 2,
            volumeBatches: 2,
            structure: {
                threads: [{name: "main-revenge", title: "复仇主线"}],
                characters: [{name: "阿青", summary: "主角"}],
                worldFacts: [{title: "天元大陆", category: "location"}],
                openHooks: [{description: "失落钥匙"}],
            },
        });
        expectAdhocParticipants(view.journal, 3);
    });

    test("book-structure-extract 缺 summaries 在创建任何 Agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {});

        const view = await runner.start(await workflow("book-structure-extract"), {});

        expect(view).toMatchObject({status: "failed", error: "必须提供 summaries：逐章摘要 JSON 数组（{path, title, summary}）。"});
        expect(invokes).toBe(0);
    });

    test("write-review-loop 真跑两轮结构化评审修订并返回最终稿", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const events: WorkflowEvent[] = [];
        let writerTurn = 0;
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("评审第")) {
                const round = turn.message.match(/第 (\d+) 轮/u)?.[1] ?? "?";
                return {
                    message: `第 ${round} 轮评审完成`,
                    data: {
                        overall: `第 ${round} 轮整体评价`,
                        issues: [{problem: "因果不足", revision: "补充动机"}],
                    },
                };
            }
            writerTurn++;
            return {
                message: `第 ${writerTurn} 版完成`,
                data: {
                    draft: writerTurn === 1 ? "# 初稿" : `# 修订稿 ${writerTurn - 1}`,
                    changeSummary: `第 ${writerTurn} 版改动`,
                },
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {onEvent: (event) => events.push(event)});

        const view = await runner.start(await workflow("write-review-loop"), {
            brief: "写一段测试文本",
            reviewRounds: 2,
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            reviewRounds: 2,
            initialDraft: "# 初稿",
            finalDraft: "# 修订稿 2",
            reviews: [
                {round: 1, review: {overall: "第 1 轮整体评价"}},
                {round: 2, review: {overall: "第 2 轮整体评价"}},
            ],
        });
        expect(writerTurn).toBe(3);
        expectAdhocParticipants(view.journal, 2);
        const moves = events.flatMap((event) => event.type === "chart" && event.op.op === "move" ? [event.op] : []);
        expect(moves.filter((op) => op.from === "review" && op.to === "revise")).toHaveLength(2);
        expect(moves.at(-1)).toMatchObject({from: "revise", to: "final", label: "采用修订稿"});
    });

    test("parallel-brainstorm 真跑结构化并发分支与汇总，顺序保持输入顺序", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const events: WorkflowEvent[] = [];
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("汇总议题")) {
                return {
                    message: "综合方案完成",
                    data: {
                        candidates: ["候选甲", "候选乙"],
                        recommendation: ["候选甲"],
                        tradeoffs: ["新颖性与成本"],
                        nextSteps: ["先做小样"],
                    },
                };
            }
            return {
                message: "角度脑暴完成",
                data: {ideas: [
                    {idea: "想法一", value: "价值一", risk: "风险一"},
                    {idea: "想法二", value: "价值二", risk: "风险二"},
                    {idea: "想法三", value: "价值三", risk: "风险三"},
                ]},
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {onEvent: (event) => events.push(event)});

        const view = await runner.start(await workflow("parallel-brainstorm"), {
            topic: "测试议题",
            angles: ["角度甲", "角度乙", "角度丙"],
            concurrency: 2,
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            topic: "测试议题",
            angles: ["角度甲", "角度乙", "角度丙"],
            perspectives: [
                {angle: "角度甲", ideas: expect.arrayContaining([expect.objectContaining({idea: "想法一"})])},
                {angle: "角度乙", ideas: expect.arrayContaining([expect.objectContaining({idea: "想法一"})])},
                {angle: "角度丙", ideas: expect.arrayContaining([expect.objectContaining({idea: "想法一"})])},
            ],
            synthesis: {recommendation: ["候选甲"]},
        });
        expectAdhocParticipants(view.journal, 4);
        const branchTokens = events.flatMap((event) => event.type === "chart" && event.op.op === "enter"
            && event.op.token.startsWith("angle-") ? [event.op.token] : []);
        expect(branchTokens).toEqual(expect.arrayContaining(["angle-1", "angle-2", "angle-3"]));
        const mergeEdges = events.flatMap((event) => event.type === "chart" && event.op.op === "edge"
            && event.op.to === "merge" ? [event.op.from] : []);
        expect(mergeEdges).toEqual(expect.arrayContaining(["angle-1", "angle-2", "angle-3"]));
    });
});
