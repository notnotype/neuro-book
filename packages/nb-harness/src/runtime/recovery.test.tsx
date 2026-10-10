import {afterEach, describe, expect, test} from "bun:test";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {createSession} from "../session/session";
import {assistantMessage, invocation, toolCall, userMessage} from "../session/testing/fixtures";
import Type from "typebox";
import {defineTool} from "../tools/tools";
import {createHarness, invocationPhases, kinds, shellTool} from "./testing/harness";
import type {Harness} from "./testing/harness";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

describe("打开与恢复（输出 13）", () => {
    test("场景 7：等待审批时关闭（模拟崩溃）→ 重开为 waiting-user → approve 后运行时执行工具、写结果与 resumed、模型继续到 completed", async () => {
        const executed: string[] = [];
        const first = await createHarness({store: "jsonl", tools: [shellTool(executed)], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}, {text: "不会到这"}]});
        harnesses.push(first);
        const created = await first.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(created.code);
        const started = await created.value.prompt({content: "跑"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("等待用户", () => created.value.status.phase === "waiting-user");
        await created.value.close();

        // 同一存储、新的运行时（新进程）；模型脚本从这里的第一条开始
        const second = await createHarness({store: first.store, tools: [shellTool(executed)], approvalMode: "write", script: [{text: "跑完了"}]});
        harnesses.push(second);
        const reopened = await second.runtime.openSession("s1");
        if (!reopened.ok) throw new Error(`${reopened.code}: ${reopened.detail}`);
        const session = reopened.value;
        expect(session.status).toMatchObject({phase: "waiting-user", profileId: "writer"});
        expect(session.status.pending).toHaveLength(1);
        expect(await session.prompt({content: "x"})).toMatchObject({ok: false, code: "busy"});
        expect(await session.continue()).toMatchObject({ok: false, code: "invalid-state"});

        const before = session.log.entries.length;
        expect(await session.resolve({interactionId: session.status.pending[0]!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        await waitUntil("恢复的调用完成", () => session.status.phase === "idle");
        expect(executed).toEqual(["ls"]);
        expect(kinds(session.log.entries.slice(before))).toEqual(["custom:harness/interaction", "message:toolResult", "custom:harness/invocation", "message:assistant", "custom:harness/invocation"]);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting", "resumed", "end"]);
        // 模型看到的：历史里有工具调用与结果
        expect(second.contexts[0]!.messages.slice(-2).map((message) => message.role)).toEqual(["assistant", "toolResult"]);
        await session.close();
    });

    test("场景 7：运行中崩溃（没有待处理事项）→ 重开时补中断结果与 interrupted，状态 idle，可以 continue", async () => {
        const harness = await createHarness({store: "jsonl", script: [{text: "继续后的回复"}]});
        harnesses.push(harness);
        const log = await createSession(harness.store, {id: "crashed"});
        if (!log.ok) throw new Error(log.detail);
        await log.value.append([
            invocation("inv-1", "start"), userMessage("开始"),
            assistantMessage([toolCall("c1", "echo", {text: "x"})], {stopReason: "toolUse"}),
        ]);
        log.value.close();
        const reopened = await harness.runtime.openSession("crashed");
        if (!reopened.ok) throw new Error(reopened.code);
        expect(reopened.value.status).toMatchObject({phase: "idle", pending: []});
        expect(kinds(reopened.value.log.entries).slice(-2)).toEqual(["message:toolResult", "custom:harness/invocation"]);
        expect(invocationPhases(reopened.value.log.entries)).toEqual(["start", "interrupted"]);
        // 没有 Profile 记录的会话不能继续；指定 Profile 后可以
        expect(await reopened.value.continue()).toMatchObject({ok: false, code: "unknown-profile"});
        const withProfile = await reopened.value.prompt({content: "接着来"}, {profileId: "writer"});
        if (!withProfile.ok) throw new Error(`${withProfile.code}: ${withProfile.detail}`);
        expect((await withProfile.value.done).status).toBe("completed");
        await reopened.value.close();
    });

    test("恢复执行可中止：工具收到信号，abort 后迟到的完成不再写入、不再 resumed；同一事项并发两次 resolve 只有一次成功，句柄照常可用", async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let toolStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            toolStarted = resolve;
        });
        let sawAbort = false;
        const slowShell = () => defineTool({
            id: "shell", description: "慢命令", parameters: Type.Object({cmd: Type.String()}), risk: "exec",
            execute: async (_args, ctx) => {
                toolStarted();
                ctx.signal.addEventListener("abort", () => {
                    sawAbort = true;
                }, {once: true});
                await gate;
                return {ok: true, content: "迟到的结果"};
            },
        });
        const first = await createHarness({store: "jsonl", tools: [slowShell()], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}]});
        harnesses.push(first);
        const created = await first.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(created.code);
        const run = await created.value.prompt({content: "跑"});
        if (!run.ok) throw new Error(run.code);
        await waitUntil("等待用户", () => created.value.status.phase === "waiting-user");
        await created.value.close();

        const second = await createHarness({store: first.store, tools: [slowShell()], approvalMode: "write", script: [{text: "继续后的回复"}]});
        harnesses.push(second);
        const reopened = await second.runtime.openSession("s1");
        if (!reopened.ok) throw new Error(reopened.code);
        const session = reopened.value;
        const id = session.status.pending[0]!.interactionId;
        const firstResolve = session.resolve({interactionId: id, decision: "approve"});
        await started;
        // 同一事项再应答一次：在任何写入之前就被挡下，不会让日志拒绝写入、更不会关闭句柄
        expect(await session.resolve({interactionId: id, decision: "approve"})).toMatchObject({ok: false, code: "already-answered"});

        // 恢复执行期间 abort：工具收到信号，日志收口为 aborted；放行工具后迟到的结果不再写入
        expect(session.abort()).toEqual({ok: true, value: undefined});
        await waitUntil("收口完成", () => session.status.phase === "idle");
        expect(sawAbort).toBe(true);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting", "aborted"]);
        const before = session.log.entries.length;
        release();
        expect((await firstResolve).ok).toBe(false);
        expect(session.log.entries.length).toBe(before);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting", "aborted"]);

        // 句柄照常可用
        const next = await session.prompt({content: "继续"});
        if (!next.ok) throw new Error(`${next.code}: ${next.detail}`);
        expect((await next.value.done).status).toBe("completed");
        await session.close();
    });

    test("恢复出来的等待状态 abort：拒绝应答、aborted 结果、invocation aborted，回到 idle", async () => {
        const first = await createHarness({store: "jsonl", tools: [shellTool()], approvalMode: "write", script: [{calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}]});
        harnesses.push(first);
        const created = await first.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(created.code);
        const started = await created.value.prompt({content: "跑"});
        if (!started.ok) throw new Error(started.code);
        await waitUntil("等待用户", () => created.value.status.phase === "waiting-user");
        await created.value.close();
        const second = await createHarness({store: first.store, tools: [shellTool()]});
        harnesses.push(second);
        const reopened = await second.runtime.openSession("s1");
        if (!reopened.ok) throw new Error(reopened.code);
        expect(reopened.value.abort()).toEqual({ok: true, value: undefined});
        await waitUntil("收口完成", () => reopened.value.status.phase === "idle");
        expect(invocationPhases(reopened.value.log.entries)).toEqual(["start", "waiting", "aborted"]);
        expect(kinds(reopened.value.log.entries).slice(-3)).toEqual(["custom:harness/interaction", "message:toolResult", "custom:harness/invocation"]);
        await reopened.value.close();
    });
});
