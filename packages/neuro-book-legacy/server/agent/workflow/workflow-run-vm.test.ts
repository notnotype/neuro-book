import {describe, expect, test} from "vitest";
import {MemorySessionStore, MockAgentPort, WorkflowRunner} from "@notnotype/nb-workflow";
import type {AgentWorkflowDefinition, JsonValue, Wf} from "@notnotype/nb-workflow";
import {buildRunVm, collectSessionNaming} from "nbook/server/agent/workflow/workflow-run-vm";
import type {TimedEvent} from "nbook/server/agent/workflow/workflow-run-vm";

/**
 * 观测 VM 构建器：人话标签 / phase 归属 / session 序列图 / 时间线 / 直播卡片 / 关系图。
 * 用内存实现驱动一个 writer↔critic + ask 的迷你流程，校验产出的结构与 mermaid 形态。
 */
describe("workflow-run-vm", () => {
    async function runMini() {
        const store = new MemorySessionStore();
        const mock = new MockAgentPort(store);
        const events: TimedEvent[] = [];
        let tick = 0;
        // 测试用确定性时间戳：每个事件 +100ms
        const runner = new WorkflowRunner({sessions: store, agents: mock}, {onEvent: (e) => events.push({event: e, at: (tick += 100)})});

        let rounds = 0;
        mock.register("workflow.demo.writer", ({mode}) => ({message: `draft(${mode})`, data: {v: 1} as JsonValue}));
        mock.register("workflow.demo.critic", () => {
            rounds++;
            return {message: rounds >= 2 ? "通过" : "驳回", data: {pass: rounds >= 2} as JsonValue};
        });

        const phases = [
            {key: "draft", title: "初稿"},
            {key: "loop", title: "评审循环"},
        ];
        const def: AgentWorkflowDefinition = {
            key: "vm-mini",
            phases,
            run: async (wf: Wf) => {
                wf.progress({phase: "draft"});
                const writer = await wf.agents.create("workflow.demo.writer", {});
                const critic = await wf.agents.create("workflow.demo.critic", {});
                // 状态图零预置：节点随代码运行长出来
                wf.chart.node("draft", "写手初稿");
                wf.chart.enter("draft", {sessionId: writer.id});
                let draft = (await writer.invoke({message: "写第一章"})).result;
                wf.progress({phase: "loop"});
                wf.chart.node("review", "评审");
                wf.chart.move("draft", "review", {sessionId: critic.id, label: "交稿"});
                for (let i = 0; i < 3; i++) {
                    const review = (await critic.invoke({input: {draft: draft.data}})).result;
                    if ((review.data as {pass: boolean}).pass) break;
                    wf.chart.node("revise", "写手修改");
                    wf.chart.move("review", "revise", {sessionId: writer.id, label: "驳回"});
                    draft = (await writer.invoke({mode: "followup", input: {fix: true}})).result;
                    wf.chart.move("revise", "review", {sessionId: critic.id, label: "再交"});
                }
                const ok = await wf.ask({kind: "approve", title: "采用当前稿？"});
                return {ok} as JsonValue;
            },
        };
        return {runner, events, phases, def};
    }

    /** 服务端同款：本次执行段 = 自最近一次 status:running 起 */
    function currentExec(events: TimedEvent[]): TimedEvent[] {
        const lastStart = events.map((t, i) => (t.event.type === "status" && t.event.status === "running" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
        return events.slice(lastStart + 1);
    }

    test("挂起时：标签人话化、phase 归属正确、序列图含参与者与用户", async () => {
        const {runner, events, phases, def} = await runMini();
        const v1 = await runner.start(def, null);
        expect(v1.status).toBe("waiting");

        const sessions = collectSessionNaming(v1.journal);
        const vm = buildRunVm({view: v1, events: currentExec(events), running: new Map(), phases, sessions});

        // 标签是人话：写手/评审 + 中文动词，不暴露内核 kind
        const labelText = Object.values(vm.labels).join("\n");
        expect(labelText).toContain("写手#1：提问「写第一章」");
        expect(labelText).toContain("评审#2：提问（draft）");
        expect(labelText).toContain("等待用户：采用当前稿？");
        expect(labelText).not.toContain("agents.invoke");

        // phase：draft 完成，loop 活跃且 ask 归入 loop；invoke 落对段
        expect(vm.phases.map((p) => p.status)).toEqual(["done", "active"]);
        expect(vm.phases[1]!.askTitles).toEqual(["采用当前稿？"]);
        expect(vm.phases[0]!.activityKeys.length).toBeGreaterThan(0);

        // 序列图：participant 人名 + 编排器→session 箭头 + 用户参与
        expect(vm.flowMermaid).toContain("sequenceDiagram");
        expect(vm.flowMermaid).toContain("participant S1 as 写手#1");
        expect(vm.flowMermaid).toContain("WF->>S2:");
        expect(vm.flowMermaid).toContain("participant U as 用户");
        // writer↔critic 交替可见：S2（评审）请求后又回到 S1（写手）
        const arrows = vm.flowMermaid.split("\n").filter((l) => l.includes("WF->>S"));
        expect(arrows.length).toBeGreaterThanOrEqual(4);

        // trace：人话标签进图且 ask 是体育场节点
        expect(vm.traceMermaid).toContain('(["等待用户');
        expect(vm.traceMermaid).not.toContain("agents.create @");

        // 参与者中文名
        expect(vm.participants.map((p) => p.name)).toEqual(["写手#1", "评审#2"]);

        // 时间线：写手/评审各一条泳道，编排器泳道有等待用户的进行中条（end=null）
        const laneNames = vm.timeline.map((l) => l.name);
        expect(laneNames).toContain("写手#1");
        expect(laneNames).toContain("评审#2");
        const wfLane = vm.timeline.find((l) => l.sessionId === null);
        expect(wfLane?.spans.some((s) => s.end === null && s.label.includes("等待用户"))).toBe(true);
        const writerLane = vm.timeline.find((l) => l.name === "写手#1");
        expect(writerLane?.spans.every((s) => s.end !== null)).toBe(true);

        // 直播卡片：全部空闲，且有最近一问一答
        expect(vm.live.map((c) => c.name)).toEqual(["写手#1", "评审#2"]);
        expect(vm.live.every((c) => !c.busy)).toBe(true);
        expect(vm.live[0]!.lastReply).toContain("draft");

        // 关系图：创建边 + 逐次调用边（写手被 invoke 两次），挂起 ask 是橙色虚线边
        expect(vm.relationMermaid).toContain("graph LR");
        expect(vm.relationMermaid).toContain("创建");
        expect(vm.relationMermaid).toContain("第1次");
        expect(vm.relationMermaid).toContain("第2次");
        expect(vm.relationMermaid).toContain("-.->");
        expect(vm.relationMermaid).toContain("stroke-dasharray");

        // 状态图（wf.chart）：零预置随代码长出、append-only + 边执行序号 + 节点持久 worker 名 + 重访 ×2
        // 迷你流程 token 路径：draft →① review →② revise →③ review（第二轮通过后挂起在 ask，token 停在 review）
        expect(vm.machineMermaid).toContain('c_draft["写手初稿〔写手#1〕"]');
        expect(vm.machineMermaid).toContain("评审 ×2〔评审#2〕");
        expect(vm.machineMermaid).toContain('|"① 交稿"|');
        expect(vm.machineMermaid).toContain('|"② 驳回"|');
        expect(vm.machineMermaid).toContain('|"③ 再交"|');
        expect(vm.machineMermaid).toContain("style c_review fill:#33200f");
        expect(vm.machineMermaid).toContain("style c_draft fill:#14261a");
        // revise→review 是按创建顺序的第 2 条边（0 起：交稿/驳回/再交）
        expect(vm.machineMermaid).toContain("linkStyle 2 stroke:#d97706");
    });

    test("resume 后：重放命中在序列图标 ⚡，phase 全部完成", async () => {
        const {runner, events, phases, def} = await runMini();
        const v1 = await runner.start(def, null);
        const ask = v1.pendingAsks[0];
        if (!ask) throw new Error("缺少 pendingAsk");
        const v2 = await runner.resume(v1.runId, {[ask.key]: true});
        expect(v2.status).toBe("completed");

        const vm = buildRunVm({view: v2, events: currentExec(events), running: new Map(), phases, sessions: collectSessionNaming(v2.journal)});
        expect(vm.phases.map((p) => p.status)).toEqual(["done", "done"]);
        expect(vm.flowMermaid).toContain("⚡");
        expect(vm.flowMermaid).toContain("U-->>WF:");
    });
});
