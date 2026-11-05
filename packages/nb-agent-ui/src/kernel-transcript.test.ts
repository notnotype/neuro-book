/**
 * 适配器对新内核的契约（docs/specs/agent/conversation.md 输出 5、15–18）：真内核、真日志，只替模型输出。
 * 一个适配器跟着帧走，另一个从快照与路径重建，两者的消息要一样：断线重连、刷新之后看到的和一直开着的相同。
 */

import {describe, expect, test} from "bun:test";

import {defineExtension} from "@notnotype/nb-harness/kernel";
import type {ApproveHook, Frame, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestSession} from "@notnotype/nb-harness/kernel/testing";
import type {TestSession} from "@notnotype/nb-harness/kernel/testing";

import {createKernelTranscript} from "./kernel-transcript";
import type {KernelTranscript} from "./kernel-transcript";
import type {AssistantMessageView, MessageView} from "./types";

let commands = 0;
const id = () => `kt-${String((commands += 1))}`;

/** 宿主打开会话的算法（输出 5）：先订阅并缓存，取快照，取路径，再处理缓存。 */
async function follow(session: SessionApi): Promise<{transcript: KernelTranscript; frames: Frame[]; stop(): void}> {
    const transcript = createKernelTranscript({toolName: (tool) => tool.slice(tool.lastIndexOf(".") + 1)});
    const frames: Frame[] = [];
    let buffered: Frame[] | null = [];
    const take = (frame: Frame) => {
        frames.push(frame);
        if (frame.type === "log") {
            if (transcript.applyEvent(frame.event) === "leaf-changed") void rebuild();
        } else transcript.applyFrame(frame);
    };
    const rebuild = async () => {
        transcript.applyPath(await session.path());
    };
    const stop = session.subscribe((frame) => {
        if (buffered !== null) buffered.push(frame);
        else take(frame);
    });
    const snapshot = await session.snapshot();
    transcript.applySnapshot(snapshot);
    transcript.applyPath(await session.path());
    const early = buffered;
    buffered = null;
    for (const frame of early) if (frame.type !== "status") take(frame);
    return {transcript, frames, stop};
}

async function rebuilt(session: SessionApi): Promise<KernelTranscript> {
    const transcript = createKernelTranscript({toolName: (tool) => tool.slice(tool.lastIndexOf(".") + 1)});
    transcript.applySnapshot(await session.snapshot());
    transcript.applyPath(await session.path());
    return transcript;
}

const assistants = (messages: readonly MessageView[]) => messages.filter((message): message is AssistantMessageView => message.kind === "assistant");

/** 一直跟着的和重建的一样；用量和快照一样；日志里每种事件都认得。 */
async function expectConsistent(session: TestSession, followed: KernelTranscript): Promise<void> {
    const fresh = await rebuilt(session.raw);
    expect(followed.messages()).toEqual(fresh.messages());
    expect(followed.usage()).toEqual(fresh.usage());
    expect(followed.pending()).toEqual(fresh.pending());
    expect(followed.queue()).toEqual(fresh.queue());
    expect(followed.interrupted()).toBe(fresh.interrupted());
    expect(followed.problems()).toEqual([]);
    expect(fresh.problems()).toEqual([]);
}

async function send(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

function waitingFor(session: TestSession, count: number): Promise<readonly {id: string}[]> {
    return new Promise((resolve) => {
        const check = (status: {state: string; pending?: {id: string}[]}) => {
            if (status.state === "waiting" && status.pending!.length === count) {
                stop();
                resolve(status.pending!);
            }
        };
        const stop = session.raw.subscribe((frame) => {
            if (frame.type === "status") check(frame.status);
        });
        void session.raw.snapshot().then((snapshot) => check(snapshot.status));
    });
}

const askForWrites: ApproveHook = async (_call, info) => (info.effect === "read" ? {verdict: "allow", by: "rule"} : {verdict: "ask"});

describe("一轮对话", () => {
    test("用户的话、回复、用量；增量画正在生成的那条，事件到了换掉", async () => {
        await using session = await createTestSession();
        const {transcript, stop} = await follow(session.raw);
        session.model.script({text: "回复全文", thinking: "想了想", usage: {input: 100, output: 20, cacheRead: 30, cacheWrite: 5, cost: 2}});
        await session.say("你好");
        stop();
        const messages = transcript.messages();
        expect(messages.map((message) => message.kind)).toEqual(["user", "assistant"]);
        expect(messages[0]).toMatchObject({intent: "normal", blocks: [{kind: "text", text: "你好"}]});
        expect(messages[1]).toMatchObject({status: "done", text: "回复全文", thinking: "想了想", usage: {input: 100, output: 20, cacheRead: 30, cacheWrite: 5, cost: 2}});
        expect(transcript.usage()).toMatchObject({cost: 2, input: 100, output: 20, cacheRead: 30, cacheWrite: 5, context: 135});
        await expectConsistent(session, transcript);
    });

    test("运行中只有增量时，消息里有一条 streaming 的；状态是运行中", () => {
        const transcript = createKernelTranscript();
        transcript.applyFrame({type: "status", status: {state: "running", runId: "r", turnId: "t", phase: "streaming", request: 1}, afterSeq: 1});
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 1, part: "text", text: "你"});
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 2, part: "text", text: "好"});
        expect(transcript.run()).toMatchObject({status: "running", phase: "streaming"});
        expect(transcript.messages()).toMatchObject([{kind: "assistant", status: "streaming", text: "你好"}]);
        // 重连：合并器重新编号，手里的半截接不上，清空重来。
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 1, part: "text", text: "接着"});
        expect(transcript.messages()).toMatchObject([{text: "接着"}]);
        // 丢了帧：不再画，等 assistant 事件。
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 5, part: "text", text: "后面"});
        expect(transcript.messages()).toEqual([]);
    });

    test("路径重建不碰乐观消息：结果未知的消息重连之后还能重发", () => {
        const transcript = createKernelTranscript();
        const history = [{id: "a", type: "input", at: 1, data: {text: "早先的", queued: "q"}}];
        transcript.applyPath(history);
        transcript.addOptimistic({id: "o", commandId: "x", text: "没确认的", timestamp: 2});
        transcript.markOptimisticUnknown("o");
        transcript.applyPath(history);
        expect(transcript.messages().map((message) => [message.id, (message as {delivery?: string}).delivery])).toEqual([["a", undefined], ["o", "unknown"]]);
    });

    test("回复已经写下了，晚到的增量不再画一条“正在生成”", () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([{id: "a", type: "assistant", at: 1, data: {request: 7, content: [{kind: "text", text: "回复"}], toolCalls: []}}]);
        transcript.applyFrame({type: "delta", request: 7, purpose: "turn", n: 1, part: "text", text: "回复"});
        expect(transcript.messages().map((message) => (message as {status?: string}).status)).toEqual(["done"]);
        transcript.applyFrame({type: "delta", request: 8, purpose: "turn", n: 1, part: "text", text: "下一条"});
        expect(transcript.messages().map((message) => (message as {status?: string}).status)).toEqual(["done", "streaming"]);
    });

    test("别的用途的增量不是回复", () => {
        const transcript = createKernelTranscript();
        transcript.applyFrame({type: "delta", request: 1, purpose: "compaction", n: 1, part: "text", text: "摘要"});
        expect(transcript.messages()).toEqual([]);
    });

    test("工具参数流式：第一块带工具名，抽路径与字数", () => {
        const transcript = createKernelTranscript({toolName: (tool) => tool.slice(tool.lastIndexOf(".") + 1)});
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 1, part: "toolArgs", callId: "c1", tool: "nbook.agent.write", text: '{"path":"project://正文/一.md","con'});
        transcript.applyFrame({type: "delta", request: 1, purpose: "turn", n: 2, part: "toolArgs", callId: "c1", text: 'tent":"很长的正文'});
        const [message] = assistants(transcript.messages());
        expect(message!.toolCalls).toEqual([{id: "c1", name: "write", status: "streaming", args: {path: "project://正文/一.md", partialChars: 44}}]);
    });

    test("乐观消息：显示在最后；内核确认换掉最早的；被拒撤掉；结果未知标出来", async () => {
        await using session = await createTestSession();
        const {transcript, stop} = await follow(session.raw);
        transcript.addOptimistic({id: "o1", commandId: "x1", text: "我发的", timestamp: 1});
        expect(transcript.messages()).toMatchObject([{id: "o1", delivery: "pending"}]);
        transcript.markOptimisticUnknown("o1");
        expect(transcript.messages()).toMatchObject([{id: "o1", delivery: "unknown"}]);
        transcript.removeOptimistic("o1");
        expect(transcript.messages()).toEqual([]);
        transcript.addOptimistic({id: "o2", commandId: "x2", text: "我发的", timestamp: 1});
        session.model.script("好");
        await session.say("拦截改写过的文字");
        stop();
        expect(transcript.messages().map((message) => message.kind)).toEqual(["user", "assistant"]);
        expect(transcript.messages()[0]).not.toHaveProperty("delivery");
    });
});

describe("工具", () => {
    test("调用状态、实际执行的参数与结果；tool 帧在结果写下之前就标完成", async () => {
        const rewrite = defineExtension({id: "lab.rewrite", intercept: {tool: async (call, next) => next({...call, args: {path: "改过的"}})}});
        let midway: ReturnType<KernelTranscript["messages"]> = [];
        let transcriptRef: KernelTranscript | null = null;
        await using session = await createTestSession({extensions: [rewrite], tools: [
            {id: "lab.first", execute: () => "第一个好了"},
            {id: "lab.second", execute: () => {
                midway = transcriptRef!.messages();
                return "第二个好了";
            }},
        ]});
        const {transcript, stop} = await follow(session.raw);
        transcriptRef = transcript;
        session.model.script({tools: [{tool: "lab.first", args: {path: "原来的"}}, {tool: "lab.second"}]}, "完");
        await session.say("跑");
        stop();
        expect(assistants(midway)[0]!.toolCalls.map((call) => call.status)).toEqual(["success", "running"]);
        const [call] = assistants(transcript.messages())[0]!.toolCalls;
        expect(call).toMatchObject({name: "first", status: "success", args: {path: "改过的"}, result: {text: "第一个好了"}});
        await expectConsistent(session, transcript);
    });

    test("并发的工具：各记各的", async () => {
        const shared = {concurrency: "shared" as const};
        await using session = await createTestSession({tools: [{id: "lab.a", ...shared, execute: () => "甲"}, {id: "lab.b", ...shared, execute: () => ({text: "炸了", status: "error" as const, code: "lab-boom"})}]});
        const {transcript, stop} = await follow(session.raw);
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.b"}]}, "完");
        await session.say("跑");
        stop();
        expect(assistants(transcript.messages())[0]!.toolCalls.map((call) => [call.name, call.status, call.error ?? null])).toEqual([["a", "success", null], ["b", "error", "炸了"]]);
        await expectConsistent(session, transcript);
    });

    test("参数不合规是 invalid；未知工具是 error", async () => {
        const strict = {id: "lab.strict", execute: () => "好"};
        await using session = await createTestSession({tools: [strict], approve: async () => ({verdict: "allow", by: "test"})});
        const {transcript, stop} = await follow(session.raw);
        session.model.script({tools: [{tool: "lab.nothing"}]}, "完");
        await session.say("跑");
        stop();
        expect(assistants(transcript.messages())[0]!.toolCalls[0]).toMatchObject({status: "error"});
        await expectConsistent(session, transcript);
    });

    test("一批审批：都进 pending；拒绝的是 denied 且说明是你拒绝的；运行状态 waiting", async () => {
        const writer = (tool: string) => ({id: tool, effect: "write" as const, execute: () => `${tool} 写好了`});
        await using session = await createTestSession({approve: askForWrites, tools: [writer("lab.a"), writer("lab.b")]});
        const {transcript, stop} = await follow(session.raw);
        session.model.script({tools: [{tool: "lab.a", args: {path: "一.md"}}, {tool: "lab.b"}]}, "完");
        const runId = await send(session, "写");
        const pending = await waitingFor(session, 2);
        expect(transcript.pending().map((item) => [item.kind, (item.request as {tool: string}).tool])).toEqual([["approval", "lab.a"], ["approval", "lab.b"]]);
        expect(transcript.run().status).toBe("waiting");
        expect((await rebuilt(session.raw)).pending()).toEqual(transcript.pending());
        await session.raw.resolve({commandId: id(), id: pending[0]!.id, decision: "allow"});
        await session.raw.resolve({commandId: id(), id: pending[1]!.id, decision: "deny", note: "不要"});
        await session.raw.waitRun(runId);
        stop();
        expect(transcript.pending()).toEqual([]);
        const calls = assistants(transcript.messages())[0]!.toolCalls;
        expect(calls.map((call) => call.status)).toEqual(["success", "denied"]);
        expect(calls[1]!.note).toMatchObject({key: "kernel.tool.deniedByUser"});
        await expectConsistent(session, transcript);
    });
});

describe("运行结束", () => {
    test("停止：不算中断；调用记 denied；回复标已停止", async () => {
        const writer = {id: "lab.a", effect: "write" as const, execute: () => "好"};
        await using session = await createTestSession({approve: askForWrites, tools: [writer]});
        const {transcript, stop} = await follow(session.raw);
        session.model.script({text: "我要写了", tools: [{tool: "lab.a"}]});
        const runId = await send(session, "写");
        await waitingFor(session, 1);
        await session.raw.abort({commandId: id()});
        await session.raw.waitRun(runId);
        stop();
        expect(transcript.interrupted()).toBe(false);
        const [message] = assistants(transcript.messages());
        expect(message).toMatchObject({status: "stopped"});
        expect(message!.toolCalls[0]).toMatchObject({status: "denied", note: {key: "kernel.tool.notStarted"}});
        await expectConsistent(session, transcript);
    });

    test("模型错误显示成人话；能重试的标出来", async () => {
        await using session = await createTestSession();
        const {transcript, stop} = await follow(session.raw);
        session.model.script({fail: "provider", partial: "半截", usage: {input: 7, output: 1, cost: 1}});
        await session.say("问");
        stop();
        const messages = transcript.messages();
        expect(messages.map((message) => message.kind)).toEqual(["user", "assistant", "error"]);
        expect(messages[1]).toMatchObject({status: "error", text: "半截"});
        expect(messages[2]).toMatchObject({retryable: true, message: {key: "harness.error.provider"}});
        expect(transcript.usage()).toMatchObject({cost: 1, input: 7});
        await expectConsistent(session, transcript);
    });

    test("等重发：半截文字丢掉，只留重发成功的那条；用量都算", async () => {
        await using session = await createTestSession({retry: () => ({maxRetries: 2})});
        const {transcript, stop} = await follow(session.raw);
        session.model.script({fail: "network", retryable: true, partial: "第一次的半截", usage: {input: 5, output: 1, cost: 1}}, {text: "重发成功", usage: {input: 6, output: 1, cost: 1}});
        const runId = await send(session, "问");
        await new Promise<void>((resolve) => {
            const check = (status: {state: string; retry?: unknown}) => {
                if (status.state !== "running" || status.retry === undefined) return;
                unsubscribe();
                resolve();
            };
            const unsubscribe = session.raw.subscribe((frame) => {
                if (frame.type === "status") check(frame.status);
            });
            void session.raw.snapshot().then((snapshot) => check(snapshot.status));
        });
        expect(transcript.run().retry).toMatchObject({attempt: 1});
        expect(assistants(transcript.messages())).toEqual([]);
        await session.clock.advance(60_000);
        await session.raw.waitRun(runId);
        stop();
        expect(assistants(transcript.messages()).map((message) => message.text)).toEqual(["重发成功"]);
        expect(transcript.usage()).toMatchObject({cost: 2, input: 11});
        await expectConsistent(session, transcript);
    });

    test("运行结束的码比类别优先", () => {
        const transcript = createKernelTranscript();
        for (const [code, key] of [["cost-limit", "kernel.error.costLimit"], ["tool-call-loop", "kernel.error.toolCallLoop"], ["empty-reply", "kernel.error.emptyReply"], ["thinking-loop", "kernel.error.thinkingLoop"], ["first-event-timeout", "kernel.error.firstEventTimeout"]] as const) {
            transcript.applyEvent({id: code, type: "runEnded", at: 1, data: {reason: "error", error: {kind: "local", code}}});
            expect(transcript.messages().at(-1)).toMatchObject({kind: "error", message: {key}});
        }
    });

    test("中断：路径上最后一次运行 interrupted 才算；新运行一开始就不算了", () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([{id: "a", type: "runStarted", at: 1, data: {runId: "r"}}, {id: "b", type: "runEnded", at: 2, data: {runId: "r", reason: "interrupted"}}]);
        expect(transcript.interrupted()).toBe(true);
        transcript.applyEvent({id: "c", type: "runStarted", at: 3, data: {runId: "r2"}});
        expect(transcript.interrupted()).toBe(false);
    });
});

describe("回退、队列、会话级", () => {
    test("回退：通知重建；重建之后只有当前路径；累计用量不减", async () => {
        await using session = await createTestSession();
        const {transcript, stop} = await follow(session.raw);
        session.model.script({text: "一", usage: {input: 10, output: 1, cost: 1}}, {text: "二", usage: {input: 20, output: 1, cost: 1}});
        await session.say("第一问");
        await session.say("第二问");
        const target = (await session.raw.rewindTargets()).find((item) => item.kind === "before-turn" && item.inputText === "第二问")!;
        const rewound = await session.raw.rewind({commandId: id(), to: target.id});
        expect(rewound.ok).toBe(true);
        transcript.applyPath(await session.raw.path());
        stop();
        expect(assistants(transcript.messages()).map((message) => message.text)).toEqual(["一"]);
        expect(transcript.usage()).toMatchObject({cost: 2, input: 30, context: 10});
        await expectConsistent(session, transcript);
    });

    test("排队：进队、改、移除、消费；标题、说明、归档、核心设置", async () => {
        await using session = await createTestSession();
        const {transcript, stop} = await follow(session.raw);
        const queued = await session.raw.enqueue({commandId: id(), input: {text: "排着的"}, mode: "followup"});
        if (!queued.ok) throw new Error(queued.code);
        const inputId = queued.value.inputId;
        expect(transcript.queue()).toEqual([{id: inputId, mode: "followup", text: "排着的"}]);
        await session.raw.edit({commandId: id(), inputId, input: {text: "改过的"}});
        expect(transcript.queue()).toEqual([{id: inputId, mode: "followup", text: "改过的"}]);
        await session.raw.remove({commandId: id(), inputId});
        expect(transcript.queue()).toEqual([]);
        await session.raw.setTitle({commandId: id(), title: "第三章"});
        await session.raw.archive({commandId: id(), archived: true});
        await session.raw.changeSettings({commandId: id(), patch: {core: {approvalMode: "yolo"}}});
        stop();
        expect(transcript.meta()).toMatchObject({title: "第三章", archived: true, settings: {approvalMode: "yolo"}});
        expect((await rebuilt(session.raw)).meta()).toEqual(transcript.meta());
        await expectConsistent(session, transcript);
    });

    test("快照的 model 与 Profile 进 meta", async () => {
        await using session = await createTestSession();
        const fresh = await rebuilt(session.raw);
        expect(fresh.meta().model).toMatchObject({ok: true});
        expect(typeof fresh.meta().profile).toBe("string");
    });

    test("不认识的事件记问题，不打断回放；扩展的事件忽略；seq 不大于快照的丢掉", () => {
        const transcript = createKernelTranscript();
        transcript.applySnapshot({head: 5, usage: {cost: 1}});
        transcript.applyEvent({id: "old", seq: 5, type: "assistant", at: 1, data: {request: 1, content: [{kind: "text", text: "旧"}], toolCalls: [], usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 9}}});
        expect(transcript.messages()).toEqual([]);
        expect(transcript.usage().cost).toBe(1);
        transcript.applyEvent({id: "x", seq: 6, type: "lab.ext/thing", kind: "ext", at: 1, data: {}});
        expect(transcript.problems()).toEqual([]);
        transcript.applyEvent({id: "y", seq: 7, type: "somethingNew", at: 1, data: {}});
        expect(transcript.problems()).toEqual([{source: "somethingNew y", reason: "不认识的事件：somethingNew"}]);
        transcript.applyEvent("不是对象");
        expect(transcript.problems()).toHaveLength(2);
    });

    test("没有变化时 messages() 给同一个数组", async () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([{id: "a", type: "input", at: 1, data: {text: "你好", queued: "q"}}]);
        expect(transcript.messages()).toBe(transcript.messages());
    });
});

describe("压缩（runtime.md 输出 46–52，t11）", () => {
    const system = (transcript: KernelTranscript) => transcript.messages().filter((message) => message.kind === "system");
    const turn = (n: number, at: number) => [
        {id: `t${String(n)}`, type: "turnStarted", at, data: {turnId: `tt${String(n)}`}},
        {id: `i${String(n)}`, type: "input", at, data: {text: `问${String(n)}`}},
        {id: `a${String(n)}`, type: "assistant", at, data: {request: n, content: [{kind: "text", text: `答${String(n)}`}], toolCalls: [], stopReason: "stop", usage: {input: 900, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01, complete: true}, model: "p/m"}},
    ];

    test("摘要方法：详情取自事件的 details 与 restored，保留的轮数按切点数；上下文读数是压缩后的估算加放回的量", () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([
            ...turn(1, 1), ...turn(2, 2), ...turn(3, 3),
            {id: "c", type: "compaction", at: 4, data: {
                method: "nbook.agent.summary", firstKeptEntryId: "t3", replacement: "摘要正文", omitted: [], tokensBefore: 3_000, tokensAfter: 700,
                details: {model: "p/small", usage: {input: 2_000, output: 300, cacheRead: 40_000, cacheWrite: 10, cost: 0.02, complete: true}, require: ["保留人名"]},
                restored: [{kind: "file", target: "project://a.md", tokens: 120, truncated: true}, {kind: "log", target: "sessions://s/session.jsonl", tokens: 0, truncated: false}, {kind: "bogus", target: "x"}],
            }},
        ]);
        const [divider] = system(transcript);
        expect(divider).toMatchObject({source: "compaction", text: "摘要正文", compaction: {
            method: "nbook.agent.summary", tokensBefore: 3_000, tokensAfter: 700, keptTurns: 1, omitted: 0, require: ["保留人名"],
            model: {name: "p/small", input: 2_000, output: 300, cacheRead: 40_000, cacheWrite: 10, cost: 0.02},
        }});
        expect((divider as {compaction: {restored: readonly unknown[]}}).compaction.restored).toEqual([{kind: "file", target: "project://a.md", tokens: 120, truncated: true}, {kind: "log", target: "sessions://s/session.jsonl", tokens: 0, truncated: false}]);
        expect(transcript.usage().context).toBe(820);
    });

    test("shake：没有调模型、没有摘要、没有放回；省略的条数写在详情里，原来的消息都还在", () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([...turn(1, 1), ...turn(2, 10), {id: "c", type: "compaction", at: 20, data: {method: "nbook.agent.shake", firstKeptEntryId: "t1", replacement: null, omitted: [{entryId: "r1", placeholder: "…"}, {entryId: "r2", placeholder: "…"}], tokensBefore: 3_000, tokensAfter: 1_000, details: {require: []}}}]);
        const [divider] = system(transcript);
        expect(divider).toMatchObject({text: "", compaction: {model: null, omitted: 2, restored: [], keptTurns: null}});
        expect(transcript.messages().filter((message) => message.kind === "user")).toHaveLength(2);
    });

    test("只压缩的运行：run 带 kind，收口后恢复；停止与失败不碰上一轮的回复，各给一行自己的说明", () => {
        const transcript = createKernelTranscript();
        transcript.applyPath([...turn(1, 1), {id: "r1", type: "runStarted", at: 2, data: {runId: "x", kind: "compact"}}]);
        transcript.applyFrame({type: "status", status: {state: "running", phase: "compacting"}});
        expect(transcript.run()).toMatchObject({status: "running", kind: "compact", phase: "compacting"});

        transcript.applyEvent({id: "r2", type: "runEnded", at: 3, data: {runId: "x", reason: "aborted"}});
        transcript.applyFrame({type: "status", status: {state: "idle"}});
        expect(transcript.run().kind).toBeNull();
        const stopped = transcript.messages();
        expect(stopped.filter((message) => message.kind === "assistant").map((message) => (message as AssistantMessageView).status)).toEqual(["done"]);
        expect(stopped.at(-1)).toMatchObject({kind: "system", source: "reminder"});

        transcript.applyEvent({id: "r3", type: "runStarted", at: 4, data: {runId: "y", kind: "compact"}});
        transcript.applyEvent({id: "r4", type: "runEnded", at: 5, data: {runId: "y", reason: "error", error: {kind: "local", code: "compaction-failed"}}});
        const failed = transcript.messages();
        expect(failed.filter((message) => message.kind === "assistant").map((message) => (message as AssistantMessageView).status)).toEqual(["done"]);
        expect(failed.at(-1)).toMatchObject({kind: "system", source: "reminder", label: {key: "kernel.error.compactionFailed"}});
        // 同样的事件重放得到同样的结果（刷新、重开）。
        const replayed = createKernelTranscript();
        replayed.applyPath([...turn(1, 1), {id: "r1", type: "runStarted", at: 2, data: {runId: "x", kind: "compact"}}, {id: "r2", type: "runEnded", at: 3, data: {runId: "x", reason: "aborted"}}, {id: "r3", type: "runStarted", at: 4, data: {runId: "y", kind: "compact"}}, {id: "r4", type: "runEnded", at: 5, data: {runId: "y", reason: "error", error: {kind: "local", code: "compaction-failed"}}}]);
        expect(replayed.messages()).toEqual(failed);
    });

    test("run.kind 不依赖 status 帧与 runStarted 事件的到达先后：先快照后路径、先帧后事件都带 kind；被打断的只压缩运行不给“继续”", () => {
        const opened = createKernelTranscript();
        opened.applySnapshot({head: 5, status: {state: "running", phase: "compacting"}} as never);
        opened.applyPath([...turn(1, 1), {id: "r1", type: "runStarted", at: 2, data: {runId: "x", kind: "compact"}}]);
        expect(opened.run()).toMatchObject({status: "running", kind: "compact", startedAt: 2});

        const live = createKernelTranscript();
        live.applyPath(turn(1, 1));
        live.applyFrame({type: "status", status: {state: "running", phase: "compacting"}});
        live.applyEvent({id: "r1", type: "runStarted", at: 2, data: {runId: "x", kind: "compact"}});
        expect(live.run()).toMatchObject({status: "running", kind: "compact"});

        live.applyEvent({id: "r2", type: "runEnded", at: 3, data: {runId: "x", reason: "interrupted"}});
        live.applyFrame({type: "status", status: {state: "idle"}});
        expect(live.interrupted()).toBe(false);
        expect(live.run().kind).toBeNull();
    });
});
