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
 * consistency-audit 内置 workflow 的无模型运行级回归：
 * catalog 真编译 Type 注入源码，MockAgentPort 按 message 前缀分流审计员/汇总员。
 */
describe("consistency-audit workflow", () => {
    const catalog = new WorkflowCatalog(
        resolve("assets", "workspace", ".nbook", "agent", "workflows"),
        resolve(".agent", "tmp", "consistency-audit-test", "no-user-root"),
    );

    /** 从 catalog 取定义；缺失时让测试以明确错误失败。 */
    async function workflow(): Promise<WorkflowDefinition> {
        const item = await catalog.get("consistency-audit");
        if (!item) throw new Error("测试所需 workflow 不存在：consistency-audit");
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

    const chapterOne = "manuscript/001-volume/001-chapter/index.md";
    const chapterTwo = "manuscript/001-volume/002-chapter/index.md";

    test("正常路径：逐章并发审计透传 issues，跨章汇总给出 verdict", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let auditorInvokes = 0;
        let mergerInvokes = 0;
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("汇总一致性审计结果")) {
                mergerInvokes++;
                return {
                    message: "跨章汇总完成",
                    data: {
                        summary: "两章之间存在时间线冲突",
                        crossChapterIssues: [{
                            chapters: [chapterOne, chapterTwo],
                            kind: "timeline",
                            explanation: "第一章说三日后启程，第二章却写次日已到北城",
                            suggestion: "统一行程耗时",
                        }],
                        verdict: "has-major",
                    },
                };
            }
            if (turn.message?.startsWith("审计章节")) {
                auditorInvokes++;
                if (turn.message.includes(chapterOne)) {
                    return {
                        message: "第一章审计完成",
                        data: {
                            facts: ["阿青左臂重伤", "阿青在南镇"],
                            issues: [{
                                kind: "injury",
                                severity: "major",
                                quote: "他抬起左臂稳稳接住飞剑",
                                explanation: "审计基准记载阿青左臂重伤未愈，无法发力",
                                suggestion: "改为右臂或补写伤愈过程",
                            }],
                        },
                    };
                }
                return {
                    message: "第二章审计完成",
                    data: {facts: ["阿青抵达北城"], issues: []},
                };
            }
            throw new Error(`未识别的 mock 消息前缀：${turn.message?.slice(0, 30)}`);
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                [chapterOne]: "# 第一章\n阿青在南镇休整，左臂缠着绷带。他抬起左臂稳稳接住飞剑。",
                [chapterTwo]: "# 第二章\n次日阿青抵达北城。",
                "lorebook/character/aqing/index.md": "# 阿青\n左臂重伤未愈，无法发力。",
            }),
        });

        const view = await runner.start(await workflow(), {
            chapterPaths: [chapterOne, chapterTwo],
            lorebookPaths: "lorebook/character/aqing/index.md",
            worldFacts: "阿青当前位置：南镇。",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            chapterCount: 2,
            auditedChapters: [
                {path: chapterOne, factCount: 2, issues: [{kind: "injury", severity: "major"}]},
                {path: chapterTwo, factCount: 1, issues: []},
            ],
            skippedLorebook: [],
            crossChapterIssues: [{chapters: [chapterOne, chapterTwo], kind: "timeline"}],
            verdict: "has-major",
            summary: "两章之间存在时间线冲突",
        });
        expect(auditorInvokes).toBe(2);
        expect(mergerInvokes).toBe(1);
        expectAdhocParticipants(view.journal, 3);
    });

    test("lorebook 容错：读不到的路径记入 skippedLorebook 而不失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("汇总一致性审计结果")) {
                return {
                    message: "跨章汇总完成",
                    data: {summary: "未发现矛盾", crossChapterIssues: [], verdict: "clean"},
                };
            }
            return {message: "章节审计完成", data: {facts: ["阿青在南镇"], issues: []}};
        });
        const runner = new WorkflowRunner({sessions, agents}, {
            workspace: createMemoryWorkspace({
                [chapterOne]: "# 第一章\n阿青在南镇。",
                "lorebook/character/aqing/index.md": "# 阿青\n剑客。",
            }),
        });

        const view = await runner.start(await workflow(), {
            chapterPaths: chapterOne,
            lorebookPaths: "lorebook/character/aqing/index.md,lorebook/missing/index.md",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            chapterCount: 1,
            skippedLorebook: ["lorebook/missing/index.md"],
            verdict: "clean",
        });
    });

    test("章节清单为空且 manuscript/index.md 缺失时，在创建任何 agent 前失败", async () => {
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

        const view = await runner.start(await workflow(), {chapterPaths: ""});

        expect(view.status).toBe("failed");
        expect(view.error).toContain("chapterPaths");
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });
});
