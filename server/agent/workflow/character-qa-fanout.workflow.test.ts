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
 * character-qa-fanout 内置 workflow 的无模型运行级回归：
 * catalog 真编译 Type 注入源码，MockAgentPort 按 message 前缀分流答题员/汇总员。
 */
describe("character-qa-fanout workflow", () => {
    const catalog = new WorkflowCatalog(
        resolve("assets", "workspace", ".nbook", "agent", "workflows"),
        resolve(".agent", "tmp", "character-qa-fanout-test", "no-user-root"),
    );

    /** 从 catalog 取定义；缺失时让测试以明确错误失败。 */
    async function workflow(): Promise<WorkflowDefinition> {
        const item = await catalog.get("character-qa-fanout");
        if (!item) throw new Error("测试所需 workflow 不存在：character-qa-fanout");
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

    /** 构造一条 mock 答题条目：题号 + 指定数量候选。 */
    function mockAnswer(questionId: string, candidateCount: number): JsonValue {
        const candidates = [];
        for (let index = 0; index < candidateCount; index++) {
            candidates.push({answer: `${questionId} 候选 ${index + 1}`, rationale: `${questionId} 解读方向 ${index + 1}`});
        }
        return {questionId, question: `${questionId} 题面`, candidates};
    }

    test("正常路径：7 题按 groupSize 5 拆成 2 组扇出，答案册按题号排序", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let mergerInvokes = 0;
        const groupMessages: string[] = [];
        agents.register("adhoc", (turn): {message: string; data: JsonValue} => {
            if (turn.message?.startsWith("汇总角色问答候选")) {
                mergerInvokes++;
                return {
                    message: "候选汇总完成",
                    data: {
                        notes: "候选整体倾向克制路线，关系素材仍有缺口",
                        conflicts: ["Q24_02 与 Q24_06 的候选对她是否主动接近存在矛盾"],
                    },
                };
            }
            if (turn.message?.startsWith("批量回答角色理解题")) {
                groupMessages.push(turn.message);
                if (turn.message.includes("（第 1 组）")) {
                    // 故意乱序返回，验证 workflow 按题号顺序拼装答案册
                    return {
                        message: "第 1 组答题完成",
                        data: {
                            answers: [
                                mockAnswer("Q24_03", 2),
                                mockAnswer("Q24_01", 2),
                                mockAnswer("Q24_05", 2),
                                mockAnswer("Q24_02", 2),
                                mockAnswer("Q24_04", 2),
                            ],
                        },
                    };
                }
                return {
                    message: "第 2 组答题完成",
                    data: {answers: [mockAnswer("Q24_07", 2), mockAnswer("Q24_06", 2)]},
                };
            }
            throw new Error(`未识别的 mock 消息前缀：${turn.message?.slice(0, 30)}`);
        });
        const runner = new WorkflowRunner({sessions, agents}, {workspace: createMemoryWorkspace({})});

        const view = await runner.start(await workflow(), {
            material: "标签：剑客、嘴硬。印象：危险但克制。已确认设定：左臂旧伤。",
            questions: [
                "Q24_01 这个角色一句话是什么？",
                "Q24_02 她最吸引人的地方是什么？",
                "Q24_03 她最不该被写成什么？",
                "Q24_04 她的核心矛盾是什么？",
                "Q24_05 她的底色是什么？",
                "Q24_06 她最怕什么？",
                "Q24_07 她怎么表达需求？",
            ].join("\n"),
            groupSize: "5",
            candidatesPerQuestion: "2",
        });

        expect(view.status).toBe("completed");
        expect(view.result).toMatchObject({
            questionCount: 7,
            groupCount: 2,
            notes: "候选整体倾向克制路线，关系素材仍有缺口",
            conflicts: ["Q24_02 与 Q24_06 的候选对她是否主动接近存在矛盾"],
        });
        const answers = (view.result as {answers: {questionId: string; candidates: unknown[]}[]}).answers;
        expect(answers.map((answer) => answer.questionId)).toEqual([
            "Q24_01", "Q24_02", "Q24_03", "Q24_04", "Q24_05", "Q24_06", "Q24_07",
        ]);
        for (const answer of answers) expect(answer.candidates).toHaveLength(2);

        // 分组正确：组 1 含前 5 题不含第 6 题，组 2 含后 2 题；候选数要求写进了消息
        expect(groupMessages).toHaveLength(2);
        const first = groupMessages.find((message) => message.includes("（第 1 组）"));
        const second = groupMessages.find((message) => message.includes("（第 2 组）"));
        expect(first).toContain("Q24_01 这个角色一句话是什么？");
        expect(first).toContain("Q24_05 她的底色是什么？");
        expect(first).not.toContain("Q24_06");
        expect(second).toContain("Q24_06 她最怕什么？");
        expect(second).toContain("Q24_07 她怎么表达需求？");
        expect(first).toContain("2 个候选答案");
        expect(mergerInvokes).toBe(1);
        expectAdhocParticipants(view.journal, 3);
    });

    test("material 为空时，在创建任何 agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {workspace: createMemoryWorkspace({})});

        const view = await runner.start(await workflow(), {
            material: "   ",
            questions: "Q24_01 这个角色一句话是什么？",
        });

        expect(view.status).toBe("failed");
        expect(view.error).toContain("material");
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });

    test("questions 解析为空时，在创建任何 agent 前失败", async () => {
        const sessions = new MemorySessionStore();
        const agents = new MockAgentPort(sessions);
        let invokes = 0;
        agents.register("adhoc", () => {
            invokes++;
            return {message: "不应调用"};
        });
        const runner = new WorkflowRunner({sessions, agents}, {workspace: createMemoryWorkspace({})});

        const view = await runner.start(await workflow(), {
            material: "标签：剑客。",
            questions: " \n  \n",
        });

        expect(view.status).toBe("failed");
        expect(view.error).toContain("questions");
        expect(invokes).toBe(0);
        expect(view.journal.some((record) => record.kind === "agents.create")).toBe(false);
    });
});
