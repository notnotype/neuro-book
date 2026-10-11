import {afterEach, describe, expect, test} from "bun:test";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {InteractionData} from "../session/session";
import type {AgentSession, RuntimeEvent} from "./runtime";
import {createHarness, echoTool, invocationPhases, kinds, shellTool, waitingTool} from "./testing/harness";
import type {Harness} from "./testing/harness";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

async function open(options: Parameters<typeof createHarness>[0] = {}): Promise<{harness: Harness; session: AgentSession; events: RuntimeEvent[]}> {
    const harness = await createHarness({store: "jsonl", ...options});
    harnesses.push(harness);
    const created = await harness.runtime.createSession({profileId: "writer", id: "s1"});
    if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
    const events: RuntimeEvent[] = [];
    created.value.subscribe((event) => events.push(event));
    return {harness, session: created.value, events};
}

const interactions = (entries: readonly {type: string; customType?: string; data?: unknown}[]): InteractionData[] =>
    entries.filter((entry) => entry.type === "custom" && entry.customType === "harness/interaction").map((entry) => entry.data as InteractionData);
const toolTexts = (entries: readonly {type: string; message?: {role: string; content: unknown}}[]): string[] =>
    entries.filter((entry) => entry.type === "message" && entry.message!.role === "toolResult").map((entry) => JSON.stringify(entry.message!.content));
const settled = async <T,>(promise: Promise<T>): Promise<boolean> => Promise.race([promise.then(() => true), Promise.resolve(false)]);

describe("审批等待与应答（输出 6、7）", () => {
    test("场景 3：exec 工具在 write 模式下询问用户；approve(session) 后执行并继续，同会话再调不再询问；reject 的结果带说明", async () => {
        const executed: string[] = [];
        const {session, events} = await open({
            tools: [echoTool(), shellTool(executed)], approvalMode: "write",
            script: [{calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}, {text: "跑完了"}, {calls: [{id: "c2", name: "shell", args: {cmd: "pwd"}}]}, {text: "又跑完了"}, {calls: [{id: "c3", name: "echo", args: {text: "x"}}, {id: "c4", name: "shell", args: {cmd: "rm"}}]}, {text: "结束"}],
        });
        const started = await session.prompt({content: "跑一下"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("进入等待用户", () => session.status.phase === "waiting-user");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting"]);
        const pending = session.status.pending;
        expect(pending).toHaveLength(1);
        expect(pending[0]!.request).toMatchObject({toolCallId: "c1", toolName: "shell", tier: "exec"});
        expect(await settled(started.value.done)).toBe(false);
        expect(events.filter((event) => event.type === "interaction").map((event) => (event as {phase: string}).phase)).toEqual(["request"]);
        expect(await session.resolve({interactionId: "nope", decision: "approve"})).toMatchObject({ok: false, code: "unknown-interaction"});

        expect(await session.resolve({interactionId: pending[0]!.interactionId, decision: "approve", scope: "session"})).toEqual({ok: true, value: undefined});
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(executed).toEqual(["ls"]);
        expect(invocationPhases(result.entries)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(interactions(result.entries).map((data) => data.phase)).toEqual(["request", "response"]);
        expect(interactions(result.entries)[1]!.response).toMatchObject({decision: "approve", scope: "session", decidedBy: "user"});
        expect(await session.resolve({interactionId: pending[0]!.interactionId, decision: "approve"})).toMatchObject({ok: false, code: "invalid-state"});

        // 本会话内已允许 shell（exec）：第二次不再询问
        const second = await session.prompt({content: "再跑"});
        if (!second.ok) throw new Error(second.code);
        const secondResult = await second.value.done;
        expect(secondResult.status).toBe("completed");
        expect(interactions(secondResult.entries)).toEqual([]);
        expect(executed).toEqual(["ls", "pwd"]);

        // 不同工具：echo 是 read 直接放行；拒绝的 shell 调用带说明——用新会话（本会话已放行）
        const fresh = await harnesses[0]!.runtime.createSession({profileId: "writer", id: "s2"});
        if (!fresh.ok) throw new Error(fresh.code);
        const freshRun = await fresh.value.prompt({content: "删"});
        if (!freshRun.ok) throw new Error(freshRun.code);
        await waitUntil("等待用户", () => fresh.value.status.phase === "waiting-user");
        const ask = fresh.value.status.pending[0]!;
        expect(ask.request.toolCallId).toBe("c4");
        expect(await fresh.value.resolve({interactionId: ask.interactionId, decision: "reject", note: "不行"})).toEqual({ok: true, value: undefined});
        const freshResult = await freshRun.value.done;
        expect(freshResult.status).toBe("completed");
        expect(toolTexts(freshResult.entries)).toEqual([JSON.stringify([{type: "text", text: "回显：x"}]), JSON.stringify([{type: "text", text: "denied: 不行"}])]);
    });

    test("场景 3：同一批两个询问任意顺序应答；全部应答后才写 resumed", async () => {
        const executed: string[] = [];
        const {session} = await open({tools: [shellTool(executed)], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "a"}}, {id: "c2", name: "shell", args: {cmd: "b"}}]}, {text: "完"}]});
        const started = await session.prompt({content: "两个"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("两个待处理", () => session.status.pending.length === 2);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting"]);
        const [first, second] = session.status.pending;
        expect(await session.resolve({interactionId: second!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        expect(session.status.phase).toBe("waiting-user");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting"]);
        expect(await session.resolve({interactionId: first!.interactionId, decision: "reject"})).toEqual({ok: true, value: undefined});
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(invocationPhases(result.entries)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(executed).toEqual(["b"]);
    });

    test("输出 6：auto 模式下审批模型 allow/deny 直接生效并写两条 interaction（decidedBy: approver），escalate 转为询问用户", async () => {
        const executed: string[] = [];
        const {session, harness} = await open({
            tools: [shellTool(executed)], approvalMode: "auto", approvalRole: true,
            script: [{calls: [{id: "c1", name: "shell", args: {cmd: "a"}}]}, {text: "一"}, {calls: [{id: "c2", name: "shell", args: {cmd: "b"}}]}, {text: "二"}, {calls: [{id: "c3", name: "shell", args: {cmd: "c"}}]}, {text: "三"}],
            judge: [{text: '{"decision":"allow","reason":"安全"}'}, {text: '{"decision":"deny","reason":"危险"}'}, {text: "说不清"}],
        });
        const allowed = await session.prompt({content: "a"});
        if (!allowed.ok) throw new Error(allowed.code);
        const allowedResult = await allowed.value.done;
        expect(allowedResult.status).toBe("completed");
        expect(executed).toEqual(["a"]);
        expect(interactions(allowedResult.entries).map((data) => data.phase)).toEqual(["request", "response"]);
        expect(interactions(allowedResult.entries)[1]!.response).toMatchObject({decision: "approve", decidedBy: "approver", note: "安全"});
        expect(harness.judgeContexts[0]!.messages[0]!.content).toContain('<tool id="shell" tier="exec">');

        const denied = await session.prompt({content: "b"});
        if (!denied.ok) throw new Error(denied.code);
        const deniedResult = await denied.value.done;
        expect(executed).toEqual(["a"]);
        expect(toolTexts(deniedResult.entries)[0]).toContain("denied: 危险");
        expect(interactions(deniedResult.entries)[1]!.response).toMatchObject({decision: "reject", decidedBy: "approver"});

        const escalated = await session.prompt({content: "c"});
        if (!escalated.ok) throw new Error(escalated.code);
        await waitUntil("转为询问用户", () => session.status.phase === "waiting-user");
        expect(interactions(session.log.entries).at(-1)).toMatchObject({phase: "request", request: {toolCallId: "c3"}});
        expect(await session.resolve({interactionId: session.status.pending[0]!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        expect((await escalated.value.done).status).toBe("completed");
        expect(executed).toEqual(["a", "c"]);
    });
});

describe("中止（输出 8）", () => {
    test("场景 4：等待审批时 abort → 拒绝应答（note: aborted）、工具结果 aborted、invocation aborted、队列清空；运行中 abort 同样收口", async () => {
        const executed: string[] = [];
        const {session, events} = await open({tools: [shellTool(executed), waitingTool()], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "a"}}]}, {text: "不该到这"}, {calls: [{id: "c2", name: "wait", args: {}}]}, {text: "也不该"}]});
        const started = await session.prompt({content: "a"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("等待用户", () => session.status.phase === "waiting-user");
        expect(session.followup({content: "之后"})).toEqual({ok: true, value: undefined});
        expect(session.abort()).toEqual({ok: true, value: undefined});
        const result = await started.value.done;
        expect(result.status).toBe("aborted");
        expect(executed).toEqual([]);
        expect(interactions(result.entries).at(-1)).toMatchObject({phase: "response", response: {decision: "reject", decidedBy: "user", note: "aborted"}});
        expect(toolTexts(result.entries)[0]).toContain("aborted");
        expect(invocationPhases(result.entries)).toEqual(["start", "waiting", "aborted"]);
        expect(session.status).toMatchObject({phase: "idle", queue: {steer: 0, followUp: 0}});
        expect(events.filter((event) => event.type === "status").map((event) => (event as {status: {phase: string}}).status.phase)).toEqual(["running", "waiting-user", "aborting", "idle"]);

        const running = await session.prompt({content: "wait"});
        if (!running.ok) throw new Error(running.code);
        await waitUntil("工具开始", () => events.some((event) => event.type === "tool" && (event as {toolName: string}).toolName === "wait"));
        expect(session.abort()).toEqual({ok: true, value: undefined});
        const aborted = await running.value.done;
        expect(aborted.status).toBe("aborted");
        expect(invocationPhases(aborted.entries)).toEqual(["start", "aborted"]);
        expect(session.abort()).toEqual({ok: true, value: undefined});
    });
});

describe("关闭（输出 16）", () => {
    test("等待用户时 close：不写新条目，done 以 waiting 完成，之后操作为 closed", async () => {
        const {session} = await open({tools: [shellTool()], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "a"}}]}, {text: "完"}]});
        const started = await session.prompt({content: "a"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("等待用户", () => session.status.phase === "waiting-user");
        const before = kinds(session.log.entries);
        await session.close();
        expect((await started.value.done).status).toBe("waiting");
        expect(kinds(session.log.entries)).toEqual(before);
        expect(await session.prompt({content: "x"})).toMatchObject({ok: false, code: "closed"});
        expect(session.abort()).toMatchObject({ok: false, code: "closed"});
    });
});

describe("Invocation.next()（输出 6）", () => {
    test("场景 11：等待审批时 next 返回 waiting 与事项（再调用仍返回）；应答后 next 返回 done；没有审批的调用第一次 next 就是 done", async () => {
        const {session} = await open({tools: [echoTool(), shellTool()], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}, {text: "跑完了"}, {text: "直接回复"}]});
        const started = await session.prompt({content: "跑"});
        if (!started.ok) throw new Error(started.code);
        const step = await started.value.next();
        expect(step.kind).toBe("waiting");
        if (step.kind !== "waiting") return;
        expect(step.pending.map((item) => item.request.toolCallId)).toEqual(["c1"]);
        expect(session.status.phase).toBe("waiting-user");
        // 没应答之前再问一次：还是同一组事项
        const again = await started.value.next();
        expect(again.kind === "waiting" && again.pending[0]!.interactionId).toBe(step.pending[0]!.interactionId);
        expect(await session.resolve({interactionId: step.pending[0]!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        const finished = await started.value.next();
        expect(finished.kind).toBe("done");
        expect(finished.kind === "done" && finished.result).toEqual(await started.value.done);

        const plain = await session.prompt({content: "说句话"});
        if (!plain.ok) throw new Error(plain.code);
        const only = await plain.value.next();
        expect(only.kind === "done" && only.result.status).toBe("completed");
    });
});
