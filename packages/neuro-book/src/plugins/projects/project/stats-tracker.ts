/**
 * 项目实例里的作品统计（docs/specs/runtime/projects.md 输出第 16 条）：扫描项目目录，按 `nbook.files/project` 的变更
 * 增量结算，维护字数、篇数、读不出的文件数、今天的基线与最近编辑。写进 Storage 归 `stats-writer.ts`，这里只把内存里的
 * 状态算对。
 *
 * - 改状态的工作串行：同一时间只有一次整轮扫描或一个事件的结算在跑。扫描期间到达的消息排在队里，扫完按到达顺序结算；
 *   要重扫只立一个标记，所以至多一次扫描在跑、另外至多排一次。
 * - 直接读项目目录，不经 Files 的 `read`：那要把整段正文编码进远程结果，统计只要字数与最后一段。每个文件读完只留字数，
 *   最后一段只在事件触发的重读里取，正文随即丢掉。
 * - 只计普通文件：符号链接、FIFO 与设备文件都不计。打开时带 O_NOFOLLOW 与 O_NONBLOCK：路径在判定之后被换成链接或
 *   FIFO，也不会跟随出项目或卡住扫描。
 */

import {constants} from "node:fs";
import {lstat, open, readdir} from "node:fs/promises";
import type {FileHandle} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteResult, RemoteSubscribeOptions, RemoteSubscription} from "@notnotype/nb-runtime/remote";

import {parseResource, TEXT_BUDGET_BYTES} from "nbook/plugins/files/shared/contracts";
import type {ChangesMessage, FileChange} from "nbook/plugins/files/shared/contracts";
import {countWords} from "nbook/shared/word-count";

import {localDate} from "../backend/shelf";
import {SHELF_EXCERPT_MAX_LENGTH} from "../shared/contracts";
import type {ProjectStatsSnapshot, ShelfLastEdit} from "../shared/contracts";

/** 扫描时并发读的文件数上限；每读完一批让出一次执行权，扫描不独占项目实例的事件循环。 */
export const SCAN_CONCURRENCY = 4;
/** 停止时等在途的单文件重读的上限（注入时钟）。 */
export const STOP_DRAIN_MS = 1000;
/**
 * 排队的消息超过这么多就折成一次重扫：扫描期间来了一大批变化时队列不无限增长。折掉的事件里的最近编辑随之丢失，
 * 数字由重扫补齐。
 */
export const MAX_PENDING_CHANGES = 2000;

export type StatsStatus = "counting" | "complete" | "ended";

export interface StatsState {
    readonly status: StatsStatus;
    /** `complete` 时是当前的快照；`counting` 时是记录里的（没有记录为 null）；`ended` 时是结束前最后的完整快照或记录。 */
    readonly snapshot: ProjectStatsSnapshot | null;
}

export interface StatsTrackerOptions {
    /** 项目目录的真实路径。 */
    readonly root: string;
    readonly clock: RuntimeClock;
    /** 记录里的快照：首扫完成前对外给它，今天的基线与最近编辑从它接着算。 */
    readonly initial: ProjectStatsSnapshot | null;
    /** 订阅 `nbook.files/project` 的变更（项目实例里的本地调用）。 */
    readonly subscribe: (listener: (message: ChangesMessage) => void, options: RemoteSubscribeOptions) => Promise<RemoteResult<RemoteSubscription>>;
    readonly record: (input: Omit<DiagnosticInput, "source">) => void;
    /** 完整快照变了（首扫完成、事件结算、跨午夜）；停止开始后不再调用。 */
    readonly changed: () => void;
}

export interface StatsTracker {
    /** 先订阅变更，订阅建立后开始首扫；不等首扫完成。 */
    start(): void;
    /** 只读内存状态，立即返回。 */
    current(): StatsState;
    /** 完整的快照；首扫没完成为 null。 */
    snapshot(): ProjectStatsSnapshot | null;
    /**
     * 停止：退订、取消扫描与午夜计时。整轮扫描没完成（首扫没完成、或停止时正有一次重扫在跑或排着）返回 null，调用方
     * 不写、保留旧记录；否则等在途的单文件重读至多 `STOP_DRAIN_MS`，返回那时的快照。之后状态不再变化。幂等。
     */
    stop(): Promise<ProjectStatsSnapshot | null>;
}

type ReadOutcome =
    | {readonly kind: "text"; readonly text: string}
    | {readonly kind: "unreadable"; readonly reason: string}
    | {readonly kind: "missing" | "directory" | "other"};

type Pending = FileChange | {readonly type: "resync"};

export function createStatsTracker(options: StatsTrackerOptions): StatsTracker {
    const {root, clock, initial, record} = options;

    /** 计入的可读文件 → 字数。 */
    let words = new Map<string, number>();
    /** 读不出的文件：计入 `unreadable`，不计字数。与 `words` 合起来是“已知文件”。 */
    let unreadable = new Map<string, string>();
    let total = 0;
    /** 已知文件的每一级上级目录 → 其下已知文件数：判定事件路径是不是已知文件的上级目录。 */
    let ancestors = new Map<string, number>();
    /** 首扫完成过：之后的数字都是完整的。 */
    let complete = false;
    let today = openingToday(initial, clock.now());
    let last: ShelfLastEdit | null = initial?.last ?? null;
    let computedAt = clock.now();

    const pending: Pending[] = [];
    /** 要一次整轮扫描（首扫、目录事件、resync）。 */
    let rescan = false;
    let scanning = false;
    /** 每次取消扫描加一；扫描在每批之间核对，变了就作废。 */
    let scanRound = 0;
    let worker: Promise<void> | null = null;
    let subscription: RemoteSubscription | null = null;
    /** 订阅已建立：此前到达的消息只排队，等首扫开始后再一起结算。 */
    let listening = false;
    let cancelMidnight: (() => void) | null = null;
    /** 订阅已结束：不再扫描，状态为 `ended`。 */
    let ended = false;
    /** 结束时正有整轮扫描在跑或排着：结束前的数字不完整。 */
    let cutByEnd = false;
    let stopping: Promise<ProjectStatsSnapshot | null> | null = null;
    /** 停止已取走结果：在途的读取回来也不再改状态。 */
    let frozen = false;

    const known = (path: string): boolean => words.has(path) || unreadable.has(path);
    const lastPath = (): string | null => {
        if (last === null) return null;
        const parsed = parseResource(last.address);
        return parsed.ok ? parsed.resource.path : null;
    };

    const build = (): ProjectStatsSnapshot => ({
        computedAt: new Date(computedAt).toISOString(),
        words: total,
        files: words.size,
        unreadable: unreadable.size,
        // 首扫完成时一定定下了今天（没有记录时取首扫的总数）。
        today: today as NonNullable<typeof today>,
        last,
    });

    const touch = (): void => {
        computedAt = clock.now();
        if (complete && stopping === null && !frozen) options.changed();
    };

    /**
     * 跨过本地午夜：先把基线换成当时的总字数，再计入之后的变化。首扫完成前总数还不知道，用记录里的总数（与打开时
     * 记录不是今天的规则相同）。
     */
    const rollover = (): boolean => {
        const date = localDate(clock.now());
        if (today === null || today.date === date) return false;
        const current = complete ? total : initial?.words;
        if (current === undefined) return false;
        today = {date, baseline: current};
        return true;
    };

    const armMidnight = (): void => {
        if (ended || stopping !== null) return;
        const now = clock.now();
        cancelMidnight = clock.schedule(() => {
            cancelMidnight = null;
            // 计时可能早到（系统时间被调），这时日期没变，下面按当时重新计到下一个午夜。
            if (rollover() && complete) touch();
            armMidnight();
        }, nextLocalMidnight(now) - now);
    };

    const adjustAncestors = (path: string, delta: 1 | -1): void => {
        for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
            const directory = path.slice(0, at);
            const count = (ancestors.get(directory) ?? 0) + delta;
            if (count > 0) ancestors.set(directory, count);
            else ancestors.delete(directory);
        }
    };

    /** 换掉一个文件的计数：`outcome` 为 null 表示它不再计入。 */
    const setFile = (path: string, outcome: {readonly words: number} | {readonly unreadable: string} | null): void => {
        const before = known(path);
        const counted = words.get(path);
        if (counted !== undefined) {
            total -= counted;
            words.delete(path);
        }
        unreadable.delete(path);
        if (outcome !== null && "words" in outcome) {
            words.set(path, outcome.words);
            total += outcome.words;
        } else if (outcome !== null) {
            unreadable.set(path, outcome.unreadable);
        }
        const after = known(path);
        if (!before && after) adjustAncestors(path, 1);
        if (before && !after) adjustAncestors(path, -1);
    };

    const editedAt = (path: string, excerpt: string): void => {
        const address = `project://${path}`;
        // Linux 允许文件名里有反斜杠这类资源地址不接受的字符：这样的文件照常计字数，只是不能作为最近编辑的地址。
        if (!parseResource(address).ok) {
            record({level: "info", event: "projects.stats.last-unaddressable", message: "被修改的文件路径不能写成资源地址，最近编辑不更新", data: {path}});
            return;
        }
        last = {address, label: labelOf(path), at: new Date(clock.now()).toISOString(), excerpt};
    };

    /** 最近编辑跟着改名走到新地址；新地址不计入（隐藏名、不是 `.md`、不能写成地址）时清空。 */
    const followLast = (to: string): void => {
        const address = `project://${to}`;
        last = last !== null && known(to) && parseResource(address).ok ? {...last, address, label: labelOf(to)} : null;
    };

    /** 重读一个文件；`edit` 为真时这是一次观察到的修改，更新最近编辑。 */
    const reread = async (path: string, edit: boolean): Promise<void> => {
        const outcome = await readMarkdown(join(root, path));
        if (frozen) return;
        switch (outcome.kind) {
            case "text":
                setFile(path, {words: countWords(outcome.text)});
                if (edit) editedAt(path, lastParagraphExcerpt(outcome.text));
                break;
            case "unreadable":
                setFile(path, {unreadable: outcome.reason});
                record({level: "info", event: "projects.stats.file-unreadable", message: "统计时读不出文件，计入读不出的文件数", data: {path, reason: outcome.reason}});
                break;
            case "directory":
                // 同名的文件被换成了目录：按目录事件处理。
                setFile(path, null);
                rescan = true;
                break;
            case "missing":
            case "other":
                setFile(path, null);
                if (lastPath() === path) last = null;
                break;
        }
        touch();
    };

    /** 不是已知文件也不是已知文件的上级目录：`lstat` 一次判定它现在是什么。 */
    const entryKind = async (path: string): Promise<"file" | "directory" | "missing" | "other"> => {
        try {
            const info = await lstat(join(root, path));
            return info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
        } catch (error) {
            const code = errnoOf(error);
            if (code === "ENOENT" || code === "ENOTDIR") return "missing";
            record({level: "info", event: "projects.stats.lstat-failed", message: "统计时查看路径失败，按不计入处理", data: {path, code}});
            return "other";
        }
    };

    const modified = async (path: string, edit: boolean): Promise<void> => {
        if (isHidden(path)) return;
        if (known(path)) {
            await reread(path, edit);
            return;
        }
        if (ancestors.has(path)) {
            rescan = true;
            return;
        }
        const kind = await entryKind(path);
        if (kind === "directory") rescan = true;
        else if (kind === "file" && isMarkdown(path)) await reread(path, edit);
    };

    const deleted = (path: string): void => {
        if (known(path)) {
            setFile(path, null);
            if (lastPath() === path) last = null;
            touch();
            return;
        }
        if (ancestors.has(path)) rescan = true;
        const current = lastPath();
        if (current !== null && current.startsWith(`${path}/`)) {
            last = null;
            touch();
        }
    };

    const renamed = async (from: string, to: string): Promise<void> => {
        if (known(from)) {
            const wasLast = lastPath() === from;
            setFile(from, null);
            if (!isHidden(to) && isMarkdown(to)) await reread(to, false);
            if (frozen) return;
            if (wasLast) followLast(to);
            touch();
            return;
        }
        const current = lastPath();
        const lastInside = current !== null && current.startsWith(`${from}/`);
        if (ancestors.has(from) || lastInside) {
            // 目录改名：重扫得出新数字；最近编辑先跟到新地址，重扫后核对它还计入。
            rescan = true;
            if (lastInside && last !== null) {
                const address = `project://${to}${(current as string).slice(from.length)}`;
                last = parseResource(address).ok ? {...last, address} : null;
                touch();
            }
            return;
        }
        // 源不是已知的（例如从隐藏名改成普通名）：按目标现在是什么判定。
        await modified(to, false);
    };

    const apply = async (change: Pending): Promise<void> => {
        if (change.type === "resync") {
            rescan = true;
            return;
        }
        if (rollover()) touch();
        switch (change.type) {
            case "renamed":
                await renamed(change.from, change.path);
                return;
            case "deleted":
                deleted(change.path);
                return;
            case "created":
            case "changed":
                // 新建与复制给 `created`，只计数；保存与外部修改给 `changed`，算一次观察到的修改。
                await modified(change.path, change.type === "changed");
                return;
        }
    };

    /** 一次整轮扫描；被取消（停止、订阅结束、又排了新的取消）时返回 null。 */
    const scanTree = async (round: number): Promise<{readonly words: Map<string, number>; readonly unreadable: Map<string, string>; readonly total: number} | null> => {
        const found = {words: new Map<string, number>(), unreadable: new Map<string, string>(), total: 0};
        const directories = [""];
        const files: string[] = [];
        const cancelled = (): boolean => round !== scanRound;
        const readBatch = async (): Promise<void> => {
            const batch = files.splice(0, SCAN_CONCURRENCY);
            const outcomes = await Promise.all(batch.map((path) => readMarkdown(join(root, path))));
            batch.forEach((path, index) => {
                const outcome = outcomes[index] as ReadOutcome;
                if (outcome.kind === "text") {
                    const count = countWords(outcome.text);
                    found.words.set(path, count);
                    found.total += count;
                } else if (outcome.kind === "unreadable") {
                    found.unreadable.set(path, outcome.reason);
                }
                // 其余（列出之后被删掉、换成目录或链接）这一轮不计：那次变化的事件随后会结算它。
            });
            await yieldTurn();
        };
        while (directories.length > 0) {
            const directory = directories.shift() as string;
            let entries;
            try {
                entries = await readdir(join(root, directory), {withFileTypes: true});
            } catch (error) {
                // 根目录读不出：整轮作废，Files 随后会以 root-gone 结束订阅。子目录读不出：跳过它，记诊断。
                if (directory === "") throw error;
                record({level: "warn", event: "projects.stats.directory-unreadable", message: "统计时读不出子目录，其中的文件不计入", data: {path: directory, code: errnoOf(error)}});
                continue;
            }
            if (cancelled()) return null;
            for (const entry of entries) {
                if (entry.name.startsWith(".")) continue;
                const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
                if (entry.isDirectory()) directories.push(path);
                else if (entry.isFile() && isMarkdown(entry.name)) files.push(path);
            }
            while (files.length >= SCAN_CONCURRENCY) {
                await readBatch();
                if (cancelled()) return null;
            }
        }
        while (files.length > 0) {
            await readBatch();
            if (cancelled()) return null;
        }
        return found;
    };

    const fullScan = async (): Promise<void> => {
        const round = scanRound;
        const began = clock.now();
        scanning = true;
        try {
            const found = await scanTree(round);
            if (found === null || round !== scanRound || frozen) return;
            words = found.words;
            unreadable = found.unreadable;
            total = found.total;
            ancestors = new Map();
            for (const path of [...words.keys(), ...unreadable.keys()]) adjustAncestors(path, 1);
            const first = !complete;
            complete = true;
            // 从没统计过的作品：第一次扫完的总字数就是基线，扫描本身不算今天写的。
            if (today === null) today = {date: localDate(clock.now()), baseline: total};
            rollover();
            // 扫描不设最近编辑，只核对它指的文件还在（重开后沿用记录里的、或扫描期间漏掉了删除）。
            const current = lastPath();
            if (current !== null && !known(current)) last = null;
            record({
                level: "info",
                event: "projects.stats.scanned",
                message: first ? "首次统计完成" : "重新统计完成",
                data: {words: total, files: words.size, unreadable: unreadable.size, durationMs: clock.now() - began, unreadableSample: [...unreadable].slice(0, 10).map(([path, reason]) => ({path, reason}))},
            });
            touch();
        } catch (error) {
            record({level: "warn", event: "projects.stats.scan-failed", message: "统计扫描失败，等下一个变更再试", error});
        } finally {
            scanning = false;
        }
    };

    const work = async (): Promise<void> => {
        while (!frozen) {
            if (rescan && !ended && stopping === null) {
                rescan = false;
                await fullScan();
                continue;
            }
            const next = pending.shift();
            if (next === undefined) return;
            // 首扫没成（根目录读不出）就没有可以增量结算的基础：任何消息都只触发再扫一次。
            if (!complete) {
                pending.length = 0;
                rescan = true;
                continue;
            }
            await apply(next);
        }
    };

    const kick = (): void => {
        if (worker !== null || frozen) return;
        worker = work()
            .catch((error: unknown) => {
                record({level: "error", event: "projects.stats.failed", message: "统计出错，等下一个变更再试", error});
            })
            .finally(() => {
                worker = null;
                if (!frozen && (pending.length > 0 || (rescan && !ended && stopping === null))) kick();
            });
    };

    const end = (reason: string): void => {
        if (ended) return;
        ended = true;
        cutByEnd = scanning || rescan;
        rescan = false;
        scanRound += 1;
        cancelMidnight?.();
        cancelMidnight = null;
        record({level: reason === "root-gone" ? "warn" : "info", event: "projects.stats.ended", message: "文件变更订阅已结束，统计不再更新", data: {reason}});
    };

    const onMessage = (message: ChangesMessage): void => {
        if (ended || frozen) return;
        switch (message.kind) {
            case "ready":
                return;
            case "batch":
                pending.push(...message.events);
                break;
            case "resync":
                pending.push({type: "resync"});
                break;
            case "ended":
                end(message.reason);
                return;
        }
        if (pending.length > MAX_PENDING_CHANGES) {
            pending.length = 0;
            pending.push({type: "resync"});
        }
        if (listening) kick();
    };

    return {
        start: () => {
            armMidnight();
            options.subscribe(onMessage, {onEnd: end}).then(
                (subscribed) => {
                    if (!subscribed.ok) {
                        record({level: "warn", event: "projects.stats.watch-failed", message: "订阅文件变更失败，不做统计", data: {code: subscribed.code, detail: subscribed.detail ?? null}});
                        end(`subscribe-failed:${subscribed.code}`);
                        return;
                    }
                    if (ended || stopping !== null) {
                        subscribed.value.release();
                        return;
                    }
                    subscription = subscribed.value;
                    listening = true;
                    rescan = true;
                    kick();
                },
                (error: unknown) => {
                    record({level: "error", event: "projects.stats.watch-failed", message: "订阅文件变更出错，不做统计", error});
                    end("subscribe-failed");
                },
            );
        },
        current: () => {
            if (ended) return {status: "ended", snapshot: complete ? build() : initial};
            if (!complete) return {status: "counting", snapshot: initial};
            return {status: "complete", snapshot: build()};
        },
        snapshot: () => (complete ? build() : null),
        stop: () => {
            stopping ??= (async () => {
                cancelMidnight?.();
                cancelMidnight = null;
                subscription?.release();
                subscription = null;
                const cut = !complete || scanning || rescan || cutByEnd;
                scanRound += 1;
                rescan = false;
                if (cut) {
                    frozen = true;
                    return null;
                }
                if (worker !== null) await settleWithin(worker, clock, STOP_DRAIN_MS);
                frozen = true;
                // 等待期间结算到目录事件：要重扫才对，这次不写。
                return rescan ? null : build();
            })();
            return stopping;
        },
    };
}

/** 打开时的今天：记录里的日期是今天就沿用基线，不是今天就以记录的总字数作基线；没有记录时等首扫。 */
function openingToday(initial: ProjectStatsSnapshot | null, now: number): {readonly date: string; readonly baseline: number} | null {
    if (initial === null) return null;
    const date = localDate(now);
    return initial.today.date === date ? initial.today : {date, baseline: initial.words};
}

/** 下一个本地午夜（毫秒）；按日历加一天算，夏令时切换的那天也对。 */
function nextLocalMidnight(ms: number): number {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** `promise` 结算或 `ms` 到点，先到者为准；到点时不取消 `promise`。 */
async function settleWithin(promise: Promise<void>, clock: RuntimeClock, ms: number): Promise<void> {
    const deadline = Promise.withResolvers<void>();
    const cancel = clock.schedule(() => deadline.resolve(), ms);
    try {
        await Promise.race([promise, deadline.promise]);
    } finally {
        cancel();
    }
}

/** 让出一次执行权（一个宏任务）：扫描每批之后让 RPC 与文件事件先跑。 */
function yieldTurn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function isHidden(path: string): boolean {
    return path.split("/").some((segment) => segment.startsWith("."));
}

function isMarkdown(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
}

/** 片段名：文件名去掉扩展名。 */
function labelOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/iu, "");
}

function errnoOf(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** 读一个 Markdown 文件的正文。上限与编码规则同 Files 的读取：超过正文上限、不是 UTF-8 或含 NUL 都算读不出。 */
async function readMarkdown(absolute: string): Promise<ReadOutcome> {
    let handle: FileHandle;
    try {
        handle = await open(absolute, OPEN_FLAGS);
    } catch (error) {
        const code = errnoOf(error);
        if (code === "ENOENT" || code === "ENOTDIR") return {kind: "missing"};
        // O_NOFOLLOW 碰到符号链接。
        if (code === "ELOOP") return {kind: "other"};
        return {kind: "unreadable", reason: code ?? "open-failed"};
    }
    try {
        const info = await handle.stat();
        if (info.isDirectory()) return {kind: "directory"};
        if (!info.isFile()) return {kind: "other"};
        if (info.size > TEXT_BUDGET_BYTES) return {kind: "unreadable", reason: "too-large"};
        const bytes = await handle.readFile();
        // 打开之后文件又长大了。
        if (bytes.length > TEXT_BUDGET_BYTES) return {kind: "unreadable", reason: "too-large"};
        const text = decodeUtf8(bytes);
        return text === null ? {kind: "unreadable", reason: "not-text"} : {kind: "text", text};
    } catch (error) {
        return {kind: "unreadable", reason: errnoOf(error) ?? "read-failed"};
    } finally {
        await handle.close();
    }
}

/** 只接受 UTF-8；含 NUL 的视为二进制。 */
function decodeUtf8(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        // 非法 UTF-8：TextDecoder 只给 TypeError，调用方按“读不出（not-text）”计入并记诊断。
        return null;
    }
}

/** 与 `countWords` 认法相同的开头 frontmatter。 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;
/** 行首的 Markdown 标记：引用的 `>`、标题的 `#`、列表的 `-`、`*`、`+` 与 `1.`、`1)`，可以叠在一起（`> - 项`）。 */
const LINE_MARKERS = /^\s*(?:(?:>|#{1,6}(?=\s|$)|[-*+](?=\s)|\d{1,9}[.)](?=\s))\s*)*/u;
/** 分隔线（`---`、`***`、`___`）不是段落。 */
const THEMATIC_BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/u;

/**
 * 最近编辑的片段：最后一个非空段落去掉行首标记后的前 `SHELF_EXCERPT_MAX_LENGTH` 个字符（按码点截，记录的 schema 按字形
 * 簇计长度，码点数不会少于字形簇数）。段落里的换行换成空格。frontmatter 不算段落。
 */
export function lastParagraphExcerpt(text: string): string {
    const lines = text.replace(FRONTMATTER, "").split(/\r?\n/u);
    const paragraph: string[] = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const raw = lines[index] as string;
        const line = THEMATIC_BREAK.test(raw) ? "" : raw.replace(LINE_MARKERS, "").trim();
        if (line === "") {
            if (paragraph.length > 0) break;
            continue;
        }
        paragraph.unshift(line);
    }
    let excerpt = "";
    let count = 0;
    for (const character of paragraph.join(" ")) {
        if (count === SHELF_EXCERPT_MAX_LENGTH) break;
        excerpt += character;
        count += 1;
    }
    return excerpt;
}
