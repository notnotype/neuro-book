/**
 * 会话的资源视图（docs/specs/agent/resources.md）：单数地址的改写、分类，与经写入接口的读写（注明代表这个会话，输出 10）。
 * 也给内核的资源接口（`SessionEnv.resources`）用。权限由文件服务按调用方（挂载方案的授权）判定，这里不另判。
 *
 * 它只在 `nbook.agent` 里按内核给的会话上下文构造：会话 id 与当前 Profile 来自内核，所以 Files 收到的“代表哪个会话”可信。
 * 若经共享的 `AgentService` 交出构造函数，任何依赖 `agentKey` 的插件都能自填会话 id 替别的会话读写。
 */

import {randomUUID} from "node:crypto";

import type {Resources, ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";

import {decodeText, parseAddress} from "nbook/plugins/files/shared/contracts";
import type {CallOptions, WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import type {Expanded, ResourceClass, SessionArtifacts, SessionCalls, SessionResources} from "../shared/resources";

/** `session://attachments/`、`session://artifacts/` 由宿主写入，Agent 只读。 */
const HOST_WRITTEN = ["attachments", "artifacts"];

const join = (base: string, path: string): string => (path === "" ? base : `${base}/${path}`);

/** `toolId`：构造它的工具，作 `call(ctx)` 的分组缺省标题；内核的资源接口不属于哪个工具，为 null。 */
export function sessionResources(files: WorkspaceFiles, context: ToolSessionContext, toolId: string | null): SessionResources {

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

    const self = {session: context.sessionId, profile: context.profile};
    return {
        expand,
        classify,
        ...bind(files, expand, {agent: self}, undefined),
        call: (call, info) => {
            // 分组在第一次用到时建一次，这次调用里的全部写入共用它。
            let grouped: Promise<WorkspaceFiles> | null = null;
            const scoped = (): Promise<WorkspaceFiles> => (grouped ??= files.group({title: info?.title ?? toolId ?? "Agent", ...(info?.note === undefined ? {} : {note: info.note})}, async (group) => group));
            return bind(lazy(scoped), expand, {agent: {...self, entry: call.callId}}, call.signal);
        },
    };
}

/**
 * 宿主写全文（docs/specs/agent/resources.md 输出 11）。不带 `as`：来源是 `nbook.agent` 自己，绕开的是 Agent 不能写 `artifacts/` 的
 * 规则。单数地址只有资源视图认，所以这里拼全局地址。文件名不用工具调用 id：它只保证同一条回复里不重复，换一次请求就可能再出现。
 */
export function sessionArtifacts(files: WorkspaceFiles, context: ToolSessionContext): SessionArtifacts {
    return {
        save: async (label, write) => {
            if (label === "" || label === "." || label === ".." || /[/\\]/u.test(label)) return {ok: false, code: "invalid-address", detail: `artifact label must be a single segment: ${label}`};
            const address = `sessions://${context.sessionId}/home/artifacts/${label}-${randomUUID()}.log`;
            const saved = await files.stage(address, write, {expect: "absent", createParents: true});
            return saved.ok ? {ok: true, value: {address}} : saved;
        },
    };
}

/** 一个等到第一次调用才取到的写入接口（分组的门面）。 */
function lazy(get: () => Promise<WorkspaceFiles>): WorkspaceFiles {
    return new Proxy({} as WorkspaceFiles, {
        get: (_target, key: keyof WorkspaceFiles) => async (...args: unknown[]) => {
            const files = await get();
            return (files[key] as (...rest: unknown[]) => unknown)(...args);
        },
    });
}

/**
 * 把写入接口按会话绑定：每个地址先改写（改写失败直接交回），调用都带上 `as` 与合进来的 `signal`。调用方给的 `as` 被覆盖：
 * 代表哪个会话只由构造它的 `nbook.agent` 决定。
 */
function bind(files: WorkspaceFiles, expand: (address: string) => Expanded, as: NonNullable<CallOptions["as"]>, signal: AbortSignal | undefined): SessionCalls {
    const with_ = <O extends CallOptions>(options: O | undefined): O => {
        const signals = [signal, options?.signal].filter((value): value is AbortSignal => value !== undefined);
        return {...(options ?? {}), as, ...(signals.length === 0 ? {} : {signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals)})} as O;
    };
    const at = <T>(address: string, run: (global: string) => Promise<T>): Promise<T | Extract<Expanded, {ok: false}>> => {
        const expanded = expand(address);
        return expanded.ok ? run(expanded.address) : Promise.resolve(expanded);
    };
    /** 批量：每一项的地址都改写，有一项改写不了就整批交回那一项的失败。 */
    const all = <I, T>(items: ReadonlyArray<I>, map: (item: I, rewrite: (address: string) => string) => I, run: (rewritten: I[]) => Promise<T>): Promise<T | Extract<Expanded, {ok: false}>> => {
        let failed: Extract<Expanded, {ok: false}> | null = null;
        const rewritten = items.map((item) => map(item, (address) => {
            const expanded = expand(address);
            if (expanded.ok) return expanded.address;
            failed ??= expanded;
            return address;
        }));
        return failed === null ? run(rewritten) : Promise.resolve(failed);
    };
    const calls: SessionCalls = {
        read: (address, options) => at(address, (global) => files.read(global, with_(options))),
        readPath: (address, options) => at(address, (global) => files.readPath(global, with_(options))),
        list: (address, options) => at(address, (global) => files.list(global, with_(options))),
        stage: (address, write, options) => at(address, (global) => files.stage(global, write, with_(options))),
        write: (address, content, options) => at(address, (global) => files.write(global, content, with_(options))),
        update: (address, edit, options) => at(address, (global) => files.update(global, edit, with_(options))),
        identify: (addresses, options) => all(addresses, (address, rewrite) => rewrite(address), (rewritten) => files.identify(rewritten, with_(options))),
        create: (address, kind, options) => at(address, (global) => files.create(global, kind, with_(options))),
        createContent: (address, options) => at(address, (global) => files.createContent(global, with_(options))),
        rename: (address, name, options) => at(address, (global) => files.rename(global, name, with_(options))),
        convert: (address, to, options) => at(address, (global) => files.convert(global, to, with_(options))),
        reorder: (directory, names, options) => at(directory, (global) => files.reorder(global, names, with_(options))),
        display: (address, display, options) => at(address, (global) => files.display(global, display, with_(options))),
        include: (address, options) => at(address, (global) => files.include(global, with_(options))),
        drop: (address, options) => at(address, (global) => files.drop(global, with_(options))),
        move: (items, options) => all(items, (item, rewrite) => ({...item, source: rewrite(item.source), target: rewrite(item.target)}), (rewritten) => files.move(rewritten, with_(options))),
        copy: (items, options) => all(items, (item, rewrite) => ({...item, source: rewrite(item.source), target: rewrite(item.target)}), (rewritten) => files.copy(rewritten, with_(options))),
        delete: (items, options) => all(items, (item, rewrite) => ({...item, address: rewrite(item.address)}), (rewritten) => files.delete(rewritten, with_(options))),
        group: (info, run) => files.group(info, (scoped) => run(bind(scoped, expand, as, signal))),
    };
    return calls;
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
            if (!read.ok) {
                if (read.code === "not-found") return undefined;
                throw new Error(`读不了 ${uri}：${read.code}（${read.detail}）`);
            }
            // 与文件服务读文本同一规则：严格 UTF-8、BOM 留在文本里、含 NUL 的不是文本。
            const text = decodeText(read.value.bytes);
            if (text === null) throw new Error(`读不了 ${uri}：not-text（不是 UTF-8 文本）`);
            return text;
        },
    };
}
