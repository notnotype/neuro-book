/**
 * 社交流程里库调到的数据库钩子（w00037 t08 计划 3.10 的 `hooks.ts`；合进 `auth.ts` 的 `databaseHooks`）。第 8 片有关联意图的建账号
 * 前钩子、改账号前钩子与改账号列的钩子；注册意图（`user.create.before`、建账号前钩子的注册分支）在第 9 片。
 *
 * 钩子从帧（`flow.ts`）读意图，判出的失败记进帧再抛 `APIError`：库会把钩子抛的错误换成自己的码或吞掉（问 4.1），回调只信帧里的
 * （`callback.ts` 的 `mapSocialError`）。关联路径上库不经 `redirectOnError`，钩子的 `APIError` 成了库回的 JSON 错误体（问 8）。
 *
 * 上游令牌一律不落库（计划 3.4）：站点只用上游认人，之后不调上游的接口。库没有“不存”的选项，建行与改行时这里把五列置空；
 * `updateAccountOnSignIn: false` 下登录已不改行，改行的置空是兜底。
 */

import {APIError} from "better-auth/api";

import type {SocialErrorCode, SocialProvider} from "@notnotype/nb-site-identity-contract";

import {inLibraryTransaction, type IdentityConnection} from "../db/connection";
import {currentFrame, liveFlowSessionUser, type SocialFrame} from "./flow";
import {claimUpstreamName} from "./upstream-name";

/** 库的 `account` 行里存上游令牌的五列，建行与改行时都置空。 */
const NO_UPSTREAM_TOKENS = {accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null} as const;

export interface SocialHooksOptions {
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
}

/** 记下自家的失败码并抛给库。`APIError` 的码与自家码相同，回调读到库回的码时也对得上（但只信帧）。 */
function reject(frame: SocialFrame, code: SocialErrorCode): never {
    frame.ownFailure = code;
    throw new APIError("BAD_REQUEST", {code, message: code});
}

/** 库调 `createAccount` 时的数据里本钩子要的几项（库 1.7.27 的 `linkOAuthAccount`：`userId` 与 `accountKey` 的两项）。 */
interface AccountCreate {
    readonly userId: string | number;
    readonly providerId: string;
    readonly accountId: string;
}

export function socialDatabaseHooks(options: SocialHooksOptions) {
    const {conn, clock} = options;
    return {
        user: {
            update: {
                // 站点不验证邮箱，`emailVerified` 恒为 false（`site.oauth-provider` 输出 7）。库在已关联的身份登录时，若上游说邮箱已验证、
                // 且与账号的相同，会把它改成 true（link-account.mjs 的 `handleOAuthUserInfo`，问 11 实测；升级清单“社交”）。用户信息端点
                // 另在挂载层恒写 false，两层都做。
                before: async (data: Readonly<Record<string, unknown>>) => ("emailVerified" in data ? {data: {...data, emailVerified: false}} : undefined),
            },
        },
        account: {
            create: {
                // 关联意图：库认出这个上游身份还没有 `account` 行，要建一行。先复核发起的会话（回调交库之前判过一次，之间隔着对上游的
                // 网络往返，会话可能已被结束：omp 设计审查第 1 条），再认下上游名字（`upstream-name.ts`），两样在同一个写事务里：
                // 结束会话的写事务要么排在它前面（这里看到会话没了），要么排在后面（关联已成，像是关联之后才登出）。
                // 关联不在库的事务里被调到（问 8 实测），也不能包进事务：库在这之前有对上游的网络往返，事务里不许等它。
                before: async (account: AccountCreate) => {
                    const frame = currentFrame();
                    // 不是社交回调却走到库的建账号：有别的路径调了库，本模块没有这样的路径。
                    if (frame === undefined) throw new Error("the library created an account outside a social callback");
                    if (await inLibraryTransaction()) throw new Error("social registration is not wired yet: the library created an account inside its transaction");
                    if (frame.flow.intent !== "link") throw new Error(`the library created an account for a social ${frame.flow.intent} outside its transaction`);
                    const upstream = frame.upstream;
                    if (upstream === undefined) throw new Error("the library linked an upstream identity without fetching its user info");
                    const sessionId = frame.flow.sessionId;
                    if (sessionId === null) throw new Error("a social link flow has no session");
                    const userId = Number(account.userId);
                    const provider = account.providerId as SocialProvider;
                    if (provider !== frame.flow.provider) throw new Error("the library linked a different upstream than the flow started");
                    const nowMs = clock.now();
                    const failure = await conn.write((tx) => {
                        if (liveFlowSessionUser(tx, sessionId, nowMs) !== userId) return "social_state_invalid" as const;
                        return claimUpstreamName(tx, {userId, provider, upstreamAccountId: account.accountId, name: upstream.name, nowMs});
                    });
                    if (failure !== null) reject(frame, failure);
                    return {data: NO_UPSTREAM_TOKENS};
                },
            },
            update: {
                // 同一个账号再关联它已有的同一个上游身份：库找到已有的 `account` 行，改那一行、不调建账号前钩子（问 11 实测，缺省落到
                // 成功地址；升级清单“社交”）。这里拒成 `identity_exists`（`site.accounts` 输出 15）。
                before: async () => {
                    const frame = currentFrame();
                    if (frame?.flow.intent === "link") reject(frame, "identity_exists");
                    return {data: NO_UPSTREAM_TOKENS};
                },
            },
        },
    };
}
