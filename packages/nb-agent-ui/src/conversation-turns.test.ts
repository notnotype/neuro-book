import {describe, expect, it} from "bun:test";
import type {AssistantMessageView, MessageView, RunView, ToolCallView, UserMessageView} from "./types";
import {createAgentViewRegistry} from "./registry";
import {builtinToolRenderers} from "./builtin-tools";
import {agentRef} from "./text";
import {assignTurnKeys, buildTurns, defaultTurnExpanded, reuseTurnGroups, splitIntoTurnGroups, type BuildTurnsInput, type ChainBlock, type ConversationTurn, type ToolGroupStep, type TurnBlock} from "./conversation-turns";

const builtinToolsContribution = {source: "builtin:tools", tools: builtinToolRenderers};
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

    it("一轮中途的压缩（t11）：整轮收起时分隔线也在 processDividers 里；最终回复之后的不算", () => {
        const [turn] = buildTurns(input([
            user("u1", "写"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            {kind: "system", id: "c1", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "摘要"},
            assistant("a2", {text: "写好了"}),
            {kind: "system", id: "c2", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "又压缩"},
        ]));
        expect(turn!.foldable).toBe(true);
        expect(turn!.processDividers.map((block) => block.id)).toEqual(["c1"]);
        expect(turn!.trailing.map((block) => block.id)).toEqual(["c2"]);
    });

    it("只压缩的运行（t11）：它没有用户消息，上一轮不算运行中，仍可收起；分隔线落在上一轮后面", () => {
        const messages: MessageView[] = [
            user("u1", "写"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "写好了"}),
        ];
        const [whileCompacting] = buildTurns(input(messages, {run: {status: "running", phase: "", kind: "compact"}}));
        expect(whileCompacting!.status).toBe("done");
        expect(whileCompacting!.foldable).toBe(true);
        // 对照：普通运行里最新一轮跟随运行状态。
        const [normal] = buildTurns(input(messages, running));
        expect(normal!.status).toBe("running");
        const [idle] = buildTurns(input(messages, {run: {status: "idle", phase: ""}}));
        const [after] = buildTurns(input([...messages, {kind: "system", id: "c1", timestamp: tick() + 3_600_000, source: "compaction", label: "上下文已压缩", text: "摘要"}], {run: {status: "idle", phase: ""}}));
        expect(after!.trailing.map((block) => block.id)).toEqual(["c1"]);
        expect(after!.status).toBe("done");
        // 手动压缩可以在回复完成很久之后：这一轮的用时不受它影响。
        expect(after!.metrics.durationMs).toBe(idle!.metrics.durationMs);
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
            agentRef("toolGroup.read", {count: 2}),
            agentRef("toolGroup.search", {count: 1}),
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
            tools: [{id: "atlas_lookup", toolNames: ["atlas_lookup"], category: "explore", icon: "i-lucide-map", label: "查地图", summary: () => "", groupPhrase: (calls) => (agentRef("toolGroup.lookup", {count: calls.length})), presentation: "line"}],
        }]);
        const turns = buildTurns(input([
            user("u1", "查"),
            assistant("a1", {toolCalls: [tool("x1", "atlas_lookup", {}), tool("x2", "atlas_lookup", {}), tool("r1", "read", {path: "a.md"})]}),
        ], {registry: withPlugin}));

        const group = chains(turns[0]!)[0]!.entries[0] as ToolGroupStep;
        expect(group.kind).toBe("toolGroup");
        expect(group.tools).toHaveLength(3);
    });

    it("组短语按渲染器分别收到组里自己的调用，按时间顺序，出错与运行中的也在（验收 31）", () => {
        const received: string[][] = [];
        const chapters = createAgentViewRegistry([builtinToolsContribution, {
            source: "plugin:story",
            tools: [{
                id: "story_read", toolNames: ["story_read"], category: "explore", icon: "i-lucide-book-open", label: "读原文", summary: () => "", presentation: "line",
                groupPhrase: (calls) => {
                    received.push(calls.map((call) => `${call.id}:${call.status}`));
                    const done = calls.filter((call) => call.status === "success").map((call) => (call.args as {chapter: number}).chapter);
                    return `读了第 ${Math.min(...done)}–${Math.max(...done)} 章`;
                },
            }],
        }]);
        const turns = buildTurns(input([
            user("u1", "查"),
            assistant("a1", {toolCalls: [
                tool("s1", "story_read", {chapter: 33}), tool("r1", "read", {path: "a.md"}), tool("s2", "story_read", {chapter: 41}, "error"),
                tool("s3", "story_read", {chapter: 37}), tool("s4", "story_read", {chapter: 38}, "running"),
            ]}),
        ], {registry: chapters, ...running}));

        const group = chains(turns[0]!)[0]!.entries[0] as ToolGroupStep;
        expect(received.at(-1)).toEqual(["s1:success", "s2:error", "s3:success", "s4:running"]);
        expect(group.phrases).toEqual(["读了第 33–37 章", agentRef("toolGroup.read", {count: 1})]);
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

describe("buildTurns 结果节点（验收 20）", () => {
    const answerTool = {id: "answer", toolNames: ["answer"], category: "interact" as const, icon: "i-lucide-message-square-text", label: "作答", summary: () => "", presentation: "node" as const, outcome: true};
    const withAnswer = createAgentViewRegistry([builtinToolsContribution, {source: "test:story", tools: [answerTool]}]);

    function answered(trailingDivider: boolean, closingText = ""): ConversationTurn {
        const messages: MessageView[] = [
            user("u1", "谁知道钟声的秘密？"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "第三章.md"})]}),
            assistant("a2", {toolCalls: [tool("q1", "answer", {conclusion: "林默"}, "error")]}),
            assistant("a3", {toolCalls: [tool("q2", "answer", {conclusion: "林默知道"})]}),
        ];
        if (closingText !== "") messages.push(assistant("a4", {text: closingText}));
        if (trailingDivider) messages.push({kind: "system", id: "c1", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "…"});
        return buildTurns(input(messages, {registry: withAnswer}))[0]!;
    }

    it("交成功的那次是结果，整轮收起后仍露出；被退回的那次是思维链里的一行，前后合成同一条思维链（验收 29）", () => {
        const turn = answered(false);
        expect(shape(turn)).toEqual(["chain(tool,boundary,tool)", "node"]);
        expect(turn.blocks[turn.outcomeStart]!.id).toBe("q2");
        expect(chains(turn)[0]!.entries.map((entry) => entry.id)).toEqual(["r1", "a2:boundary", "q1"]);
        expect(turn.foldable).toBe(true);
        expect(turn.metrics.steps).toBe(2);
        expect(turn.outcomeMessage?.id).toBe("a3");
        expect(turn.outcomeCallId).toBe("q2");
    });

    it("结果之后跟着压缩分隔线时，分隔线移到 trailing，答案仍是结果", () => {
        const turn = answered(true);
        expect(shape(turn, turn.trailing)).toEqual(["divider"]);
        expect(turn.blocks[turn.outcomeStart]!.id).toBe("q2");
    });

    it("结果节点之后还有最终回复时，操作条作用于最终回复", () => {
        const turn = answered(false, "以上是我的回答。");
        expect(shape(turn).slice(turn.outcomeStart)).toEqual(["node", "reply"]);
        expect(turn.outcomeMessage?.id).toBe("a4");
        expect(turn.outcomeCallId).toBeNull();
        expect(turn.metrics.steps).toBe(2);
    });

    it("一条消息交了两个成功的结果节点：两个都不计操作次数；结果节点改的文件照常算进改动文件", () => {
        const reporting = createAgentViewRegistry([builtinToolsContribution, {source: "test:story", tools: [
            answerTool,
            {...answerTool, id: "report", toolNames: ["report"], effects: () => ({read: [], changed: [{path: "报告.md", added: 3, removed: 0}]})},
        ]}]);
        const turn = buildTurns(input([
            user("u1", "写报告并作答"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "第三章.md"})]}),
            assistant("a2", {toolCalls: [tool("q1", "answer", {conclusion: "甲"}), tool("w1", "report", {})]}),
        ], {registry: reporting}))[0]!;
        expect(shape(turn).slice(turn.outcomeStart)).toEqual(["node", "node"]);
        expect(turn.metrics.steps).toBe(1);
        expect(turn.changedFiles.map((file) => file.change.path)).toEqual(["报告.md"]);
        expect(turn.metrics.filesChanged).toBe(1);
    });

    it("全部被退回时这一轮没有结果区：只有一条思维链，整轮可以收起（验收 29）", () => {
        const turn = buildTurns(input([
            user("u1", "谁知道钟声的秘密？"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "第三章.md"})]}),
            assistant("a2", {toolCalls: [tool("q1", "answer", {conclusion: "林默"}, "error")]}),
        ], {registry: withAnswer}))[0]!;
        expect(shape(turn)).toEqual(["chain(tool,boundary,tool)"]);
        expect(turn.outcomeStart).toBe(turn.blocks.length);
        expect(turn.outcomeCallId).toBeNull();
        expect(turn.foldable).toBe(true);
    });

    it("运行中的结果调用仍是节点；参数无效的与运行结束时还没有结果的进思维链（宿主标成出错或仍留着在写都一样）", () => {
        const running = buildTurns(input([user("u1", "问"), assistant("a1", {status: "streaming", toolCalls: [tool("q1", "answer", {conclusion: "林"}, "streaming")]})], {registry: withAnswer, run: {status: "running", phase: ""}}))[0]!;
        expect(shape(running)).toEqual(["node"]);
        for (const status of ["invalid", "error", "streaming", "running"] as const) {
            const ended = buildTurns(input([user("u1", "问"), assistant("a1", {status: "stopped", toolCalls: [tool("q1", "answer", {}, status)]})], {registry: withAnswer}))[0]!;
            expect(shape(ended)).toEqual(["chain(tool)"]);
        }
    });

    it("回复之后依次是压缩分隔线与系统提醒：分隔线移到 trailing，提醒留在结果区，回复仍是结果（验收 29）", () => {
        const turn = buildTurns(input([
            user("u1", "改稿"),
            assistant("a1", {toolCalls: [tool("r1", "read", {path: "a.md"})]}),
            assistant("a2", {text: "改好了"}),
            {kind: "system", id: "c1", timestamp: tick(), source: "compaction", label: "上下文已压缩", text: "…"},
            {kind: "system", id: "n1", timestamp: tick(), source: "reminder", label: "提醒", text: "记得保存"},
        ]))[0]!;
        expect(shape(turn).slice(turn.outcomeStart)).toEqual(["reply", "notice"]);
        expect(shape(turn, turn.trailing)).toEqual(["divider"]);
        expect(turn.outcomeMessage?.id).toBe("a2");
    });

    it("附注跟着消息：有文字时随文字（不成块），没有文字的单独成块、像信息条目一样留在结果区（验收 28）", () => {
        const note = {customType: "story.refs", text: "没核实的出处：41.20"};
        const turn = buildTurns(input([
            user("u1", "问"),
            assistant("a1", {text: "先查一下", toolCalls: [tool("r1", "read", {path: "a.md"})], annotations: [note]}),
            assistant("a2", {text: "第 37 章", annotations: [note]}),
            assistant("a3", {annotations: [note]}),
        ]))[0]!;
        expect(shape(turn)).toEqual(["chain(text,tool)", "reply", "annotations"]);
        expect(shape(turn).slice(turn.outcomeStart)).toEqual(["reply", "annotations"]);
        expect(turn.outcomeMessage?.id).toBe("a2");
        const narration = chains(turn)[0]!.entries[0]!;
        expect(narration.kind === "text" && narration.message.annotations).toEqual([note]);
    });

    it("没有声明为结果的节点不算结果", () => {
        const turn = buildTurns(input([user("u1", "列个计划"), assistant("a1", {toolCalls: [tool("k1", "task_create", {title: "计划"})]})]))[0]!;
        expect(turn.outcomeStart).toBe(turn.blocks.length);
        expect(turn.outcomeMessage).toBeNull();
    });
});

describe("buildTurns 汇总", () => {
    it("统计用时、工具次数、模型回复次数、读写文件数、tokens 与费用；改动文件按路径合并，只算成功的调用", () => {
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
            durationMs: clock - start, steps: 7, requests: 3, failed: 2, filesRead: 1, filesChanged: 2, tokens: 410, cost: 0.03,
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

    it("有一条消息单价未知，整轮费用就是未知；免费模型的 0 照常相加", () => {
        const unknown = buildTurns(input([
            user("u1", "a"),
            assistant("a1", {usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01}}),
            assistant("a2", {usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null}, text: "完成"}),
        ]));
        expect(unknown[0]!.metrics).toMatchObject({tokens: 30, cost: null});

        const free = buildTurns(input([user("u2", "b"), assistant("a3", {usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0}, text: "完成"})]));
        expect(free[0]!.metrics).toMatchObject({tokens: 15, cost: 0});
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

describe("reuseTurnGroups", () => {
    it("消息逐条相同的那组沿用上一次的数组；有新消息的那组换成新的", () => {
        const messages = [user("u1", "写第一章"), assistant("a1", {text: "好。"}), user("u2", "再写第二章")];
        const before = splitIntoTurnGroups(messages);
        const after = reuseTurnGroups(before, splitIntoTurnGroups([...messages, assistant("a2", {text: "写好了。"})]));
        expect(after[0]).toBe(before[0]);
        expect(after[1]).not.toBe(before[1]);
        expect(after[1]!.map((message) => message.id)).toEqual(["u2", "a2"]);
    });

    it("宿主沿用带附注的消息对象时整轮沿用；给消息加附注换成新对象时这一轮重算（README 的引用稳定约定）", () => {
        const answered = {...assistant("a1", {text: "第 37 章"}), annotations: [{customType: "story.refs", text: "没核实的出处：41.20"}]};
        const messages = [user("u1", "谁知道？"), answered];
        const before = splitIntoTurnGroups(messages);
        expect(reuseTurnGroups(before, splitIntoTurnGroups([...messages]))[0]).toBe(before[0]);
        const reannotated = {...answered, annotations: [...answered.annotations, {customType: "story.refs", text: "没核实的出处：41.21"}]};
        expect(reuseTurnGroups(before, splitIntoTurnGroups([messages[0]!, reannotated]))[0]).not.toBe(before[0]);
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
