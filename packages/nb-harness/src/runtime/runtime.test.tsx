import {afterEach, describe, expect, test} from "bun:test";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {createMemorySessionStore} from "../session/session";
import {withFailingAppend} from "../session/testing/store-scenarios";
import {createStaticToolSource} from "../tools/tools";
import type {AgentSession, RuntimeEvent} from "./runtime";
import {createHarness, echoTool, invocationPhases, kinds, testProfile} from "./testing/harness";
import type {Harness} from "./testing/harness";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

async function open(options: Parameters<typeof createHarness>[0] = {}): Promise<{harness: Harness; session: AgentSession; events: RuntimeEvent[]}> {
    const harness = await createHarness(options);
    harnesses.push(harness);
    const created = await harness.runtime.createSession({profileId: "writer", id: "s1", title: "第三章"});
    if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
    const events: RuntimeEvent[] = [];
    created.value.subscribe((event) => events.push(event));
    return {harness, session: created.value, events};
}

describe("一次完整调用（输出 2–5、9）", () => {
    test("场景 1：写入顺序、事件序号、状态变化、done 的结果；第二次调用不再写种子、提醒按轮触发", async () => {
        const {harness, session, events} = await open({script: [{calls: [{id: "c1", name: "echo", args: {text: "你好"}}]}, {text: "改好了"}, {text: "第二次"}]});
        const before = session.log.entries.length;
        const started = await session.prompt({content: "改第三章"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        expect(kinds(session.log.entries.slice(before))[0]).toBe("custom:harness/invocation");
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(kinds(result.entries)).toEqual([
            "custom:harness/invocation", "custom_message:harness/seed", "custom_message:harness/seed", "model_change",
            "message:user", "custom_message:harness/reminder", "custom:harness/profile-state",
            "message:assistant", "message:toolResult", "message:assistant", "custom:harness/invocation",
        ]);
        expect(result.entries).toEqual(session.log.entries.slice(before));
        expect(invocationPhases(result.entries)).toEqual(["start", "end"]);
        expect(session.status).toMatchObject({phase: "idle", pending: [], queue: {steer: 0, followUp: 0}, profileId: "writer", model: "test/m"});

        // 事件：序号单调递增；status 先 running 后 idle；entry 事件覆盖每条写入；stream 与 tool 事件出现
        expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
        const statuses = events.filter((event) => event.type === "status").map((event) => (event as {status: {phase: string}}).status.phase);
        expect(statuses).toEqual(["running", "idle"]);
        expect(events.filter((event) => event.type === "entry")).toHaveLength(result.entries.length);
        expect(events.some((event) => event.type === "stream")).toBe(true);
        expect(events.filter((event) => event.type === "tool").map((event) => (event as {stage: string}).stage)).toEqual(["start", "end"]);
        // 模型第一次看到：系统提示词、种子、输入、提醒；第二次多了助手消息与工具结果
        expect(harness.contexts[0]!.systemPrompt).toEqual(["你是写作助手。"]);
        expect(harness.contexts[0]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user"]);
        expect(harness.contexts[1]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user", "assistant", "toolResult"]);

        const second = await session.prompt({content: "再改第四章"});
        if (!second.ok) throw new Error(second.code);
        const secondResult = await second.value.done;
        expect(kinds(secondResult.entries)).toEqual(["custom:harness/invocation", "message:user", "message:assistant", "custom:harness/invocation"]);
        expect(harness.contexts[2]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user", "assistant", "toolResult", "assistant", "user"]);
    });

    test("场景 2：受理失败各返回对应失败码，日志不变、无事件", async () => {
        const {harness, session, events} = await open({script: [{text: "x"}]});
        const before = session.log.entries.length;
        const code = async (promise: ReturnType<AgentSession["prompt"]>): Promise<string | null> => {
            const result = await promise;
            return result.ok ? null : result.code;
        };
        expect(await code(session.prompt({content: "  "}))).toBe("invalid-input");
        expect(await code(session.prompt({content: []}))).toBe("invalid-input");
        expect(await code(session.prompt({content: "x"}, {profileId: "nope"}))).toBe("unknown-profile");
        expect(await code(session.prompt({content: "x"}, {profileId: "writer", model: "nowhere/m"}))).toBe("model-unavailable");
        expect(await code(session.prompt({content: "x"}, {signal: AbortSignal.abort()}))).toBe("invalid-state");
        expect(session.log.entries.length).toBe(before);
        expect(events).toEqual([]);

        const noKey = await createHarness({withKey: false});
        harnesses.push(noKey);
        const noKeySession = await noKey.runtime.createSession({profileId: "writer"});
        expect(noKeySession.ok && (await noKeySession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "credentials-missing"});

        const conflict = await createHarness({sources: [createStaticToolSource([echoTool()]), createStaticToolSource([echoTool()])]});
        harnesses.push(conflict);
        const conflictSession = await conflict.runtime.createSession({profileId: "writer"});
        expect(conflictSession.ok && (await conflictSession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "tool-conflict"});

        const noTools = await createHarness({supportsTools: false});
        harnesses.push(noTools);
        const noToolsSession = await noTools.runtime.createSession({profileId: "writer"});
        expect(noToolsSession.ok && (await noToolsSession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "capability-missing"});
        expect(harness.contexts).toHaveLength(0);
    });
});

describe("队列（输出 1、11）", () => {
    test("场景 5：运行中 steer 在当前工具批次之后送给模型并写入；followup 在 completed 后自动开始新调用；busy 与 invalid-state", async () => {
        const {harness, session, events} = await open({script: [{calls: [{id: "c1", name: "echo", args: {text: "一"}}]}, {text: "收到插话"}, {text: "第二次完成"}]});
        expect(session.steer({content: "太早"})).toMatchObject({ok: false, code: "invalid-state"});
        // 插话要在工具批次结束前入队才会在下一次模型调用前送达：在工具开始的事件里同步 steer（轮询等待会错过这个窗口）
        let steered: unknown = null;
        session.subscribe((event) => {
            if (event.type === "tool" && event.stage === "start" && steered === null) steered = session.steer({content: "插话"});
        });
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        expect(await session.prompt({content: "再来"})).toMatchObject({ok: false, code: "busy"});
        expect(await session.continue()).toMatchObject({ok: false, code: "busy"});
        const queued = await session.prompt({content: "追加"}, {streamingBehavior: "followUp"});
        expect(queued.ok && queued.value.invocationId).toBe(started.value.invocationId);
        await waitUntil("插话已入队", () => steered !== null);
        expect(steered).toEqual({ok: true, value: undefined});
        const first = await started.value.done;
        expect(first.status).toBe("completed");
        const texts = first.entries.map((entry) => (entry.type === "message" ? `${entry.message.role}:${typeof entry.message.content === "string" ? entry.message.content : JSON.stringify(entry.message.content)}` : kinds([entry])[0]!));
        const steerIndex = texts.findIndex((text) => text === "user:插话");
        const resultIndex = texts.findIndex((text) => text.startsWith("message:toolResult") || text.startsWith("toolResult:"));
        expect(steerIndex).toBeGreaterThan(resultIndex);
        expect(harness.contexts[1]!.messages.at(-1)).toMatchObject({role: "user", content: "插话"});

        await waitUntil("第二次调用完成", () => invocationPhases(session.log.entries).length === 4 && session.status.phase === "idle");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "end", "start", "end"]);
        // 追加的调用是第 3 轮（插话算用户发出的一轮），提醒每 2 轮触发一次，所以末尾是提醒、追加在它前面
        expect(harness.contexts[2]!.messages.at(-2)).toMatchObject({role: "user", content: "追加"});
        expect(harness.contexts[2]!.messages.at(-1)).toMatchObject({role: "user", attribution: "agent"});
        const queues = events.filter((event) => event.type === "queue").map((event) => `${(event as {steer: number}).steer}/${(event as {followUp: number}).followUp}`);
        expect(queues).toEqual(["0/1", "1/1", "0/1", "0/0"]);
    });
});

describe("终态分类与继续（输出 9、10）", () => {
    test("场景 6：模型错误 → failed/model 并可 continue；正常回复后 continue 为 invalid-state；轮数上限 → failed/limit", async () => {
        const {session} = await open({script: [{error: "上游挂了"}, {text: "好了"}]});
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        const failed = await started.value.done;
        expect(failed).toMatchObject({status: "failed", error: {kind: "model", message: "上游挂了", overflow: false}});
        expect(invocationPhases(failed.entries)).toEqual(["start", "error"]);
        const resumed = await session.continue();
        if (!resumed.ok) throw new Error(resumed.code);
        const result = await resumed.value.done;
        expect(result.status).toBe("completed");
        expect(kinds(result.entries)).toEqual(["custom:harness/invocation", "message:assistant", "custom:harness/invocation"]);
        expect(await session.continue()).toMatchObject({ok: false, code: "invalid-state"});

        const limited = await createHarness({maxTurns: 2, script: Array.from({length: 5}, (_, index) => ({calls: [{id: `c${index}`, name: "echo", args: {text: "x"}}]}))});
        harnesses.push(limited);
        const created = await limited.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const run = await created.value.prompt({content: "一直调工具"});
        if (!run.ok) throw new Error(run.code);
        const limitResult = await run.value.done;
        expect(limitResult).toMatchObject({status: "failed", error: {kind: "limit"}});
        expect(limitResult.entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant").length).toBeLessThanOrEqual(3);
        expect(invocationPhases(limitResult.entries)).toEqual(["start", "error"]);
    });

    test("场景 6：日志写入失败 → failed/log，句柄随日志关闭", async () => {
        const store = withFailingAppend(createMemorySessionStore());
        const {session, events} = await open({store, script: [{calls: [{id: "c1", name: "echo", args: {text: "x"}}]}, {text: "完"}]});
        // 工具开始时让下一次存储写入失败：命中的是助手消息或工具结果的写入，都在循环中途
        let armed = false;
        session.subscribe((event) => {
            if (event.type === "tool" && event.stage === "start" && !armed) {
                armed = true;
                store.failNext();
            }
        });
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        const result = await started.value.done;
        expect(armed).toBe(true);
        expect(events.some((event) => event.type === "entry" && event.entry.type === "message" && event.entry.message.role === "assistant")).toBe(true);
        expect(result).toMatchObject({status: "failed", error: {kind: "log"}});
        expect(await session.prompt({content: "再来"})).toMatchObject({ok: false, code: "closed"});
    });

    test("createSession 与 openSession：未知 Profile、重复 id、不存在的会话；title 写成 title_change；listSessions", async () => {
        const harness = await createHarness({profiles: [testProfile({"harness/tools": []}), testProfile({"harness/tools": []}, {id: "other"})]});
        harnesses.push(harness);
        expect(await harness.runtime.createSession({profileId: "nope"})).toMatchObject({ok: false, code: "unknown-profile"});
        const created = await harness.runtime.createSession({profileId: "other", id: "fixed", title: "标题"});
        if (!created.ok) throw new Error(created.code);
        expect(kinds(created.value.log.entries)).toEqual(["title_change"]);
        expect(await harness.runtime.createSession({profileId: "other", id: "fixed"})).toMatchObject({ok: false, code: "session-exists"});
        expect(await harness.runtime.openSession("missing")).toMatchObject({ok: false, code: "session-not-found"});
        await created.value.close();
        const reopened = await harness.runtime.openSession("fixed");
        expect(reopened.ok && reopened.value.status).toMatchObject({phase: "idle", pending: []});
        const listed = await harness.runtime.listSessions();
        expect(listed.ok && listed.value.map((summary) => summary.id)).toEqual(["fixed"]);
    });
});
