/**
 * 上次的作品与启动时打开（docs/specs/runtime/projects.md 的“最近打开”“启动时打开”）。
 *
 * `opened` 记下窗口绑定的作品；`GET /api/nbook.projects/resume` 是启动类入口（桌面壳、`nbook` 命令）打开的地址，302 到上次的
 * 作品或书架。路由只读、不打开项目，也不检查项目能不能打开：打不开时窗口停在“无法打开项目”页，那里的“不打开项目”回 `/`，
 * 不再经过这里，所以不会来回跳。路由里任何一步失败都落到书架：窗口里不能出现一页 JSON 错误，托盘重开又会走到同一个地址。
 */

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import type {SettingsService} from "nbook/shared/settings";
import type {ProjectsService} from "nbook/shared/projects";
import type {StorageService} from "nbook/shared/storage";

import {startupOpenSetting} from "../shared/contracts";
import {LAST_OPENED_RECORD} from "../shared/last-opened-record";
import {projectUrl} from "../shared/project-url";

export interface LastOpenedSources {
    readonly projects: Pick<ProjectsService, "list">;
    readonly storage: Pick<StorageService, "open">;
    readonly settings: Pick<SettingsService, "get">;
    readonly record: (input: Omit<DiagnosticInput, "source">) => void;
}

export type OpenedResult =
    | {readonly ok: true}
    | {readonly ok: false; readonly code: "unknown-project" | "registry-invalid" | "write-failed"; readonly detail: string};

export async function recordOpened(sources: LastOpenedSources, id: string): Promise<OpenedResult> {
    const listed = await sources.projects.list();
    if (!listed.ok) return {ok: false, code: "registry-invalid", detail: listed.detail};
    if (!listed.value.some((project) => project.id === id)) return {ok: false, code: "unknown-project", detail: `没有登记 id 为 ${id} 的作品`};
    const opened = await sources.storage.open(LAST_OPENED_RECORD);
    if (!opened.ok) return {ok: false, code: "write-failed", detail: `${opened.code}: ${opened.detail}`};
    const value = {id};
    // 最后写的赢：`update` 在冲突时重读再写。
    const updated = await opened.handle.update(() => value);
    if (updated.ok) return {ok: true};
    // 坏记录只是一个丢了的提示：条件 reset 覆盖它（原件进原件区），不让它永久挡住之后的写入。
    if ("revision" in updated) {
        sources.record({level: "warn", event: "projects.last-opened.record-damaged", message: "上次的作品的记录坏了，以条件 reset 覆盖", data: {status: updated.code, detail: updated.detail}});
        const reset = await opened.handle.reset(value, {expect: updated.revision});
        if (reset.ok) return {ok: true};
        return {ok: false, code: "write-failed", detail: `${reset.code}: ${reset.detail}`};
    }
    return {ok: false, code: "write-failed", detail: `${updated.code}: ${updated.detail}`};
}

/** 启动时该进的地址：`projectUrl(短名)` 或 `/`。短名取登记表当前的，改过短名也对。 */
export async function resumeTarget(sources: LastOpenedSources): Promise<string> {
    if (sources.settings.get(startupOpenSetting) === "shelf") return "/";
    const opened = await sources.storage.open(LAST_OPENED_RECORD);
    if (!opened.ok) throw new Error(`打不开上次的作品的记录：${opened.code}: ${opened.detail}`);
    const last = await opened.handle.read();
    switch (last.status) {
        case "missing":
            return "/";
        case "ok":
            break;
        case "corrupt":
        case "unsupported-version":
            throw new Error(`上次的作品的记录坏了（${last.status}）：${last.detail}`);
        case "error":
            throw new Error(`读不出上次的作品的记录：${last.code}: ${last.detail}`);
    }
    const listed = await sources.projects.list();
    if (!listed.ok) throw new Error(`登记表读不出：${listed.detail}`);
    const project = listed.value.find((item) => item.id === last.value.id);
    // 移出了书架：落到书架，不算失败。
    return project === undefined ? "/" : projectUrl(project.name);
}

export function createResumeRoutes(sources: LastOpenedSources): Hono<{Bindings: HttpRouteEnv}> {
    const app = new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError);
    // 查询串一律丢弃：目标只会是 `/` 或 `/?project=`，带过去的参数没有使用者，还可能与 `project` 撞名。
    app.get("/resume", async (c) => {
        let target = "/";
        try {
            target = await resumeTarget(sources);
        } catch (error) {
            sources.record({level: "warn", event: "projects.resume-failed", message: "启动时取不到上次的作品，打开书架", error});
        }
        return c.redirect(target, 302);
    });
    return app;
}
