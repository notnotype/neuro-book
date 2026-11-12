import {describe, expect, test} from "bun:test";
import {autoSelect, sessionRows} from "../src/web/host/sessions-list.js";
import type {PaneView, RunView, SessionsData, SessionView} from "../src/web/host/types.js";

/** 会话页左列表的行与自动选中（`host/sessions-list.ts`，t15 阶段 4 第 3 批，决定点 19 到 21）。 */
const REPO = "/repo";
function pane(paneId: string, over: Partial<PaneView> = {}): PaneView {
    return {paneId, terminalId: `term_${paneId}`, agent: "claude", status: "idle", session: {agent: "claude", value: `id-${paneId}`}, cwd: REPO, foregroundCwd: REPO, workspaceLabel: null, inRepository: true, scrollback: 0, history: null, title: null, ...over};
}
function session(key: string, over: Partial<SessionView> = {}): SessionView {
    return {key, agent: key.split(":")[0]!, sessionId: null, label: null, alive: true, managed: false, herdr: null, leases: [], runs: [], title: null, ...over};
}
function run(pid: number, paneId: string | null, command: string): RunView {
    return {pid, startedAt: "2026-10-14T09:00:00.000Z", command, cwd: REPO, checkout: REPO, ownerVia: null, paneId, unit: null, sessionHint: null, sessionAlive: null, descendants: []};
}
const lease = (workId: string, taskId: string, stale = false) => ({workId, taskId, acquiredAt: "", lastActivityAt: "", lastAction: "", stale});
function data(panes: PaneView[], sessions: SessionView[] = [], unownedRuns: RunView[] = []): SessionsData {
    return {herdr: {available: true, mode: "subscribed", version: "0.9.3", at: null, error: null, missedEvents: 0, reconnects: 0}, panes, sessions, unownedRuns, ignoredProcesses: 0, checkouts: []};
}

describe("左列表的行", () => {
    test("Agent 会话按等确认、工作中、完成、空闲、不在 herdr 里、已结束排；标题先取会话文件，再取租约的 Task，再取短号", () => {
        const rows = sessionRows(data(
            [
                pane("w1:p1", {status: "idle"}),
                pane("w1:p2", {status: "working", title: {text: "会话页重做", source: "claude-ai-title"}}),
                pane("w1:p3", {status: "blocked"}),
                pane("w1:p4", {status: "done"}),
            ],
            [
                session("claude:id-w1:p1", {leases: [lease("w00022-dev-panel", "t15-ui-polish")]}),
                session("claude:gone", {alive: false, leases: [lease("w00019-x", "t07-y", true)]}),
                session("codex:away", {alive: null}),
            ],
        ));
        expect(rows.agents.map((row) => [row.key, row.tone, row.selectable])).toEqual([
            ["w1:p3", "blocked", true], ["w1:p2", "working", true], ["w1:p4", "done", true], ["w1:p1", "idle", true],
            ["codex:away", "absent", false], ["claude:gone", "ended", false],
        ]);
        const byKey = new Map(rows.agents.map((row) => [row.key, row]));
        expect([byKey.get("w1:p2")!.title, byKey.get("w1:p2")!.titleFrom]).toEqual(["会话页重做", "file"]);
        expect([byKey.get("w1:p1")!.title, byKey.get("w1:p1")!.titleFrom]).toEqual(["w00022/t15", "task"]);
        expect(byKey.get("w1:p1")!.tasks).toEqual([{label: "w00022/t15", stale: false}]);
        expect([byKey.get("w1:p3")!.title, byKey.get("w1:p3")!.titleFrom]).toEqual(["claude id-w1:p3", "short"]);
        expect(byKey.get("claude:gone")!.stateLabel).toBe("已结束");
        expect(byKey.get("codex:away")!.stateLabel).toBe("不在 herdr 里");
    });

    test("非 Agent 的 pane 进“其它 pane”、只读：标题取这格的运行命令，没有就写 pane 号加目录；没有回滚的写明不能往回翻；别的仓库的 Agent 会话只列出", () => {
        const rows = sessionRows(data(
            [
                pane("w2:p1", {agent: null, session: null, status: "unknown", foregroundCwd: "/repo/packages/dev-panel", scrollback: 361}),
                pane("w3:p1", {agent: null, session: null, status: "unknown", scrollback: 0}),
                pane("w4:p1", {inRepository: false, foregroundCwd: "/elsewhere"}),
                pane("w5:p1", {agent: null, session: null, inRepository: false}),
            ],
            [],
            [run(11, "w2:p1", "bun run dev")],
        ));
        expect(rows.panes.map((row) => [row.paneId, row.title, row.titleFrom, row.scrollback, row.selectable])).toEqual([
            ["w2:p1", "bun run dev（dev-panel）", "run", true, true],
            ["w3:p1", "窗格 w3:p1 · repo", "pane", false, true],
        ]);
        expect(rows.panes[1]!.detail).toBe("全屏程序或没有回滚，不能往回翻");
        expect(rows.agents).toEqual([]);
        expect(rows.elsewhere.map((row) => [row.paneId, row.detail])).toEqual([["w4:p1", "/elsewhere"]]);
    });
});

describe("按会话键分（第 3 批审查重要 5）", () => {
    test("认出了 Agent 但没报会话的 pane：本仓库里的进“其它 pane”（只读，有回滚时能读更早的输出），不在本仓库的只列出", () => {
        const rows = sessionRows(data([
            pane("w6:p1", {agent: "codex", session: null, scrollback: 120}),
            pane("w6:p2", {agent: "claude", session: null, inRepository: false, foregroundCwd: "/elsewhere"}),
        ]));
        expect(rows.agents).toEqual([]);
        expect(rows.panes.map((row) => [row.paneId, row.title, row.agent, row.scrollback, row.selectable])).toEqual([["w6:p1", "codex（没有报会话）", "codex", true, true]]);
        expect(rows.elsewhere.map((row) => [row.paneId, row.title, row.selectable])).toEqual([["w6:p2", "claude（没有报会话）", false]]);
    });
});

describe("自动选中", () => {
    test("选第一个能打开的 Agent 会话（排序已让等确认、工作中在前）；没有能打开的就不选", () => {
        const rows = sessionRows(data([pane("w1:p1", {status: "idle"}), pane("w1:p2", {status: "working"})], [session("claude:gone", {alive: false})]));
        expect(autoSelect(rows.agents)).toBe("w1:p2");
        expect(autoSelect(sessionRows(data([], [session("claude:gone", {alive: false})])).agents)).toBeNull();
    });
});
