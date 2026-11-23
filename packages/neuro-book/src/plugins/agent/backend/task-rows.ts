/**
 * `nbook.agent` 作为后台任务清单的提供方（docs/specs/agent/jobs.md 输出 20、sessions.md 输出 30）：任务中心里的后台任务、在跑或
 * 等你处理的根会话（会话块的组头）、没有任务跟着的子会话，各交一行。
 *
 * `rows()` 同步、不读盘：会话的状态取会话表此刻的活动（`activityWithBackground`），标题取 `SessionTitles` 的缓存，有归属的根取
 * 内存里的集合。会话的行按会话与运行定址（`session:<会话>:<运行>`），换了一次运行就是另一行，旧行的“停止”停不到下一次运行。
 */

import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";
import type {Text} from "@notnotype/nb-ui/text";

import type {ProvidedRow, RowOwner, RowState, StopOutcome, TaskProvider} from "nbook/plugins/tasks/shared/contracts";

import {agentText} from "../shared/text";
import {isLive, type Job, type JobCenter, type JobState} from "./jobs/center";
import type {SessionTitles} from "./running-work";
import type {SessionRelations} from "./subagents/relations";

/** 打开会话的命令（窗口里由 `nbook.agent` 贡献）；清单只执行行的提供方自己贡献的命令。 */
const FOCUS_SESSION = "nbook.agent.focus-session";
/**
 * 提问写进进展时至多留这么多字：它是文字引用的参数，清单只截字面字符串、不截参数，整行编码超过 2 KiB 会被丢掉
 * （background-tasks.md 输出 19）。
 */
const QUESTION_MAX = 200;

type Activity = ReturnType<SessionTable["activityWithBackground"]>[number];

export interface AgentTaskRowsSources {
    readonly table: Pick<SessionTable, "activityWithBackground" | "onActivityChanged" | "onLog" | "view">;
    readonly jobs: Pick<JobCenter, "all" | "onListChanged" | "kill">;
    readonly relations: Pick<SessionRelations, "rootOf">;
    readonly titles: Pick<SessionTitles, "of">;
    /** 程序自己开的会话（起标题与说明）：不出行。 */
    readonly internal: ReadonlySet<string>;
    /** 有归属的根会话（bot 的主对话等，sessions.md 输出 23、25）：它们的树不出会话的行，起的后台任务照常出行。 */
    readonly owned: ReadonlySet<string>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

const ENDED: Readonly<Record<Exclude<JobState, "starting" | "running" | "question">, RowState>> = {
    completed: "succeeded",
    failed: "failed",
    aborted: "cancelled",
    interrupted: "interrupted",
};

const open = (sessionId: string) => ({command: FOCUS_SESSION, args: {sessionId}});

/** 回执还没进会话的才列（jobs.md 输出 20）：还没领、正在送、写入结果未知；提醒已受理、只送了短回执、已取走的不列。 */
function listed(job: Job): boolean {
    if (job.state === "starting") return false;
    if (isLive(job.state)) return true;
    const exit = job.exit;
    return exit === undefined || (exit.kind === "notice" && exit.state !== "pending");
}

export function agentTaskRows(sources: AgentTaskRowsSources): TaskProvider {
    const {table, jobs, relations, titles} = sources;

    const titleOf = (session: string): Text => titles.of(session) ?? agentText("tasks.untitled");
    const owner = (root: string): RowOwner => ({kind: "session", session: root, title: titleOf(root), open: open(root)});

    /** 等你处理的事项写成进展：审批、提问。 */
    const pendingText = (item: Activity): Text => agentText(item.pending === "question" ? "tasks.question" : "tasks.approval");

    function jobRow(job: Job, child: Activity | undefined): ProvidedRow {
        const live = isLive(job.state);
        // 子代理的子会话此刻这次运行在等你：任务这一行算等你处理。
        const waiting = live && child?.state === "waiting" && child.runId === job.target?.runId;
        const state: RowState = !live ? ENDED[job.state as keyof typeof ENDED] : waiting ? "waiting" : "running";
        const message: Text | null = waiting ? pendingText(child!) : job.state === "question" && job.question !== undefined ? agentText("tasks.asking", {question: job.question.text.slice(0, QUESTION_MAX)}) : live ? (job.lastLine ?? null) : (job.outcome?.line ?? null);
        const kind = job.kind === "agent" || job.kind === "shell" ? job.kind : "plugin";
        return {
            id: `job:${job.id}`,
            title: job.summary,
            message,
            state,
            kind,
            kindLabel: kind === "plugin" ? job.label : agentText(kind === "agent" ? "tasks.kind.agent" : "tasks.kind.shell"),
            form: "once",
            owner: owner(relations.rootOf(job.owner)),
            foreground: job.waiters > 0,
            startedAt: job.startedAt,
            endedAt: job.endedAt ?? null,
            stoppable: live,
            ...(job.target === undefined ? {} : {open: open(job.target.sessionId)}),
        };
    }

    function sessionRow(item: Activity, root: string): ProvidedRow {
        const head = item.id === root;
        const message: Text = item.state === "held" ? agentText("tasks.held") : item.state === "waiting" ? pendingText(item) : agentText(item.compacting === true ? "tasks.compacting" : "tasks.replying");
        return {
            id: `session:${item.id}:${item.state === "held" ? "held" : item.runId ?? "run"}`,
            title: titleOf(item.id),
            message,
            // 留着的话要你在对话里放行，算等你处理。
            state: item.state === "running" ? "running" : "waiting",
            kind: head ? "session" : "subsession",
            kindLabel: agentText(head ? "tasks.kind.session" : "tasks.kind.subsession"),
            form: "once",
            owner: owner(root),
            head,
            foreground: true,
            startedAt: item.startedAt ?? 0,
            stoppable: item.state !== "held" && item.runId !== undefined,
            open: open(item.id),
        };
    }

    return {
        rows() {
            const all = jobs.all().filter(listed);
            const activity = table.activityWithBackground().filter((item) => !sources.internal.has(item.id));
            const byId = new Map(activity.map((item) => [item.id, item]));
            // 有在跑的子代理任务跟着这次运行的子会话不另出行（任务那一行已经代表它）。
            const covered = new Set(all.filter((job) => isLive(job.state) && job.target !== undefined).map((job) => `${job.target!.sessionId}\n${job.target!.runId}`));
            const rows: ProvidedRow[] = all.map((job) => jobRow(job, job.target === undefined ? undefined : byId.get(job.target.sessionId)));
            for (const item of activity) {
                const root = relations.rootOf(item.id);
                if (sources.owned.has(root)) continue;
                if (item.id !== root && (item.state === "held" || covered.has(`${item.id}\n${item.runId ?? ""}`))) continue;
                rows.push(sessionRow(item, root));
            }
            return rows;
        },
        subscribe(notify) {
            // 标题的缓存先订了 `onLog`（agent.ts 建表时），同一条日志事件到这里时缓存已经更新。
            const stops = [
                table.onActivityChanged(notify),
                jobs.onListChanged(notify),
                table.onLog((_id, frame) => {
                    if (frame.event.type === "titleChanged") notify();
                }),
            ];
            return () => {
                for (const stop of stops) stop();
            };
        },
        async stop(rowId) {
            if (rowId.startsWith("job:")) return jobStop(await jobs.kill(null, rowId.slice("job:".length)));
            if (!rowId.startsWith("session:")) return {kind: "rejected", reason: agentText("tasks.stop.gone")};
            const rest = rowId.slice("session:".length);
            const at = rest.lastIndexOf(":");
            const session = rest.slice(0, at);
            const runId = rest.slice(at + 1);
            if (runId === "held") return {kind: "rejected", reason: agentText("tasks.stop.ended")};
            const aborted = await table.view(session).abort({commandId: crypto.randomUUID(), keepQueue: true, runId});
            if (!aborted.ok) {
                sources.report("task-row-stop-failed", `stopping session ${session} from the task list failed: ${aborted.code}`, {session, code: aborted.code});
                return {kind: "unknown"};
            }
            return aborted.value.aborted ? {kind: "accepted"} : {kind: "rejected", reason: agentText("tasks.stop.ended")};
        },
    };
}

/** 停后台任务的结果（jobs.md 输出 20）：停下是已受理；已经结束、已不在是被拒；停不下来里被拒绝的写码，其余未知。 */
function jobStop(outcome: Awaited<ReturnType<JobCenter["kill"]>>): StopOutcome {
    if (outcome === "killed") return {kind: "accepted"};
    if (outcome === "already-ended") return {kind: "rejected", reason: agentText("tasks.stop.ended")};
    if (outcome === "job-unknown") return {kind: "rejected", reason: agentText("tasks.stop.gone")};
    return outcome.code === "not-allowed" ? {kind: "rejected", reason: agentText("tasks.stop.refused", {code: outcome.code})} : {kind: "unknown"};
}
