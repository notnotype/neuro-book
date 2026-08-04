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
} from "nbook/server/vendor/nb-workflow/index";

/**
 * book-deconstruct 内置 workflow 的无模型运行级回归：
 * catalog 真编译 Type 注入源码，MockAgentPort 按 message 前缀分流章节拆书员/汇总员。
 */
describe("book-deconstruct workflow", () => {
    const catalog = new WorkflowCatalog(
        resolve("assets", "workspace", ".nbook", "agent", "workflows"),
        resolve(".agent", "tmp", "book-deconstruct-test", "no-user-root"),
    );

    /** 从 catalog 取定义；缺失时让测试以明确错误失败。 */
    async function workflow(): Promise<WorkflowDefinition> {
        const item = await catalog.get("book-deconstruct");
        if (!item) throw new Error("测试所需 workflow 不存在：book-deconstruct");
        return item.def;
    }

    /** 所有参与者都应是 ephemeral adhoc，且声明了 outputSchema。 */
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

    /** 固定的章节拆解 mock data（覆盖 ChapterDeconstructSchema 全部关键字段）。 */
    function chapterAnalysis(title: string): JsonValue {
        return {
            hook: `${title}：开场悬念`,
            promises: [{action: "setup", text: "主角终将逆袭"}],
            highlights: ["当众打脸"],
            pacing: "前紧后松",
            infoReveal: "藏身世，露实力",
            endingPush: "章末反转吊住读者",
        };
    }

    /** 固定的拆书报告 mock data（覆盖 BookReportSchema 全部关键字段）。 */
    const bookReport: JsonValue = {
        structure: "三幕式：落魄开局-连环打脸-高潮收束",
        promiseRhythm: "每两章建立一个承诺，间隔一到两章兑现",
        openingTechniques: ["悬念开场", "身份反差"],
        borrowable: ["快节奏打脸循环"],
        risks: ["套路同质化"],
        summary: "整体商业完成度高，节奏是最大卖点",
    };

    /** 注册按 message 前缀分流的 adhoc mock，返回调用计数与拆解到的章节标题清单。 */
    function registerResponders(agents: MockAgentPort): {counters: {analyze: number; synthesize: number}; analyzedTitles: string[]} {
        const counters = {analyze: 0, synthesize: 0};
        const analyzedTitles: string[] = [];
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("汇总拆书报告")) {
                counters.synthesize++;
                return {message: "拆书报告汇总完成", data: bookReport};
            }
            if (turn.message?.startsWith("拆解章节「")) {
                counters.analyze++;
                const title = turn.message.match(/^拆解章节「(.+?)」/u)?.[1] ?? "";
                analyzedTitles.push(title);
                return {message: "章节拆解完成", data: chapterAnalysis(title)};
            }
            throw new Error(`未识别的 mock 消息前缀：${turn.message?.slice(0, 30)}`);
        });
        return {counters, analyzedTitles};
    }

    const chapterTitles = ["第一章 落魄", "第二章 觉醒", "第三章 打脸", "第四章 收获", "第五章 危机", "第六章 转折", "第七章 高潮", "第八章 结局"];

    /** 拼一本番茄 full.md：书名页 + 8 章正文（章内带 h2 小节，验证不会被切碎）。 */
    const fullMd = [
        "# 测试之书",
        "",
        ...chapterTitles.flatMap((title) => [
            `# ${title}`,
            `${title}的正文段落，讲述剧情推进与人物冲突。`,
            "## 章内小节",
            "小节内容属于本章，不应被切成独立章节。",
            "",
        ]),
    ].join("\n");

    test("番茄目录正常路径：跳过书名页，8 章按开头5+结尾1采样，逐章拆解后汇总", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const {counters, analyzedTitles} = registerResponders(agents);
        const bookDir = "reference/tomato/123";
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                [`${bookDir}/metadata.json`]: JSON.stringify({book_name: "测试之书", author: "测试作者", chapter_count: 8}),
                [`${bookDir}/full.md`]: fullMd,
            }),
        });

        const view = await runner.start(await workflow(), {book: bookDir, maxChapters: "6"});

        expect(view.status).toBe("completed");
        // 采样构成：预算 6 = 开头 min(5,6)=5 章 + 结尾 min(2,6-5)=1 章 + 中段配额 0
        expect(view.result).toMatchObject({
            book: bookDir,
            bookName: "测试之书",
            totalChapters: 8,
            sampledChapters: [
                {index: 1, title: "第一章 落魄"},
                {index: 2, title: "第二章 觉醒"},
                {index: 3, title: "第三章 打脸"},
                {index: 4, title: "第四章 收获"},
                {index: 5, title: "第五章 危机"},
                {index: 8, title: "第八章 结局"},
            ],
            report: bookReport,
        });
        // 书名页被跳过：拆解到的标题不含书名，且恰为采样的 6 章
        expect(analyzedTitles).not.toContain("测试之书");
        expect([...analyzedTitles].sort()).toEqual(["第一章 落魄", "第二章 觉醒", "第三章 打脸", "第四章 收获", "第五章 危机", "第八章 结局"].sort());
        const result = view.result as {perChapter: {index: number; title: string; analysis: {hook?: string}}[]};
        expect(result.perChapter).toHaveLength(6);
        expect(result.perChapter[5]).toMatchObject({index: 8, title: "第八章 结局", analysis: {hook: "第八章 结局：开场悬念"}});
        expect(counters.analyze).toBe(6);
        expect(counters.synthesize).toBe(1);
        expectAdhocParticipants(view.journal, 7);
    });

    test("单 .md 输入（无 metadata）：书名取自被跳过的书名页标题，全部章节入选", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const {counters} = registerResponders(agents);
        const bookPath = "reference/import/alone.md";
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                [bookPath]: [
                    "# 孤本残卷",
                    "",
                    "# 第一章 开端",
                    "第一章正文：主角登场，冲突初起，铺陈世界观与人物关系，为后续剧情埋下伏笔。",
                    "",
                    "# 第二章 收束",
                    "第二章正文：冲突化解，留下新的悬念。",
                ].join("\n"),
            }),
        });

        const view = await runner.start(await workflow(), {book: bookPath});

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            book: bookPath,
            bookName: "孤本残卷",
            totalChapters: 2,
            sampledChapters: [
                {index: 1, title: "第一章 开端"},
                {index: 2, title: "第二章 收束"},
            ],
            report: bookReport,
        });
        expect(counters.analyze).toBe(2);
        expect(counters.synthesize).toBe(1);
        expectAdhocParticipants(view.journal, 3);
    });

    test("book 缺失时在创建任何 agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({}),
        });

        const view = await runner.start(await workflow(), {});

        expect(view.status).toBe("failed");
        expect(view.error).toContain("book");
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });
});
