/**
 * 视图：模板、轮的渲染、提交与槽（t20 第 4 片）。测试名里的编号是 docs/specs/harness/profile.md 的输出条目与验收场景。
 * 都经真内核的会话跑；只有 `<ToolName>`、`<If>` 直接调模板渲染（工具集要到第 5 片才接进会话）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, Message, ToolInfo} from "../api/index.js";
import {conv, defineExtension} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {finalOnly, reminder, standardLayout, withoutEvents} from "../helpers/index.js";
import {createTestSession, type TestSession} from "../testing/test-session.js";
import {Assistant, If, P, Slot, System, Tag, ToolName, Turn, User} from "./prompt/nodes.js";
import {renderTemplate} from "./render.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-view");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

type ProfileFields = Omit<Parameters<typeof defineProfile>[0], "id" | "version" | "name" | "description">;
const profileWith = (fields: ProfileFields): AnyProfile => defineProfile({id: "lab.view", version: "1", name: "视图", description: "视图测试", system: "系统", ...fields} as Parameters<typeof defineProfile>[0]) as AnyProfile;

const notes = defineExtension({id: "lab.notes", contribute: {notes: {value: () => "笔记"}}});
const clock = defineExtension({id: "lab.clock", contribute: {clock: {volatile: true, value: ({now}) => `现在 ${now}`}}});
const opener = defineExtension({id: "lab.opener", contribute: {opening: {value: () => "开场"}}});
const remind = reminder({id: "lab.remind", every: 1, text: () => "提醒"});
/** 每个工具结果之后补一条对话事件（位置章是“这一步之后”）。 */
const after = defineExtension({
    id: "lab.after",
    events: {note: conv<{text: string}>()},
    on: {toolResult: (_event, ctx) => ctx.emit("note", {text: "看过结果"})},
    render: {note: () => "扩展给的文字"},
});

const texts = (blocks: readonly {kind: string; text?: string}[]) => blocks.map((block) => block.text);
const codes = async (session: TestSession) => (await session.raw.diagnostics()).map((item) => item.code);

describe("模板", () => {
    test("输出 1：缺省布局依次是系统与稳定的槽、开场、历史、这一轮、会变的槽", async () => {
        await using session = await createTestSession({extensions: [notes, clock, opener]});
        session.model.script("一", "二");
        await session.say("第一句");
        const second = await session.say("第二句");
        expect(second.requests[0]!.outline()).toEqual([
            "system: fixed:profile | slot:notes@lab.notes",
            "user: slot:opening@lab.opener",
            "user: event:input",
            "assistant: event:assistant",
            "user: event:input",
            "user: slot:clock@lab.clock",
        ]);
    });

    test("输出 1：volatile: before-turn 把会变的槽移到这一轮之前；history 的 false 与 {last}", async () => {
        const run = async (profile: AnyProfile) => {
            await using session = await createTestSession({profile, extensions: [clock]});
            session.model.script("一", "二", "三");
            await session.say("第一句");
            await session.say("第二句");
            return (await session.say("第三句")).requests[0]!.outline();
        };
        expect(await run(profileWith({prompt: standardLayout({volatile: "before-turn"})}))).toEqual([
            "system: fixed:profile",
            "user: event:input", "assistant: event:assistant", "user: event:input", "assistant: event:assistant",
            "user: slot:clock@lab.clock",
            "user: event:input",
        ]);
        expect(await run(profileWith({prompt: standardLayout({history: false})}))).toEqual(["system: fixed:profile", "user: event:input", "user: slot:clock@lab.clock"]);
        expect(await run(profileWith({prompt: standardLayout({history: {last: 1}})}))).toEqual(["system: fixed:profile", "user: event:input", "assistant: event:assistant", "user: event:input", "user: slot:clock@lab.clock"]);
        expect(await run(profileWith({prompt: standardLayout({history: {last: 0}})}))).toEqual(["system: fixed:profile", "user: event:input", "user: slot:clock@lab.clock"]);
    });

    test("输出 2、3：容器里每个子节点一块，行内相连；<Tag> 的属性转义，子节点不转义；<User>、<Assistant> 各成一条", async () => {
        const profile = profileWith({prompt: () => (
            <>
                <System>
                    <System />
                    <P>甲<Tag name="rule" attrs={{level: 'a"b<c&d'}}>规则 &lt;b&gt;</Tag>乙</P>
                    {"第三段"}
                    {null}
                </System>
                <User>示例问题</User>
                <Assistant>示例回答</Assistant>
                <Turn />
            </>
        )});
        await using session = await createTestSession({profile});
        session.model.script("好");
        const {requests} = await session.say("问");
        const request = requests[0]!.raw;
        expect(texts(request.system)).toEqual(["系统", '甲<rule level="a&quot;b&lt;c&amp;d">规则 <b></rule>乙', "第三段"]);
        expect(request.messages.map((message) => [message.role, texts(message.content)])).toEqual([["user", ["示例问题"]], ["assistant", ["示例回答"]], ["user", ["问"]]]);
        expect(requests[0]!.outline()[0]).toBe("system: fixed:profile | fixed:profile | fixed:profile");
    });

    test("输出 4：<ToolName> 渲染交给服务商的名字；<If> 只在工具在生效工具集里时渲染", () => {
        const tool = (id: string, providerName?: string): ToolInfo => ({id, ...(providerName === undefined ? {} : {providerName}), description: id, parameters: {}, provider: "lab", version: "1", finish: false, concurrency: "shared", effect: "read"});
        const rendered = renderTemplate(
            <>
                <System>
                    <P>用 <ToolName id="nbook.read" /> 读，用 <ToolName id="nbook.ask" /> 问</P>
                    <If tool="nbook.grep">能搜</If>
                    <If tool="nbook.read">能读</If>
                </System>
                <Turn />
            </>,
            {system: null, tools: [tool("nbook.read"), tool("nbook.ask", "ask_user")], slots: [], history: () => [], turn: () => []},
        );
        expect(texts(rendered.system)).toEqual(["用 nbook__read 读，用 ask_user 问", "能读"]);
    });

    test.each([
        ["<Turn /> 放进容器", "template-invalid", () => <><User><Turn /></User></>],
        ["<System /> 放进 <User>", "template-invalid", () => <><User><System /></User><Turn /></>],
        ["<Slot> 放进行内", "template-invalid", () => <><System><P><Slot name="x" /></P></System><Turn /></>],
        ["没有 <Turn />", "turn-node-count", () => <><System /></>],
        ["两个 <Turn />", "turn-node-count", () => <><Turn /><Turn /></>],
    ] as const)("输出 5：%s 时请求算不出来，运行以 profile-failed 收口", async (_name, code, prompt) => {
        await using session = await createTestSession({profile: profileWith({prompt})});
        session.model.script("不会用到");
        const report = await session.say("问");
        expect(report.result).toMatchObject({reason: "error", error: {kind: "local", code: "profile-failed"}});
        expect(report.events.find((event) => event.type === "extensionFailed")?.data).toEqual({extension: "lab.view", entry: "prompt", code: "invalid-output"});
        expect(report.requests).toHaveLength(0);
        expect(await codes(session)).toContain(code);
    });
});

describe("轮的渲染", () => {
    test("输出 6：附带内容在前、用户的话在最后；回复带工具调用，工具结果各一条，这一步之后的事件合成一条", async () => {
        await using session = await createTestSession({extensions: [remind, after]});
        session.model.script({text: "查一下", tools: [{tool: "lab.search"}]}, "完成");
        const {requests} = await session.say("问");
        expect(requests[1]!.outline()).toEqual([
            "system: fixed:profile",
            "user: event:lab.remind/reminder | event:input",
            "assistant: event:assistant | call:lab.search",
            "tool: event:toolResult",
            "user: event:lab.after/note",
        ]);
        expect(texts(requests[1]!.raw.messages[3]!.content)).toEqual(["扩展给的文字"]);
    });

    test("输出 7：Profile 的 render 优先于扩展的；抛错的 render 用缺省文字并诊断；没有 text 的数据包成 system-reminder", async () => {
        const noisy = defineExtension({
            id: "lab.noisy",
            events: {oops: conv<{text: string}>(), count: conv<{n: number}>()},
            on: {turnStarted: (_event, ctx) => {
                ctx.emit("oops", {text: "原文"});
                ctx.emit("count", {n: 2});
            }},
            render: {oops: () => {
                throw new Error("坏了");
            }},
        });
        const profile = profileWith({dependsOn: [after, noisy], render: {"lab.after/note": () => "Profile 给的文字"}});
        await using session = await createTestSession({profile, extensions: [after, noisy]});
        session.model.script({tools: [{tool: "lab.search"}]}, "完成");
        const {requests} = await session.say("问");
        const messages = requests[1]!.raw.messages;
        expect(texts(messages[0]!.content)).toEqual(["原文", '<system-reminder>\n{"n":2}\n</system-reminder>', "问"]);
        expect(texts(messages.at(-1)!.content)).toEqual(["Profile 给的文字"]);
        const diagnostic = (await session.raw.diagnostics()).find((item) => item.code === "render-threw");
        expect(diagnostic).toMatchObject({extension: "lab.noisy", entry: "render", event: {type: "lab.noisy/oops"}});
    });

    test("输出 8：Profile 覆盖 assistant 时回复渲染成那段文字，工具调用照常保留", async () => {
        const profile = profileWith({render: {assistant: () => "（回复略）", toolResult: () => "（结果略）"}});
        await using session = await createTestSession({profile});
        session.model.script({text: "长长的思考", tools: [{tool: "lab.search"}]}, "完成");
        const {requests} = await session.say("问");
        const [, assistant, tool] = requests[1]!.raw.messages;
        expect(texts(assistant!.content)).toEqual(["（回复略）"]);
        expect(assistant!.toolCalls).toHaveLength(1);
        expect(texts(tool!.content)).toEqual(["（结果略）"]);
    });

    test("输出 9：Profile 的 turn 抛错时运行以 profile-failed 收口（entry: turn）", async () => {
        const profile = profileWith({turn: () => {
            throw new Error("turn 坏了");
        }});
        await using session = await createTestSession({profile});
        const report = await session.say("问");
        expect(report.result.error).toMatchObject({kind: "local", code: "profile-failed"});
        expect(report.events.find((event) => event.type === "extensionFailed")?.data).toEqual({extension: "lab.view", entry: "turn", code: "threw"});
    });
});

describe.each([["内存存储", false], ["JSONL 存储", true]] as const)("提交（%s）", (_name, jsonl) => {
    test("场景 1、输出 10、11、13：commit 每轮只算一次；重开之后算出的历史逐块一致，且不含工具调用", async () => {
        let commits = 0;
        const profile = profileWith({commit: (turn, format) => {
            commits += 1;
            return format.turn(finalOnly(turn));
        }});
        await using session = await createTestSession({profile, ...(jsonl ? {store: {root}} : {})});
        session.model.script({tools: [{tool: "lab.search"}]}, "答一", {tools: [{tool: "lab.search"}]}, "答二", "答三");
        await session.say("第一问");
        const second = await session.say("第二问");
        expect(second.requests.map((request) => request.outline().slice(1, 3))).toEqual([
            ["user: event:input", "assistant: event:assistant"],
            ["user: event:input", "assistant: event:assistant"],
        ]);
        expect(commits).toBe(1);
        const beforeReopen = second.requests[1]!.raw.messages;
        await session.reopen();
        const third = await session.say("第三问");
        const history = third.requests[0]!.raw.messages;
        expect(history.slice(0, 2)).toEqual(beforeReopen.slice(0, 2) as Message[]);
        expect(third.requests[0]!.outline().slice(1)).toEqual(["user: event:input", "assistant: event:assistant", "user: event:input", "assistant: event:assistant", "user: event:input"]);
        expect(texts(history[3]!.content)).toEqual(["答二"]);
        expect(commits).toBe(3);
    });
});

describe("提交的失败", () => {
    test("输出 12：commit 抛错或交回不成对的消息时改用缺省的提交，之后的请求照常", async () => {
        const run = async (commit: NonNullable<ProfileFields["commit"]>) => {
            await using session = await createTestSession({profile: profileWith({commit})});
            session.model.script({tools: [{tool: "lab.search"}]}, "答一", "答二");
            await session.say("第一问");
            const second = await session.say("第二问");
            return {outline: second.requests[0]!.outline(), result: second.result, codes: await codes(session)};
        };
        const threw = await run(() => {
            throw new Error("commit 坏了");
        });
        expect(threw.result.reason).toBe("completed");
        expect(threw.outline).toEqual(["system: fixed:profile", "user: event:input", "assistant: call:lab.search", "tool: event:toolResult", "assistant: event:assistant", "user: event:input"]);
        expect(threw.codes).toContain("commit-threw");
        const invalid = await run((turn, format) => turn.steps.map((step) => format.assistant(step.reply)));
        expect(invalid.result.reason).toBe("completed");
        expect(invalid.outline).toEqual(threw.outline);
        expect(invalid.codes).toContain("commit-invalid");
    });

    test("输出 13：finalOnly 去掉最后一步回复的工具调用（这一轮在工具之后失败）", async () => {
        const profile = profileWith({commit: (turn, format) => format.turn(finalOnly(turn))});
        await using session = await createTestSession({profile});
        session.model.script({text: "先查", tools: [{tool: "lab.search"}]}, {fail: "network"}, "好");
        expect((await session.say("第一问")).result.reason).toBe("error");
        const second = await session.say("第二问");
        expect(second.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input", "assistant: event:assistant", "user: event:input"]);
        expect(await codes(session)).not.toContain("commit-invalid");
    });

    test("输出 14：withoutEvents 在提交时去掉某个依赖的对话事件，进行中的这一轮照常带着", async () => {
        const profile = profileWith({dependsOn: [remind], commit: (turn, format) => format.turn(withoutEvents(turn, remind, "reminder"))});
        await using session = await createTestSession({profile, extensions: [remind]});
        session.model.script("一", "二");
        await session.say("第一问");
        const second = await session.say("第二问");
        expect(second.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input", "assistant: event:assistant", "user: event:lab.remind/reminder | event:input"]);
    });
});

describe("槽", () => {
    test("输出 15：同一个槽的几块按装配序；value 抛错时这个扩展这次不交并诊断", async () => {
        const facts = (id: string, value: () => string) => defineExtension({id, contribute: {facts: {shared: true, value}}});
        await using session = await createTestSession({extensions: [facts("lab.b", () => "乙"), facts("lab.a", () => "甲"), facts("lab.c", () => {
            throw new Error("坏了");
        })]});
        session.model.script("好");
        const {requests} = await session.say("问");
        expect(requests[0]!.outline()[0]).toBe("system: fixed:profile | slot:facts@lab.a | slot:facts@lab.b");
        expect((await session.raw.diagnostics()).find((item) => item.code === "contribute-threw")).toMatchObject({extension: "lab.c", params: {slot: "facts"}});
    });

    test("输出 16：按名字摆放、drop、没摆的丢弃、会变的放进系统块；* 只收没被提到的", async () => {
        const stray = defineExtension({id: "lab.stray", contribute: {stray: {value: () => "没人摆"}}});
        const ignored = defineExtension({id: "lab.ignored", contribute: {ignored: {value: () => "不要"}}});
        const profile = profileWith({prompt: () => (
            <>
                <System><System /><Slot name="clock" /></System>
                <Slot name="notes" />
                <If tool="lab.none"><Slot name="opening" /></If>
                <Turn />
                <Slot name="*" stable />
                <Slot name="ignored" drop />
            </>
        )});
        await using session = await createTestSession({profile, extensions: [clock, notes, opener, stray, ignored]});
        session.model.script("好");
        const {requests} = await session.say("问");
        expect(requests[0]!.outline()).toEqual(["system: fixed:profile | slot:clock@lab.clock", "user: slot:notes@lab.notes", "user: event:input", "user: slot:stray@lab.stray"]);
        const diagnostics = await session.raw.diagnostics();
        expect(diagnostics.find((item) => item.code === "slot-volatile-in-system")).toMatchObject({extension: "lab.clock", params: {slot: "clock"}});
        expect(diagnostics.some((item) => item.code === "slot-unplaced")).toBe(false);
    });

    test("输出 16：每份没摆的贡献各一条诊断；模板没有 <System /> 时 Profile 的 system 里的槽不算摆放；* stable 不收会变的", async () => {
        const both = defineExtension({id: "lab.both", contribute: {alpha: {value: () => "甲"}, beta: {value: () => "乙"}}});
        const stable = defineExtension({id: "lab.stable", contribute: {facts: {shared: true, value: () => "稳"}}});
        const moving = defineExtension({id: "lab.moving", contribute: {facts: {shared: true, volatile: true, value: () => "变"}}});
        const hidden = defineExtension({id: "lab.hidden", contribute: {hidden: {value: () => "藏"}}});
        const profile = profileWith({system: <Slot name="hidden" />, prompt: () => <><Turn /><Slot name="*" stable /></>});
        await using session = await createTestSession({profile, extensions: [both, stable, moving, hidden]});
        session.model.script("好");
        const {requests} = await session.say("问");
        expect(requests[0]!.outline()).toEqual(["user: event:input", "user: slot:alpha@lab.both | slot:beta@lab.both | slot:hidden@lab.hidden | slot:facts@lab.stable"]);
        await using bare = await createTestSession({profile: profileWith({prompt: () => <><Turn /></>}), extensions: [both, moving]});
        bare.model.script("好");
        await bare.say("问");
        const unplaced = (await bare.raw.diagnostics()).filter((item) => item.code === "slot-unplaced").map((item) => `${item.extension}:${String(item.params.slot)}`);
        expect(unplaced.sort()).toEqual(["lab.both:alpha", "lab.both:beta", "lab.moving:facts"]);
        const mixed = (await session.raw.diagnostics()).filter((item) => item.code === "slot-unplaced").map((item) => `${item.extension}:${String(item.params.slot)}`);
        expect(mixed).toEqual(["lab.moving:facts"]);
    });

    test("输出 16：槽有内容而模板没摆时内容丢弃并诊断；同名槽不是都写 shared 时装配就诊断", async () => {
        const one = defineExtension({id: "lab.one", contribute: {facts: {value: () => "一"}}});
        const two = defineExtension({id: "lab.two", contribute: {facts: {shared: true, value: () => "二"}}});
        const profile = profileWith({prompt: () => <><System /><Turn /></>});
        await using session = await createTestSession({profile, extensions: [one, two]});
        session.model.script("好");
        const {requests} = await session.say("问");
        expect(requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input"]);
        const diagnostics = await session.raw.diagnostics();
        expect(diagnostics.find((item) => item.code === "slot-unplaced")).toMatchObject({params: {slot: "facts"}});
        expect(diagnostics.find((item) => item.code === "slot-collision")).toMatchObject({extension: "lab.one", entry: "assembly", params: {slot: "facts", with: "lab.two"}});
    });
});

describe("请求的校验与开发检查", () => {
    test("输出 18：块的来源是结构化的：固定文字、内核事件、扩展事件、槽", async () => {
        await using session = await createTestSession({profile: profileWith({}), extensions: [remind, notes]});
        session.model.script("好");
        const {requests, events} = await session.say("问");
        const request = requests[0]!.raw;
        const idOf = (type: string) => events.find((event) => event.type === type)!.id;
        expect(request.system.map((block) => block.origin)).toEqual([{kind: "fixed", by: "profile"}, {kind: "slot", name: "notes", extension: "lab.notes"}]);
        expect(request.messages[0]!.content.map((block) => block.origin)).toEqual([
            {kind: "event", eventId: idOf("lab.remind/reminder"), type: "lab.remind/reminder", extension: "lab.remind"},
            {kind: "event", eventId: idOf("input"), type: "input", extension: "kernel"},
        ]);
    });

    test("输出 17：turn 丢掉工具结果时请求不合格，运行以 request-invalid 收口", async () => {
        const profile = profileWith({turn: (turn, format) => [format.user(turn.input), ...turn.steps.map((step) => format.assistant(step.reply))]});
        await using session = await createTestSession({profile});
        session.model.script({tools: [{tool: "lab.search"}]}, "不会用到");
        const report = await session.say("问");
        expect(report.result).toMatchObject({reason: "error", error: {kind: "local", code: "request-invalid"}});
        expect(report.requests).toHaveLength(1);
        expect((await session.raw.diagnostics()).find((item) => item.code === "request-invalid")?.message).toContain("call-1-1");
        const duplicated = profileWith({turn: (turn, format) => format.turn(turn).map((message) => (message?.toolCalls === undefined ? message : {...message, toolCalls: [...message.toolCalls, ...message.toolCalls]}))});
        await using twice = await createTestSession({profile: duplicated});
        twice.model.script({tools: [{tool: "lab.search"}]}, "不会用到");
        expect((await twice.say("问")).result.error).toMatchObject({code: "request-invalid"});
    });

    test("输出 19：同一轮后一次渲染改了前面的块时诊断 prefix-unstable", async () => {
        const profile = profileWith({turn: (turn, format) => [format.user(`第 ${turn.steps.length} 步`, turn.input), ...format.steps(turn.steps)]});
        await using session = await createTestSession({profile});
        session.model.script({tools: [{tool: "lab.search"}]}, "完成");
        const report = await session.say("问");
        expect(report.result.reason).toBe("completed");
        expect(await codes(session)).toContain("prefix-unstable");
        const rewrites = profileWith({turn: (turn, format) => format.turn(turn).map((message) => (message?.toolCalls === undefined ? message : {...message, toolCalls: message.toolCalls.map((call) => ({...call, args: {steps: turn.steps.length}}))}))});
        await using sameIds = await createTestSession({profile: rewrites});
        sameIds.model.script({tools: [{tool: "lab.search"}]}, {tools: [{tool: "lab.search"}]}, "完成");
        await sameIds.say("问");
        expect(await codes(sameIds)).toContain("prefix-unstable");
    });

    test("输出 19：没写 commit、提交的样子与最后一次渲染不一致时诊断 commit-differs；只往后长的不报", async () => {
        const run = async (profile: AnyProfile) => {
            await using session = await createTestSession({profile});
            session.model.script({tools: [{tool: "lab.search"}]}, "一", "二");
            await session.say("第一问");
            await session.say("第二问");
            return codes(session);
        };
        const differs = await run(profileWith({turn: (turn, format) => [format.user(turn.status === "running" ? "进行中" : "已结束", turn.input), ...format.steps(turn.steps)]}));
        expect(differs).toContain("commit-differs");
        const steady = await run(profileWith({}));
        expect(steady).not.toContain("commit-differs");
        expect(steady).not.toContain("prefix-unstable");
    });
});
