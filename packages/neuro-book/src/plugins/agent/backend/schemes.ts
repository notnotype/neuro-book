/**
 * `nbook.agent` 注册进文件服务的五个方案（docs/specs/agent/resources.md 的“输入与前置条件”表与输出 4–8）。这里只有声明：
 * 根的说明与条目、挂载点、授权规则；读写与目录寿命由 `nbook.files` 管理。
 *
 * 授权按调用方区分：`caller.agent` 是 Agent 会话（由 `nbook.agent` 自己注明，Files 只认它注明），没带的是服务端插件，
 * 例如宿主写入附件与工具大结果，按系统放行，系统只读的（会话日志、产品文档）除外。
 */

import {lstat} from "node:fs/promises";
import {join} from "node:path";

import type {SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";

import type {AuthorizeResult, MountedSchemeSpec, SchemeCaller, SchemeOperation} from "nbook/plugins/files/shared/contracts";

import type {ProfileEntry} from "../shared/contracts";

/** `sessions://` 的根至多列出这么多个会话。 */
export const SESSIONS_LISTED = 200;
const LOG = "session.jsonl";
const HOME = "home";
/** 会话 `home/` 里由宿主写入、Agent 只读的两个子目录。 */
const HOST_WRITTEN = ["attachments", "artifacts"];

const writes = (operation: SchemeOperation): boolean => operation === "write" || operation === "create";
const under = (path: string, directory: string): boolean => path === directory || path.startsWith(`${directory}/`);

async function exists(path: string): Promise<boolean> {
    return lstat(path).then(() => true, () => false);
}

export interface AgentSchemesOptions {
    readonly sessionsRoot: string;
    readonly profilesRoot: string;
    /** 临时目录容器；不可用时为 null，`temps://` 没有挂载点。 */
    readonly tempContainer: string | null;
    /** 产品文档目录（含 `builtin/`、`agent/`）；没生成时为 null。 */
    readonly docsRoot: string | null;
    readonly listSessions: () => Promise<readonly SessionIndexEntry[]>;
    readonly profiles: () => readonly ProfileEntry[];
}

export const AGENT_SCHEMES = ["sessions", "profiles", "temps", "docs", "skills"] as const;

export function agentSchemes(options: AgentSchemesOptions): Record<(typeof AGENT_SCHEMES)[number], MountedSchemeSpec> {
    // 贡献声明是静态的，方案总要给出实现：容器不可用时没有挂载点，根的说明写明原因。
    const container = options.tempContainer;
    const temps: MountedSchemeSpec = {
        capabilities: ["read", "write", "list", "realPath"],
        container: container ?? options.sessionsRoot,
        root: () => ({description: container === null ? "各会话的临时目录。本机的系统临时目录不可用，临时目录暂时用不了。" : "各会话的临时目录，服务端重启时清掉已归档的会话的目录。本会话的临时目录也可以写成 tmp://。", entries: []}),
        mount: async (name) => (container !== null && (await exists(join(options.sessionsRoot, name))) ? {create: true} : null),
        authorize: (caller, mount, operation) => (writes(operation) && caller.agent !== null && caller.agent.session !== mount ? "permission-denied" : true),
    };
    return {
        sessions: {
            capabilities: ["read", "write", "list", "realPath"],
            container: options.sessionsRoot,
            root: async () => {
                const sessions = [...await options.listSessions()].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, SESSIONS_LISTED);
                return {
                    description: `Agent 会话，按最近使用列出至多 ${String(SESSIONS_LISTED)} 个。每个会话有只读的对话日志 session.jsonl 与工作区 home/；本会话的工作区也可以写成 session://。`,
                    entries: sessions.map((session) => ({name: session.id, ...(session.title === null ? {} : {title: session.title}), meta: {profile: session.profile, updated: new Date(session.lastActivityAt).toISOString()}})),
                };
            },
            // 会话目录由内核建：不存在就是没有这个会话，不替它建。
            mount: async (name) => ((await exists(join(options.sessionsRoot, name))) ? {create: false, ensure: [HOME]} : null),
            authorize: (caller, mount, operation, path) => sessionRule(caller, mount, operation, path),
        },
        profiles: {
            capabilities: ["read", "write", "list", "realPath"],
            container: options.profilesRoot,
            root: () => ({
                description: "Profile 的笔记目录，跨书保存。当前 Profile 的目录也可以写成 profile://，只有它可写。",
                entries: options.profiles().map((profile) => ({name: profile.key, title: profile.name, meta: {source: profile.source, status: profile.status}})),
            }),
            mount: async (name) => {
                if (options.profiles().some((profile) => profile.key === name)) return {create: true};
                // Profile 已经不在，留下的笔记仍可读。
                return (await exists(join(options.profilesRoot, name))) ? {create: false} : null;
            },
            authorize: (caller, mount, operation) => (writes(operation) && caller.agent !== null && caller.agent.profile !== mount ? "permission-denied" : true),
        },
        docs: {
            capabilities: ["read", "list", "realPath"],
            container: options.docsRoot ?? options.sessionsRoot,
            root: () => ({
                description: options.docsRoot === null ? "产品文档。开发环境里还没有生成，先运行 bun run build:agent-docs。" : "产品文档，只读。builtin/ 是 NeuroBook 自带的文档（插件 SDK 在 builtin/sdk/），agent/ 是 Agent 的使用说明。",
                entries: options.docsRoot === null ? [] : [{name: "builtin", title: "NeuroBook 自带的文档"}, {name: "agent", title: "Agent 的使用说明"}],
            }),
            mount: async (name) => (options.docsRoot !== null && ["builtin", "agent"].includes(name) && (await exists(join(options.docsRoot, name))) ? {create: false} : null),
            authorize: (_caller, _mount, operation) => (writes(operation) ? "permission-denied" : true),
        },
        skills: {
            capabilities: ["read", "list"],
            container: options.sessionsRoot,
            root: () => ({description: "Skill 目录。还没有可用的 Skill。", entries: []}),
            mount: () => null,
            authorize: () => "not-found",
        },
        temps,
    };
}

/** 会话目录：只露出日志与 `home/`；日志对所有调用方只读；Agent 只写自己的 `home/`，宿主写入的两个子目录除外。 */
function sessionRule(caller: SchemeCaller, mount: string, operation: SchemeOperation, path: string): AuthorizeResult {
    if (path === "") return writes(operation) ? "permission-denied" : true;
    if (path === LOG) return writes(operation) ? "permission-denied" : true;
    if (!under(path, HOME)) return "protected-path";
    if (!writes(operation) || caller.agent === null) return true;
    if (caller.agent.session !== mount) return "permission-denied";
    return HOST_WRITTEN.some((directory) => under(path, `${HOME}/${directory}`)) ? "permission-denied" : true;
}
