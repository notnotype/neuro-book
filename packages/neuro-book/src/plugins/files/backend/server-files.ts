/**
 * 服务端文件服务 `serverFilesKey`（docs/specs/workspace/resources.md 的“服务端文件服务”）：按调用方门面，按全局地址分派到
 * `user://`、`projects://` 与已注册的方案。只在服务端进程内使用，不经远程合同。
 */

import {provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ProvidedService} from "@notnotype/nb-runtime/plugins";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import type {Baseline, ChangeSource} from "../shared/contracts";
import {parseAddress} from "../shared/resource";
import type {Address} from "../shared/resource";
import {serverFilesKey} from "../shared/schemes";
import type {SchemeCaller, ServerFiles, ServerFilesOptions, ServerFilesResult} from "../shared/schemes";
import {saveText, toResult, tracked} from "./execute";
import type {WriteTarget} from "./execute";
import type {Operations} from "./operations";
import type {SchemeRegistry} from "./registry";

/** 能注明代表哪个 Agent 会话的只有服务端的 `nbook.agent`（docs/specs/agent/resources.md）。 */
const AGENT_PLUGIN = "nbook.agent";

/** `projects://` 的分派（第 2 片接上）；没有项目登记的实例里为 null。 */
export interface ProjectsScheme {
    list(path: string, request: FilesRequest): ReturnType<ServerFiles["list"]>;
    read(path: string, request: FilesRequest): ReturnType<ServerFiles["read"]>;
    write(path: string, text: string, baseline: Baseline, request: FilesRequest): ReturnType<ServerFiles["write"]>;
    create(path: string, kind: "file" | "directory", request: FilesRequest): ReturnType<ServerFiles["create"]>;
    realPath(path: string, request: FilesRequest): ReturnType<ServerFiles["realPath"]>;
}

/** 一次已接纳的请求：调用方、写入来源与这次的终止信号。 */
export interface FilesRequest {
    readonly caller: SchemeCaller;
    readonly source: ChangeSource;
    readonly signal: AbortSignal;
}

export interface ServerFilesDeps {
    readonly user: WriteTarget & {readonly operations: Operations};
    readonly registry: SchemeRegistry;
    readonly projects: ProjectsScheme | null;
    /** 提供入口的停止信号：入口停止时在途调用一并中止。 */
    readonly signal: AbortSignal;
    readonly sourceOf: (consumer: ConsumerIdentity) => ChangeSource;
}

type Fail = Extract<ServerFilesResult<never>, {ok: false}>;
const fail = (code: Fail["code"], detail: string): Fail => ({ok: false, code, detail});

export function provideServerFiles(deps: ServerFilesDeps): ProvidedService<ServerFiles> {
    const released = new WeakMap<object, AbortController>();
    return provideServicePerConsumer(serverFilesKey, (consumer) => {
        // 门面释放（调用方入口停止）时中止它在途的调用。
        const gone = new AbortController();
        const begin = (address: string, options: ServerFilesOptions | undefined): {readonly address: Address; readonly request: FilesRequest} | Fail => {
            const parsed = parseAddress(address);
            if (!parsed.ok) return fail(parsed.code, parsed.detail);
            const agent = options?.as?.agent ?? null;
            if (agent !== null && !(consumer.location === "server" && consumer.plugin === AGENT_PLUGIN)) return fail("invalid-input", "只有服务端的 nbook.agent 可以注明代表哪个会话");
            const signal = AbortSignal.any([gone.signal, deps.signal, ...(options?.signal === undefined ? [] : [options.signal])]);
            if (signal.aborted) return fail("cancelled", "调用已取消");
            return {address: parsed.address, request: {caller: {consumer, agent}, source: agent === null ? deps.sourceOf(consumer) : {kind: "agent", session: agent.session}, signal}};
        };
        const unknown = (scheme: string): Fail => fail("unknown-scheme", `没有方案 ${scheme}://`);
        const {user, registry, projects} = deps;

        const facade: ServerFiles = {
            list: async (address, options) => {
                const started = begin(address, options);
                if ("ok" in started) return started;
                const {address: {scheme, path}, request} = started;
                if (scheme === "user") return toResult(await user.service.list(path));
                if (scheme === "projects") return projects === null ? unknown(scheme) : projects.list(path, request);
                return registry.get(scheme)?.list(path, request.caller, request.signal) ?? unknown(scheme);
            },
            read: async (address, options) => {
                const started = begin(address, options);
                if ("ok" in started) return started;
                const {address: {scheme, path}, request} = started;
                if (scheme === "user") return toResult(await user.service.read(path));
                if (scheme === "projects") return projects === null ? unknown(scheme) : projects.read(path, request);
                return registry.get(scheme)?.read(path, request.caller, request.signal) ?? unknown(scheme);
            },
            write: async (address, text, baseline, options) => {
                const started = begin(address, options);
                if ("ok" in started) return started;
                const {address: {scheme, path}, request} = started;
                if (scheme === "user") return toResult(await saveText(user, path, text, baseline, request.source));
                if (scheme === "projects") return projects === null ? unknown(scheme) : projects.write(path, text, baseline, request);
                return registry.get(scheme)?.write(path, text, baseline, request.caller, request.source, request.signal) ?? unknown(scheme);
            },
            create: async (address, kind, options) => {
                const started = begin(address, options);
                if ("ok" in started) return started;
                const {address: {scheme, path}, request} = started;
                if (scheme === "user") return toResult(await tracked(user.scope, "files.create", () => user.operations.create({path, kind}, request.source)));
                if (scheme === "projects") return projects === null ? unknown(scheme) : projects.create(path, kind, request);
                return registry.get(scheme)?.create(path, kind, request.caller, request.source, request.signal) ?? unknown(scheme);
            },
            realPath: async (address, options) => {
                const started = begin(address, options);
                if ("ok" in started) return started;
                const {address: {scheme, path}, request} = started;
                if (scheme === "user") return toResult(await user.service.realPath(path));
                if (scheme === "projects") return projects === null ? unknown(scheme) : projects.realPath(path, request);
                return registry.get(scheme)?.realPath(path, request.caller, request.signal) ?? unknown(scheme);
            },
        };
        released.set(facade, gone);
        return facade;
    }, {release: (facade) => {
        released.get(facade)?.abort();
    }});
}
