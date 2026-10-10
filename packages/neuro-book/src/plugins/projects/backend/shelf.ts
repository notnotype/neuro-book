/**
 * 服务端的书架条目（docs/specs/runtime/projects.md 输出第 17 条）：登记项与运行状态来自 `projectsKey`，作品信息来自身份文件，
 * 统计来自运行中项目实例的实时状态或 user 分区的记录。不为显示统计打开项目：只对 `running` 的项目经 `{project}` 目标问
 * （服务端插件的无租约访问，不续宽限期），其余读记录。
 *
 * 每部作品各取各的：一部的身份文件、实时状态或记录取不到只影响它自己（作品信息为 null，统计按 `stale` 或 `none`），并记诊断。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";

import type {ProjectRegistryRead, ProjectsService, ProjectState} from "nbook/shared/projects";
import type {StorageService} from "nbook/shared/storage";

import type {ProjectMetadata, ProjectStatsSnapshot, ShelfFreshness, ShelfItem, ShelfStats} from "../shared/contracts";
import {PROJECT_STATS_RECORD} from "../shared/stats-record";

/** 运行中项目实例 `nbook.projects/stats` 的 `current()` 结果。 */
export type LiveStats = RemoteResult<{readonly status: "counting" | "complete" | "ended"; readonly snapshot: ProjectStatsSnapshot | null}>;

export interface ShelfSources {
    readonly projects: ProjectsService;
    /** 本入口的 Storage 门面：记录的 owner 是 `nbook.projects`。 */
    readonly storage: StorageService;
    /** 问某个运行中项目的统计状态。 */
    readonly live: (id: string) => Promise<LiveStats>;
    /** 当前时刻（毫秒）；“今天”按服务端所在机器的本地日期。 */
    readonly now: () => number;
    readonly record: (input: Omit<DiagnosticInput, "source">) => void;
}

const NO_METADATA: ProjectMetadata = {title: null, description: null, color: null};
const NO_STATS: ShelfStats = {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null};

/** 本地日期 `YYYY-MM-DD`：统计快照的 `today.date` 用同一种写法。 */
export function localDate(ms: number): string {
    const date = new Date(ms);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function summary(freshness: Exclude<ShelfFreshness, "none">, snapshot: ProjectStatsSnapshot, today: string): ShelfStats {
    return {
        freshness,
        computedAt: snapshot.computedAt,
        words: snapshot.words,
        files: snapshot.files,
        unreadable: snapshot.unreadable,
        // 快照的基线是它那天开始时的总字数；不是今天的快照说不出今天写了多少。
        today: snapshot.today.date === today ? snapshot.words - snapshot.today.baseline : null,
        last: snapshot.last,
    };
}

/** 全部作品的书架条目，按登记顺序；只有登记表坏了才整体失败。 */
export async function buildShelf(sources: ShelfSources): Promise<ProjectRegistryRead<ShelfItem[]>> {
    const listed = await sources.projects.list();
    if (!listed.ok) return listed;
    const today = localDate(sources.now());
    return {ok: true, value: await Promise.all(listed.value.map((project) => shelfItem(sources, project, today)))};
}

async function shelfItem(sources: ShelfSources, project: ProjectState, today: string): Promise<ShelfItem> {
    const failed = (event: string, message: string) => (error: unknown) => {
        sources.record({level: "warn", event, message, error, data: {project: project.id}});
        return null;
    };
    const [metadata, stats] = await Promise.all([
        metadataOf(sources, project).catch(failed("projects.shelf.metadata-failed", "取作品信息时出错，书架上这部作品不带作品信息")),
        statsOf(sources, project, today).catch(failed("projects.shelf.stats-failed", "取统计时出错，书架上这部作品按没有统计显示")),
    ]);
    return {id: project.id, name: project.name, path: project.path, state: project.state, ...(metadata ?? NO_METADATA), stats: stats ?? NO_STATS};
}

async function metadataOf(sources: ShelfSources, project: ProjectState): Promise<ProjectMetadata> {
    const read = await sources.projects.readMetadata(project.id);
    if (!read.ok) {
        sources.record({level: "warn", event: "projects.shelf.identity-unreadable", message: "读不出作品的身份文件，书架上不带作品信息", data: {project: project.id, path: project.path, reason: read.reason, detail: read.detail}});
        return NO_METADATA;
    }
    if (read.problems.length > 0) {
        sources.record({level: "warn", event: "project.metadata.invalid", message: "身份文件里有不合规的作品信息，按没有处理", data: {project: project.id, path: project.path, problems: read.problems}});
    }
    return read.metadata;
}

async function statsOf(sources: ShelfSources, project: ProjectState, today: string): Promise<ShelfStats> {
    if (project.state === "running") {
        const live = await sources.live(project.id);
        if (live.ok) {
            const {status, snapshot} = live.value;
            if (status === "complete" && snapshot !== null) return summary("fresh", snapshot, today);
            if (status === "counting") return snapshot === null ? {...NO_STATS, freshness: "counting"} : summary("counting", snapshot, today);
            // ended：订阅已结束、不再更新，按记录呈现。
        } else {
            sources.record({level: "info", event: "projects.shelf.live-unavailable", message: "运行中的项目没有给出统计状态，按记录显示", data: {project: project.id, code: live.code, cause: live.cause ?? null}});
        }
    }
    return storedStats(sources, project, today);
}

/** user 分区里的记录：有就是 `stale`；没有、或读不出（按 Spec 都显示为没有统计）为 `none`。 */
async function storedStats(sources: ShelfSources, project: ProjectState, today: string): Promise<ShelfStats> {
    const unreadable = (detail: Record<string, unknown>): ShelfStats => {
        sources.record({level: "warn", event: "projects.shelf.stats-unreadable", message: "读不出作品的统计记录，按没有统计显示", data: {project: project.id, ...detail}});
        return NO_STATS;
    };
    const opened = await sources.storage.open(PROJECT_STATS_RECORD, project.id);
    if (!opened.ok) return unreadable({code: opened.code, detail: opened.detail});
    const snapshot = await opened.handle.read();
    switch (snapshot.status) {
        case "ok":
            return summary("stale", snapshot.value, today);
        case "missing":
            return NO_STATS;
        case "corrupt":
        case "unsupported-version":
            return unreadable({status: snapshot.status, detail: snapshot.detail});
        case "error":
            return unreadable({code: snapshot.code, detail: snapshot.detail});
    }
}
