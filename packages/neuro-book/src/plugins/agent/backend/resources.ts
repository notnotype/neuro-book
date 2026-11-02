/**
 * 会话的资源视图（docs/specs/agent/resources.md）：单数地址的改写、分类，与经服务端文件服务的读写（注明代表这个会话）。
 * 也给内核的资源接口（`SessionEnv.resources`）用。
 *
 * 它只在 `nbook.agent` 里按内核给的会话上下文构造：会话 id 与当前 Profile 来自内核，所以 Files 收到的“代表哪个会话”可信。
 * 若经共享的 `AgentService` 交出构造函数，任何依赖 `agentKey` 的插件都能自填会话 id 替别的会话读写。
 */

import type {Resources, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import {parseAddress} from "nbook/plugins/files/shared/contracts";
import type {ServerFiles} from "nbook/plugins/files/shared/contracts";

import type {Expanded, ResourceClass, SessionResources} from "../shared/resources";

/** `session://attachments/`、`session://artifacts/` 由宿主写入，Agent 只读。 */
const HOST_WRITTEN = ["attachments", "artifacts"];

const join = (base: string, path: string): string => (path === "" ? base : `${base}/${path}`);

export function sessionResources(files: ServerFiles, context: ToolSessionContext): SessionResources {
    const as = {agent: {session: context.sessionId, profile: context.profile}};

    const expand = (address: string): Expanded => {
        const parsed = parseAddress(address);
        if (!parsed.ok) return parsed;
        const {scheme, path} = parsed.address;
        switch (scheme) {
            case "project":
                if (context.project === undefined) return {ok: false, code: "no-project", detail: "这个会话不属于任何作品，project:// 不可用"};
                return {ok: true, address: join(`projects://${context.project}`, path)};
            case "session":
                return {ok: true, address: join(`sessions://${context.sessionId}/home`, path)};
            case "profile":
                return {ok: true, address: join(`profiles://${context.profile}`, path)};
            case "tmp":
                return {ok: true, address: join(`temps://${context.sessionId}`, path)};
            default:
                return {ok: true, address};
        }
    };

    const classify = (address: string): ResourceClass | Extract<Expanded, {ok: false}> => {
        const expanded = expand(address);
        if (!expanded.ok) return expanded;
        const parsed = parseAddress(expanded.address);
        if (!parsed.ok) return parsed;
        const {scheme, path} = parsed.address;
        const segments = path === "" ? [] : path.split("/");
        const [first, second, third] = segments;
        const allowed = (ok: boolean): ResourceClass => ({content: false, write: ok ? "allowed" : "denied"});
        switch (scheme) {
            case "projects":
                return {content: true, write: segments.length > 0 ? "allowed" : "denied"};
            case "user":
                return {content: false, write: "ask"};
            case "sessions":
                return allowed(first === context.sessionId && second === "home" && !(third !== undefined && HOST_WRITTEN.includes(third)));
            case "profiles":
                return allowed(first === context.profile);
            case "temps":
                return allowed(first === context.sessionId);
            default:
                return allowed(false);
        }
    };

    /** 改写后经服务端文件服务调用；改写失败直接交回。 */
    const call = <T>(address: string, run: (global: string) => Promise<T>): Promise<T | Extract<Expanded, {ok: false}>> => {
        const expanded = expand(address);
        return expanded.ok ? run(expanded.address) : Promise.resolve(expanded);
    };

    return {
        expand,
        classify,
        list: (address, options) => call(address, (global) => files.list(global, {as, ...options})),
        read: (address, options) => call(address, (global) => files.read(global, {as, ...options})),
        write: (address, text, baseline, options) => call(address, (global) => files.write(global, text, baseline, {as, ...options})),
        create: (address, kind, options) => call(address, (global) => files.create(global, kind, {as, ...options})),
        realPath: (address, options) => call(address, (global) => files.realPath(global, {as, ...options})),
    };
}

/** 内核的资源接口：`resolve` 交回全局地址（改写不了的原样交回）；`read` 只在不存在时为空，其它失败抛出（输出 9）。 */
export function kernelResources(resources: SessionResources): Resources {
    return {
        resolve: (uri) => {
            const expanded = resources.expand(uri);
            return expanded.ok ? expanded.address : uri;
        },
        read: async (uri) => {
            const read = await resources.read(uri);
            if (read.ok) return read.value.text;
            if (read.code === "not-found") return undefined;
            throw new Error(`读不了 ${uri}：${read.code}（${read.detail}）`);
        },
    };
}
