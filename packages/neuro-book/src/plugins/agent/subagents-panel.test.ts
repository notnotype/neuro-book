/**
 * 子代理管理的行、个数、红点与出错未看（docs/specs/agent/conversation.md 输出 43）：纯函数与插件作用域的两个小对象。
 */

import {describe, expect, test} from "bun:test";
import type {RunResult} from "@notnotype/nb-harness/kernel/contracts";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {TreeItem} from "./shared/subagents";
import {createRunResults, createSeenErrors, panelRows, panelSummary} from "./web/subagents-panel";

const ACTIVATED = 1_000;

function item(id: string, parent: string, patch: Partial<TreeItem> = {}): TreeItem {
    return {id, parent, callId: null, invocation: null, forked: false, profile: "nbook.agent.adhoc", name: `${id} 的任务`, state: "idle", runs: [], ...patch};
}

const tree = (...items: TreeItem[]): ReadonlyMap<string, TreeItem> => new Map(items.map((entry) => [entry.id, entry]));

describe("行（输出 43）", () => {
    test("从当前会话往下深度优先、按派生关系缩进；父会话不在树里的排在最后、不缩进；fork 出来的照样算一行", () => {
        const rows = panelRows("root", tree(
            item("a", "root"),
            item("b", "root", {forked: true}),
            item("a1", "a"),
            item("a1x", "a1"),
            item("lost", "gone"),
        ));
        expect(rows.map((row) => [row.id, row.depth])).toEqual([["a", 0], ["a1", 1], ["a1x", 2], ["b", 0], ["lost", 0]]);
        expect(panelRows(null, tree(item("a", "root")))).toEqual([]);
    });

    test("状态与卡片同一套：在跑、等你、在问照当前；空闲看最近一次收口；没运行过的是状态未知", () => {
        const rows = panelRows("root", tree(
            item("run", "root", {state: "running", tools: 7, startedAt: 500, step: {tool: "nbook.agent.read", target: "project://正文/第二章 雨夜.md"}}),
            item("trim", "root", {state: "running"}),
            item("wait", "root", {state: "waiting", pending: [{id: "p", kind: "approval", callId: "c", request: {tool: "nbook.agent.write"}}]}),
            item("ask", "root", {state: "question", question: {id: "q", text: "周叔和周伯是同一个人吗？"}}),
            item("done", "root", {runs: [{runId: "r0", reason: "error", endedAt: 10}, {runId: "r1", reason: "completed", endedAt: 20}]}),
            item("fin", "root", {runs: [{runId: "r1", reason: "finished", endedAt: 20}]}),
            item("err", "root", {runs: [{runId: "r1", reason: "error", endedAt: 20}]}),
            item("stop", "root", {runs: [{runId: "r1", reason: "aborted", endedAt: 20}]}),
            item("int", "root", {runs: [{runId: "r1", reason: "interrupted", endedAt: 20}]}),
            item("new", "root"),
        ));
        expect(rows.map((row) => [row.id, row.state])).toEqual([["run", "running"], ["trim", "running"], ["wait", "waiting"], ["ask", "question"], ["done", "done"], ["fin", "done"], ["err", "failed"], ["stop", "aborted"], ["int", "interrupted"], ["new", "unknown"]]);
        const [run, trim, wait, ask, done] = rows;
        // 最近一步：工具写视图认的键，地址只留最后一段。
        expect(run).toMatchObject({tools: 7, startedAt: 500, step: {tool: "read", target: "第二章 雨夜.md"}, ended: null});
        // 子树太大时服务端截掉动态字段：行上只写状态。
        expect(trim!.tools === undefined && trim!.startedAt === undefined && trim!.step === undefined).toBe(true);
        expect(wait!.waitingFor).toEqual({kind: "approval", tool: "write"});
        expect(ask!.question).toBe("周叔和周伯是同一个人吗？");
        expect(done!.ended).toEqual({runId: "r1", endedAt: 20});
    });
});

describe("个数与红点", () => {
    test("个数是全部行；在跑与等你处理分开数；有等你处理的就亮", () => {
        const seen = createSeenErrors(ACTIVATED);
        const rows = panelRows("root", tree(item("a", "root", {state: "running"}), item("b", "a", {state: "waiting"}), item("c", "root", {forked: true})));
        expect(panelSummary(rows, seen)).toEqual({total: 3, running: 1, waiting: 1, dot: true});
        expect(panelSummary(panelRows("root", tree(item("a", "root", {state: "running"}))), seen).dot).toBe(false);
    });

    test("出错未看：激活前收口的算看过；打开浮层看过的不再亮，之后又出错的再亮；切到那个会话也算看过；在问父 Agent 不亮", () => {
        const seen = createSeenErrors(ACTIVATED);
        const rowsAt = (endedAt: number, reason = "error") => panelRows("root", tree(item("a", "root", {runs: [{runId: `r${String(endedAt)}`, reason, endedAt}]}), item("q", "root", {state: "question"})));

        expect(panelSummary(rowsAt(ACTIVATED - 1), seen).dot).toBe(false);
        const fresh = rowsAt(ACTIVATED + 5);
        expect(panelSummary(fresh, seen).dot).toBe(true);
        seen.markRows(fresh);
        expect(panelSummary(fresh, seen).dot).toBe(false);

        const again = rowsAt(ACTIVATED + 9);
        expect(panelSummary(again, seen).dot).toBe(true);
        seen.markSession("a", ACTIVATED + 10);
        expect(panelSummary(again, seen).dot).toBe(false);
        // 只认以错误收口的：停掉、中断的不亮。
        expect(panelSummary(rowsAt(ACTIVATED + 20, "aborted"), seen).dot).toBe(false);
    });
});

describe("收口结果", () => {
    const result = (text: string): RunResult => ({runId: "r1", reason: "completed", stopReason: "stop", text, result: null, error: null, usage: {} as never, entries: {first: 1, last: 2}});

    test("同一次运行只取一次，正在取的不重复取；取不到的不记，下次再取；调用失败写诊断", async () => {
        const reports: string[] = [];
        const results = createRunResults((message) => reports.push(message));
        let calls = 0;
        let answer: RunResult | null = null;
        const fetch = async (): Promise<RunResult | null> => {
            calls += 1;
            return answer;
        };
        results.load("a", "r1", fetch);
        results.load("a", "r1", fetch);
        expect(calls).toBe(1);
        // 交回 null：等这次取完（不在取了才会再取），再看没记下。
        await waitUntil("取完", () => {
            results.load("a", "r1", fetch);
            return calls === 2;
        });
        expect(results.get("a", "r1")).toBeUndefined();

        answer = result("找到 4 处");
        await waitUntil("取到结果", () => {
            results.load("a", "r1", fetch);
            return results.get("a", "r1") !== undefined;
        });
        const after = calls;
        results.load("a", "r1", fetch);
        expect(calls).toBe(after);

        results.load("b", "r1", async () => {
            throw new Error("断开");
        });
        await waitUntil("写了诊断", () => reports.length > 0);
        expect(reports[0]).toContain("b:r1");
    });
});
