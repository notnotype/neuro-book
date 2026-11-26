/**
 * `nbook.agent` 交给同进程服务端插件的服务（docs/specs/agent/sessions.md“输入与前置条件”）。远程合同在第 4 片加。
 */

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {CreateSessionOptions, Issuer, JsonValue, RunResult, SessionApi, SessionHeader, SessionIndexEntry, StorageResult, UserInput} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionHold} from "@notnotype/nb-harness/kit/sessions";

import type {AgentProfileDeclaration, AgentToolDeclaration} from "./points";

/** 别的内置插件贡献 Profile 用（跨插件的运行时导入只能指向合同，contributions.md 输出 7）：声明的助手与贡献点 id。 */
export {agentProfile, PROFILES_POINT} from "./points";
/** 模式扩展的 id：别的插件的 Profile 在声明里按它引用（contributions.md 输出 26）。 */
export {AGENT_MODES_EXTENSION} from "./permissions";
export type {AgentProfileImplementation} from "./points";

/** 别的内置插件贡献工具（`agent.tools`）用的助手与类型（docs/specs/agent/contributions.md）；第三方插件经 SDK 的 `/agent` 取同一份。 */
export {agentTool, evalObject, TOOLS_POINT} from "./points";
export type {AgentToolImplementation} from "./points";
export type {AgentToolServices} from "./resources";

export type ProfileStatus = "ok" | "unavailable" | "error";

/** Profile 目录的一项（contributions.md 输出 7）。 */
/** 主创：用户新建会话时默认用的 Profile（docs/specs/agent/builtin-profiles.md）。 */
export const MAIN_PROFILE = "nbook.agent.main";
/** 给前台会话生成标题和说明的 Profile；不给人选。 */
export const SESSION_TITLE_PROFILE = "nbook.agent.session-title";
/** 临时帮手：别的 Agent 派出来做一件事的子代理（builtin-profiles.md 输出 14）。 */
export const ADHOC_PROFILE = "nbook.agent.adhoc";

/**
 * 主创的工具要求（builtin-profiles.md 输出 1、15）。别的插件的岗位 Profile 要与主创同一套工具时照它声明（bots.md 输出 3）：声明在入口
 * 定义里、激活之前就要有，所以是合同里的数据。都可选的那些用户能用工具绑定换掉或去掉；`edit` 用 replace：中文一段就是一行，hashline
 * 要整段重写，输出 token 约是 replace 的三倍（w00032 t18 的实验）。
 */
export const MAIN_PROFILE_TOOLS: NonNullable<AgentProfileDeclaration["tools"]> = {
    required: ["nbook.agent.read", "nbook.agent.write", "nbook.agent.grep", "nbook.agent.glob", "nbook.agent.switch-mode"],
    optional: ["nbook.agent.edit-replace", "nbook.agent.shell", "nbook.agent.eval", "nbook.agent.ask-form", "nbook.agent.spawn", "nbook.agent.send", "nbook.agent.answer", "nbook.agent.wait", "nbook.agent.kill", "nbook.agent.jobs"],
};

/** 不可用或有错误的原因（contributions.md 输出 15）：界面按码翻译，不带本机的绝对路径。 */
export type ProfileProblem =
    | {readonly code: "tools-missing"; readonly tools: readonly string[]}
    | {readonly code: "key-taken"}
    /** 引用的扩展没有插件声明（按清单算，不激活提供方）。 */
    | {readonly code: "extensions-missing"; readonly extensions: readonly string[]}
    /** `module` 是导入了的包；运行时才算出模块名的没有。 */
    | {readonly code: "module-not-shared"; readonly module?: string}
    /** `expectedId`：导出了 Profile，但 id 不是这个文件该有的。 */
    | {readonly code: "invalid-export"; readonly expectedId?: string}
    /** `file` 相对 `user/profiles/`。 */
    | {readonly code: "build-failed" | "load-failed"; readonly file: string; readonly line?: number; readonly message: string};

export interface ProfileEntry {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    /** 贡献它的插件 id，或 `user`。 */
    readonly source: string;
    readonly status: ProfileStatus;
    /** 不可用或有错误时的原因。 */
    readonly problem?: ProfileProblem;
    /** 不给人选（contributions.md 输出 7）。 */
    readonly hidden?: true;
    /** 图标 class：会话面板每行与对话顶栏用。 */
    readonly icon?: string;
    /** 工具要求（contributions.md 输出 14）。用户级的来自上一次成功的包，从未成功时没有。 */
    readonly tools?: AgentProfileDeclaration["tools"];
    readonly defaultTools?: false;
    /** 按 id 引用的扩展（contributions.md 输出 14）：插件 Profile 来自声明，用户级来自上一次成功的包。 */
    readonly referencedExtensions?: readonly string[];
    /** 声明的缺省角色；用户级没有。 */
    readonly role?: string;
    readonly modelNeeds?: AgentProfileDeclaration["modelNeeds"];
    /** 声明的可派子代理（contributions.md 输出 19）；用户级的没有声明，白名单只来自 Profile 设置。 */
    readonly agents?: AgentProfileDeclaration["agents"];
    readonly skills?: AgentProfileDeclaration["skills"];
    /** 声明的表情包白名单（contributions.md 输出 23）；用户级的没有声明，白名单只来自 Profile 设置。 */
    readonly stickers?: AgentProfileDeclaration["stickers"];
    /** 开场指令（contributions.md 输出 21）；用户级的没有声明，所以没有。 */
    readonly starters?: AgentProfileDeclaration["starters"];
}

/** 工具目录的一项（contributions.md 输出 17）。 */
export interface ToolCatalogEntry {
    readonly id: string;
    /** 写给模型的说明：可能很长、不是界面语言。 */
    readonly description: string;
    /** 换算后交给模型的名字：相同的只有先出现的进工具集。 */
    readonly providerName: string;
    readonly effect: AgentToolDeclaration["effect"];
    /** 贡献它的插件 id。 */
    readonly plugin: string;
    /** 装到所有 Profile 的工具集里（输出 4）。 */
    readonly defaultForAll?: true;
}

export type CreateUserProfileResult = {readonly ok: true; readonly key: string; readonly address: string} | {readonly ok: false; readonly code: "invalid-name" | "exists"};
export type DeleteUserProfileResult = {readonly ok: true} | {readonly ok: false; readonly code: "not-found"};

/** 设置页管 Profile 用的（profile-settings.md）：只给同插件的远程实现，不进 `agentKey`。 */
export interface ProfileAdmin {
    toolCatalog(): readonly ToolCatalogEntry[];
    /** 骨架里的文字由调用方按界面语言给；交回时目录里已经有它。 */
    createUser(name: string, texts: {readonly description: string; readonly system: string}): Promise<CreateUserProfileResult>;
    deleteUser(key: string): Promise<DeleteUserProfileResult>;
    /** 目录变了（contributions.md 输出 16）；交回取消订阅。 */
    onCatalogChanged(listener: () => void): () => void;
}

export type CreateResult = {readonly ok: true; readonly value: SessionApi} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

/**
 * 插件经 `agentKey` 建会话的选项（sessions.md 输出 23）：`owner` 只给 `id`，`plugin` 由门面按调用方盖章，所以一个插件建不出归属别的
 * 插件的会话。
 */
export type AgentCreateOptions = Omit<CreateSessionOptions, "owner"> & {readonly owner?: {readonly id: string}};

/** `hold` 的结果（sessions.md 输出 24）：失败时是打开会话的码，或服务正在停止的 `unavailable`。 */
export type HoldResult = {readonly ok: true; readonly value: SessionHold} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

/** 发起一次任务（sessions.md 输出 10、11）。`taskId` 是调用方生成的 UUID：重发同一个得到同一个结果。 */
export interface StartTaskOptions {
    readonly taskId: string;
    readonly profile: string;
    readonly initial?: JsonValue;
    readonly input: UserInput;
    readonly project?: string;
    readonly background?: boolean;
}

export type StartTaskResult = {readonly ok: true; readonly sessionId: string; readonly runId: string} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

/** `taskId` 的格式：UUID（小写或大写都行）。 */
export const TASK_ID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
/** 任务的会话 id：内核自己生成的会话 id 不带这个前缀，普通会话不会撞上。 */
export const taskSessionId = (taskId: string): string => `task-${taskId.toLowerCase()}`;

/**
 * 插件经 `agentKey` 取视图时的身份（sessions.md 输出 21）：缺省是调用方插件的宿主身份（`source.plugin` 由门面按调用方填），
 * `source` 给出给人与模型看的来源；`asUser` 时代替用户发话（开发者 2026-11-18 允许）。冒充不了别的插件或会话。
 */
export interface SessionViewOptions {
    readonly asUser?: boolean;
    readonly source?: {readonly label: string; readonly ref?: string; readonly at?: number};
}

/** 别的插件经 `agentKey` 拿到的门面：按调用方生成，视图的发出者见 `SessionViewOptions`。 */
export interface AgentService {
    /** 建会话；交回的是视图（sessions.md 输出 6）。`owner` 见 `AgentCreateOptions`。 */
    create(options: AgentCreateOptions, view?: SessionViewOptions): Promise<CreateResult>;
    /** 某个会话的视图：本身不持引用，每次调用时打开。 */
    session(id: string, view?: SessionViewOptions): SessionApi;
    /** 打开会话并持有一份引用，持有期间不空闲关闭（sessions.md 输出 24）。调用方停止时它的持有一并放掉。 */
    hold(sessionId: string): Promise<HoldResult>;
    /** 只读会话头，不打开会话（sessions.md 输出 28）。 */
    header(sessionId: string): Promise<StorageResult<SessionHeader>>;
    /** 缺省不列归档的与后台的（sessions.md 输出 1），不列有归属的会话与它们的后代（输出 25）。 */
    list(filter?: {readonly project?: string; readonly archived?: boolean; readonly background?: boolean}): Promise<StorageResult<readonly SessionIndexEntry[]>>;
    profiles(): readonly ProfileEntry[];
    /** 打开着、正在运行的会话。 */
    running(): readonly string[];
    /**
     * 发起任务：建会话（已有就核对参数）、受理输入并开始运行，不等运行结束；`result` 在运行结束时完成，期间持有会话。
     * 参数与已有的任务不一致时 `task-conflict`。
     */
    startTask(options: StartTaskOptions, view?: SessionViewOptions): Promise<StartTaskResult & {readonly result?: Promise<RunResult>}>;
}

/** `nbook.agent` 自己用的服务：视图按给定的发出者（缺省用户），只在插件内部与远程实现里用，不进 `agentKey`。 */
export interface AgentRuntimeService {
    create(options: CreateSessionOptions, issuer?: Issuer): Promise<CreateResult>;
    session(id: string, issuer?: Issuer): SessionApi;
    hold: AgentService["hold"];
    header: AgentService["header"];
    list: AgentService["list"];
    profiles: AgentService["profiles"];
    running: AgentService["running"];
    startTask(options: StartTaskOptions, issuer?: Issuer): Promise<StartTaskResult & {readonly result?: Promise<RunResult>}>;
}

export const agentKey: ServiceKey<AgentService> = defineServiceKey<AgentService>("nbook.agent/agent");

/**
 * 有归属的会话的归属插件（agent/conversation.md 输出 53）：贡献点 `agent.sessionOwners`，只收浏览器入口的贡献，贡献 id 以贡献方插件 id
 * 开头，每个插件至多一条（第二条 `nbook.agent` 不接、记诊断）。声明是空对象，实现是 `SessionOwnerProvider`：消息视图的 bot 一页列它的
 * 联系人，打开有归属的会话时顶栏写它给的身份。会话头的 `owner.plugin` 由 `nbook.agent` 按贡献句柄对上，联系人不自带插件 id，第三方插件
 * 冒不了别人的联系人。
 */
export const SESSION_OWNERS_POINT = "agent.sessionOwners";

/** 一个联系人（bot）。 */
export interface OwnerContact {
    /** 会话头 `owner.id`。 */
    readonly id: string;
    readonly name: string;
    readonly avatar?: string;
    /** 未读数；还没数完为 null。 */
    readonly unread: number | null;
    /** “看到”的位置（主对话日志的 seq）；未读还没数完时为 null。聊天区据此定这次的未读线（agent/conversation.md 输出 55）。 */
    readonly seenSeq: number | null;
    /** 最后一条消息的摘要与时间；没有为 null。 */
    readonly last: {readonly text: string; readonly at: number} | null;
    /** 主对话的会话 id；还没建为 null。 */
    readonly sessionId: string | null;
}

/** 联系人列表读到没有。 */
export type OwnerContactsState = {readonly kind: "loading"} | {readonly kind: "ready"} | {readonly kind: "failed"; readonly code: string};

/**
 * 归属插件的实现。`contacts`、`state` 是响应式的值（浏览器一侧给 Vue 的 ref；共用合同不带 Vue 类型，写成只读的 `value`），消息视图与
 * 视图的计数在计算里读它们。
 */
export interface SessionOwnerProvider {
    readonly contacts: {readonly value: readonly OwnerContact[]};
    readonly state: {readonly value: OwnerContactsState};
    /** 重读联系人（读不到时的“重试”）。 */
    reload(): void;
    /** 取这个联系人的主对话（建或持有），交回会话 id。 */
    open(id: string): Promise<{readonly ok: true; readonly sessionId: string} | {readonly ok: false; readonly code: string}>;
    /** 看到了 `seq`（聊天区已经应用到的日志 seq）。 */
    seen(id: string, seq: number): void;
}
export const sessionOwnersPoint: ContributionPointDefinition<Record<string, never>> = {
    id: SESSION_OWNERS_POINT,
    implementation: "required",
    idPrefix: "plugin",
    validate: (descriptor) => (descriptor.location === "browser" ? null : `${SESSION_OWNERS_POINT} only accepts contributions from browser entries`),
};

/**
 * 表情包页改包名时问 Agent：哪些 Profile 明确选了这个表情包（声明的白名单写了它的 id，或用户在 Profile 设置里加了它），改名之后它们要重新
 * 勾选（docs/specs/agent/stickers.md 输出 33）。`nbook.agent` 的浏览器入口提供；表情包插件为设置页另开一个入口、对它可选依赖：服务依赖按
 * 入口算，这样不会与表情包的另一个入口提供给 Markdown 的 `stickerResolverKey` 成环。交回显示名；查不到（Profile 目录取不到）为 null。
 */
export interface StickerAllowlistUsage {
    profilesUsing(packId: string): Promise<readonly string[] | null>;
}
export const stickerAllowlistUsageKey: ServiceKey<StickerAllowlistUsage> = defineServiceKey<StickerAllowlistUsage>("nbook.agent/sticker-allowlist-usage");
