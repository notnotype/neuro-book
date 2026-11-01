/**
 * `nbook.agent` 交给同进程服务端插件的服务（docs/specs/agent/sessions.md“输入与前置条件”）。远程合同在第 4 片加。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {CreateSessionOptions, Issuer, SessionApi, SessionIndexEntry, StorageResult} from "@notnotype/nb-harness/kernel/contracts";

export type ProfileStatus = "ok" | "unavailable" | "error";

/** Profile 目录的一项（contributions.md 输出 7）。 */
export interface ProfileEntry {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    /** 贡献它的插件 id，或 `user`。 */
    readonly source: string;
    readonly status: ProfileStatus;
    /** 不可用或有错误时的原因：缺的必需工具、打包或求值的错误。 */
    readonly reason?: string;
}

export type CreateResult = {readonly ok: true; readonly value: SessionApi} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

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
}

export const agentKey: ServiceKey<AgentService> = defineServiceKey<AgentService>("nbook.agent/agent");
