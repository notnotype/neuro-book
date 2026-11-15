/**
 * Windows 冒烟（`smoke-windows.ts`、`smoke-update.ts`）里不碰操作系统的判断：读壳的日志、比数据基线。单独成文件，
 * 在 Linux 上也能测（`facts.test.ts`）。
 */

/** `logs/desktop/shell.log` 的一行：`<ISO 时间> <事件> <细节>`（适配层 `desktop/src/bun/index.ts` 的 `log`）。 */
export type LogEntry = {readonly at: string; readonly event: string; readonly detail: string; readonly fields: Readonly<Record<string, string>>};

/** 读 shell.log 的全文，取第 `from` 行（从 0 数）之后的条目。记事实的诊断的细节是 `key=value` 用空格隔开，读进 `fields`。 */
export function logEntries(text: string, from = 0): LogEntry[] {
    const entries: LogEntry[] = [];
    for (const line of text.split(/\r?\n/u).slice(from)) {
        const match = /^(\d{4}-\d{2}-\d{2}T\S+) (\S+)(?: (.*))?$/u.exec(line);
        if (match === null) continue;
        const detail = match[3] ?? "";
        const fields: Record<string, string> = {};
        for (const pair of detail.split(" ")) {
            const index = pair.indexOf("=");
            if (index > 0) fields[pair.slice(0, index)] = pair.slice(index + 1);
        }
        entries.push({at: match[1]!, event: match[2]!, detail, fields});
    }
    return entries;
}

/** 行数，作下一段的起点（`logEntries(text, lineCount(before))` 取这之后新写的）。 */
export function lineCount(text: string): number {
    return text === "" ? 0 : text.split(/\r?\n/u).length - (text.endsWith("\n") ? 1 : 0);
}

/**
 * 一次启动之后服务端是不是有序以 0 停的（desktop-shell 的停止合同）：有 `desktop.server.ready`，之后有 `desktop.server.stopped`
 * 且 `forced=false exitCode=0`，中间没有 `desktop.server.exited`（意外退出不经停止路径、也不写异常标记）。就绪要带服务端的 PID；`pid` 给了时，
 * 就绪的必须是它（这次壳拉起的那个）。返回问题，空表示通过。
 */
export function orderlyStopProblems(entries: readonly LogEntry[], pid?: number): string[] {
    const ready = entries.filter((entry) => entry.event === "desktop.server.ready");
    const stopped = entries.filter((entry) => entry.event === "desktop.server.stopped");
    const problems: string[] = [];
    if (ready.length === 0) problems.push("这次启动之后没有 desktop.server.ready：服务端没有就绪过");
    else if (ready.some((entry) => !/^[1-9]\d*$/u.test(entry.fields.pid ?? ""))) problems.push(`desktop.server.ready 没有带服务端的 PID：${ready.map((entry) => entry.detail).join("；")}`);
    else if (pid !== undefined && !ready.some((entry) => entry.fields.pid === String(pid))) problems.push(`就绪的服务端是 ${ready.map((entry) => entry.fields.pid).join("、")}，不是这次壳拉起的 ${String(pid)}`);
    for (const entry of entries.filter((item) => item.event === "desktop.server.exited")) problems.push(`服务端意外退出过（${entry.detail}）`);
    const last = stopped.at(-1);
    if (last === undefined) problems.push("没有 desktop.server.stopped：服务端不是经停止路径停的");
    else if (last.fields.forced !== "false" || last.fields.exitCode !== "0") problems.push(`服务端停止不是有序以 0 退出：${last.detail}`);
    return problems;
}

/** 这段日志里的更新检查结论（`desktop.update.checked`）。 */
export function updateChecks(entries: readonly LogEntry[]): Array<{remote: string; local: string; result: string}> {
    return entries.filter((entry) => entry.event === "desktop.update.checked").map((entry) => ({remote: entry.fields.remote ?? "", local: entry.fields.local ?? "", result: entry.fields.result ?? ""}));
}

/** 页面显示过的更新通知（`desktop.update.notice-shown`，页面显示之后交回壳时写）：一次性的通知几秒后自己消失，以这条为准。 */
export function noticesShown(entries: readonly LogEntry[]): Array<{kind: string; version: string}> {
    return entries.filter((entry) => entry.event === "desktop.update.notice-shown").map((entry) => ({kind: entry.fields.kind ?? "", version: entry.fields.version ?? ""}));
}

/** 用户看得到的数据：作品登记（id 与路径）、冒烟写进去的模型设置、那一章的内容。 */
export type DataBaseline = {readonly projects: readonly string[]; readonly models: string; readonly chapter: string};

/** 从 `projects.json`、`settings.json` 的文本与章节内容取基线。设置只取模型的两项：别的设置项可能被应用合法地改写。 */
export function dataBaseline(projectsJson: string, settingsJson: string, chapter: string): DataBaseline {
    const projects = (JSON.parse(projectsJson) as {projects?: Array<{id?: unknown; path?: unknown}>}).projects ?? [];
    const settings = JSON.parse(settingsJson) as Record<string, unknown>;
    return {
        projects: projects.map((entry) => `${String(entry.id)} ${String(entry.path)}`).sort(),
        models: JSON.stringify([settings["nbook.models/providers"], settings["nbook.models/roles"]]),
        chapter,
    };
}

/** 之后读到的与基线比；返回问题，空表示不变。 */
export function baselineProblems(before: DataBaseline, after: DataBaseline): string[] {
    const problems: string[] = [];
    const missing = before.projects.filter((entry) => !after.projects.includes(entry));
    if (missing.length > 0) problems.push(`作品登记少了：${missing.join("、")}`);
    if (after.models !== before.models) problems.push("settings.json 里的模型设置变了");
    if (after.chapter !== before.chapter) problems.push("那一章的内容变了");
    return problems;
}
