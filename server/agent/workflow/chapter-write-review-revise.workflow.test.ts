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
 * chapter-write-review-revise 的无模型运行级回归：
 * catalog 真编译 Type 注入源码，MockAgentPort 按 message 前缀 / mode 分流真实控制流。
 */
describe("chapter-write-review-revise workflow", () => {
    const catalog = new WorkflowCatalog(
        resolve("assets", "workspace", ".nbook", "agent", "workflows"),
        resolve(".agent", "tmp", "chapter-wrr-test", "no-user-root"),
    );
    const chapterPath = "manuscript/001-volume/001-chapter/index.md";
    const chapterBody = "# 第一章 星陨遗迹\n薇洛丝在遗迹深处解开了封印。";

    /** 从 catalog 取定义；缺失时让测试以明确错误失败。 */
    async function workflow(key: string): Promise<WorkflowDefinition> {
        const item = await catalog.get(key);
        if (!item) throw new Error(`测试所需 workflow 不存在：${key}`);
        return item.def;
    }

    test("正常路径：写 → 两轮三维评审 → 一轮修订后收敛", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        const events: WorkflowEvent[] = [];
        let writerInvokes = 0;
        // writer：首轮 prompt 写正文，followup 轮修订，都用 summary 回报。
        agents.register("writer", (turn): {message: string; data: JsonValue} => {
            writerInvokes++;
            if (turn.mode === "followup") {
                return {
                    message: "修订完成",
                    data: {summary: "按 major 意见补足了动机铺垫", outputPath: chapterPath},
                };
            }
            return {
                message: "章节写作完成",
                data: {summary: "薇洛丝解封莉雅并遭遇邪教徒", outputPath: chapterPath},
            };
        });
        // 评审：三维度共用 responder，按轮次分流——第一轮 1 个 major，第二轮全空。
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (!turn.message?.startsWith("你是章节评审")) throw new Error(`意外的评审 message：${turn.message}`);
            const round = turn.message.match(/第 (\d+) 轮/u)?.[1] ?? "?";
            return {
                message: `第 ${round} 轮评审完成`,
                data: {
                    overall: `第 ${round} 轮整体评价`,
                    issues: round === "1"
                        ? [{severity: "major", problem: "动机铺垫不足", revision: "补一段解封前的心理描写"}]
                        : [],
                },
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({[chapterPath]: chapterBody}),
            onEvent: (event) => events.push(event),
        });

        const view = await runner.start(await workflow("chapter-write-review-revise"), {
            chapterPath,
            brief: "本章目标：解开封印并遭遇邪教徒。",
            reviewRounds: "2",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            chapterPath,
            converged: true,
            finalSummary: "按 major 意见补足了动机铺垫",
            finalLength: chapterBody.length,
            rounds: [
                {
                    round: 1,
                    reviews: [
                        {dimension: "consistency", overall: "第 1 轮整体评价", issues: [{severity: "major"}]},
                        {dimension: "pacing", overall: "第 1 轮整体评价"},
                        {dimension: "style", overall: "第 1 轮整体评价"},
                    ],
                    revisionSummary: "按 major 意见补足了动机铺垫",
                },
                {
                    round: 2,
                    reviews: [
                        {dimension: "consistency", issues: []},
                        {dimension: "pacing", issues: []},
                        {dimension: "style", issues: []},
                    ],
                },
            ],
        });
        const rounds = (view.result as {rounds: unknown[]}).rounds;
        expect(rounds).toHaveLength(2);
        // writer 恰好被调 2 次：1 写 + 1 修。
        expect(writerInvokes).toBe(2);

        // 参与者：1 个非 ephemeral 的真实 writer + 每轮 3 个 ephemeral adhoc 评审。
        const creates = view.journal
            .filter((record) => record.kind === "agents.create")
            .map((record) => JSON.parse(record.fingerprint) as {profileKey?: string; ephemeral?: boolean});
        expect(creates.filter((params) => params.profileKey === "writer")).toMatchObject([{ephemeral: false}]);
        expect(creates.filter((params) => params.profileKey === "adhoc")).toHaveLength(6);
        for (const params of creates.filter((item) => item.profileKey === "adhoc")) {
            expect(params.ephemeral).toBe(true);
        }

        // 阶段推进跑满 write → review → revise → review → finalize。
        const phases = events
            .flatMap((event) => event.type === "progress" && event.state.phase ? [event.state.phase] : [])
            .filter((phase, index, all) => index === 0 || all[index - 1] !== phase);
        expect(phases).toEqual(["write", "review", "revise", "review", "finalize"]);
        // 成功路径终点：move 到 final 并 leave。
        const chartOps = events.flatMap((event) => event.type === "chart" ? [event.op] : []);
        expect(chartOps.filter((op) => op.op === "move" && op.to === "final")).toMatchObject([{from: "gate", label: "已收敛"}]);
        expect(chartOps.at(-1)).toMatchObject({op: "leave", key: "final"});
    });

    test("提前收敛：首轮无 major 则一轮结束且不修订", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let writerInvokes = 0;
        agents.register("writer", (): {message: string; data: JsonValue} => {
            writerInvokes++;
            return {message: "章节写作完成", data: {summary: "首轮即达标", outputPath: chapterPath}};
        });
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            const round = turn.message?.match(/第 (\d+) 轮/u)?.[1] ?? "?";
            return {
                message: `第 ${round} 轮评审完成`,
                data: {overall: "没有必须修订的问题", issues: []},
            };
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({[chapterPath]: chapterBody}),
        });

        const view = await runner.start(await workflow("chapter-write-review-revise"), {
            chapterPath,
            brief: "本章目标：解开封印。",
            reviewRounds: "2",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({converged: true, finalSummary: "首轮即达标"});
        const rounds = (view.result as {rounds: {revisionSummary?: string}[]}).rounds;
        expect(rounds).toHaveLength(1);
        expect(rounds[0]!.revisionSummary).toBeUndefined();
        // writer 只被调了写作一次，没有修订轮。
        expect(writerInvokes).toBe(1);
    });

    test("chapterPath 缺失：在创建任何 agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("writer", () => {
            invokes++;
            return {message: "不应调用"};
        });
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({[chapterPath]: chapterBody}),
        });

        const view = await runner.start(await workflow("chapter-write-review-revise"), {
            brief: "只有 brief 没有路径",
        });

        expect(view.status).toBe("failed");
        expect(view.error).toContain("缺少 chapterPath");
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });
});
