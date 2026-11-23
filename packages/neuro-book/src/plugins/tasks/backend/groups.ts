/**
 * 视图要的行与分组（docs/specs/workbench/background-tasks.md 输出 22、23、26、27）：纯函数，输入是自己的任务与提供方已读的行。
 *
 * 修剪在分组之前做：先按范围过滤，整份估计超出上限时按固定的先后去掉行、计进 `more`，再分组。估计按每行编码后的字节数加上每组
 * 的余量，不反复整份序列化。
 */

import type {Text} from "@notnotype/nb-ui/text";

import type {Static} from "typebox";

import type {BackgroundSummary, ListedRow, RowGroup, RowOpen, RowOwner, RowsPayload, RowState, TaskItem} from "../shared/contracts";
import type {RowsFilterSchema} from "../shared/contracts";
import type {AcceptedRow} from "./providers";

/** 视图的范围（输出 22），形状同远程合同的过滤。 */
export type RowsFilter = Static<typeof RowsFilterSchema>;

/** `rows` 整份的上限（同 v1 的清单）；每组按这么多字节估计组头与外壳，整份另留一份载荷外壳的余量，每行另算一个逗号。 */
export const ROWS_MAX_BYTES = 512 * 1024;
const GROUP_OVERHEAD_BYTES = 2 * 1024;
const ENVELOPE_BYTES = 4 * 1024;
const BACKGROUND_ITEMS = 20;
/** 自己的任务在视图里的种类：没有提供方前缀。 */
const OWN_KIND = "nbook.tasks.task";

interface Item {
    readonly row: ListedRow;
    /** 提供方登记的代次；自己的任务没有。 */
    readonly generation: number | null;
    readonly owner: RowOwner;
    readonly head: boolean;
    readonly startedAt: number;
    readonly endedAt: number | null;
    readonly live: boolean;
    readonly fromOwn: boolean;
    readonly bytes: number;
}

const isLive = (state: RowState): boolean => state === "running" || state === "waiting";
const iso = (time: number | null): string | null => (time === null ? null : new Date(time).toISOString());

function ownItem(task: TaskItem): Item {
    const row: ListedRow = {
        key: `own:${task.id}`,
        source: {kind: "own", id: task.id},
        kind: OWN_KIND,
        kindLabel: null,
        title: task.title,
        message: task.message,
        state: task.state,
        progress: task.progress,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        foreground: false,
        stoppable: false,
        open: null,
        own: task,
    };
    return {row, generation: null, owner: task.owner, head: false, startedAt: Date.parse(task.startedAt), endedAt: task.endedAt === null ? null : Date.parse(task.endedAt), live: task.state === "running", fromOwn: true, bytes: Buffer.byteLength(JSON.stringify(row), "utf8")};
}

/** 提供方的一行发给窗口时的样子；行的 2 KiB 上限按它量（providers.ts）。 */
export function listedRowOf(accepted: AcceptedRow): ListedRow {
    return {
        key: accepted.key,
        source: {kind: "provider", plugin: accepted.plugin},
        kind: accepted.kind,
        kindLabel: accepted.kindLabel,
        title: accepted.title,
        message: accepted.message,
        state: accepted.state,
        progress: accepted.progress,
        startedAt: new Date(accepted.startedAt).toISOString(),
        endedAt: iso(accepted.endedAt),
        foreground: accepted.foreground,
        stoppable: accepted.stoppable,
        open: accepted.open,
        own: null,
    };
}

function providedItem(accepted: AcceptedRow): Item {
    const row = listedRowOf(accepted);
    return {row, generation: accepted.generation, owner: accepted.owner, head: accepted.head, startedAt: accepted.startedAt, endedAt: accepted.endedAt, live: isLive(accepted.state), fromOwn: false, bytes: Buffer.byteLength(JSON.stringify(row), "utf8")};
}

const inScope = (owner: RowOwner, filter: RowsFilter): boolean => owner.kind !== "project" || filter.all || owner.project === filter.project;

/** 组内：在跑与等用户的在上（开始得晚的在前），结束的在下（结束得晚的在前）。 */
function byState(a: Item, b: Item): number {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.live ? b.startedAt - a.startedAt : (b.endedAt ?? 0) - (a.endedAt ?? 0);
}

/**
 * 超出上限时去掉的先后（输出 23）：提供方结束的行（最早结束的先）、自己结束但不是失败的任务（同上）、不是组头的在跑行（最早开始的先）、
 * 组头；自己失败的任务一直留着。交回留下的。
 */
function trim(items: readonly Item[], groups: number): readonly Item[] {
    const budget = ROWS_MAX_BYTES - ENVELOPE_BYTES;
    let total = items.reduce((sum, item) => sum + item.bytes + 1, 0) + groups * GROUP_OVERHEAD_BYTES;
    if (total <= budget) return items;
    const ended = (item: Item) => item.endedAt ?? 0;
    const order = [
        ...items.filter((item) => !item.live && !item.fromOwn).sort((a, b) => ended(a) - ended(b)),
        ...items.filter((item) => !item.live && item.fromOwn && item.row.state !== "failed").sort((a, b) => ended(a) - ended(b)),
        ...items.filter((item) => item.live && !item.head).sort((a, b) => a.startedAt - b.startedAt),
        ...items.filter((item) => item.live && item.head).sort((a, b) => a.startedAt - b.startedAt),
    ];
    const dropped = new Set<Item>();
    for (const item of order) {
        if (total <= budget) break;
        dropped.add(item);
        total -= item.bytes + 1;
    }
    return items.filter((item) => !dropped.has(item));
}

/**
 * 一个根会话的块（输出 26）：组头与它的标题、“打开”只认最早登记的那家提供方——几家都交了组头时，别家的组头当普通行，不能换掉
 * 组头停的对象；没有组头时取最早登记的那家的行的归属。
 */
function sessionGroup(session: string, items: Item[], conflict: (session: string) => void): {readonly group: RowGroup; readonly waiting: boolean; readonly at: number} {
    const byGeneration = [...items].sort((a, b) => (a.generation ?? Number.MAX_SAFE_INTEGER) - (b.generation ?? Number.MAX_SAFE_INTEGER));
    const heads = byGeneration.filter((item) => item.head);
    const head = heads[0] ?? null;
    if (heads.length > 1 && heads.some((item) => item.generation !== head!.generation)) conflict(session);
    const rest = items.filter((item) => item !== head).sort(byState);
    const fromProvider = byGeneration.find((item) => !item.fromOwn) ?? null;
    // 会话块里的行按归属的会话分来，归属一定是会话。
    const title = ((head ?? fromProvider ?? items[0]!).owner as Extract<RowOwner, {kind: "session"}>).title;
    const ownerOpen = fromProvider === null ? null : ((fromProvider.owner as {open?: RowOpen}).open ?? null);
    const waiting = items.some((item) => item.row.state === "waiting");
    return {
        group: {kind: "session", session, title, open: head?.row.open ?? ownerOpen, head: head?.row ?? null, waiting, rows: rest.map((item) => item.row)},
        waiting,
        at: head?.startedAt ?? Math.min(...items.map((item) => item.startedAt)),
    };
}

/** `rowsChanged` 的载荷（输出 23、26）。 */
export function buildRows(own: readonly TaskItem[], snapshot: {readonly version: number; readonly rows: readonly AcceptedRow[]; readonly overflow: readonly AcceptedRow[]}, filter: RowsFilter, revision: number, conflict: (session: string) => void = () => {}): RowsPayload {
    const all = [...own.map(ownItem), ...snapshot.rows.map(providedItem)];
    const scoped = all.filter((item) => inScope(item.owner, filter));
    // 超过一家上限没列出的也计数：范围内的进 `more`，范围外在跑的进 `elsewhere`。
    const overflowInScope = snapshot.overflow.filter((row) => inScope(row.owner, filter)).length;
    const elsewhere = all.filter((item) => item.live && !inScope(item.owner, filter)).length + snapshot.overflow.filter((row) => isLive(row.state) && !inScope(row.owner, filter)).length;
    const keyOf = (owner: RowOwner): string => (owner.kind === "app" ? "app" : `${owner.kind}:${owner.kind === "project" ? owner.project : owner.session}`);
    const items = trim(scoped, new Set(scoped.map((item) => keyOf(item.owner))).size);
    const more = scoped.length - items.length + overflowInScope;

    const sessions = new Map<string, Item[]>();
    const projects = new Map<string, Item[]>();
    const app: Item[] = [];
    for (const item of items) {
        if (item.owner.kind === "session") sessions.set(item.owner.session, [...(sessions.get(item.owner.session) ?? []), item]);
        else if (item.owner.kind === "project") projects.set(item.owner.project, [...(projects.get(item.owner.project) ?? []), item]);
        else app.push(item);
    }
    const sessionGroups = [...sessions].map(([session, members]) => sessionGroup(session, members, conflict)).sort((a, b) => (a.waiting !== b.waiting ? (a.waiting ? -1 : 1) : b.at - a.at)).map((entry) => entry.group);
    // 当前项目在前；其余的名字是 Text，按语言翻译后才有意义，服务端只按 id 排、窗口再按名字排（输出 26）。
    const projectGroups: RowGroup[] = [...projects].sort(([a], [b]) => (a === filter.project ? -1 : b === filter.project ? 1 : a < b ? -1 : a > b ? 1 : 0)).map(([project, members]) => ({
        kind: "project",
        project,
        title: (members[0]!.owner as {title: Text}).title,
        current: project === filter.project,
        rows: [...members].sort(byState).map((item) => item.row),
    }));
    const groups: RowGroup[] = [...sessionGroups, ...projectGroups, ...(app.length === 0 ? [] : [{kind: "app" as const, rows: [...app].sort(byState).map((item) => item.row)}])];
    return {version: snapshot.version + revision, groups, more, elsewhere};
}

/** 不分范围的后台一次性工作（输出 23、27）：自己在跑的任务，加提供方不是前台的在跑行（含超过一家上限没列出的）。 */
export function backgroundSummary(own: readonly TaskItem[], provided: readonly AcceptedRow[], overflow: readonly AcceptedRow[]): BackgroundSummary {
    const live = [
        ...own.filter((task) => task.state === "running").map((task) => ({title: task.title, message: task.message, progress: task.progress, at: Date.parse(task.startedAt)})),
        ...[...provided, ...overflow].filter((row) => isLive(row.state) && !row.foreground).map((row) => ({title: row.title, message: row.message, progress: row.progress, at: row.startedAt})),
    ].sort((a, b) => b.at - a.at);
    return {count: live.length, items: live.slice(0, BACKGROUND_ITEMS).map(({title, message, progress}) => ({title, message, progress}))};
}
