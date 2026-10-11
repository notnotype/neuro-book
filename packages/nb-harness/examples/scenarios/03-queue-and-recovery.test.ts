/**
 * 场景 3：排队与恢复——插话、追加，以及进程崩溃后从日志恢复等待中的审批。
 *
 * 要说明的事：
 * - 运行中再来输入有两条路：`steer` 交给 OMP，在当前工具批次结束后送给模型（本次调用内生效）；
 *   `followup` 留在运行时，本次调用 `completed` 后自动开始下一次调用。两个队列只在内存里。
 * - “崩溃”就是不 `close` 直接丢掉句柄与运行时。会话的一切状态都从日志回放：下一次 `openSession` 看到未结束的调用
 *   有待处理的审批，就恢复成 `waiting-user`；`resolve(approve)` 后运行时按日志里的工具调用执行、写结果、写 `invocation resumed`，
 *   再让模型继续。没有待处理事项的中断调用则补一条中断结果与 `invocation interrupted`，回到 `idle`。
 *
 * 行为合同：docs/specs/harness/runtime.md 输出第 11、13 条；docs/specs/harness/session.md 输出第 13、16 条。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import type {Context} from "@oh-my-pi/pi-ai";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {contextText, lastToolResultText, scriptedModel} from "../testing/scripted-model";
import type {Reply} from "../testing/scripted-model";
import {createStage, exampleConfig, invocationPhases, kinds, loadWriterProfile} from "../testing/stage";
import type {Stage} from "../testing/stage";

let stage: Stage | null = null;
const assembled: Assembled[] = [];
afterAll(async () => {
    for (const item of assembled) item.close();
    await stage?.cleanup();
});

const editSecondLine = (id: string, line: string) => (context: Context): Reply => {
    const header = lastToolResultText(context).split("\n")[0] ?? "";
    return {calls: [{id, name: "edit", args: {input: `${header}\nPUT 2.=2:\n+${line}\n`}}]};
};

describe("示例场景 3：排队与恢复", () => {
    test("steer 在工具批次之后送达，followup 在完成后自动开始下一次调用", async () => {
        stage = await createStage("03-queue");
        const model = scriptedModel([
            {calls: [{id: "c1", name: "read", args: {path: "chapter-1.md"}}]},
            {text: "明白，不剧透。第一章写出航。"},
            {text: "这是追加的那次调用的回复。"},
        ]);
        const first = await assemble({workspace: stage.workspace, state: stage.state, config: exampleConfig(), profiles: [await loadWriterProfile()], apiKeys: {scripted: "example-key"}, model: {stream: model.stream}});
        assembled.push(first);
        const created = await first.runtime.createSession({profileId: "writer", id: "queue"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;

        // 插话要在工具批次结束之前入队才会在这批之后送达：脚本化模型不等网络，批次转瞬即过，所以在 read 开始的事件里入队。
        // 界面里用户打字的那一刻通常就在某个批次中间，直接调 steer 即可
        const queued: {steer: number; followUp: number}[] = [];
        session.subscribe((event) => {
            if (event.type === "tool" && event.stage === "start" && event.toolName === "read") {
                expect(session.steer({content: "顺便说一下：别剧透结局。"})).toEqual({ok: true, value: undefined});
                expect(session.followup({content: "再用一句话总结人物。"})).toEqual({ok: true, value: undefined});
                queued.push({...session.status.queue});
            }
        });
        const started = await session.prompt({content: "第一章讲了什么？"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);

        const result = await started.value.done;
        expect(queued).toEqual([{steer: 1, followUp: 1}]);
        expect(result.status).toBe("completed");
        // 日志里插话紧跟在工具结果之后；模型第二次请求看到了它
        const seq = kinds(result.entries);
        expect(seq.slice(seq.indexOf("message:toolResult"), seq.indexOf("message:toolResult") + 3)).toEqual(["message:toolResult", "message:user", "message:assistant"]);
        expect(contextText(model.contexts[1]!)).toContain("别剧透结局");

        // 追加的输入自动成为第二次调用
        await waitUntil("追加的调用完成", () => invocationPhases(session.log.entries).length === 4 && session.status.phase === "idle");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "end", "start", "end"]);
        expect(contextText(model.contexts[2]!)).toContain("再用一句话总结人物");
        expect(session.status.queue).toEqual({steer: 0, followUp: 0});
        await session.close();
    });

    test("等待审批时进程崩溃：重开后恢复为 waiting-user，批准后工具执行、模型继续", async () => {
        if (stage === null) throw new Error("上一条场景先建场地");
        const chapter = join(stage.workspace, "chapter-1.md");
        // 第一个“进程”：读 → 改 → 等审批时丢掉一切（不 close）
        const crashing = scriptedModel([
            {calls: [{id: "c1", name: "read", args: {path: "chapter-1.md"}}]},
            editSecondLine("c2", "林岚站在远航号的甲板上。"),
        ]);
        const first = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig({tools: {edit: "ask"}}), profiles: [await loadWriterProfile()],
            apiKeys: {scripted: "example-key"}, model: {stream: crashing.stream},
        });
        assembled.push(first);
        const created = await first.runtime.createSession({profileId: "writer", id: "crash"});
        if (!created.ok) throw new Error(created.code);
        const run = await created.value.prompt({content: "把第二行改成带船名的。"});
        if (!run.ok) throw new Error(`${run.code}: ${run.detail}`);
        await waitUntil("等待审批", () => created.value.status.phase === "waiting-user");
        expect(invocationPhases(created.value.log.entries)).toEqual(["start", "waiting"]);
        first.close();

        // 第二个“进程”：同一个状态目录、新的运行时；模型脚本从“工具执行之后”那一步开始
        const resumed = scriptedModel([{text: "改好了。"}]);
        const second = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig({tools: {edit: "ask"}}), profiles: [await loadWriterProfile()],
            model: {stream: resumed.stream},
        });
        assembled.push(second);
        const reopened = await second.runtime.openSession("crash");
        if (!reopened.ok) throw new Error(`${reopened.code}: ${reopened.detail}`);
        const session = reopened.value;
        expect(session.status).toMatchObject({phase: "waiting-user", profileId: "writer"});
        expect(session.status.pending).toHaveLength(1);
        expect(session.status.pending[0]!.request.toolName).toBe("edit");

        expect(await session.resolve({interactionId: session.status.pending[0]!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        await waitUntil("恢复的调用完成", () => session.status.phase === "idle");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(await readFile(chapter, "utf8")).toBe("第一章 出航\n林岚站在远航号的甲板上。\n远处是 1987 年的青岛。\n");
        // 模型继续时看到的是完整的工具往来
        expect(resumed.contexts[0]!.messages.slice(-2).map((message) => message.role)).toEqual(["assistant", "toolResult"]);
        await session.close();
    });
});
