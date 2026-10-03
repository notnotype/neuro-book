import {beforeEach, describe, expect, test} from "vitest";
import {mkdtemp} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {NeuroWorkflowSessionPort} from "nbook/server/agent/workflow/workflow-session-port";
import {MockAgentPort, SessionBusyError, WorkflowRunner} from "@notnotype/nb-workflow";
import type {AgentWorkflowDefinition, JsonValue, Wf} from "@notnotype/nb-workflow";

/**
 * Task 110 初步接入的核心验证：nb-workflow 内核跑在真实 JsonlSessionRepository 上。
 * 覆盖：端口语义映射（F2 锚定 / auto-leaf / 归档 / findByTag）+ 四类内核行为
 * （acquire 跨 run 复用、直聊插入主线、excursion 旁支、ask 挂起 resume 缓存命中）。
 */
describe("NeuroWorkflowSessionPort × workflow 内核", () => {
    let repo: JsonlSessionRepository;
    let port: NeuroWorkflowSessionPort;
    let mock: MockAgentPort;
    let runner: WorkflowRunner;

    beforeEach(async () => {
        const root = await mkdtemp(testHostPath("nb-workflow-port-"));
        repo = new JsonlSessionRepository(root);
        port = new NeuroWorkflowSessionPort(repo);
        mock = new MockAgentPort(port);
        runner = new WorkflowRunner({sessions: port, agents: mock});
    });

    test("并发 createSession 分配唯一 sessionId（real-fanout 踩出的 seq 读改写竞态回归）", async () => {
        const metas = await Promise.all(Array.from({length: 8}, (_, i) =>
            port.createSession({profileKey: `workflow.demo.p${i}`, kind: "chat", tags: []})));
        const ids = metas.map((m) => m.sessionId);
        expect(new Set(ids).size).toBe(8);
    });

    test("端口语义：显式锚定 append 开叉、auto-leaf、checkout、transcript 投影、archive、findByTag", async () => {
        const meta = await port.createSession({profileKey: "workflow.demo.actor", kind: "chat", tags: ["demo:tag-a"]});
        // kind/tags 落进真实 header（D15 子集）
        const snapshot0 = await repo.readSession(meta.sessionId);
        expect(snapshot0.metadata.kind).toBe("chat");
        expect(snapshot0.metadata.tags).toEqual(["demo:tag-a"]);

        // append 自动移 leaf；显式 parent 锚定开叉
        const e1 = await port.append(meta.sessionId, null, {role: "user", message: "主线一", origin: "direct"});
        const e2 = await port.append(meta.sessionId, e1, {role: "assistant", message: "主线二", origin: "workflow"});
        expect(await port.activeLeaf(meta.sessionId)).toBe(e2);
        const branch = await port.append(meta.sessionId, e1, {role: "assistant", message: "旁支", origin: "workflow"});
        expect(await port.activeLeaf(meta.sessionId)).toBe(branch);

        // checkout 回主线；transcript 沿游标回溯、只含消息、origin 映射正确
        await port.setActiveLeaf(meta.sessionId, e2);
        const transcript = await port.transcript(meta.sessionId, e2);
        expect(transcript.map((e) => e.message)).toEqual(["主线一", "主线二"]);
        expect(transcript.map((e) => e.origin)).toEqual(["direct", "workflow"]);

        // findByTag 找到；归档后不再命中
        expect((await port.findByTag("workflow.demo.actor", "demo:tag-a"))?.sessionId).toBe(meta.sessionId);
        await port.archive(meta.sessionId);
        expect((await port.meta(meta.sessionId)).archived).toBe(true);
        expect(await port.findByTag("workflow.demo.actor", "demo:tag-a")).toBeNull();
    });

    test("RP 形态：acquire 跨 run 复用真实 session，直聊 entry 插在主线，锁互斥", async () => {
        mock.register("workflow.demo.leader", ({mode, message, history, input}) => {
            if (mode === "followup") return {message: `结算(${(input as {n: number}).n})`, data: {historyLen: history.length} as JsonValue};
            if (message?.startsWith("聊：")) return {message: "闲聊回应"};
            return {message: "派发", data: {n: 1} as JsonValue};
        });

        const turn: AgentWorkflowDefinition = {
            key: "mini-rp",
            run: async (wf: Wf, args) => {
                const leader = await wf.agents.acquire({profileKey: "workflow.demo.leader", tag: "t:rp"});
                const plan = await leader.invoke({message: (args as {input: string}).input});
                await leader.invoke({mode: "followup", input: {n: (plan.result.data as {n: number}).n}});
                return {leaderSession: leader.id} as JsonValue;
            },
        };

        const r1 = await runner.start(turn, {input: "回合一"});
        expect(r1.status).toBe("completed");
        const leaderId = (r1.result as {leaderSession: number}).leaderSession;

        // 轮间直聊（direct 入口写真实 entry）
        const u = await port.append(leaderId, await port.activeLeaf(leaderId), {role: "user", message: "聊：酒保是谁", origin: "direct"});
        const resp = await mock.respondAt(leaderId, u, {mode: "prompt", message: "聊：酒保是谁"});
        await port.append(leaderId, u, {role: "assistant", message: resp.message, origin: "direct"});

        // 第二回合复用同一 session，历史连续（4 + 2 + 4 = 10 条消息在主线上）
        const r2 = await runner.start(turn, {input: "回合二"});
        expect((r2.result as {leaderSession: number}).leaderSession).toBe(leaderId);
        const transcript = await port.transcript(leaderId, await port.activeLeaf(leaderId));
        expect(transcript).toHaveLength(10);
        expect(transcript.filter((e) => e.origin === "direct")).toHaveLength(2);

        // 真实 JSONL 里 workflow 写入的 entry 带 origin:"workflow"
        const snapshot = await repo.readSession(leaderId);
        const messageOrigins = snapshot.entries.filter((e) => e.type === "message").map((e) => e.type === "message" ? e.origin : null);
        expect(messageOrigins.filter((o) => o === "workflow")).toHaveLength(8);

        // 锁互斥：持锁期间 direct 加锁被拒
        await port.lock(leaderId, "run_x");
        await expect(port.lock(leaderId, "direct")).rejects.toThrow(SessionBusyError);
        await port.releaseAll("run_x");
    });

    test("sidecar 形态：excursion 旁支留在真实树上，主线不受污染；ephemeral 归档", async () => {
        mock.register("workflow.demo.retrieval", ({input}) => ({message: "检索完成", data: {facts: [`关于「${(input as {q: string}).q}」`]}}));
        const caller = await port.createSession({profileKey: "workflow.demo.actor", kind: "chat", tags: []});
        const e1 = await port.append(caller.sessionId, null, {role: "user", message: "回合一输入", origin: "direct"});
        await port.append(caller.sessionId, e1, {role: "assistant", message: "回合一回应", origin: "direct"});

        const sidecar: AgentWorkflowDefinition = {
            key: "mini-sidecar",
            run: async (wf: Wf) => {
                const target = await wf.caller();
                const facts = await target.excursion("leaf", async (branch) => {
                    await branch.append({role: "user", message: "旁路探针"});
                    const retriever = await wf.agents.create("workflow.demo.retrieval", {ephemeral: true});
                    return ((await retriever.invoke({input: {q: "旧识"}})).result.data as {facts: string[]}).facts;
                });
                await target.append({role: "user", input: {actorContext: facts} as JsonValue});
                return {injected: facts.length} as JsonValue;
            },
        };

        const view = await runner.start(sidecar, null, {callerSessionId: caller.sessionId});
        expect(view.status).toBe("completed");

        // 主线 = 原两条 + context 注入；探针在树上但不在主线
        const mainline = await port.transcript(caller.sessionId, await port.activeLeaf(caller.sessionId));
        expect(mainline.map((e) => e.message?.split("\n")[0])).toEqual(["回合一输入", "回合一回应", "```json input"]);
        const snapshot = await repo.readSession(caller.sessionId);
        const probe = snapshot.entries.find((e) => e.type === "message" && JSON.stringify(e.message.content).includes("旁路探针"));
        expect(probe).toBeDefined();
        // 检索 session（ephemeral）已归档
        const retrievalId = caller.sessionId + 1;
        expect((await port.meta(retrievalId)).archived).toBe(true);
    });

    test("ask 挂起 → resume：前缀 Activity 全部缓存命中，不重复写真实 entry", async () => {
        let invokes = 0;
        mock.register("workflow.demo.summarizer", ({input}) => {
            invokes++;
            return {message: "已摘要", data: {brief: (input as {text: string}).text}};
        });
        const def: AgentWorkflowDefinition = {
            key: "mini-ask",
            run: async (wf: Wf) => {
                const s = await wf.agents.create("workflow.demo.summarizer", {});
                const r = await s.invoke({input: {text: "第一章"}});
                const pick = await wf.ask({kind: "text", title: "选择重点"});
                return {brief: r.result.data, pick} as JsonValue;
            },
        };

        const v1 = await runner.start(def, null);
        expect(v1.status).toBe("waiting");
        expect(invokes).toBe(1);
        const firstAsk = v1.pendingAsks[0];
        if (!firstAsk) throw new Error("缺少 pendingAsk");
        const sessionId = ((v1.journal.find((r) => r.kind === "agents.create")?.result as {kind: "inline"; value: {sessionId: number}} | undefined)?.value.sessionId);
        if (sessionId === undefined) throw new Error("缺少创建的 session");
        const entriesBefore = (await repo.readSession(sessionId)).entries.filter((e) => e.type === "message").length;

        const v2 = await runner.resume(v1.runId, {[firstAsk.key]: "玉佩"});
        expect(v2.status).toBe("completed");
        expect(invokes).toBe(1); // 缓存命中，responder 未重跑
        const entriesAfter = (await repo.readSession(sessionId)).entries.filter((e) => e.type === "message").length;
        expect(entriesAfter).toBe(entriesBefore); // 真实 session 也没有重复写入
    });
});
