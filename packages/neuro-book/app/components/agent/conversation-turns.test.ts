import {describe, expect, it} from "vitest";
import type {AssistantMessageView, MessageView, RunView, ToolCallView, UserMessageView} from "./agent-view.types";
import {createAgentViewRegistry} from "./agent-view-registry";
import {builtinToolsContribution} from "./builtin-tools";
import {assignTurnKeys, buildTurns, defaultTurnExpanded, splitIntoTurnGroups, type BuildTurnsInput, type ChainBlock, type ConversationTurn, type ToolGroupStep, type TurnBlock} from "./conversation-turns";

const registry = createAgentViewRegistry([builtinToolsContribution]);

let clock = 0;
const tick = () => (clock += 1000);

function user(id: string, text: string, intent: UserMessageView["intent"] = "normal"): UserMessageView {
    return {kind: "user", id, timestamp: tick(), intent, blocks: [{kind: "text", text}], contentOmitted: false};
}

function tool(id: string, name: string, args: ToolCallView["args"], status: ToolCallView["status"] = "success"): ToolCallView {
    return {id, name, status, args};
}

function assistant(id: string, patch: Partial<AssistantMessageView> = {}): AssistantMessageView {
    return {
        kind: "assistant", id, timestamp: tick(), status: "done", text: "", thinking: "", model: "m",
        toolCalls: [], contentOmitted: false, ...patch,
    };
}

function input(messages: MessageView[], patch: Partial<BuildTurnsInput> = {}): BuildTurnsInput {
    const run: RunView = {status: "idle", phase: ""};
    return {messages, registry, run, history: {hasMore: false, loading: false, error: null}, now: clock + 60_000, ...patch};
}

/** 块的种类序列；思维链写成 `chain(条目种类…)`，方便一眼对照。 */
function shape(turn: ConversationTurn, blocks: TurnBlock[] = turn.blocks): string[] {
    return blocks.map((block) => block.kind === "chain"
        ? `chain(${block.entries.map((entry) => entry.kind).join(",")})`
        : block.kind === "content" && block.final ? "reply" : block.kind);
}

function chains(turn: ConversationTurn): ChainBlock[] {
    return turn.blocks.filter((block): block is ChainBlock => block.kind === "chain");
}

const running: Partial<BuildTurnsInput> = {run: {status: "running", phase: ""}};

describe("buildTurns 轮次边界", () => {
    it("每条普通用户消息开启一轮，steer 在当前轮里常显并切开思维链", () => {
        const turns = buildTurns(input([
            user("u1", "写第一章"),
            assistant("a1", {toolCalls: [tool("t1", "read", {path: "outline.md"})]}),
            user("s1", "语气轻松一点", "steer"),
            assistant("a2", {text: "好的，第一章写完了。"}),
            user("u2", "再写第二章"),
            assistant("a3", {text: "第二章完成。"}),
        ]));

        expect(turns.map((turn) => turn.id)).toEqual(["u1", "u2"]);
        expect(shape(turns[0]!)).toEqual(["chain(tool)", "steer", "reply"]);
        expect(turns[0]!.finalReply?.id).toBe("a2");
    });

    it("第一条用户消息之前的内容组成开场轮次；系统提示词只进思维链", () => {
        const turns = buildTurns(input([
            {kind: "system", id: "p", timestamp: tick(), source: "prompt", label: "系统提示", text: "…"},
            assistant("a0", {text: "你好，我是写作助手。"}),
            user("u1", "开始"),
        ]));

        expect(turns).toHaveLength(2);
        expect(turns[0]!.user).toBeNull();
        expect(turns[0]!.truncatedStart).toBe(false);
        expect(shape(turns[0]!)).toEqual(["chain(prompt)", "reply"]);
    });

    it("历史不完整时，第一组没有用户消息的内容标记为开头不完整，且不报用时", () => {
        const turns = buildTurns(input([
            assistant("a1", {toolCalls: [tool("t1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "已完成。"}),
            user("u2", "下一步"),
        ], {history: {hasMore: true, loading: false, error: null}}));

        expect(turns[0]!.truncatedStart).toBe(true);
        expect(turns[0]!.metrics.durationMs).toBeNull();
        expect(turns[1]!.truncatedStart).toBe(false);
    });
});

describe("buildTurns 三层", () => {
    it("结束后：中间 content 并入思维链，只有最终回复常显；消息边界留在思维链里", () => {
        const turns = buildTurns(input([
            user("u1", "改第三章"),
            assistant("a1", {text: "我先读一下。", toolCalls: [tool("b1", "bash", {command: "wc"})]}),
            assistant("a2", {thinking: "想想", text: "开始改。", toolCalls: [tool("e1", "edit", {path: "c3.md", edits: []})]}),
            assistant("a3", {thinking: "收尾", text: "改好了。"}),
        ]));

        expect(shape(turns[0]!)).toEqual(["chain(text,tool,boundary,thinking,text,tool,boundary,thinking)", "reply"]);
        expect(chains(turns[0]!)[0]!.summary).toMatchObject({steps: 2, filesChanged: 1, others: 1, thinking: true, messages: 3});
    });

    it("运行中：中间 content 常显，并把思维链切开", () => {
        const turns = buildTurns(input([
            user("u1", "改第三章"),
            assistant("a1", {thinking: "先想", text: "我先读一下。", toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {toolCalls: [tool("r2", "read", {path: "b.md"}, "running")]}),
        ], running));

        expect(shape(turns[0]!)).toEqual(["chain(thinking)", "content", "chain(toolGroup)"]);
        expect(chains(turns[0]!)[1]!.active?.id).toBe("r2");
    });

    it("交互控件常显并切开思维链；普通卡片留在思维链里", () => {
        const turns = buildTurns(input([
            user("u1", "a"),
            assistant("a1", {toolCalls: [tool("t1", "task_create", {title: "清单"}), tool("b1", "bash", {command: "ls"})]}),
            assistant("a2", {toolCalls: [tool("wf1", "run_workflow", {workflowKey: "polish"}), tool("q1", "request_user_input", {questions: []})]}),
            assistant("a3", {text: "完成"}),
        ]));

        expect(shape(turns[0]!)).toEqual(["node", "chain(tool)", "node", "node", "reply"]);
        expect(turns[0]!.blocks.filter((block) => block.kind === "node").map((block) => block.id)).toEqual(["t1", "wf1", "q1"]);
    });

    it("系统提醒与自定义消息常显为信息条目，压缩为分隔线；提问回答后仍在同一轮", () => {
        const turns = buildTurns(input([
            user("u1", "a"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            {kind: "system", id: "rem", timestamp: tick(), source: "reminder", label: "提醒", text: "…"},
            {kind: "system", id: "c1", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "…"},
            {kind: "system", id: "x1", timestamp: tick(), source: "custom", label: "插件", text: "…"},
            assistant("a2", {text: "ok"}),
        ]));

        expect(turns).toHaveLength(1);
        expect(shape(turns[0]!)).toEqual(["chain(tool)", "notice", "divider", "notice", "reply"]);
    });

    it("最终回复之后的分隔线移到 trailing", () => {
        const turns = buildTurns(input([
            user("u1", "a"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "完成"}),
            {kind: "system", id: "c1", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "…"},
            user("u2", "b"),
        ]));

        expect(shape(turns[0]!)).toEqual(["chain(tool)", "reply"]);
        expect(turns[0]!.trailing.map((block) => block.id)).toEqual(["c1"]);
    });
});

describe("buildTurns 最终回复", () => {
    it("带工具调用的消息不是最终回复，即使正文非空", () => {
        const turns = buildTurns(input([
            user("u1", "查一下"),
            assistant("a1", {text: "我先看看大纲。", toolCalls: [tool("t1", "read", {path: "outline.md"})]}),
        ]));

        expect(turns[0]!.finalReply).toBeNull();
        expect(shape(turns[0]!)).toEqual(["chain(text,tool)"]);
    });

    it("最终回复之后若还有工具调用，则本轮没有最终回复", () => {
        const turns = buildTurns(input([
            user("u1", "开始"),
            assistant("a1", {text: "中间总结"}),
            assistant("a2", {toolCalls: [tool("t1", "read", {path: "x.md"})]}),
        ]));

        expect(turns[0]!.finalReply).toBeNull();
    });

    it("最终回复的思考在它上方的思维链里，正文不重复", () => {
        const turns = buildTurns(input([user("u1", "开始"), assistant("a1", {thinking: "想一想", text: "结论"})]));

        expect(shape(turns[0]!)).toEqual(["chain(thinking)", "reply"]);
        expect(turns[0]!.finalReply?.text).toBe("结论");
    });
});

describe("buildTurns 探查工具分组", () => {
    it("连续探查合成一组，思考与消息边界并入组内；常显条目、说明文字与改文件结束分组", () => {
        const turns = buildTurns(input([
            user("u1", "改第三章"),
            assistant("a1", {thinking: "先读", toolCalls: [tool("r1", "read", {path: "c1.md"})]}),
            assistant("a2", {thinking: "再读", toolCalls: [tool("r2", "read", {path: "c2.md"}), tool("s1", "web_search", {query: "唐代官制"})]}),
            {kind: "system", id: "rem", timestamp: tick(), source: "reminder", label: "提醒", text: "…"},
            assistant("a3", {toolCalls: [tool("r3", "read", {path: "c3.md"}), tool("r4", "read", {path: "c4.md"})]}),
            assistant("a4", {text: "读完了，开始改。", toolCalls: [tool("e1", "edit", {path: "c3.md", edits: [{oldText: "a\nb", newText: "c"}]})]}),
            assistant("a5", {text: "改好了。"}),
        ]));

        expect(shape(turns[0]!)).toEqual(["chain(thinking,toolGroup)", "notice", "chain(toolGroup,boundary,text,tool)", "reply"]);
        const group = chains(turns[0]!)[0]!.entries[1] as ToolGroupStep;
        expect(group.tools.map((step) => step.id)).toEqual(["r1", "r2", "s1"]);
        expect(group.items.map((item) => item.kind)).toEqual(["tool", "boundary", "thinking", "tool", "tool"]);
        expect(group.phrases).toEqual([
            {key: "agentView.toolGroup.read", params: {count: 2}},
            {key: "agentView.toolGroup.search", params: {count: 1}},
        ]);
    });

    it("只有一次探查时不成组；组尾的思考与边界不被吞进组里", () => {
        const turns = buildTurns(input([
            user("u1", "看一下"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {thinking: "想想", toolCalls: [tool("b1", "bash", {command: "ls"})]}),
        ]));

        expect(shape(turns[0]!)).toEqual(["chain(tool,boundary,thinking,tool)"]);
    });

    it("插件登记的探查工具与内置读取并入同一组", () => {
        const withPlugin = createAgentViewRegistry([builtinToolsContribution, {
            source: "plugin:atlas",
            tools: [{id: "atlas_lookup", toolNames: ["atlas_lookup"], category: "explore", icon: "i-lucide-map", label: "查地图", summary: () => "", presentation: "line"}],
        }]);
        const turns = buildTurns(input([
            user("u1", "查"),
            assistant("a1", {toolCalls: [tool("x1", "atlas_lookup", {}), tool("x2", "atlas_lookup", {}), tool("r1", "read", {path: "a.md"})]}),
        ], {registry: withPlugin}));

        const group = chains(turns[0]!)[0]!.entries[0] as ToolGroupStep;
        expect(group.kind).toBe("toolGroup");
        expect(group.tools).toHaveLength(3);
    });

    it("运行中的组记录当前执行项，出错项单独列出；思维链统计失败次数", () => {
        const turns = buildTurns(input([
            user("u1", "查"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"}, "error"), tool("r2", "read", {path: "b.md"}, "running")]}),
        ], {run: {status: "running", phase: "读取文件"}}));

        const chain = chains(turns[0]!)[0]!;
        const group = chain.entries[0] as ToolGroupStep;
        expect(group.active?.id).toBe("r2");
        expect(group.failed.map((step) => step.id)).toEqual(["r1"]);
        expect(chain.summary.failed).toBe(1);
        // 失败和尚未结束的调用都不算“其余操作”。
        expect(chain.summary.others).toBe(0);
        expect(chain.active?.id).toBe("r2");
    });
});

describe("buildTurns 状态", () => {
    it("最新一轮跟随运行状态；较早的轮次按结尾判定", () => {
        const messages = [user("u1", "a"), assistant("a1", {text: "ok"}), user("u2", "b"), assistant("a2", {status: "streaming"})];
        expect(buildTurns(input(messages, running)).map((turn) => turn.status)).toEqual(["done", "running"]);
        expect(buildTurns(input(messages, {run: {status: "stopping", phase: ""}}))[1]!.status).toBe("running");
        expect(buildTurns(input(messages, {run: {status: "waiting", phase: ""}}))[1]!.status).toBe("waiting");
    });

    it("出错：错误常显在末尾", () => {
        const turns = buildTurns(input([
            user("u1", "写"),
            assistant("a1", {status: "error", error: "模型服务暂时不可用"}),
        ]));

        expect(turns[0]!.status).toBe("error");
        expect(turns[0]!.blocks.at(-1)).toMatchObject({kind: "error", message: "模型服务暂时不可用"});
    });

    it("独立错误条目结束的轮次也是出错；中断视为出错", () => {
        expect(buildTurns(input([
            user("u1", "写"),
            {kind: "error", id: "e1", timestamp: tick(), message: "连接中断", retryable: true},
        ]))[0]!.status).toBe("error");
        expect(buildTurns(input([user("u1", "写"), assistant("a1", {status: "interrupted"})]))[0]!.status).toBe("error");
    });

    it("被停止：状态为 stopped，已生成的正文仍作为最终回复", () => {
        const turns = buildTurns(input([user("u1", "写"), assistant("a1", {status: "stopped", text: "写到一半"})]));

        expect(turns[0]!.status).toBe("stopped");
        expect(turns[0]!.finalReply?.id).toBe("a1");
    });
});

describe("buildTurns 整轮收起", () => {
    it("已结束且有过程的轮次可收起；只有回复、运行中或等待时不可收起", () => {
        const withProcess = [user("u1", "a"), assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}), assistant("a2", {text: "完成"})];
        expect(buildTurns(input(withProcess))[0]!.foldable).toBe(true);
        expect(buildTurns(input([user("u1", "a"), assistant("a1", {text: "完成"})]))[0]!.foldable).toBe(false);
        expect(buildTurns(input(withProcess, running))[0]!.foldable).toBe(false);
        expect(buildTurns(input(withProcess, {run: {status: "waiting", phase: ""}}))[0]!.foldable).toBe(false);
    });

    it("结果是末尾连续的最终回复与错误；过程中途的错误属于过程", () => {
        const turn = buildTurns(input([
            user("u1", "a"),
            {kind: "error", id: "e1", timestamp: tick(), message: "网络抖动", retryable: true},
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "完成"}),
        ]))[0]!;
        expect(shape(turn)).toEqual(["error", "chain(tool)", "reply"]);
        expect(turn.outcomeStart).toBe(2);
    });

    it("最终回复之后的系统提醒跟着结果显示，不把最终回复收进过程", () => {
        const turn = buildTurns(input([
            user("u1", "a"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "完成"}),
            {kind: "system", id: "s1", timestamp: tick(), source: "reminder", label: "System Reminder", text: "提醒"},
        ]))[0]!;
        expect(shape(turn)).toEqual(["chain(tool)", "reply", "notice"]);
        expect(turn.outcomeStart).toBe(1);
    });

    it("只有错误的轮次不可收起；默认只展开最新一轮的出错或停止", () => {
        const [done, error] = buildTurns(input([
            user("u1", "a"), assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}), assistant("a2", {text: "ok"}),
            user("u2", "b"), assistant("a3", {toolCalls: [tool("r2", "read", {path: "b.md"})]}), assistant("a4", {status: "error", error: "x"}),
        ]));
        expect(buildTurns(input([user("u1", "a"), assistant("a1", {status: "error", error: "x"})]))[0]!.foldable).toBe(false);
        expect(defaultTurnExpanded(done!, false)).toBe(false);
        expect(defaultTurnExpanded(error!, true)).toBe(true);
        expect(defaultTurnExpanded(error!, false)).toBe(false);
    });
});

describe("buildTurns 汇总", () => {
    it("统计用时、工具次数、读写文件数、tokens 与费用；改动文件按路径合并，只算成功的调用", () => {
        const start = clock + 1000;
        const turns = buildTurns(input([
            user("u1", "改稿"),
            assistant("a1", {
                usage: {input: 100, output: 20, cacheRead: 50, cacheWrite: 0, cost: 0.01},
                toolCalls: [tool("r1", "read", {path: "a.md"}), tool("r2", "read", {path: "a.md"}), tool("r3", "read", {path: "b.md"}, "error")],
            }),
            assistant("a2", {
                usage: {input: 200, output: 30, cacheRead: 0, cacheWrite: 10, cost: 0.02},
                toolCalls: [
                    tool("e1", "edit", {path: "a.md", edits: [{oldText: "x\ny", newText: "z"}]}),
                    tool("e2", "edit", {path: "a.md", edits: [{oldText: "q", newText: "q1\nq2\nq3"}]}),
                    tool("w1", "write", {path: "c.md", content: "1\n2\n"}),
                    tool("w2", "write", {path: "d.md", content: "x"}, "error"),
                ],
            }),
            assistant("a3", {text: "完成"}),
        ]));

        const {metrics, changedFiles} = turns[0]!;
        expect(metrics).toEqual({
            durationMs: clock - start, steps: 7, failed: 2, filesRead: 1, filesChanged: 2, tokens: 410, cost: 0.03,
            usage: {input: 300, output: 50, cacheRead: 50, cacheWrite: 10},
        });
        expect(changedFiles).toEqual([
            {toolCallId: "e2", change: {path: "a.md", added: 4, removed: 3}},
            {toolCallId: "w1", change: {path: "c.md", added: 2, removed: null}},
        ]);
    });

    it("没有用量数据时 tokens 与费用为 null；运行中的用时按 now 计算", () => {
        const start = clock + 1000;
        const now = start + 42_000;
        const turns = buildTurns(input([user("u1", "a"), assistant("a1", {status: "streaming"})], {...running, now}));

        expect(turns[0]!.metrics).toMatchObject({durationMs: 42_000, tokens: null, cost: null, usage: null});
    });

    it("apply_patch 按文件统计增删行", () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: ch1.md",
            "@@",
            "-旧句子",
            "+新句子",
            "+补一句",
            "*** Add File: ch2.md",
            "+第二章",
            "*** End Patch",
        ].join("\n");
        const turns = buildTurns(input([user("u1", "a"), assistant("a1", {toolCalls: [tool("p1", "apply_patch", {patch})]})]));

        expect(turns[0]!.changedFiles).toEqual([
            {toolCallId: "p1", change: {path: "ch1.md", added: 2, removed: 1}},
            {toolCallId: "p1", change: {path: "ch2.md", added: 1, removed: 0}},
        ]);
    });
});

describe("assignTurnKeys", () => {
    it("更早一页只补上过程时，开头不完整的轮次仍沿用原来的 key", () => {
        const a3 = assistant("a3", {text: "继续。"});
        const first = assignTurnKeys(splitIntoTurnGroups([a3]), new Map());
        const next = assignTurnKeys(splitIntoTurnGroups([assistant("a1"), user("s1", "补充", "steer"), assistant("a2"), a3]), first);
        expect([...next.entries()]).toEqual([["a1", "a3"]]);
    });

    it("开头不完整的轮次补上用户消息后沿用原来的 key；新一轮收到回复时 key 不变", () => {
        const a1 = assistant("a1", {text: "接着写。"});
        const u2 = user("u2", "下一章");
        const first = assignTurnKeys(splitIntoTurnGroups([a1, u2]), new Map());
        expect([...first.values()]).toEqual(["a1", "u2"]);

        const u1 = user("u1", "开头");
        const a2 = assistant("a2", {text: "好的。"});
        const next = assignTurnKeys(splitIntoTurnGroups([user("u0", "更早"), u1, a1, u2, a2]), first);
        expect([...next.entries()]).toEqual([["u0", "u0"], ["u1", "a1"], ["u2", "u2"]]);
    });
});
