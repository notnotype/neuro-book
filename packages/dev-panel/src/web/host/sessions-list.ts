import {HERDR_STATUS_LABEL, shortSession, taskLabel, workLabel} from "./format.js";
import type {PaneView, RunView, SessionsData, SessionView} from "./types.js";

/**
 * 会话页左列表的行（t15 阶段 4 第 3 批）：从 `/api/sessions` 算出来，页面与零件都不再各自拼。
 * 按会话键分，与服务端一致（接管、文字、按键、更早的输出都按会话键判断）：
 * - Agent 会话：本仓库里有会话键的 pane，加上持有租约或运行、但 herdr 里找不到的会话（不在 herdr 里、进程已退出，不能打开）；
 * - 其它 pane（只读）：本仓库里没有会话键的 pane（开发服务、日志、shell，D2），herdr 认出了 Agent 但还没报会话的也在这里；
 * - 不在本仓库的、herdr 认出了 Agent 的 pane 只列出、不能打开（决定点 20）。
 * 标题：会话文件里的标题；取不到用租约的 Task；再取不到用短号（决定点 19）。其它 pane 取这格里登记过的运行的命令，没有就写 pane 号加目录名；
 * 认出了 Agent 的写成“codex（没有报会话）”。
 */
export type SessionTone = "blocked" | "working" | "done" | "idle" | "unknown" | "absent" | "ended" | "pane";
export type SessionRow = {
    /** 列表里的身份；能打开的行就是 pane 号。 */
    key: string;
    paneId: string | null;
    kind: "agent" | "pane";
    title: string;
    /** 标题从哪里来：会话文件、租约的 Task、短号、运行的命令、pane。 */
    titleFrom: "file" | "task" | "short" | "run" | "pane";
    agent: string | null;
    tone: SessionTone;
    stateLabel: string;
    tasks: Array<{label: string; stale: boolean}>;
    runs: number;
    /** 非 Agent 的 pane：能不能往回翻（前台是全屏程序时不能）。 */
    scrollback: boolean;
    detail: string | null;
    selectable: boolean;
};

const ORDER: Record<SessionTone, number> = {blocked: 0, working: 1, done: 2, idle: 3, unknown: 4, absent: 5, ended: 6, pane: 7};
const base = (path: string | null) => (path ?? "").split("/").filter(Boolean).at(-1) ?? "";

function toneOf(status: string): SessionTone {
    return status === "blocked" || status === "working" || status === "done" || status === "idle" ? status : "unknown";
}

function sessionTasks(session: SessionView | undefined): Array<{label: string; stale: boolean}> {
    return (session?.leases ?? []).map((lease) => ({label: `${workLabel(lease.workId)}/${taskLabel(lease.taskId)}`, stale: lease.stale}));
}

function titleOf(fileTitle: {text: string} | null | undefined, session: SessionView | undefined, key: string): {title: string; titleFrom: SessionRow["titleFrom"]} {
    if (fileTitle) return {title: fileTitle.text, titleFrom: "file"};
    const lease = session?.leases[0];
    if (lease) return {title: `${workLabel(lease.workId)}/${taskLabel(lease.taskId)}`, titleFrom: "task"};
    return {title: shortSession(key, session?.label ?? null), titleFrom: "short"};
}

export function sessionRows(data: SessionsData): {agents: SessionRow[]; panes: SessionRow[]; elsewhere: SessionRow[]} {
    const byKey = new Map(data.sessions.map((session) => [session.key, session]));
    const keyOf = (pane: PaneView) => (pane.session ? `${pane.session.agent}:${pane.session.value}` : null);
    const agents: SessionRow[] = [];
    const elsewhere: SessionRow[] = [];
    const seen = new Set<string>();
    for (const pane of data.panes) {
        const key = keyOf(pane);
        if (pane.agent === null) continue;
        if (key === null) {
            if (!pane.inRepository) elsewhere.push({key: pane.paneId, paneId: pane.paneId, kind: "agent", title: `${pane.agent}（没有报会话）`, titleFrom: "pane", agent: pane.agent, tone: "unknown", stateLabel: HERDR_STATUS_LABEL[pane.status] ?? pane.status, tasks: [], runs: 0, scrollback: false, detail: pane.foregroundCwd ?? pane.cwd ?? "目录未知", selectable: false});
            continue;
        }
        seen.add(key);
        const session = byKey.get(key);
        const tone = toneOf(pane.status);
        const row: SessionRow = {
            key: pane.paneId, paneId: pane.paneId, kind: "agent", ...titleOf(pane.title ?? session?.title, session, key), agent: pane.agent,
            tone, stateLabel: HERDR_STATUS_LABEL[pane.status] ?? pane.status, tasks: sessionTasks(session), runs: session?.runs.length ?? 0,
            scrollback: false, detail: null, selectable: pane.inRepository,
        };
        if (pane.inRepository) agents.push(row);
        else elsewhere.push({...row, detail: pane.foregroundCwd ?? pane.cwd ?? "目录未知"});
    }
    // 持有租约或运行、但 herdr 里没有这格的会话：列出来（租约等回收），不能打开。
    for (const session of data.sessions) {
        if (seen.has(session.key)) continue;
        const ended = session.alive === false;
        agents.push({
            key: session.key, paneId: null, kind: "agent", ...titleOf(session.title, session, session.key), agent: session.agent,
            tone: ended ? "ended" : "absent", stateLabel: ended ? "已结束" : "不在 herdr 里", tasks: sessionTasks(session), runs: session.runs.length,
            scrollback: false, detail: ended ? "会话进程已退出" : null, selectable: false,
        });
    }
    agents.sort((left, right) => ORDER[left.tone] - ORDER[right.tone]);
    const runsByPane = new Map<string, RunView>();
    for (const run of [...data.unownedRuns, ...data.sessions.flatMap((session) => session.runs)]) {
        if (run.paneId && !runsByPane.has(run.paneId)) runsByPane.set(run.paneId, run);
    }
    const panes: SessionRow[] = data.panes.filter((pane) => keyOf(pane) === null && pane.inRepository).map((pane) => {
        const run = runsByPane.get(pane.paneId);
        const dir = base(pane.foregroundCwd ?? pane.cwd);
        const title = pane.agent !== null ? `${pane.agent}（没有报会话）` : run ? `${run.command}${dir ? `（${dir}）` : ""}` : `窗格 ${pane.paneId}${dir ? ` · ${dir}` : ""}`;
        return {
            key: pane.paneId, paneId: pane.paneId, kind: "pane",
            title, titleFrom: pane.agent === null && run ? "run" : "pane",
            agent: pane.agent, tone: "pane", stateLabel: "只看", tasks: [], runs: 0, scrollback: (pane.scrollback ?? 0) > 0,
            detail: (pane.scrollback ?? 0) > 0 ? null : "全屏程序或没有回滚，不能往回翻", selectable: true,
        };
    });
    return {agents, panes, elsewhere};
}

/** 自动选中（决定点 21）：等确认，其次工作中，再其次其它能打开的 Agent 会话；没有就不选。 */
export function autoSelect(rows: readonly SessionRow[]): string | null {
    return rows.find((row) => row.selectable && row.paneId !== null)?.paneId ?? null;
}
