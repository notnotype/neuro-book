/**
 * 会话树与换 Profile（t20 第 6 片）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目，
 * “extensions 输出”“profile 输出”“session 输出”指同目录下的另几份 Spec。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, LogEvent} from "../api/index.js";
import {defineExtension, slice} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {createJsonlStore} from "../log/jsonl-store.js";
import {createTestSession, defaultTestProfile, type TestSession} from "../testing/test-session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-tree");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const id = () => `t-${(commands += 1)}`;
const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const texts = (events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => (event.data as {text: string}).text);
const replies = (events: readonly LogEvent[]) => events.filter((event) => event.type === "assistant").map((event) => (event.data as {content: {text?: string}[]}).content.map((block) => block.text ?? "").join(""));

/** 数输入：path 片跟着对话走，session 片不随回退。 */
const counter = defineExtension({id: "lab.count", state: {onPath: slice.path(0), inSession: slice.session(0)}, reduce: {
    input: (_event, state) => ({onPath: state.onPath + 1}),
    inputQueued: (_event, state) => ({inSession: state.inSession + 1}),
}});

/** 两轮对话：第二轮先调一次工具。 */
async function twoTurns(session: TestSession) {
    session.model.script("答一", {tools: [{tool: "lab.read"}]}, "答二");
    await session.say("第一问");
    await session.say("第二问");
}

const readTool = {id: "lab.read", execute: () => "读到了"};

describe("回退", () => {
    test("输出 35：回退目标按路径顺序列出 before-turn、after-step、after-turn", async () => {
        await using session = await createTestSession({tools: [readTool]});
        await twoTurns(session);
        const targets = await session.raw.rewindTargets();
        expect(targets.map((target) => [target.kind, target.inputText])).toEqual([
            ["before-turn", "第一问"], ["after-step", "第一问"], ["after-turn", "第一问"],
            ["before-turn", "第二问"], ["after-step", "第二问"], ["after-step", "第二问"], ["after-turn", "第二问"],
        ]);
        const events = await session.events();
        const byId = new Map(events.map((event) => [event.id, event]));
        expect(byId.get(targets[2]!.id)!.type).toBe("runEnded");
        expect(targets[3]!.id).toBe(targets[2]!.id);
        expect(byId.get(targets[5]!.id)!.type).toBe("toolResult");
    });

    test("输出 35、extensions 输出 10：回退到某一轮之前再发，开出新分支；path 片回到目标处，session 片与缓冲区不变", async () => {
        await using session = await createTestSession({tools: [readTool], extensions: [counter]});
        await twoTurns(session);
        expect(await session.state(counter)).toEqual({onPath: 2, inSession: 2});
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "第二问")!;
        await session.raw.enqueue({commandId: id(), input: {text: "排着的"}, mode: "followup"});
        const rewound = await session.raw.rewind({commandId: id(), to: before.id});
        expect(rewound).toMatchObject({ok: true, value: {leaf: before.id}});
        expect(await session.state(counter)).toEqual({onPath: 1, inSession: 3});
        expect(texts(await session.events(), "input")).toEqual(["第一问"]);
        expect((await session.raw.snapshot()).buffer.map((item) => item.input.text)).toEqual(["排着的"]);
        session.model.script("另一个答二", "答排着的");
        const sent = await session.say("改过的第二问");
        expect(texts(await session.events(), "input")).toEqual(["第一问", "改过的第二问", "排着的"]);
        expect(sent.requests[0]!.outline()).toEqual(["system: fixed:profile", "user: event:input", "assistant: event:assistant", "user: event:input"]);
        const runStarts = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "runStarted");
        expect(await session.raw.siblings({node: runStarts[1]!.id})).toHaveLength(2);
    });

    test("输出 36：回退到回复之前、start 接着跑，新回复与旧回复是兄弟（重试）；暂停时重开不当崩溃", async () => {
        await using session = await createTestSession({tools: [readTool], store: {root}});
        await twoTurns(session);
        const lastStep = (await session.raw.rewindTargets()).filter((target) => target.kind === "after-step").at(-1)!;
        await session.raw.rewind({commandId: id(), to: lastStep.id});
        expect((await session.raw.snapshot()).status).toEqual({state: "idle"});
        await session.reopen();
        expect(types(await session.events()).at(-1)).toBe("toolResult");
        session.model.script("重试的答二");
        const started = await session.raw.start({commandId: id()});
        if (!started.ok) throw new Error(started.code);
        const result = await session.raw.waitRun(started.value.runId);
        expect(result.text).toBe("重试的答二");
        const events = await session.events();
        expect(replies(events)).toEqual(["答一", "", "重试的答二"]);
        const all = (await session.raw.log({afterSeq: 0})).events;
        const oldReply = all.filter((event) => event.type === "assistant").find((event) => replies([event])[0] === "答二")!;
        // 分叉点在模型请求上：新的 modelStarted 与旧回复的 modelStarted 是兄弟，两条回复各挂在自己那次请求下面。
        const siblings = await session.raw.siblings({node: oldReply.parent!});
        expect(siblings.map((item) => item.node)).toContain(events.filter((event) => event.type === "modelStarted").at(-1)!.id);
        expect(siblings).toHaveLength(2);
    });

    test("输出 36：rewind{resend} 回退后入队并开始；目标在运行中途时让暂停的运行接着跑", async () => {
        await using session = await createTestSession({tools: [readTool]});
        await twoTurns(session);
        const targets = await session.raw.rewindTargets();
        session.model.script("新答二");
        const resent = await session.raw.rewind({commandId: id(), to: targets.find((target) => target.kind === "before-turn" && target.inputText === "第二问")!.id, resend: {text: "重写的第二问"}});
        if (!resent.ok || resent.value.runId === undefined) throw new Error("resend did not start");
        expect((await session.raw.waitRun(resent.value.runId)).text).toBe("新答二");
        expect(texts(await session.events(), "input")).toEqual(["第一问", "重写的第二问"]);
    });

    test("输出 36：回退到同一次运行里第二轮之前（运行中途），send 入队并接着跑这次运行，先取这条开一轮", async () => {
        await using session = await createTestSession();
        session.model.script("答一", "答二", "新答二");
        await session.raw.enqueue({commandId: id(), input: {text: "第二问"}, mode: "followup"});
        await session.say("第一问");
        expect(texts(await session.events(), "input")).toEqual(["第一问", "第二问"]);
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "第二问")!;
        await session.raw.rewind({commandId: id(), to: before.id});
        const sent = await session.raw.send({commandId: id(), input: {text: "新的第二问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not resume");
        expect(await session.raw.waitRun(sent.value.runId)).toMatchObject({reason: "completed", text: "新答二"});
        expect(session.requests).toHaveLength(3);
        expect(session.requests[2]!.raw.messages.at(-1)!.content).toMatchObject([{kind: "text", text: "新的第二问"}]);
        const events = await session.events();
        expect(texts(events, "input")).toEqual(["第一问", "新的第二问"]);
        expect(types(events).filter((type) => type === "runStarted")).toHaveLength(1);
    });

    test("输出 35：运行中得 running；不是节点得 unknown-node；不是目标得 invalid-target", async () => {
        await using session = await createTestSession({tools: [readTool]});
        await twoTurns(session);
        const events = await session.events();
        expect(await session.raw.rewind({commandId: id(), to: "nope"})).toEqual({ok: false, code: "unknown-node"});
        expect(await session.raw.rewind({commandId: id(), to: events.find((event) => event.type === "assistant")!.id})).toEqual({ok: false, code: "invalid-target"});
        expect(await session.raw.rewind({commandId: id(), to: null})).toEqual({ok: false, code: "invalid-target"});
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await using busy = await createTestSession({tools: [{id: "lab.hold", execute: async () => {
            await held;
            return "放行";
        }}]});
        busy.model.script({tools: [{tool: "lab.hold"}]}, "完成");
        const sent = await busy.raw.send({commandId: id(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        const anyNode = (await busy.events())[0]!.id;
        expect(await busy.raw.rewind({commandId: id(), to: anyNode})).toEqual({ok: false, code: "running", detail: {runId: sent.value.runId}});
        expect(await busy.raw.switchBranch({commandId: id(), node: anyNode})).toEqual({ok: false, code: "running", detail: {runId: sent.value.runId}});
        release();
        await busy.raw.waitRun(sent.value.runId);
    });
});

describe("分支与 fork", () => {
    test("输出 37：switchBranch 落到那条分支最近写入的末端", async () => {
        await using session = await createTestSession({tools: [readTool]});
        await twoTurns(session);
        const oldLeaf = (await session.raw.snapshot()).leaf!;
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "第二问")!;
        await session.raw.rewind({commandId: id(), to: before.id});
        session.model.script("别的答案");
        await session.say("别的问题");
        const runStarts = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "runStarted");
        expect(await session.raw.switchBranch({commandId: id(), node: runStarts[1]!.id})).toMatchObject({ok: true, value: {leaf: oldLeaf}});
        expect(texts(await session.events(), "input")).toEqual(["第一问", "第二问"]);
        expect(await session.raw.switchBranch({commandId: id(), node: "nope"})).toEqual({ok: false, code: "unknown-node"});
    });

    test("输出 37、session 输出 20：fork 复制到叶子为止的路径成新会话，带上 Profile 与设置，原会话不变", async () => {
        await using session = await createTestSession({tools: [readTool], store: {root}});
        await twoTurns(session);
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "high"}}});
        const afterFirst = (await session.raw.rewindTargets()).find((target) => target.kind === "after-turn" && target.inputText === "第一问")!;
        const forked = await session.raw.fork({commandId: id(), leaf: afterFirst.id});
        if (!forked.ok) throw new Error(forked.code);
        expect(texts(await session.events(), "input")).toEqual(["第一问", "第二问"]);
        await using copy = await createTestSession({store: {root}, open: forked.value.sessionId, tools: [readTool]});
        const snapshot = await copy.raw.snapshot();
        expect(snapshot.header.origin).toEqual({session: session.id, entry: afterFirst.id});
        expect(snapshot.settings.effort).toBe("high");
        expect(texts(await copy.events(), "input")).toEqual(["第一问"]);
        expect(types((await copy.raw.log({afterSeq: 0})).events).filter((type) => type === "profileChanged")).toHaveLength(1);
        const listed = await createJsonlStore({root}).list({});
        expect(listed.ok && listed.value.some((entry) => entry.id === forked.value.sessionId)).toBe(true);
    });
});

describe("换 Profile", () => {
    const tally = defineExtension({id: "lab.tally.count", state: {inputs: slice.path(0)}, reduce: {input: (_event, state) => ({inputs: state.inputs + 1})}});
    const other = defineProfile({
        id: "lab.tally", version: "1", name: "另一个", description: "换过去的 Profile",
        extensions: [tally],
        render: {assistant: () => "（旧回答）"},
    }) as AnyProfile;

    test("输出 38、profile 输出 11：换 Profile 后按新装配重新归约、已提交的轮按新 Profile 渲染；重开沿用新 Profile", async () => {
        await using session = await createTestSession({store: {root}, profiles: [other]});
        session.model.script("答一", "答二", "答三");
        await session.say("第一问");
        await session.say("第二问");
        const changed = await session.raw.changeProfile({commandId: id(), profile: "lab.tally"});
        expect(changed).toMatchObject({ok: true, value: {changed: true}});
        expect(await session.state(tally)).toEqual({inputs: 2});
        const third = await session.say("第三问");
        expect(third.requests[0]!.raw.messages.filter((message) => message.role === "assistant").map((message) => (message.content[0] as {text: string}).text)).toEqual(["（旧回答）", "（旧回答）"]);
        const changes = (await session.raw.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged").map((event) => (event.data as {reason: string; profile: string}));
        expect(changes.map((change) => [change.reason, change.profile])).toEqual([["created", "test.profile"], ["user", "lab.tally"]]);
        await session.reopen();
        expect((await session.raw.snapshot()).profile.id).toBe("lab.tally");
        expect(await session.raw.changeProfile({commandId: id(), profile: "lab.tally"})).toMatchObject({ok: true, value: {changed: false}});
        expect(await session.raw.changeProfile({commandId: id(), profile: "lab.nope"})).toEqual({ok: false, code: "unknown-profile"});
        expect(await session.raw.changeProfile({commandId: id(), profile: defaultTestProfile.id})).toMatchObject({ok: true, value: {changed: true}});
    });
});
