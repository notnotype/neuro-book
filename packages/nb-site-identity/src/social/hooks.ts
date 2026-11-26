/**
 * 社交流程里库调到的数据库钩子（w00037 t08 计划 3.10 的 `hooks.ts`；合进 `auth.ts` 的 `databaseHooks`）：注册意图的建用户前、
 * 建账号前钩子与建会话前的判断，关联意图的建账号前钩子，改账号前钩子与改账号列的钩子。
 *
 * 社交注册（`site.accounts` 输出 13、14）的先后，库 1.7.27 的 `handleOAuthUserInfo`（升级清单“社交注册的先后”几行）：库先按
 * 上游身份找已有的 `account` 行，找到就登录那个账号、不建（建会话前的判断拒成 `identity_taken`，计划第 10 节第 5 条）；再按邮箱找
 * 账号，找到就是撞号（库回 `account_not_linked`，回调换成 `email_taken`）；都没有时在库自己开的一个事务里先建用户、再建账号，
 * 两个钩子在那个事务里被调到，经 `joinLibTransaction` 加入它：扣码、建账号、补充资料、同意记录、上游名字一起提交或回滚
 * （输出 2 的原子性）。会话在事务提交之后才建。
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
import {claimRegistration, writeRegistrationRecords} from "../register";
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

/** 库调 `createUser` 时的数据里本钩子要的（库 1.7.27 的 `handleOAuthUserInfo`：邮箱已转小写）。 */
interface UserCreate {
    readonly email: string;
}

/**
 * 库在社交回调里建会话之前（`auth.ts` 的建会话前钩子调它）：注册意图下库没有建出账号、却要给某个账号建会话，就是这个上游身份已
 * 关联了账号、库直接登录了它（输出 13 末两句）。这时不建会话、不扣码（码只在建用户前钩子里扣，这次没调到），跳回带
 * `identity_taken`（计划第 10 节第 5 条选 b）。通过时记下建会话的账号，登录成功后回调据此写最近登录时间。
 */
export function admitSocialSession(frame: SocialFrame, userId: number): void {
    if (frame.flow.intent === "register" && frame.registeredUserId !== userId) reject(frame, "identity_taken");
    frame.sessionUserId = userId;
}

export function socialDatabaseHooks(options: SocialHooksOptions) {
    const {conn, clock} = options;

    /**
     * 注册意图、库在它的事务里建账号：写补充资料与同意记录，认下上游名字（`upstream-name.ts`），在同一个加入的写里。上游名字也经
     * `claimUpstreamName`：与并发的关联争同一张表，那边已认下这个身份时回 `identity_taken`，抛出让整个注册回滚，不建号、不扣码
     * （omp 设计审查第 9 条；`site.accounts` 验收 14）。
     */
    const registerAccount = async (frame: SocialFrame, account: AccountCreate): Promise<void> => {
        if (frame.flow.intent !== "register") throw new Error(`the library created an account for a social ${frame.flow.intent} inside its transaction`);
        const registration = frame.flow.payload.register;
        const codes = frame.claimedCodes;
        const upstream = frame.upstream;
        if (registration === undefined || codes === undefined || upstream === undefined) throw new Error("the library created a social account without going through the user hook");
        const userId = Number(account.userId);
        const provider = account.providerId as SocialProvider;
        if (provider !== frame.flow.provider) throw new Error("the library registered a different upstream than the flow started");
        const nowMs = clock.now();
        const failure = await conn.joinLibTransaction(() =>
            conn.write((tx) => {
                writeRegistrationRecords(tx, userId, codes, registration.termsVersion, nowMs);
                return claimUpstreamName(tx, {userId, provider, upstreamAccountId: account.accountId, name: upstream.name, nowMs});
            }),
        );
        if (failure !== null) reject(frame, failure);
        frame.registeredUserId = userId;
    };

    return {
        user: {
            create: {
                // 只有注册意图建用户：登录意图下库因 `disableImplicitSignUp` 不建（`providers.ts`），走到这里是兜底。邮箱要上游标明验证过
                // （输出 13；没给邮箱的库先以 `email_not_found` 拒了）。然后在库的事务里扣码、复核占用；回冲突时这一次写已提交到库的事务
                // 里，抛出让库的事务整个回滚，扣掉的次数一起撤销。改写库要插入的行：用户名、显示名照发起时的，邮箱不算验证过，没有
                // 头像（与密码注册建出的账号一样；上游的头像地址不一定合资料的字段规则），时间用模块时钟。
                before: async (user: UserCreate) => {
                    const frame = currentFrame();
                    if (frame === undefined) throw new Error("the library created a user outside a social callback");
                    if (frame.flow.intent !== "register") reject(frame, "social_not_registered");
                    const registration = frame.flow.payload.register;
                    if (registration === undefined) throw new Error("a social registration flow carries no registration");
                    if (frame.upstream?.emailVerified !== true) reject(frame, "social_email_missing");
                    const nowMs = clock.now();
                    const claimed = await conn.joinLibTransaction(() => conn.write((tx) => claimRegistration(tx, registration, user.email, nowMs)));
                    if (typeof claimed === "string") reject(frame, claimed);
                    frame.claimedCodes = claimed;
                    return {
                        data: {
                            username: registration.username,
                            displayUsername: registration.rawUsername,
                            name: registration.displayName,
                            emailVerified: false,
                            image: null,
                            role: "user",
                            createdAt: new Date(nowMs),
                            updatedAt: new Date(nowMs),
                        },
                    };
                },
            },
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
                // 走哪条按库是不是在事务里调到的判（`inLibraryTransaction`），不按意图猜：在事务里的是注册（`registerAccount`）。
                before: async (account: AccountCreate) => {
                    const frame = currentFrame();
                    // 不是社交回调却走到库的建账号：有别的路径调了库，本模块没有这样的路径。
                    if (frame === undefined) throw new Error("the library created an account outside a social callback");
                    if (await inLibraryTransaction()) {
                        await registerAccount(frame, account);
                        return {data: NO_UPSTREAM_TOKENS};
                    }
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
