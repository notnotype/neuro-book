import {randomUUID} from "node:crypto";
import {hostname} from "node:os";
import {createError} from "h3";
import type {FetchError} from "ofetch";
import type {PassportCredential} from "nbook/server/generated/prisma/client";
import {appLogger} from "nbook/server/app-logs/logger";
import {prisma} from "nbook/server/database/prisma";
import {PassportUnlinkedError} from "nbook/server/passport/passport-errors";
import {officialSiteFetch} from "nbook/server/passport/official-site-transport";
import {DEFAULT_SLOT_ID, REQUESTED_SCOPES} from "nbook/shared/passport/passport-constants";
import type {PassportLinkPollDto, PassportLinkSessionDto, PassportStatusDto} from "nbook/shared/dto/passport.dto";

// Passport 客户端服务（Task 112 spec §11）：实例侧与官方站的全部通信收口在这里。
// 设备码流：deviceCode 只留在服务端内存会话，前端只见 userCode / 链接（spec §6.2）。
// 凭据：refresh token 存 App SQLite（按槽位）；access token 内存缓存即可。

/** 官方站设备码申请响应（wire 契约见 nb-workshop reference/passport/api-v1.md §6.2） */
type UpstreamDeviceCode = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
};

/** 官方站 token 端点成功响应（同 §6.4） */
type UpstreamTokenGrant = {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    scopes: string[];
    account: {id: number; username: string; displayName: string};
};

/** 进行中的关联会话（进程内存；重启丢失 = 用户重新发起，可接受） */
type LinkSession = {
    deviceCode: string;
    interval: number;
    expiresAt: number; // 毫秒时间戳
};

/**
 * 从官方站错误响应中取 OAuth 风格错误码（HTTP 400 + body.data.error，spec §6.4）。
 */
function upstreamErrorCode(error: unknown): string | undefined {
    const fetchError = error as FetchError<{data?: {error?: string}}>;
    return fetchError?.data?.data?.error;
}

export class PassportClientService {
    private linkSessions = new Map<string, LinkSession>();
    /** 内存 access token 缓存；expiresAt 为毫秒时间戳 */
    private accessTokenCache: {token: string; expiresAt: number} | null = null;
    /** 进行中的 refresh 请求：并发 getAccessToken 必须共享同一次轮换，否则旧 token 双花会触发官方站撤链 */
    private refreshInFlight: Promise<string> | null = null;
    /** refresh 提交失败后阻止本进程再次读取可能未删掉的旧凭据。 */
    private credentialBlocked = false;

    /**
     * 读取默认槽位的关联状态。
     */
    async getStatus(): Promise<PassportStatusDto> {
        if (this.credentialBlocked) {
            return this.toStatus(null);
        }
        const credential = await prisma.passportCredential.findUnique({where: {slotId: DEFAULT_SLOT_ID}});
        return this.toStatus(credential);
    }

    /**
     * 发起设备码流：向官方站申请设备码，deviceCode 留在服务端内存会话。
     */
    async startLink(): Promise<PassportLinkSessionDto> {
        const upstream = await officialSiteFetch<UpstreamDeviceCode>("passport.device.create", "/api/v1/passport/device/code", {
            method: "POST",
            body: {
                instanceName: `NeuroBook @ ${hostname()}`,
                scopes: [...REQUESTED_SCOPES],
            },
        });

        const linkSessionId = randomUUID();
        this.linkSessions.set(linkSessionId, {
            deviceCode: upstream.deviceCode,
            interval: upstream.interval,
            expiresAt: Date.now() + upstream.expiresIn * 1000,
        });
        return {
            linkSessionId,
            userCode: upstream.userCode,
            verificationUri: upstream.verificationUri,
            verificationUriComplete: upstream.verificationUriComplete,
            expiresIn: upstream.expiresIn,
            interval: upstream.interval,
        };
    }

    /**
     * 单次轮询：前端定时驱动，每调一次只对官方站发一次 device_code grant。
     * 成功时凭据先落库再清会话；slow_down 把放大后的间隔透传给前端。
     */
    async pollLink(linkSessionId: string): Promise<PassportLinkPollDto> {
        const session = this.linkSessions.get(linkSessionId);
        if (!session) {
            throw createError({statusCode: 404, message: "关联会话不存在或已失效，请重新发起关联"});
        }
        if (Date.now() > session.expiresAt) {
            this.linkSessions.delete(linkSessionId);
            return {state: "expired"};
        }

        try {
            const grant = await officialSiteFetch<UpstreamTokenGrant>("passport.token.exchange", "/api/v1/passport/token", {
                method: "POST",
                body: {grantType: "device_code", deviceCode: session.deviceCode},
            });
            let credential: PassportCredential;
            try {
                credential = await this.saveCredential(grant);
            } catch (error) {
                this.linkSessions.delete(linkSessionId);
                this.accessTokenCache = null;
                const remoteAuthorization = await this.revokeGrant(grant, "link.persist_failed");
                void appLogger.error("passport.link.credentialPersistFailed", {
                    phase: "credential_persist",
                    accountId: grant.account.id,
                    remoteAuthorization,
                }, error, "官网已批准，但本机 Passport 凭据写入失败");
                return {
                    state: "failed",
                    reason: "credential_persist_failed",
                    remoteAuthorization,
                };
            }
            this.linkSessions.delete(linkSessionId);
            this.credentialBlocked = false;
            this.accessTokenCache = {
                token: grant.accessToken,
                expiresAt: Date.now() + grant.expiresIn * 1000,
            };
            return {state: "linked", status: this.toStatus(credential)};
        } catch (error) {
            const code = upstreamErrorCode(error);
            if (code === "authorization_pending") {
                return {state: "pending", interval: session.interval};
            }
            if (code === "slow_down") {
                session.interval += 5;
                return {state: "pending", interval: session.interval};
            }
            if (code === "expired_token") {
                this.linkSessions.delete(linkSessionId);
                return {state: "expired"};
            }
            if (code === "access_denied") {
                this.linkSessions.delete(linkSessionId);
                return {state: "denied"};
            }
            if (code === "invalid_grant") {
                this.linkSessions.delete(linkSessionId);
                void appLogger.warn("passport.link.exchangeInvalid", {
                    phase: "token_exchange",
                }, "Passport 设备码已失效或已被消费");
                return {state: "failed", reason: "exchange_invalid"};
            }
            throw error;
        }
    }

    /**
     * 取消关联：先 best-effort 通知官方站吊销（网络失败不阻塞），再删本地凭据与缓存。
     */
    async unlink(): Promise<void> {
        const credential = await prisma.passportCredential.findUnique({where: {slotId: DEFAULT_SLOT_ID}});
        if (credential) {
            try {
                await officialSiteFetch("passport.authorization.revoke", "/api/v1/passport/revoke", {
                    method: "POST",
                    body: {refreshToken: credential.refreshToken},
                });
            } catch {
                // 官方站不可达也要允许本地解除关联；残留授权可在官方站面板吊销
            }
            await prisma.passportCredential.delete({where: {id: credential.id}}).catch(() => undefined);
        }
        this.accessTokenCache = null;
        this.refreshInFlight = null;
        this.credentialBlocked = true;
    }

    /**
     * 取可用 access token：缓存未到期直接用；否则用 refresh 轮换。
     * refresh 并发共享同一 in-flight 请求——两路并发各自轮换会让旧 token 双花，触发官方站整链撤销。
     * 凭据失效抛 PassportUnlinkedError，消费点必须转成「请重新关联」，不得静默重试。
     */
    async getAccessToken(): Promise<string> {
        if (this.credentialBlocked) {
            throw new PassportUnlinkedError();
        }
        const cache = this.accessTokenCache;
        if (cache && cache.expiresAt - 30_000 > Date.now()) {
            return cache.token;
        }
        if (this.refreshInFlight) {
            return await this.refreshInFlight;
        }
        this.refreshInFlight = this.refreshAccessToken();
        try {
            return await this.refreshInFlight;
        } finally {
            this.refreshInFlight = null;
        }
    }

    /**
     * 执行一次 refresh 轮换：新 refresh token 先落库，再更新内存缓存（spec §11 顺序要求）。
     */
    private async refreshAccessToken(): Promise<string> {
        const credential = await prisma.passportCredential.findUnique({where: {slotId: DEFAULT_SLOT_ID}});
        if (!credential) {
            throw new PassportUnlinkedError();
        }
        let grant: UpstreamTokenGrant;
        try {
            grant = await officialSiteFetch<UpstreamTokenGrant>("passport.token.refresh", "/api/v1/passport/token", {
                method: "POST",
                body: {grantType: "refresh_token", refreshToken: credential.refreshToken},
            });
        } catch (error) {
            if (upstreamErrorCode(error) === "invalid_grant") {
                // 授权已被吊销 / token 链失效：清凭据，退回未关联态
                await prisma.passportCredential.delete({where: {id: credential.id}}).catch(() => undefined);
                this.accessTokenCache = null;
                this.credentialBlocked = true;
                throw new PassportUnlinkedError();
            }
            throw error;
        }
        try {
            await this.saveCredential(grant);
        } catch (error) {
            this.accessTokenCache = null;
            this.credentialBlocked = true;
            const remoteAuthorization = await this.revokeGrant(grant, "refresh.persist_failed");
            let localCredential: "deleted" | "unknown" = "deleted";
            try {
                await prisma.passportCredential.delete({where: {id: credential.id}});
            } catch (deleteError) {
                localCredential = "unknown";
                void appLogger.warn("passport.refresh.localCredentialDeleteFailed", {
                    phase: "credential_cleanup",
                    accountId: credential.accountId,
                }, "Passport 旧凭据清理失败，已在当前进程阻止继续使用");
                void appLogger.debug("passport.refresh.localCredentialDeleteError", {
                    phase: "credential_cleanup",
                    accountId: credential.accountId,
                    error: deleteError,
                }, "Passport 旧凭据清理错误详情");
            }
            void appLogger.error("passport.refresh.credentialPersistFailed", {
                phase: "credential_persist",
                accountId: grant.account.id,
                remoteAuthorization,
                localCredential,
            }, error, "Passport refresh 凭据写入失败，已要求重新关联");
            throw new PassportUnlinkedError();
        }
        this.credentialBlocked = false;
        this.accessTokenCache = {
            token: grant.accessToken,
            expiresAt: Date.now() + grant.expiresIn * 1000,
        };
        return grant.accessToken;
    }

    /**
     * 把 grant 写入默认槽位（upsert：关联与轮换共用）。
     */
    private async saveCredential(grant: UpstreamTokenGrant): Promise<PassportCredential> {
        const data = {
            accountId: grant.account.id,
            accountUsername: grant.account.username,
            accountDisplayName: grant.account.displayName,
            scopesJson: JSON.stringify(grant.scopes),
            refreshToken: grant.refreshToken,
        };
        return await prisma.passportCredential.upsert({
            where: {slotId: DEFAULT_SLOT_ID},
            create: {slotId: DEFAULT_SLOT_ID, ...data},
            update: data,
        });
    }

    /**
     * 吊销尚未提交到本地的 grant；调用失败只返回 unknown，不覆盖原始提交错误。
     */
    private async revokeGrant(
        grant: UpstreamTokenGrant,
        phase: "link.persist_failed" | "refresh.persist_failed",
    ): Promise<"revoked" | "unknown"> {
        try {
            await officialSiteFetch("passport.authorization.revoke", "/api/v1/passport/revoke", {
                method: "POST",
                body: {refreshToken: grant.refreshToken},
            });
            return "revoked";
        } catch (error) {
            void appLogger.warn("passport.authorization.compensatingRevokeFailed", {
                phase,
                accountId: grant.account.id,
                error,
            }, "Passport 补偿吊销结果未知");
            return "unknown";
        }
    }

    /**
     * 凭据行 → 状态 DTO。
     */
    private toStatus(credential: PassportCredential | null): PassportStatusDto {
        if (!credential) {
            return {linked: false, account: null, scopes: [], linkedAt: null};
        }
        return {
            linked: true,
            account: {
                id: credential.accountId,
                username: credential.accountUsername,
                displayName: credential.accountDisplayName,
            },
            scopes: JSON.parse(credential.scopesJson) as string[],
            linkedAt: credential.linkedAt.toISOString(),
        };
    }
}

type GlobalPassportClient = {
    passportClientService?: PassportClientService;
};

const globalForPassport = globalThis as typeof globalThis & GlobalPassportClient;

/**
 * 进程级单例：内存会话与 token 缓存必须跨请求共享。
 */
export function usePassportClient(): PassportClientService {
    if (!globalForPassport.passportClientService) {
        globalForPassport.passportClientService = new PassportClientService();
    }
    return globalForPassport.passportClientService;
}
