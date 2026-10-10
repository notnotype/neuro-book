/**
 * 统计记录 `projects.stats` 的写入（docs/specs/runtime/projects.md 输出第 16 条的“持久化”与“停止”）：变化后最多每 30 秒
 * 写一次，按 revision 条件保存。
 *
 * 记录是可重算的缓存，可能有不止一个写者（两个服务端进程打开同一作品时各有一个项目实例）。写者之间以快照的 `computedAt`
 * 决胜：冲突或结果未知时重读，存着的更晚就放弃这次写入，否则以读到的 revision 重写；存着的与要写的相同（结果未知的那次
 * 其实已落盘）就算写成。写入串行：同一时间只有一次写入在途，排着的写入到点时取最新的快照。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {OpenResult, RecordHandle} from "nbook/shared/storage";

import type {ProjectStatsSnapshot, ShelfLastEdit} from "../shared/contracts";

/** 两次写入之间至少隔这么久（注入时钟）。宽限期里书架读到的记录因此最多旧这么多。 */
export const WRITE_INTERVAL_MS = 30_000;
/** 一轮里冲突后重读重写的次数上限：两个写者交替抢写时不在一轮里打转，留到下一轮。 */
const MAX_ATTEMPTS = 3;

export interface StatsWriterOptions {
    readonly clock: RuntimeClock;
    /** 打开本项目的记录（`PROJECT_STATS_RECORD`，资源 id 是项目 id）；失败时下一轮再打开。 */
    readonly open: () => Promise<OpenResult<ProjectStatsSnapshot>>;
    /** 此刻要写的完整快照；首扫没完成为 null。 */
    readonly snapshot: () => ProjectStatsSnapshot | null;
    readonly record: (input: Omit<DiagnosticInput, "source">) => void;
}

export interface StatsWriter {
    /** 读记录作统计的初值，并记下它的 revision；没有、坏了或读不出为 null（坏记录在第一次写入时条件 reset）。 */
    load(): Promise<ProjectStatsSnapshot | null>;
    /** 快照变了：距上一轮写入满间隔就立即写，否则排到那时。`finish` 之后不再写。 */
    changed(): void;
    /**
     * 停止时的最后一次写入：取消排着的写入、等在途的写完，再把 `final` 写一次（与已存的相同则不写）。`final` 为 null
     * 时只收口不写，保留旧记录。
     */
    finish(final: ProjectStatsSnapshot | null): Promise<void>;
}

/** 写者对记录现状的了解：`unknown` 要先重读才能写。 */
type Known =
    | {readonly status: "unknown"}
    | {readonly status: "missing"; readonly revision: string | null}
    | {readonly status: "damaged"; readonly revision: string}
    | {readonly status: "ok"; readonly revision: string; readonly value: ProjectStatsSnapshot};

export function createStatsWriter(options: StatsWriterOptions): StatsWriter {
    const {clock, record} = options;
    let handle: RecordHandle<ProjectStatsSnapshot> | null = null;
    let known: Known = {status: "unknown"};
    let lastRound = Number.NEGATIVE_INFINITY;
    let dirty = false;
    let cancelTimer: (() => void) | null = null;
    let writing: Promise<void> | null = null;
    let finished = false;

    const opened = async (): Promise<RecordHandle<ProjectStatsSnapshot> | null> => {
        if (handle !== null) return handle;
        const result = await options.open();
        if (!result.ok) {
            record({level: "warn", event: "projects.stats.open-failed", message: "打开统计记录失败，下一轮再试", data: {code: result.code, detail: result.detail}});
            return null;
        }
        handle = result.handle;
        return handle;
    };

    /** 重读记录并记下现状；读不出为 null。 */
    const reread = async (target: RecordHandle<ProjectStatsSnapshot>): Promise<Exclude<Known, {readonly status: "unknown"}> | null> => {
        const read = await target.read();
        switch (read.status) {
            case "ok":
                known = {status: "ok", revision: read.revision, value: read.value};
                return known;
            case "missing":
                known = {status: "missing", revision: read.revision};
                return known;
            case "corrupt":
            case "unsupported-version":
                known = {status: "damaged", revision: read.revision};
                record({level: "warn", event: "projects.stats.record-damaged", message: "统计记录坏了，写入时以条件 reset 覆盖", data: {status: read.status, detail: read.detail}});
                return known;
            case "error":
                known = {status: "unknown"};
                record({level: "warn", event: "projects.stats.read-failed", message: "读统计记录失败，下一轮再试", data: {code: read.code, detail: read.detail}});
                return null;
        }
    };

    /** 写一次 `snapshot`。`retry`：没写成且值得下一轮再试；`done`：写成、被更新的快照取代，或放弃。 */
    const attempt = async (snapshot: ProjectStatsSnapshot): Promise<"done" | "retry"> => {
        for (let round = 0; round < MAX_ATTEMPTS; round += 1) {
            const target = await opened();
            if (target === null) return "retry";
            const current = known.status === "unknown" ? await reread(target) : known;
            if (current === null) return "retry";
            if (current.status === "ok") {
                if (sameSnapshot(current.value, snapshot)) return "done";
                if (Date.parse(current.value.computedAt) > Date.parse(snapshot.computedAt)) {
                    record({level: "info", event: "projects.stats.superseded", message: "记录里的统计算得更晚，放弃这次写入", data: {stored: current.value.computedAt, mine: snapshot.computedAt}});
                    return "done";
                }
            }
            const result = current.status === "damaged" ? await target.reset(snapshot, {expect: current.revision}) : await target.save(snapshot, {expect: current.revision});
            if (result.ok) {
                if (current.status === "damaged") record({level: "warn", event: "projects.stats.record-reset", message: "坏的统计记录已覆盖，原件进了原件区", data: {revision: current.revision}});
                known = {status: "ok", revision: result.revision, value: snapshot};
                return "done";
            }
            switch (result.code) {
                case "conflict":
                case "unknown-outcome":
                case "protected":
                    // 别人写过、不知道自己写没写成、或记录刚被改坏：重读后按同样的规则核对。
                    known = {status: "unknown"};
                    continue;
                case "busy":
                case "io-error":
                case "unavailable":
                    record({level: "warn", event: "projects.stats.write-failed", message: "统计记录没写成，保留旧记录，下一轮再写", data: {code: result.code, detail: result.detail}});
                    return "retry";
                case "originals-full":
                    record({level: "warn", event: "projects.stats.originals-full", message: "原件区已满，放弃覆盖坏的统计记录", data: {detail: result.detail}});
                    return "done";
                default:
                    record({level: "error", event: "projects.stats.write-rejected", message: "统计记录被拒绝写入", data: {code: result.code, detail: result.detail}});
                    return "done";
            }
        }
        record({level: "warn", event: "projects.stats.write-contended", message: "统计记录连续冲突，下一轮再写", data: {attempts: MAX_ATTEMPTS}});
        return "retry";
    };

    const schedule = (): void => {
        if (finished || !dirty || cancelTimer !== null || writing !== null) return;
        const wait = lastRound + WRITE_INTERVAL_MS - clock.now();
        if (wait <= 0) {
            flush();
            return;
        }
        cancelTimer = clock.schedule(() => {
            cancelTimer = null;
            flush();
        }, wait);
    };

    const flush = (): void => {
        dirty = false;
        const snapshot = options.snapshot();
        if (snapshot === null) return;
        lastRound = clock.now();
        writing = attempt(snapshot)
            .then((outcome) => {
                if (outcome === "retry") dirty = true;
            })
            .catch((error: unknown) => {
                dirty = true;
                record({level: "error", event: "projects.stats.write-error", message: "写统计记录出错，下一轮再写", error});
            })
            .finally(() => {
                writing = null;
                schedule();
            });
    };

    return {
        load: async () => {
            const target = await opened();
            const current = target === null ? null : await reread(target);
            return current?.status === "ok" ? current.value : null;
        },
        changed: () => {
            dirty = true;
            schedule();
        },
        finish: async (final) => {
            finished = true;
            cancelTimer?.();
            cancelTimer = null;
            if (writing !== null) await writing;
            if (final === null) return;
            if (known.status === "ok" && sameSnapshot(known.value, final)) return;
            await attempt(final);
        },
    };
}

function sameLast(left: ShelfLastEdit | null, right: ShelfLastEdit | null): boolean {
    if (left === null || right === null) return left === right;
    return left.address === right.address && left.label === right.label && left.at === right.at && left.excerpt === right.excerpt;
}

function sameSnapshot(left: ProjectStatsSnapshot, right: ProjectStatsSnapshot): boolean {
    return left.computedAt === right.computedAt
        && left.words === right.words
        && left.files === right.files
        && left.unreadable === right.unreadable
        && left.today.date === right.today.date
        && left.today.baseline === right.today.baseline
        && sameLast(left.last, right.last);
}
