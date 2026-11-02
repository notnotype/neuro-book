/**
 * `projects://`（docs/specs/workspace/resources.md 的“跨项目访问”）：根列出已登记的项目；`projects://<引用>/路径` 每次调用
 * 先取得项目的租约（没在运行的会被打开），再对 `{project}` 目标调用项目实例的文件合同，结算后释放租约。
 *
 * 这里是服务端文件服务的一部分、在进程内被调用，远程调用由它直接发出：项目实例返回的路由失败（例如写请求结果未知
 * `unknown-outcome`）原样交回调用方。若改成由一个远程提供方再转发一跳，这类失败会被改报为提供方异常。
 */

import type {ActivationContext} from "@notnotype/nb-runtime/plugins";

import type {ProjectsService} from "nbook/shared/projects";

import type {Baseline, FileText, Listing, OperationDone, SavedText} from "../shared/contracts";
import {projectFilesContract} from "../shared/contracts";
import {renderVirtual} from "../shared/schemes";
import type {ServerFilesResult, VirtualListing} from "../shared/schemes";
import {hashOf} from "./files-service";
import type {FilesRequest, ProjectsScheme} from "./server-files";

type Fail = Extract<ServerFilesResult<never>, {ok: false}>;
const fail = (code: Fail["code"], detail: string): Fail => ({ok: false, code, detail});

const DESCRIPTION = "已登记的作品。每一项是一本书的作品目录，按 projects://<短名>/<路径> 读写；当前会话所在的书也可以写成 project://。";

/** 远程调用的结果：业务失败的详情是对象（`{detail, current?}`），路由层失败的详情是字符串；都摊平成同一个形状。 */
type RemoteOutcome<T> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: string; readonly detail?: unknown; readonly cause?: unknown};

function flatten<T>(result: RemoteOutcome<T>): ServerFilesResult<T> {
    if (result.ok) return {ok: true, value: result.value};
    const detail = result.detail;
    const object = typeof detail === "object" && detail !== null ? (detail as {readonly detail?: string; readonly current?: Baseline}) : null;
    return {
        ok: false,
        code: result.code as Fail["code"],
        detail: object === null ? String(detail ?? "") : (object.detail ?? ""),
        ...(object?.current === undefined ? {} : {current: object.current}),
        ...(result.cause === undefined ? {} : {cause: result.cause as NonNullable<Fail["cause"]>}),
    };
}

export function createProjectsScheme(projects: ProjectsService, remote: ActivationContext["remote"]): ProjectsScheme {
    const virtual = async (): Promise<ServerFilesResult<VirtualListing>> => {
        const listed = await projects.list();
        if (!listed.ok) return fail("project-unavailable", `项目登记表不可用：${listed.detail}`);
        const entries = await Promise.all(listed.value.map(async (project) => {
            const metadata = await projects.readMetadata(project.id);
            const title = metadata.ok ? (metadata.metadata.title ?? undefined) : undefined;
            return {name: project.name, address: `projects://${project.name}`, ...(title === undefined ? {} : {title}), meta: {id: project.id, state: project.state}};
        }));
        return {ok: true, value: {kind: "virtual", description: DESCRIPTION, entries}};
    };

    /** 解析引用、取得租约、调用、释放。`signal` 在取得租约之后已触发的，立即释放、不发出调用。 */
    const withProject = async <T>(path: string, request: FilesRequest, call: (id: string, inner: string) => Promise<RemoteOutcome<T>>): Promise<ServerFilesResult<T>> => {
        const slash = path.indexOf("/");
        const reference = slash < 0 ? path : path.slice(0, slash);
        const inner = slash < 0 ? "" : path.slice(slash + 1);
        const resolved = await projects.resolve(reference);
        if (!resolved.ok) return fail("project-unavailable", `项目登记表不可用：${resolved.detail}`);
        if (resolved.value === null) return fail("not-found", `没有登记项目 ${reference}`);
        const acquired = await projects.acquire(resolved.value.id);
        if (acquired.status === "rejected") return fail("project-unavailable", `打不开项目 ${reference}：${acquired.reason}（${acquired.detail}）`);
        const {lease} = acquired;
        try {
            if (request.signal.aborted) return fail("cancelled", "调用已取消");
            return flatten(await call(lease.id, inner));
        } finally {
            lease.release();
        }
    };
    const client = (id: string) => remote.use(projectFilesContract).at({project: id});
    const rootOnly = (path: string): boolean => path === "";

    return {
        list: async (path, request) => (rootOnly(path) ? virtual() : withProject<Listing>(path, request, (id, inner) => client(id).list({path: inner}, {signal: request.signal}))),
        read: async (path, request) => {
            if (rootOnly(path)) {
                const listed = await virtual();
                if (!listed.ok) return listed;
                const text = renderVirtual(listed.value);
                return {ok: true, value: {text, baseline: {hash: hashOf(new TextEncoder().encode(text))}}};
            }
            return withProject<FileText>(path, request, (id, inner) => client(id).read({path: inner}, {signal: request.signal}));
        },
        write: async (path, text, baseline, request) => {
            if (rootOnly(path)) return fail("permission-denied", "projects:// 是只读的目录");
            return withProject<SavedText>(path, request, (id, inner) => client(id).write({path: inner, text, baseline, as: request.source}, {signal: request.signal}));
        },
        create: async (path, kind, request) => {
            if (rootOnly(path)) return fail("permission-denied", "projects:// 是只读的目录");
            return withProject<OperationDone>(path, request, (id, inner) => client(id).create({path: inner, kind, as: request.source}, {signal: request.signal}));
        },
        realPath: async (path, request) => {
            if (rootOnly(path)) return fail("unsupported-capability", "projects:// 是虚拟目录，没有真实路径");
            return withProject<{readonly path: string; readonly kind: "file" | "directory" | "other"}>(path, request, (id, inner) => client(id).realPath({path: inner}, {signal: request.signal}));
        },
    };
}
