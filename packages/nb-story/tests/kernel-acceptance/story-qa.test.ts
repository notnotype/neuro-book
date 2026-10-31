/**
 * nb-harness 新内核的验收门（w00032 t20 第 10 片）：用新内核（`@notnotype/nb-harness/kernel` 与 `/kernel/testing`）
 * 重写一遍 nb-story 的 `story.qa` Profile 与 `answer` 收尾工具，用 nb-story 自己的工具、读原文账本、答案校验与防剧透，
 * 真实书库与 100 章样例书，只把模型换成脚本。五个场景：两轮、收尾、校验失败再交、中止、出站过滤防剧透。
 *
 * 只加测试、不改 nb-story 的产品代码；依赖方向不变（nb-story 用 nb-harness）。nb-story 迁到新内核在迁移 Task。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {defineProfile, type AnyProfile, type LogEvent, type SessionEnv} from "@notnotype/nb-harness/kernel";
import {createTestSession, type TestSession, type TestTool} from "@notnotype/nb-harness/kernel/testing";
import {Type} from "typebox";

import {openTestBook, type TestBook} from "../../testing/api";
import {ReadLedger} from "../../src/qa/read-ledger";
import {resolveReach, type Reach} from "../../src/qa/reach";
import {ANSWER_RULES, COMMON_RULES, STRUCTURED_RULES} from "../../src/qa/rules";
import {createVisibility, HIDDEN_VALUE} from "../../src/qa/spoiler";
import {ANSWER_TOOL_ID, storyQaPlugin, type QaToolState} from "../../src/qa/tools";

let book: TestBook;
beforeAll(async () => {
    book = await openTestBook("kernel-acceptance");
});
afterAll(async () => {
    await book.close();
});

/** 阅读位置 38.57：夏桃桃第 60 章之后才出场，位置之前搜不到；苏天晴在位置之前就有。 */
const AT = {chapter: 38, paragraph: 57};

/** 新内核写的 `story.qa`：系统提示词照 nb-story 的规则，工具按 id 声明（`answer` 可选）。 */
const storyQa = defineProfile({
    id: "story.qa",
    version: "1",
    name: "剧情问答",
    description: "按阅读位置回答小说剧情问题，查图、读原文，用 answer 交卷；可以追问。",
    initial: Type.Object({title: Type.String(), at: Type.String()}),
    tools: {optional: [ANSWER_TOOL_ID]},
    system: ({initial}) => [`你是熟读小说原文的读者，回答关于小说《${initial.title}》的问题。读者读到了 ${initial.at}：只依据这个位置以前的内容回答。`, ANSWER_RULES, STRUCTURED_RULES, COMMON_RULES].join("\n\n"),
}) as AnyProfile;

interface Question {
    readonly state: QaToolState;
    readonly reach: Reach;
    readonly tools: TestTool[];
}

/** 一问的状态与工具：nb-story 的 `storyQaPlugin` 交出的声明与实现，换成新内核的工具形状。 */
async function question(hold?: {tool: string; until: Promise<void>; started: () => void}): Promise<Question> {
    const session = await book.api.openBook("fox");
    const reach = await resolveReach(session, AT);
    const state: QaToolState = {book: session, at: reach.at, graphAt: reach.graphAt, reach, staleGraph: null, ledger: new ReadLedger({paragraphs: reach.paragraphs, at: reach.at, maxChapters: 3, readAll: false}), answer: null};
    const plugin = storyQaPlugin(state, reach.features, "structured");
    const tools = (plugin.tools ?? []).map(({declaration, impl}): TestTool => ({
        id: declaration.id,
        providerName: declaration.name ?? declaration.id.replace(".", "_"),
        description: declaration.description ?? declaration.id,
        parameters: declaration.parameters as never,
        finish: declaration.finish === true,
        concurrency: declaration.concurrency ?? "exclusive",
        effect: "read",
        execute: async (args) => {
            if (hold !== undefined && declaration.id === hold.tool) {
                hold.started();
                await hold.until;
            }
            const result = await impl.execute(args as never, undefined as never);
            const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
            return {text, status: result.isError === true ? "error" : "ok"};
        },
    }));
    return {state, reach, tools};
}

const read = (from: object, to: object) => ({tool: "story.read", args: {from, to}});
const answer = (fields: Record<string, unknown> = {}) => ({tool: ANSWER_TOOL_ID, args: {conclusion: "结论", conclusionType: "推断", explanation: "说明", evidence: ["38.55"], coverage: "第 38 章", ...fields}});
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);
const initial = {title: "我的狐狸女友是魔法少女", at: "38.57"};

async function sessionFor(q: Question, extra: {outbound?: SessionEnv["outbound"]} = {}): Promise<TestSession> {
    return createTestSession({profile: storyQa, initial, tools: q.tools, ...extra});
}

describe("nb-story 验收门：新内核写的 story.qa", () => {
    test("场景 1、2：两轮对话；读过原文后 answer 单独调用即收尾，运行以 finished 结束、结果是答案", async () => {
        const q = await question();
        await using session = await sessionFor(q);
        session.model.script({tools: [read({chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})]}, {tools: [answer()]});
        const first = await session.say("苏天晴在第 38 章做了什么？");
        expect(first.result).toMatchObject({reason: "finished", stopReason: "finished", result: {via: "tool", tool: ANSWER_TOOL_ID, valid: true, value: {evidence: ["38.55"]}}});
        expect(q.state.answer).toMatchObject({conclusion: "结论"});
        expect(dataOf(first.events, "toolResult").map((data) => [data.tool, data.status, data.text])).toEqual([["story.read", "ok", expect.stringContaining("38.55")], [ANSWER_TOOL_ID, "ok", "已交卷"]]);
        expect(first.requests).toHaveLength(2);

        session.model.script("她答应和南嘉鱼交朋友。");
        const second = await session.say("那她后来和谁成了朋友？");
        expect(second.result).toMatchObject({reason: "completed", text: "她答应和南嘉鱼交朋友。"});
        // 第二轮的请求带着第一轮：读原文的调用、结果与交卷都在历史里。
        expect(second.requests[0]!.outline()).toEqual([
            "system: fixed:profile",
            "user: event:input",
            "assistant: call:story.read",
            "tool: event:toolResult",
            "assistant: call:story.answer",
            "tool: event:toolResult",
            "user: event:input",
        ]);
    });

    test("场景 3：出处没读过时 answer 被 nb-story 的校验退回（普通工具错误），模型读了原文再交，运行以 finished 结束", async () => {
        const q = await question();
        await using session = await sessionFor(q);
        session.model.script({tools: [answer({evidence: ["38.20"]})]}, {tools: [read({chapter: 38, paragraph: 20}, {chapter: 38, paragraph: 20})]}, {tools: [answer({evidence: ["38.20"]})]});
        const report = await session.say("第 38 章开头发生了什么？");
        const results = dataOf<{tool: string; status: string; text: string}>(report.events, "toolResult");
        expect(results[0]).toMatchObject({tool: ANSWER_TOOL_ID, status: "error"});
        expect(results[0]!.text).toContain("答案没有通过校验");
        expect(report.result).toMatchObject({reason: "finished", result: {value: {evidence: ["38.20"]}}});
        expect(report.requests).toHaveLength(3);
    });

    test("场景 4：查书时中止，运行以 aborted 收口；之后的提问照常", async () => {
        let started!: () => void;
        const running = new Promise<void>((resolve) => {
            started = resolve;
        });
        let release!: () => void;
        const until = new Promise<void>((resolve) => {
            release = resolve;
        });
        const q = await question({tool: "story.card", until, started});
        await using session = await sessionFor(q);
        session.model.script({tools: [{tool: "story.card", args: {entity: "苏天晴"}}]});
        const sent = await session.raw.send({commandId: "ask-1", input: {text: "苏天晴是谁？"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        await running;
        const aborting = session.raw.abort({commandId: "stop"});
        release();
        await aborting;
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("aborted");
        session.model.script("她是狐狸。");
        expect((await session.say("简单说说？")).result).toMatchObject({reason: "completed", text: "她是狐狸。"});
    });

    test("场景 5：出站过滤用 nb-story 的防剧透：给人看的日志里搜不到位置之后才出现的词，模型与存下的日志原样", async () => {
        const later = "夏桃桃";
        const q = await question();
        const visibility = createVisibility(q.state.book, q.reach);
        const outbound: SessionEnv["outbound"] = {
            event: async (event, reader) => {
                if (reader.kind !== "user") return event;
                if (event.type === "assistant") {
                    const data = event.data as {content: {kind: string}[]; toolCalls: {id: string; tool: string; args: Record<string, unknown>}[]};
                    const toolCalls = await Promise.all(data.toolCalls.map(async (call) => ({...call, args: await visibility.args({...call.args}, call.id)})));
                    return {...event, data: {...data, content: data.content.filter((block) => block.kind !== "thinking"), toolCalls}};
                }
                // 新内核多一种带参数的事件：toolStarted 记的是实际执行的参数，同样要换掉（迁移时宿主的过滤要覆盖它）。
                if (event.type === "toolStarted") {
                    const data = event.data as {callId: string; args: Record<string, unknown>};
                    return {...event, data: {...data, args: await visibility.args({...data.args}, data.callId)}};
                }
                if (event.type === "toolResult") {
                    const data = event.data as {callId: string; text: string};
                    return {...event, data: {...data, text: visibility.result(data.callId, data.text)}};
                }
                return event;
            },
        };
        await using session = await sessionFor(q, {outbound});
        session.model.script(
            {thinking: `想想${later}`, tools: [{tool: "story.search", args: {query: later}}, {tool: "story.search", args: {query: "苏天晴"}}]},
            {tools: [read({chapter: 38, paragraph: 55}, {chapter: 38, paragraph: 55})]},
            {tools: [answer()]},
        );
        const shown: string[] = [];
        const stop = session.raw.subscribe((frame) => {
            if (frame.type === "log") shown.push(JSON.stringify(frame.event));
        });
        const report = await session.say("那个新角色是谁？");
        expect(report.result.reason).toBe("finished");
        const forUser = (await session.raw.log({afterSeq: 0})).events;
        const userCalls = dataOf<{toolCalls: {args: {query?: string}}[]}>(forUser, "assistant")[0]!.toolCalls.map((call) => call.args.query);
        expect(userCalls).toEqual([HIDDEN_VALUE, "苏天晴"]);
        expect(JSON.stringify(forUser)).not.toContain(later);
        stop();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(shown.join("")).not.toContain(later);
        // 模型看到的、日志本身没有被改：给另一个读者（父会话）看的是原样，下一次请求里还带着原词。
        const raw = (await session.raw.as({kind: "session", id: "internal"}).log({afterSeq: 0})).events;
        expect(JSON.stringify(raw)).toContain(later);
        expect(JSON.stringify(report.requests[1]!.raw.messages)).toContain(later);
    });
});
