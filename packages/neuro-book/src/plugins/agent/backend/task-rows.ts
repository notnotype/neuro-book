/**
 * `nbook.agent` 作为后台任务清单的提供方（docs/specs/agent/jobs.md 输出 20、sessions.md 输出 30）：任务中心里的后台任务、在跑或
 * 等你处理的根会话（会话块的组头）、没有任务跟着的子会话，各交一行。
 *
 * `rows()` 同步、不读盘：会话的状态取会话表此刻的活动（`activityWithBackground`），标题取 `SessionTitles` 的缓存，有归属的根取
 * 内存里的集合。会话的行按会话与运行定址（`session:<会话>:<运行>`），换了一次运行就是另一行，旧行的“停止”停不到下一次运行；
 * 留着的话没有运行，每次进入这个状态给一个新序号（`session:<会话>:held-<序号>`）。
 *
 * 清单量的是发给窗口的整行编码，至多 2 KiB，超了整行丢掉（background-tasks.md 输出 19）。命令的输出行可能很长、带控制字符（JSON
 * 编码后一个占 6 字节），所以标题与进展在这里按编码后的字节数裁短，外壳（键、来源、时刻、打开）留约 500 字节。
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
/** 标题、进展编码成 JSON 后各至多这么多字节；提问是文字引用的参数，清单不截参数，同样在这里裁。 */
const TITLE_BYTES = 600;
const MESSAGE_BYTES = 900;
/** ANSI 转义序列与除制表、换行外的控制字符。 */
const CONTROL = /\u001b\[[0-9;?]*[ -/]*[@-~]|[\u0000-\u0008\u000b-\u001f\u007f]/gu;

const encodedBytes = (text: string): number => Buffer.byteLength(JSON.stringify(text), "utf8");

/** 去掉控制字符，编码后超过 `bytes` 时按字截短、加省略号。 */
function fit(text: string, bytes: number): string {
    const clean = text.replace(CONTROL, "");
    if (encodedBytes(clean) <= bytes) return clean;
    const chars = [...clean];
    let low = 0;
    let high = chars.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (encodedBytes(`${chars.slice(0, middle).join("")}…`) <= bytes) low = middle;
        else high = middle - 1;
    }
    return `${chars.slice(0, low).join("")}…`;
}

const fitText = (text: Text, bytes: number): Text => (typeof text === "string" ? fit(text, bytes) : text);

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
    /** 每个会话这一次留着话的序号，按看到它的时刻认是不是同一次；会话不再留着话时删掉，序号不回收（输出 19：同一代里不复用行 id）。 */
    const held = new Map<string, {readonly at: number | undefined; readonly n: number}>();
    let heldCount = 0;
    const heldNumber = (item: Activity): number => {
        let known = held.get(item.id);
        if (known === undefined || known.at !== item.startedAt) {
            heldCount += 1;
            known = {at: item.startedAt, n: heldCount};
            held.set(item.id, known);
        }
        return known.n;
    };

    const titleOf = (session: string): Text => fitText(titles.of(session) ?? agentText("tasks.untitled"), TITLE_BYTES);
    const owner = (root: string): RowOwner => ({kind: "session", session: root, title: titleOf(root), open: open(root)});

    /** 等你处理的事项写成进展：审批、提问。 */
    const pendingText = (item: Activity): Text => agentText(item.pending === "question" ? "tasks.question" : "tasks.approval");

    function jobRow(job: Job, child: Activity | undefined): ProvidedRow {
        const live = isLive(job.state);
        // 子代理的子会话此刻这次运行在等你：任务这一行算等你处理。
        const waiting = live && child?.state === "waiting" && child.runId === job.target?.runId;
        const state: RowState = !live ? ENDED[job.state as keyof typeof ENDED] : waiting ? "waiting" : "running";
        const line = live ? job.lastLine : job.outcome?.line;
        const message: Text | null = waiting ? pendingText(child!) : job.state === "question" && job.question !== undefined ? agentText("tasks.asking", {question: fit(job.question.text, MESSAGE_BYTES)}) : line === undefined ? null : fit(line, MESSAGE_BYTES);
        const kind = job.kind === "agent" || job.kind === "shell" ? job.kind : "plugin";
        const root = relations.rootOf(job.owner);
        return {
            id: `job:${job.id}`,
            title: fit(job.summary, TITLE_BYTES),
            message,
            state,
            kind,
            kindLabel: kind === "plugin" ? job.label : agentText(kind === "agent" ? "tasks.kind.agent" : "tasks.kind.shell"),
            form: "once",
            owner: owner(root),
            foreground: job.waiters > 0,
            startedAt: job.startedAt,
            endedAt: job.endedAt ?? null,
            // 有归属的树里的子代理不可停：以用户身份停会把子会话排着的话变成用户留着的，而这棵树不出会话行，那些话在清单里无处放行
            // （同决定 7）。后台命令与插件登记的任务没有排着的话，照常可停。
            stoppable: live && !(job.kind === "agent" && sources.owned.has(root)),
            ...(job.target === undefined ? {} : {open: open(job.target.sessionId)}),
        };
    }

    function sessionRow(item: Activity, root: string): ProvidedRow {
        const head = item.id === root;
        const message: Text = item.state === "held" ? agentText("tasks.held") : item.state === "waiting" ? pendingText(item) : agentText(item.compacting === true ? "tasks.compacting" : "tasks.replying");
        return {
            id: `session:${item.id}:${item.state === "held" ? `held-${String(heldNumber(item))}` : item.runId ?? "run"}`,
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
                if (item.id !== root && covered.has(`${item.id}\n${item.runId ?? ""}`)) continue;
                rows.push(sessionRow(item, root));
            }
            for (const id of [...held.keys()]) if (byId.get(id)?.state !== "held") held.delete(id);
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
            if (runId.startsWith("held-")) return {kind: "rejected", reason: agentText("tasks.stop.ended")};
            const aborted = await table.view(session).abort({commandId: crypto.randomUUID(), keepQueue: true, runId});
            if (!aborted.ok) {
                sources.report("task-row-stop-failed", `stopping session ${session} from the task list failed: ${aborted.code}`, {session, code: aborted.code});
                return {kind: "unknown"};
            }
            return aborted.value.aborted ? {kind: "accepted"} : {kind: "rejected", reason: agentText("tasks.stop.ended")};
        },
    };
}

/**
 * 停后台任务的结果（jobs.md 输出 20）：停下是已受理；已经结束、已不在是被拒；停不下来（中止没写下）交回未知，不知道它此刻停没停。
 * 从清单停是以用户身份停，内核总是放行，所以没有“被拒”的码。
 */
function jobStop(outcome: Awaited<ReturnType<JobCenter["kill"]>>): StopOutcome {
    if (outcome === "killed") return {kind: "accepted"};
    if (outcome === "already-ended") return {kind: "rejected", reason: agentText("tasks.stop.ended")};
    if (outcome === "job-unknown") return {kind: "rejected", reason: agentText("tasks.stop.gone")};
    return {kind: "unknown"};
}
