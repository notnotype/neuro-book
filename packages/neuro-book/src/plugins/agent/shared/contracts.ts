/**
 * `nbook.agent` 交给同进程服务端插件的服务（docs/specs/agent/sessions.md“输入与前置条件”）。远程合同在第 4 片加。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {CreateSessionOptions, Issuer, JsonValue, RunResult, SessionApi, SessionIndexEntry, StorageResult, UserInput} from "@notnotype/nb-harness/kernel/contracts";

export type ProfileStatus = "ok" | "unavailable" | "error";

/** Profile 目录的一项（contributions.md 输出 7）。 */
/** 主创：用户新建会话时默认用的 Profile（docs/specs/agent/builtin-profiles.md）。 */
export const MAIN_PROFILE = "nbook.agent.main";
/** 给前台会话生成标题和说明的 Profile；不给人选。 */
export const SESSION_TITLE_PROFILE = "nbook.agent.session-title";

export interface ProfileEntry {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    /** 贡献它的插件 id，或 `user`。 */
    readonly source: string;
    readonly status: ProfileStatus;
    /** 不可用或有错误时的原因：缺的必需工具、打包或求值的错误。 */
    readonly reason?: string;
    /** 不给人选（contributions.md 输出 7）。 */
    readonly hidden?: true;
}

export type CreateResult = {readonly ok: true; readonly value: SessionApi} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

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

export interface AgentService {
    /** 建会话；交回的是视图（sessions.md 输出 6）。 */
    create(options: CreateSessionOptions): Promise<CreateResult>;
    /** 某个会话的视图：本身不持引用，每次调用时打开；缺省以用户的身份。 */
    session(id: string, issuer?: Issuer): SessionApi;
    /** 缺省不列归档的与后台的（sessions.md 输出 1）。 */
    list(filter?: {readonly project?: string; readonly archived?: boolean; readonly background?: boolean}): Promise<StorageResult<readonly SessionIndexEntry[]>>;
    profiles(): readonly ProfileEntry[];
    /** 打开着、正在运行的会话。 */
    running(): readonly string[];
    /**
     * 发起任务：建会话（已有就核对参数）、受理输入并开始运行，不等运行结束；`result` 在运行结束时完成，期间持有会话。
     * 参数与已有的任务不一致时 `task-conflict`。
     */
    startTask(options: StartTaskOptions): Promise<StartTaskResult & {readonly result?: Promise<RunResult>}>;
}

export const agentKey: ServiceKey<AgentService> = defineServiceKey<AgentService>("nbook.agent/agent");
