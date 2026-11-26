/**
 * 社交流程（w00037 t08 计划 3.10 的 `flow.ts`；`site.accounts` 时序一节：发起起 10 分钟内有效、只能用一次）。
 *
 * 一次流程从发起（`start.ts`）写一行 `identity_social_flow` 起，到回调（`callback.ts`）认领那一行止。行按库给的 `state` 认：
 * 库的 state 只认浏览器（state Cookie）与库自己的记录，认不出“这次是登录、注册还是关联”“注册带了什么”，这些在本表的行里。
 *
 * 帧（`SocialFrame`）是一次回调在调库期间的上下文：回调认领了流程之后，在帧里调 `auth.handler`，库在处理里调到的钩子
 * （`hooks.ts`）与上游的取用户信息（`providers.ts`）从帧里读意图、记下自己判出的失败与上游给的东西。钩子只信帧，不信请求：
 * 库会把钩子抛出的错误换成自己的码，或把上游写进回调地址的 `error` 原样转出（计划 3.10、omp 设计审查第 9b 条）。
 */

import {AsyncLocalStorage} from "node:async_hooks";

import type {SocialErrorCode, SocialIntent, SocialProvider} from "@notnotype/nb-site-identity-contract";

import type {IdentityTx} from "../db/connection";
import {libDate} from "../db/library-rows";
import type {ClaimedCodes, Registrant} from "../register";

/** 发起起这么久之内的回调有效（`site.accounts` 时序一节）。库的 state 行与 state Cookie 的寿命也是 10 分钟（`auth.ts`）。 */
export const SOCIAL_FLOW_MS = 600_000;

/**
 * 发起时交给库的三个回调地址的路径（站点地址的 origin 加它）：库处理完回调后跳到其中之一，`callback.ts` 只按它们判结果，再换成
 * `site.accounts` 输出 23 的落点。浏览器到不了这三处：库的跳转都由 `callback.ts` 改写，不原样发出。
 * `newUser` 是库这次建了账号时去的（注册意图），与 `ok` 分得开（问 11）。
 */
export const SOCIAL_LIBRARY_TARGETS = {ok: "/__social_ok", newUser: "/__social_new", error: "/__social_error"} as const;

/** 社交注册发起时校验过的内容（`start.ts`），回调里的注册钩子按它建账号（`hooks.ts`）。 */
export interface SocialRegistration extends Registrant {
    /** 发起时同意的条款版本：同意记录写它，不写回调时的当前版本。 */
    readonly termsVersion: string;
}

/** 存进流程行的、发起时就定下的内容。不含密码（`0003_social.sql`）。 */
export interface FlowPayload {
    /** 登录、注册带了合格的续接令牌时，成功后去的站内地址（`site.accounts` 输出 23）。 */
    readonly continueUrl?: string;
    /** 注册意图才有。 */
    readonly register?: SocialRegistration;
}

/** 认领到的一行流程。 */
export interface ClaimedFlow {
    readonly flowId: number;
    readonly intent: SocialIntent;
    readonly provider: SocialProvider;
    readonly payload: FlowPayload;
    /** 关联意图发起时的会话；别的意图为 null。 */
    readonly sessionId: number | null;
}

/** 上游这次给的、本站要记下的：上游账号的名字（`site.accounts` 术语“上游账号的名字”）与上游说邮箱是否验证过。 */
export interface UpstreamFacts {
    readonly name: string;
    readonly emailVerified: boolean;
}

/** 一次回调调库期间的上下文。字段除 `flow` 外都由库调到的回调写入。 */
export interface SocialFrame {
    readonly flow: ClaimedFlow;
    /** 钩子判出的自家失败码；回调的结论以它为先（`callback.ts` 的 `mapSocialError`）。 */
    ownFailure?: SocialErrorCode;
    /** 上游的取用户信息记下的（`providers.ts`）。 */
    upstream?: UpstreamFacts;
    /** 库这次建会话的账号（`auth.ts` 的建会话前钩子记下）：登录成功后据此写最近登录时间。 */
    sessionUserId?: number;
    /** 注册意图：建用户前钩子扣到的码，建账号前钩子写补充资料时用。 */
    claimedCodes?: ClaimedCodes;
    /** 注册意图：库这次建出的账号（建账号前钩子记下）。建会话前钩子据此认出库没建账号、登录了已关联的旧账号。 */
    registeredUserId?: number;
}

const frames = new AsyncLocalStorage<SocialFrame>();

/** 在帧里执行 `fn`：`fn` 里（含它等的库的处理）调到的 `currentFrame()` 都拿到这一个帧。 */
export function runInFrame<T>(frame: SocialFrame, fn: () => Promise<T>): Promise<T> {
    return frames.run(frame, fn);
}

/** 当前的帧；不在社交回调的处理里时为 undefined。 */
export function currentFrame(): SocialFrame | undefined {
    return frames.getStore();
}

export interface NewFlow {
    readonly state: string;
    readonly intent: SocialIntent;
    readonly provider: SocialProvider;
    readonly payload: FlowPayload;
    readonly sessionId: number | null;
    readonly nowMs: number;
}

export function createFlow(tx: IdentityTx, flow: NewFlow): void {
    tx.query(`INSERT INTO identity_social_flow (state, intent, provider, payload, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        flow.state,
        flow.intent,
        flow.provider,
        JSON.stringify(flow.payload),
        flow.sessionId,
        libDate(flow.nowMs),
    );
}

interface FlowRow {
    readonly id: number;
    readonly intent: SocialIntent;
    readonly provider: SocialProvider;
    readonly payload: string;
    readonly session_id: number | null;
}

/**
 * 认领一行流程：没被用过、没过 10 分钟（模块时钟）的才认领得到，并当场标成用过。是一条带条件的 `UPDATE … RETURNING`：同一个
 * state 的回调并发到达时，写事务排在同一条队列里，只有第一个改得到这一行（问 7 实测）；之后的与重放的都认领不到。
 * 上游（`provider`）对不上的也认领不到：回调地址的上游段是请求方写的。
 */
export function claimFlow(tx: IdentityTx, state: string, provider: SocialProvider, nowMs: number): ClaimedFlow | null {
    const row = tx
        .query<FlowRow, [string, string, string, string]>(
            `UPDATE identity_social_flow SET used_at = ? WHERE state = ? AND provider = ? AND used_at IS NULL AND created_at > ? RETURNING id, intent, provider, payload, session_id`,
        )
        .get(libDate(nowMs), state, provider, libDate(nowMs - SOCIAL_FLOW_MS));
    if (row === null) return null;
    return {flowId: row.id, intent: row.intent, provider: row.provider, payload: JSON.parse(row.payload) as FlowPayload, sessionId: row.session_id};
}

/** 认领不到时，落点按这个 state 原来的意图选（`site.accounts` 输出 23）；查不到这个 state 时为 null，调用方按登录处理。 */
export function intentOfState(tx: IdentityTx, state: string): SocialIntent | null {
    return tx.query<{intent: SocialIntent}, [string]>(`SELECT intent FROM identity_social_flow WHERE state = ?`).get(state)?.intent ?? null;
}

/**
 * 关联意图发起时的会话还算数时，回它的账号 id，否则为 null：会话行还在、按模块时钟没到期、账号没被封禁（`site.accounts` 输出 15
 * 末句）。回调交库之前（`callback.ts`）与关联钩子写入之前（`hooks.ts`，omp 设计审查第 1 条）各判一次；两次之间隔着对上游的网络
 * 往返，会话可能在其间被结束。封禁时会话已删光，账号一项是兜底（与 `Sessions.read` 同理）。
 */
export function liveFlowSessionUser(tx: IdentityTx, sessionId: number, nowMs: number): number | null {
    const row = tx
        .query<{userId: number}, [number, string]>(`SELECT s."userId" AS userId FROM "session" s JOIN "user" u ON u."id" = s."userId" WHERE s."id" = ? AND s."expiresAt" > ? AND u."banned" IS NOT 1`)
        .get(sessionId, libDate(nowMs));
    return row?.userId ?? null;
}

/** 清理任务（计划 3.11）：删发起超过 10 分钟的流程，用没用过都删。回删掉的行数。 */
export function purgeExpiredFlows(tx: IdentityTx, nowMs: number): number {
    return tx.query(`DELETE FROM identity_social_flow WHERE created_at <= ?`).run(libDate(nowMs - SOCIAL_FLOW_MS)).changes;
}
