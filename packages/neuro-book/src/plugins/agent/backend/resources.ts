/**
 * 会话的资源视图（docs/specs/agent/resources.md）：单数地址的改写、分类，与经写入接口的读写（注明代表这个会话，输出 10）。
 * 也给内核的资源接口（`SessionEnv.resources`）用。权限由文件服务按调用方（挂载方案的授权）判定，这里不另判。
 *
 * 它只在 `nbook.agent` 里按内核给的会话上下文构造：会话 id 与当前 Profile 来自内核，所以 Files 收到的“代表哪个会话”可信。
 * 若经共享的 `AgentService` 交出构造函数，任何依赖 `agentKey` 的插件都能自填会话 id 替别的会话读写。
 */

import {randomUUID} from "node:crypto";

import type {ToolSessionContext} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionFiles, SessionFilesFactory, SessionLayout} from "@notnotype/nb-harness/kit/files";

import {parseAddress} from "nbook/plugins/files/shared/contracts";
import type {CallOptions, WorkspaceFiles} from "nbook/plugins/files/shared/contracts";

import type {Expanded, ResourceClass, SessionArtifacts, SessionCalls, SessionResources} from "../shared/resources";

/** `session://attachments/`、`session://artifacts/` 与后台命令的输出 `session://jobs/` 由宿主写入，Agent 只读（resources.md 输出 12）。 */
const HOST_WRITTEN = ["attachments", "artifacts", "jobs"];

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
            // 分组在第一次用到时建一次，这次调用里的全部写入共用它。代码里调的工具（`within`，resources.md 输出 17）按父调用共用
            // 一个组：一段 eval 里的十次写入是一次操作；来源条目仍是各自的嵌套调用。
            const within = call.within;
            let grouped: Promise<WorkspaceFiles> | null = null;
            const scoped = (): Promise<WorkspaceFiles> => {
                if (within !== undefined) return nestedGroup(`${context.sessionId}/${within.invocation}`, () => files.group({title: within.tool}, async (group) => group));
                return (grouped ??= files.group({title: info?.title ?? toolId ?? "Agent", ...(info?.note === undefined ? {} : {note: info.note})}, async (group) => group));
            };
            return bind(lazy(scoped), expand, {agent: {...self, entry: call.callId}}, call.signal);
        },
    };
}

/**
 * 父调用（eval 的一次执行）到它的嵌套写入共用的组。每个工具各有一份资源视图，组得放在它们之外；按“会话/父调用”记，只留最近的
 * 一批：父调用活不过它的运行，旧的组不会再有人要。
 */
const NESTED_GROUP_LIMIT = 256;
const nestedGroups = new Map<string, Promise<WorkspaceFiles>>();
function nestedGroup(key: string, open: () => Promise<WorkspaceFiles>): Promise<WorkspaceFiles> {
    let group = nestedGroups.get(key);
    if (group === undefined) {
        group = open();
        nestedGroups.set(key, group);
        if (nestedGroups.size > NESTED_GROUP_LIMIT) nestedGroups.delete(nestedGroups.keys().next().value!);
    }
    return group;
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

/**
 * 这个会话在套件看来的地址布局（docs/specs/harness/host-kit.md 输出 10）。`project://` 只在有主项目时出现：工作目录与 `auto`
 * 不问审批者的写都跟着它。
 */
export function sessionLayout(context: ToolSessionContext): SessionLayout {
    const project = context.project !== undefined;
    return {
        working: project ? "project://" : "session://",
        scratch: ["session://", "tmp://"],
        localWrites: project ? ["project://", "session://", "tmp://"] : ["session://", "tmp://"],
        shellEnv: {...(project ? {NBOOK_PROJECT: "project://"} : {}), NBOOK_SESSION: "session://"},
        // 项目根的 `.nbook/` 不露出，直接不扫，省下无谓的读（授权仍以 `readPath` 为准）。
        searchExcludes: (root) => {
            const parsed = parseAddress(root);
            return parsed.ok && parsed.address.scheme === "projects" && !parsed.address.path.includes("/") ? ["/.nbook"] : [];
        },
    };
}

/**
 * 资源视图加上布局，就是套件要的文件访问：返回类型的标注就是编译期检查，`SessionResources` 的方法与接口一失配就编译失败。
 */
export const sessionFiles = (resources: SessionResources, context: ToolSessionContext): SessionFiles => ({...resources, layout: sessionLayout(context)});

/**
 * 审批钩子、放回与内核资源接口用的工厂：在 `agent.ts` 建一次。只在 `nbook.agent` 内部传递，不进 `AgentService`：别的插件拿不到
 * 能代表会话的读写（见文件头）。
 */
export const filesFor = (files: WorkspaceFiles): SessionFilesFactory => (context, owner) => sessionFiles(sessionResources(files, context, owner), context);
