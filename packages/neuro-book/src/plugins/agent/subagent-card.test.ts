/**
 * 子代理卡片的推导（docs/specs/agent/conversation.md 输出 33–39）：调用的状态 × 子代理运行的状态，终态按四个来源依次找。
 */
import {describe, expect, test} from "bun:test";

import type {AssistantMessageView, MessageView, ToolCallView} from "@notnotype/nb-agent-ui";

import type {TreeItem} from "./shared/subagents";
import {cardModel} from "./web/subagent-card";

const spawn = (extra: Partial<ToolCallView> = {}): ToolCallView => ({id: "c1", name: "agent_spawn", status: "running", args: {profile: "nbook.agent.adhoc", prompt: "查第三章的称谓有没有前后不一致"}, invocation: "inv-1", ...extra});
const child = (extra: Partial<TreeItem> = {}): TreeItem => ({id: "child", parent: "p", callId: "c1", invocation: "inv-1", forked: false, profile: "nbook.agent.adhoc", name: "称谓检查", profileIcon: "i-lucide-bot", state: "idle", runs: [], ...extra});
const tree = (...items: TreeItem[]) => new Map(items.map((item) => [item.id, item]));
const reply = (...toolCalls: ToolCallView[]): AssistantMessageView => ({kind: "assistant", id: `a-${toolCalls[0]?.id ?? "x"}`, timestamp: 1, status: "done", text: "", thinking: "", model: "m", toolCalls, contentOmitted: false});

describe("子代理卡片", () => {
    test("参数还在生成：正在准备；名字取 name，没有时取 prompt 的开头", () => {
        expect(cardModel(spawn({status: "streaming"}), tree(), [], false)).toMatchObject({state: "preparing", name: "查第三章的称谓有没有前后不一致", childId: null});
    });

    test("派发失败：带码、没有子会话；子会话已建好时带它的 id", () => {
        const failed = spawn({status: "error", result: {text: "profile-not-allowed: …", truncated: false, details: {code: "profile-not-allowed"}}});
        expect(cardModel(failed, tree(), [], true)).toMatchObject({state: "dispatch-failed", code: "profile-not-allowed", childId: null});
        const built = spawn({status: "error", result: {text: "…", truncated: false, details: {code: "no-credentials", sessionId: "child"}}});
        expect(cardModel(built, tree(), [], true)).toMatchObject({state: "dispatch-failed", childId: "child"});
    });

    test("调用没执行：被拒写 denied、参数不对写 invalid，父会话还在跑也不转圈", () => {
        const denied = spawn({status: "denied", result: {text: "用户拒绝了", truncated: false}});
        expect(cardModel(denied, tree(), [], false)).toMatchObject({state: "denied", childId: null, result: "用户拒绝了"});
        expect(cardModel(spawn({status: "invalid", result: {text: "prompt 是必填的", truncated: false}}), tree(), [], false)).toMatchObject({state: "invalid"});
    });

    test("调用 unknown：按运行找得到就照运行画，找不到就是 unknown（父会话还在跑也不写运行中）", () => {
        const uncertain = spawn({status: "unknown", result: {text: "不知道有没有执行完", truncated: false}});
        expect(cardModel(uncertain, tree(), [], false)).toMatchObject({state: "unknown", childId: null});
        expect(cardModel(uncertain, tree(child({state: "running", runId: "r1", runInvocation: "inv-1"})), [], false)).toMatchObject({state: "running", childId: "child"});
    });

    test("运行中按调用的 invocation 认子会话（fork 出来的不认），交出最近一步、工具次数与开始时刻", () => {
        const running = child({state: "running", runId: "r1", runInvocation: "inv-1", tools: 3, startedAt: 100, step: {tool: "nbook.agent.read", target: "project://正文/第二章.md"}});
        const forked = child({id: "copy", forked: true, state: "running", runId: "r9", runInvocation: "inv-1"});
        // 工具是视图认的名字（同注册表的键），地址只留最后一段。
        expect(cardModel(spawn(), tree(forked, running), [], false)).toMatchObject({state: "running", childId: "child", step: {tool: "read", target: "第二章.md"}, tools: 3, startedAt: 100, name: "称谓检查"});
        const stepOf = (step: TreeItem["step"]) => cardModel(spawn(), tree(child({state: "running", runId: "r1", runInvocation: "inv-1", step})), [], false).step;
        expect(stepOf({tool: "nbook.agent.edit-replace", target: "project://正文/第三章/"})).toEqual({tool: "edit", target: "第三章"});
        expect(stepOf({tool: "nbook.agent.read", target: "project://正文/第二章 雨夜.md"})).toEqual({tool: "read", target: "第二章 雨夜.md"});
        expect(stepOf({tool: "nbook.agent.grep", target: "称谓"})).toEqual({tool: "grep", target: "称谓"});
        // 含地址的命令不是地址，原样写。
        expect(stepOf({tool: "nbook.agent.shell", target: "cat project://正文/第二章.md"})).toEqual({tool: "shell", target: "cat project://正文/第二章.md"});
        expect(stepOf({tool: "lab.publish_chapter"})).toEqual({tool: "publish_chapter"});
        // 进度到了、还没有工具调用：在思考；进度还没到：不标（卡片写正在启动）。
        expect(cardModel(spawn(), tree(child({state: "running", runId: "r1", runInvocation: "inv-1"})), [], false)).toMatchObject({state: "running", thinking: true});
        expect(cardModel(spawn(), tree(), [], false).thinking).toBeUndefined();
        expect(cardModel(spawn(), tree(child({state: "question", runId: "r1", runInvocation: "inv-1", question: {id: "q", text: "要几章？"}})), [], false)).toMatchObject({state: "question", line: "要几章？"});
        expect(cardModel(spawn(), tree(child({state: "waiting", runId: "r1", runInvocation: "inv-1"})), [], false)).toMatchObject({state: "waiting"});
    });

    test("等用户时写等的是什么：批准哪个工具、回答哪个问题、切换模式", () => {
        const waiting = (request: unknown, kind: "approval" | "question") => cardModel(spawn(), tree(child({state: "waiting", runId: "r1", runInvocation: "inv-1", pending: [{id: "p1", kind, callId: "x", request: request as never}]})), [], false).waitingFor;
        expect(waiting({tool: "nbook.agent.write", args: {}}, "approval")).toEqual({kind: "approval", tool: "write"});
        expect(waiting({tool: "nbook.agent.edit-replace", args: {}}, "approval")).toEqual({kind: "approval", tool: "edit"});
        expect(waiting({data: {questions: [{question: "要几章？", options: []}]}}, "question")).toEqual({kind: "question", text: "要几章？"});
        expect(waiting({data: {kind: "mode-switch", from: "plan", to: "normal"}}, "question")).toEqual({kind: "mode-switch"});
    });

    test("终态：调用自己的结果优先，其次后来的 wait 结果里同 runId 的，再次 runs 里的收口", () => {
        const own = spawn({status: "success", result: {text: "全文", truncated: false, details: {sessionId: "child", runId: "r1", status: "completed", line: "找到 4 处。"}}});
        expect(cardModel(own, tree(), [], true)).toMatchObject({state: "done", line: "找到 4 处。", result: "全文", background: false});

        const background = spawn({status: "success", result: {text: "还在跑", truncated: false, details: {sessionId: "child", runId: "r1", status: "running"}}});
        const waited = reply({id: "w1", name: "agent.wait", status: "success", args: {}, result: {text: "等到的全文", truncated: false, details: {jobs: [{jobId: "j", runId: "r1", state: "failed", line: "模型请求超时"}]}}});
        const messages: MessageView[] = [reply(background), waited];
        expect(cardModel(background, tree(child()), messages, true)).toMatchObject({state: "failed", line: "模型请求超时", background: true, result: "等到的全文"});

        expect(cardModel(background, tree(child({runs: [{runId: "r1", reason: "interrupted", endedAt: 5}]})), [reply(background)], true)).toMatchObject({state: "interrupted", background: true});
    });

    test("conversation.md 输出 33：runs 里的收口带着回复首句时完成写这句；加它之前写的索引没有，照旧写已完成", () => {
        const background = spawn({status: "success", result: {text: "还在跑", truncated: false, details: {sessionId: "child", runId: "r1", status: "running"}}});
        expect(cardModel(background, tree(child({runs: [{runId: "r1", reason: "completed", endedAt: 5, line: "找到 4 处称谓前后不一致。"}]})), [reply(background)], true)).toMatchObject({state: "done", line: "找到 4 处称谓前后不一致。"});
        expect(cardModel(background, tree(child({runs: [{runId: "r1", reason: "completed", endedAt: 5}]})), [reply(background)], true)).toMatchObject({state: "done", line: ""});
        // 只有完成写首句：出错的照旧只写“出错”（索引里那句可能是中途的旁白）。
        expect(cardModel(background, tree(child({runs: [{runId: "r1", reason: "error", endedAt: 5, line: "我先看看第二章。"}]})), [reply(background)], true)).toMatchObject({state: "failed", line: ""});
    });

    test("同一批里先收口的子代理：调用还没有结果，按子会话的第一次运行画出终态", () => {
        expect(cardModel(spawn(), tree(child({runs: [{runId: "r1", reason: "error", endedAt: 5}]})), [], false)).toMatchObject({state: "failed"});
    });

    test("父会话不在跑、也找不到子会话的收口：状态未知（进程崩溃留下的）", () => {
        const background = spawn({status: "success", result: {text: "还在跑", truncated: false, details: {sessionId: "child", runId: "r1", status: "running"}}});
        expect(cardModel(background, tree(child()), [reply(background)], true)).toMatchObject({state: "unknown"});
        expect(cardModel(spawn(), tree(), [], false)).toMatchObject({state: "running"});
    });

    test("agent_send 按参数的 id 认子会话", () => {
        const send: ToolCallView = {id: "c2", name: "agent_send", status: "running", args: {id: "child", message: "接着做"}, invocation: "inv-2"};
        expect(cardModel(send, tree(child({state: "running", runId: "r2", runInvocation: "inv-2"})), [], false)).toMatchObject({state: "running", childId: "child"});
    });
});
