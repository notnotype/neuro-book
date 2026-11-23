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

/**
 * `rows` 整份的上限（同 v1 的清单）。修剪按估算：每行按它编码后的字节数加一个逗号，每个还有行的组按它的外壳（组头之外的字段）编码后
 * 的字节数加一点余量，整份另留一份载荷外壳的余量；最后在 remote.ts 按真实编码再核一次。
 */
export const ROWS_MAX_BYTES = 512 * 1024;
const GROUP_SLACK_BYTES = 512;
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
        own: {id: task.id, cancellable: task.cancellable, cancelRequested: task.cancelRequested, retryable: task.retryable, hasDetail: task.hasDetail},
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
function trim(items: readonly Item[]): readonly Item[] {
    const budget = ROWS_MAX_BYTES - ENVELOPE_BYTES;
    // 每组的外壳只在组里还有行时算：删空一组时把它的外壳退回预算。
    const members = new Map<string, number>();
    const shells = new Map<string, number>();
    for (const item of items) {
        const key = groupOf(item.owner);
        members.set(key, (members.get(key) ?? 0) + 1);
        if (!shells.has(key)) shells.set(key, shellBytes(item.owner));
    }
    let total = items.reduce((sum, item) => sum + item.bytes + 1, 0) + [...shells.values()].reduce((sum, bytes) => sum + bytes, 0);
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
        const key = groupOf(item.owner);
        const left = members.get(key)! - 1;
        members.set(key, left);
        if (left === 0) total -= shells.get(key)!;
    }
    return items.filter((item) => !dropped.has(item));
}

const groupOf = (owner: RowOwner): string => (owner.kind === "app" ? "app" : `${owner.kind}:${owner.kind === "project" ? owner.project : owner.session}`);

/** 一个组除了行与组头之外的字段编码后的字节数，加一点余量。 */
function shellBytes(owner: RowOwner): number {
    const shell = owner.kind === "session"
        ? {kind: "session", session: owner.session, title: owner.title, open: (owner as {open?: RowOpen}).open ?? null, head: null, waiting: false, rows: []}
        : owner.kind === "project" ? {kind: "project", project: owner.project, title: owner.title, current: false, rows: []} : {kind: "app", rows: []};
    return Buffer.byteLength(JSON.stringify(shell), "utf8") + GROUP_SLACK_BYTES;
}

/**
 * 修剪之前先定每个根会话的组头（输出 26）：只认最早登记的那家交的 `head`，别家的当普通行（记一次冲突诊断）。这样修剪按定好的角色排
 * 先后；真正的组头被裁掉时这一块就没有组头，不会把别家的行提上来。
 */
function settleHeads(items: readonly Item[], conflict: (session: string) => void): readonly Item[] {
    const chosen = new Map<string, Item>();
    for (const item of items) {
        if (!item.head || item.owner.kind !== "session") continue;
        const current = chosen.get(item.owner.session);
        if (current === undefined || (item.generation ?? Number.MAX_SAFE_INTEGER) < (current.generation ?? Number.MAX_SAFE_INTEGER)) chosen.set(item.owner.session, item);
    }
    const conflicted = new Set<string>();
    const settled = items.map((item) => {
        if (!item.head || item.owner.kind !== "session" || chosen.get(item.owner.session) === item) return item;
        if (item.generation !== chosen.get(item.owner.session)!.generation) conflicted.add(item.owner.session);
        return {...item, head: false};
    });
    for (const session of conflicted) conflict(session);
    return settled;
}

/**
 * 一个根会话的块（输出 26）。组头已由 `settleHeads` 定好：有组头时标题与“打开”只取它（行上的 `open`，没有时取它的归属的 `open`），不拼
 * 别家的；没有组头时取最早登记的那家提供方的行的归属。
 */
function sessionGroup(session: string, items: Item[]): {readonly group: RowGroup; readonly waiting: boolean; readonly at: number} {
    const head = items.find((item) => item.head) ?? null;
    const rest = items.filter((item) => item !== head).sort(byState);
    const fromProvider = [...items].sort((a, b) => (a.generation ?? Number.MAX_SAFE_INTEGER) - (b.generation ?? Number.MAX_SAFE_INTEGER)).find((item) => !item.fromOwn) ?? null;
    // 会话块里的行按归属的会话分来，归属一定是会话。
    const source = head ?? fromProvider ?? items[0]!;
    const owner = source.owner as Extract<RowOwner, {kind: "session"}> & {readonly open?: RowOpen};
    const open = head !== null ? (head.row.open ?? owner.open ?? null) : fromProvider === null ? null : (owner.open ?? null);
    const waiting = items.some((item) => item.row.state === "waiting");
    return {
        group: {kind: "session", session, title: owner.title, open, head: head?.row ?? null, waiting, rows: rest.map((item) => item.row)},
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
    const items = trim(settleHeads(scoped, conflict));
    const more = scoped.length - items.length + overflowInScope;

    const sessions = new Map<string, Item[]>();
    const projects = new Map<string, Item[]>();
    const app: Item[] = [];
    for (const item of items) {
        if (item.owner.kind === "session") sessions.set(item.owner.session, [...(sessions.get(item.owner.session) ?? []), item]);
        else if (item.owner.kind === "project") projects.set(item.owner.project, [...(projects.get(item.owner.project) ?? []), item]);
        else app.push(item);
    }
    const sessionGroups = [...sessions].map(([session, members]) => sessionGroup(session, members)).sort((a, b) => (a.waiting !== b.waiting ? (a.waiting ? -1 : 1) : b.at - a.at)).map((entry) => entry.group);
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
