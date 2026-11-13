/**
 * `nbook.agent` 报给宿主的在跑的工作（docs/specs/agent/sessions.md 输出 20）：停止服务端会中断的会话与任务中心里的任务。
 *
 * 宿主同步调用报告方，所以标题不能现取：`SessionTitles` 在 Agent 层缓存，取工作时不为它打开会话。
 */

import type {KernelEvent, SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

import type {RunningWorkItem} from "nbook/shared/host";

import {agentText} from "../shared/text";
import type {JobCenter} from "./jobs/center";
import type {SessionRelations} from "./subagents/relations";

/**
 * 会话标题的缓存：启动时从扫过的索引装入，之后跟着打开着的会话写下的 `titleChanged` 更新（改标题只能经打开着的会话，所以
 * 句柄表的日志事件不会漏）；fork 出来的会话在登记关系时一并记下。
 *
 * 按会话 id 存，不只存根：哪个会话是根由关系表决定，按 id 存就不必在关系变化时搬动；条目只是一个短字符串，进程内的会话数
 * 撑不大它。
 */
export class SessionTitles {
    readonly #titles = new Map<string, string>();

    load(entries: Iterable<Pick<SessionIndexEntry, "id" | "title">>): void {
        for (const entry of entries) this.set(entry.id, entry.title);
    }

    set(id: string, title: string | null): void {
        if (title === null) this.#titles.delete(id);
        else this.#titles.set(id, title);
    }

    of(id: string): string | null {
        return this.#titles.get(id) ?? null;
    }

    /** 跟着打开着的会话的 `titleChanged` 更新；交回的函数停止跟随。 */
    follow(table: SessionTable): () => void {
        return table.onLog((id, frame) => {
            if (frame.event.type === "titleChanged") this.set(id, (frame.event as KernelEvent<"titleChanged">).data.title);
        });
    }
}

export interface AgentRunningWorkSources {
    readonly table: Pick<SessionTable, "activityWithBackground">;
    readonly relations: Pick<SessionRelations, "rootOf">;
    readonly titles: Pick<SessionTitles, "of">;
    readonly jobs: Pick<JobCenter, "live">;
    /** 程序自己开的会话（起标题与说明）：不报。 */
    readonly internal: ReadonlySet<string>;
}

/**
 * 报告方：在跑或在等用户的会话（含后台会话）按根归并，每个根一项，同根里有在跑的就算在跑；根自己已空闲或已关闭、只有后代
 * 在跑时照样报这个根。任务中心里在跑的任务每件另报一项，与会话项可以同时出现。
 */
export function agentRunningWork(sources: AgentRunningWorkSources): ReadonlyArray<RunningWorkItem> {
    const roots = new Map<string, "running" | "waiting">();
    for (const {id, state} of sources.table.activityWithBackground()) {
        if (sources.internal.has(id)) continue;
        const root = sources.relations.rootOf(id);
        if (roots.get(root) !== "running") roots.set(root, state);
    }
    const items: RunningWorkItem[] = [];
    for (const [root, state] of roots) {
        const title = sources.titles.of(root);
        if (title === null) items.push({text: agentText(state === "running" ? "work.session.untitledRunning" : "work.session.untitledWaiting")});
        else items.push({text: agentText(state === "running" ? "work.session.running" : "work.session.waiting", {title})});
    }
    for (const job of sources.jobs.live()) {
        items.push({text: job.kind === "shell" ? agentText("work.job.shell", {command: job.summary}) : agentText("work.job.agent", {name: job.summary})});
    }
    return items;
}
