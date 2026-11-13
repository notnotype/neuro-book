/**
 * `nbook.agent` 注册进文件服务的五个方案（docs/specs/agent/resources.md 的“输入与前置条件”表与输出 4–8、15）。这里只有声明：
 * 根的说明与条目、挂载点、授权规则；读写与目录寿命由 `nbook.files` 管理。
 *
 * 授权按调用方区分：`caller.agent` 是 Agent 会话（由 `nbook.agent` 自己注明，Files 只认它注明），没带的是服务端插件，
 * 例如宿主写入附件与工具大结果，按系统放行，系统只读的（会话日志、产品文档）除外。
 */

import {lstat} from "node:fs/promises";
import {basename, dirname, join} from "node:path";

import type {SessionIndexEntry} from "@notnotype/nb-harness/kernel/contracts";

import type {AuthorizeResult, MountedSchemeSpec, SchemeCaller, SchemeOperation, VirtualEntry} from "nbook/plugins/files/shared/contracts";

import type {ProfileEntry} from "../shared/contracts";
import type {SkillEntry} from "../shared/skills";
import type {SkillItem} from "./skills/catalog";
import type {SessionRelations} from "./subagents/relations";

/** `sessions://` 的根至多列出这么多个会话。 */
export const SESSIONS_LISTED = 200;
const LOG = "session.jsonl";
const HOME = "home";
/** 会话 `home/` 里由宿主写入、Agent 只读的子目录：附件、全文、后台命令的输出（resources.md 输出 12）。 */
const HOST_WRITTEN = ["attachments", "artifacts", "jobs"];

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
    /** 会话之间的父子关系：根先列读它的会话的父、子、兄弟（resources.md 输出 13）。 */
    readonly relations: SessionRelations;
    /** 在跑与等用户的会话（句柄表的 `activity()`）；不在里面的算空闲，不为取状态去打开会话。 */
    readonly activity: () => ReadonlyArray<{readonly id: string; readonly state: "running" | "waiting"}>;
    /** 这个 Profile 能派哪些 Profile（白名单合成之后，subagents.md）。 */
    readonly allowedAgents: (profile: string) => readonly string[];
    /** Skill 目录（skills.md 输出 23、24）。 */
    readonly skills: {
        /** 用户的 Skill 文件夹：方案的缺省容器；每个挂载点另给自己所在的目录。 */
        readonly userRoot: string;
        readonly list: () => readonly SkillEntry[];
        readonly item: (id: string) => SkillItem | undefined;
        /** 这个 Profile 的 Skill 白名单（合成之后）。 */
        readonly allowed: (profile: string) => ReadonlySet<string>;
    };
}

const SKILL_STATUS_TEXT = {"ready": "可用", "needs-init": "未初始化", "initializing": "正在初始化", "invalid": "无效"} as const;

const STATE_TEXT = {running: "运行中", waiting: "等用户", idle: "空闲"} as const;

/**
 * `sessions://` 根的条目顺序（resources.md 输出 13）：读它的会话的父会话、子会话、兄弟会话在前，各带状态，子会话另带派它的调用 id；
 * 之后按最近使用。合计至多 `SESSIONS_LISTED` 个、不重复。
 */
function sessionEntries(sessions: readonly SessionIndexEntry[], reader: string | null, relations: SessionRelations, activity: AgentSchemesOptions["activity"]): VirtualEntry[] {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const states = new Map(activity().map((item) => [item.id, item.state]));
    const recent = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const related: {readonly id: string; readonly relation: string}[] = [];
    if (reader !== null) {
        const parent = relations.parentOf(reader);
        if (parent !== null) related.push({id: parent, relation: "父会话"});
        const byRecent = (ids: readonly string[]) => [...ids].sort((a, b) => (byId.get(b)?.lastActivityAt ?? 0) - (byId.get(a)?.lastActivityAt ?? 0));
        for (const child of byRecent(relations.childrenOf(reader))) related.push({id: child, relation: "子会话"});
        if (parent !== null) for (const sibling of byRecent(relations.childrenOf(parent).filter((id) => id !== reader))) related.push({id: sibling, relation: "兄弟会话"});
    }
    const entries: VirtualEntry[] = [];
    const listed = new Set<string>();
    const add = (session: SessionIndexEntry, relation?: string) => {
        if (listed.has(session.id) || entries.length >= SESSIONS_LISTED) return;
        listed.add(session.id);
        const call = relation === "子会话" ? relations.callOf(session.id) : undefined;
        entries.push({
            name: session.id,
            ...(session.title === null ? {} : {title: session.title}),
            meta: {
                profile: session.profile,
                updated: new Date(session.lastActivityAt).toISOString(),
                ...(relation === undefined ? {} : {relation, state: STATE_TEXT[states.get(session.id) ?? "idle"]}),
                ...(call === undefined ? {} : {callId: call.callId}),
            },
        });
    };
    // 列表里没有的（归档的、后台的、索引读不了的）不补：根只列能用的会话。
    for (const item of related) {
        const session = byId.get(item.id);
        if (session !== undefined) add(session, item.relation);
    }
    for (const session of recent) add(session);
    return entries;
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
            root: async (caller) => ({
                description: `Agent 会话：先列本会话的父会话、子会话与兄弟会话（带状态，子会话带派它的调用 id），再按最近使用，合计至多 ${String(SESSIONS_LISTED)} 个。每个会话有只读的对话日志 session.jsonl 与工作区 home/；本会话的工作区也可以写成 session://。`,
                entries: sessionEntries(await options.listSessions(), caller.agent?.session ?? null, options.relations, options.activity),
            }),
            // 会话目录由内核建：不存在就是没有这个会话，不替它建。
            mount: async (name) => ((await exists(join(options.sessionsRoot, name))) ? {create: false, ensure: [HOME]} : null),
            authorize: (caller, mount, operation, path) => sessionRule(caller, mount, operation, path),
        },
        profiles: {
            capabilities: ["read", "write", "list", "realPath"],
            container: options.profilesRoot,
            root: (caller) => {
                // 每项标出读它的会话能不能派（resources.md 输出 14）；不是 Agent 会话在读时不标。
                const allowed = caller.agent === null ? null : new Set(options.allowedAgents(caller.agent.profile));
                return {
                    description: "Profile 的笔记目录，跨书保存。当前 Profile 的目录也可以写成 profile://，只有它可写。subagent 一栏说你能不能用 agent_spawn 派它。",
                    entries: options.profiles().map((profile) => ({name: profile.key, title: profile.name, meta: {source: profile.source, status: profile.status, ...(allowed === null ? {} : {subagent: allowed.has(profile.key) ? "可派" : "不可派"})}})),
                };
            },
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
            capabilities: ["read", "list", "realPath"],
            container: options.skills.userRoot,
            root: (caller) => {
                // 每项标出读它的会话能不能用 `$` 带上（skills.md 输出 23）；不是 Agent 会话在读时不标。
                const allowed = caller.agent === null ? null : options.skills.allowed(caller.agent.profile);
                const entries = options.skills.list().map((entry) => ({
                    name: entry.id,
                    title: entry.name,
                    meta: {
                        status: SKILL_STATUS_TEXT[entry.status],
                        ...(entry.status === "invalid" && entry.problem !== undefined ? {problem: entry.problem.code} : {}),
                        ...(entry.description === "" ? {} : {description: entry.description}),
                        ...(allowed === null ? {} : {invoke: allowed.has(entry.id) ? "能用 $" : "不在白名单"}),
                    },
                }));
                return {description: entries.length === 0 ? "Skill 目录。还没有 Skill：用户把 Skill 文件夹放进 user://skills/ 后会列在这里。" : "Skill 目录，只读。每个 Skill 的文件在 skills://<id>/ 下，入口是 SKILL.md；用户自己的 Skill 也在 user://skills/<名字>/，要改去那里。", entries};
            },
            // 挂载点是 Skill 的 id，落在它所在的目录：内置与用户的 Skill 在不同的文件夹里。链接的 Skill 不挂（挂载点不能是链接）。
            mount: (name) => {
                const item = options.skills.item(name);
                if (item === undefined || item.entry.problem?.code === "symlink") return null;
                return {create: false, container: dirname(item.directory), directory: basename(item.directory)};
            },
            authorize: (_caller, _mount, operation) => (writes(operation) ? "permission-denied" : true),
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
