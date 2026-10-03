import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {consola} from "consola";
import type {PassportCredential} from "nbook/server/generated/prisma/client";
import {PassportClientService} from "nbook/server/passport/passport-client-service";
import {OFFICIAL_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";

const prismaMock = vi.hoisted(() => ({
    passportCredential: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
    },
}));

const loggerMock = vi.hoisted(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("nbook/server/database/prisma", () => ({
    prisma: prismaMock,
}));

vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: loggerMock,
}));

describe("PassportClientService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("设备码关联固定请求 NeuroBook 官网", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            deviceCode: "device-code",
            userCode: "ABCD-EFGH",
            verificationUri: `${OFFICIAL_PASSPORT_SITE_URL}/device`,
            verificationUriComplete: `${OFFICIAL_PASSPORT_SITE_URL}/device?code=ABCD-EFGH`,
            expiresIn: 600,
            interval: 5,
        });
        vi.stubGlobal("$fetch", fetchMock);

        const result = await new PassportClientService().startLink();

        expect(fetchMock).toHaveBeenCalledWith(`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/passport/device/code`, expect.objectContaining({method: "POST"}));
        expect(result.userCode).toBe("ABCD-EFGH");
    });

    it("设备码关联网络失败返回稳定的 502", async () => {
        const cause = Object.assign(new Error("dns failed"), {code: "ENOTFOUND"});
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), {cause})));

        await expect(new PassportClientService().startLink()).rejects.toMatchObject({
            statusCode: 502,
            data: {error: "passport_site_unreachable"},
        });
    });

    it("状态 DTO 不暴露站点地址", async () => {
        prismaMock.passportCredential.findUnique.mockResolvedValue(credential());

        const status = await new PassportClientService().getStatus();

        expect(status).toMatchObject({
            linked: true,
            account: {id: 7, username: "writer", displayName: "写作者"},
        });
        expect(status).not.toHaveProperty("siteBaseUrl");
    });

    it("刷新令牌固定请求官网", async () => {
        const officialCredential = credential();
        prismaMock.passportCredential.findUnique.mockResolvedValue(officialCredential);
        prismaMock.passportCredential.upsert.mockResolvedValue(credential());
        const fetchMock = vi.fn().mockResolvedValue(tokenGrant());
        vi.stubGlobal("$fetch", fetchMock);

        const access = await new PassportClientService().getAccessToken();

        expect(fetchMock).toHaveBeenCalledWith(`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/passport/token`, expect.objectContaining({
            body: {grantType: "refresh_token", refreshToken: officialCredential.refreshToken},
        }));
        expect(access).toBe("access-new");
        const upsertInput = prismaMock.passportCredential.upsert.mock.calls[0]?.[0];
        expect(upsertInput.create).not.toHaveProperty("siteBaseUrl");
        expect(upsertInput.update).not.toHaveProperty("siteBaseUrl");
    });

    it("并发刷新共享同一次 token 轮换", async () => {
        prismaMock.passportCredential.findUnique.mockResolvedValue(credential());
        prismaMock.passportCredential.upsert.mockResolvedValue(credential());
        const fetchMock = vi.fn().mockResolvedValue(tokenGrant());
        vi.stubGlobal("$fetch", fetchMock);
        const service = new PassportClientService();

        const tokens = await Promise.all([service.getAccessToken(), service.getAccessToken()]);

        expect(tokens).toEqual(["access-new", "access-new"]);
        expect(prismaMock.passportCredential.findUnique).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(prismaMock.passportCredential.upsert).toHaveBeenCalledTimes(1);
    });

    it("取消官网关联固定请求官网吊销端点", async () => {
        const officialCredential = credential();
        prismaMock.passportCredential.findUnique.mockResolvedValue(officialCredential);
        prismaMock.passportCredential.delete.mockResolvedValue(officialCredential);
        const fetchMock = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("$fetch", fetchMock);

        await new PassportClientService().unlink();

        expect(fetchMock).toHaveBeenCalledWith(`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/passport/revoke`, expect.objectContaining({
            body: {refreshToken: officialCredential.refreshToken},
        }));
    });

    it("官网不可达时仍允许本地取消关联", async () => {
        const officialCredential = credential();
        prismaMock.passportCredential.findUnique.mockResolvedValue(officialCredential);
        prismaMock.passportCredential.delete.mockResolvedValue(officialCredential);
        const cause = Object.assign(new Error("connection refused"), {code: "ECONNREFUSED"});
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), {cause})));

        await expect(new PassportClientService().unlink()).resolves.toBeUndefined();
        expect(prismaMock.passportCredential.delete).toHaveBeenCalledWith({where: {id: officialCredential.id}});
    });

    it("首次关联落库失败后吊销新授权并终止会话", async () => {
        prismaMock.passportCredential.upsert.mockRejectedValue(new Error("sqlite write failed"));
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(deviceGrant())
            .mockResolvedValueOnce(tokenGrant())
            .mockResolvedValueOnce(undefined);
        vi.stubGlobal("$fetch", fetchMock);
        const service = new PassportClientService();
        const session = await service.startLink();

        await expect(service.pollLink(session.linkSessionId)).resolves.toEqual({
            state: "failed",
            reason: "credential_persist_failed",
            remoteAuthorization: "revoked",
        });
        await expect(service.pollLink(session.linkSessionId)).rejects.toMatchObject({statusCode: 404});
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[2]?.[0]).toBe(`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/passport/revoke`);
    });

    it("补偿吊销失败不覆盖本地写入失败终态", async () => {
        prismaMock.passportCredential.upsert.mockRejectedValue(new Error("sqlite write failed"));
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(deviceGrant())
            .mockResolvedValueOnce(tokenGrant())
            .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), {
                cause: Object.assign(new Error("reset"), {code: "ECONNRESET"}),
            }));
        vi.stubGlobal("$fetch", fetchMock);
        const service = new PassportClientService();
        const session = await service.startLink();

        await expect(service.pollLink(session.linkSessionId)).resolves.toEqual({
            state: "failed",
            reason: "credential_persist_failed",
            remoteAuthorization: "unknown",
        });
        expect(loggerMock.warn).toHaveBeenCalledWith(
            "passport.authorization.compensatingRevokeFailed",
            expect.objectContaining({phase: "link.persist_failed", accountId: 7}),
            expect.any(String),
        );
    });

    it("已消费设备码返回 exchange_invalid 并终止会话", async () => {
        const invalidGrant = Object.assign(new Error("invalid grant"), {
            response: {status: 400},
            data: {data: {error: "invalid_grant"}},
        });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(deviceGrant())
            .mockRejectedValueOnce(invalidGrant);
        vi.stubGlobal("$fetch", fetchMock);
        const service = new PassportClientService();
        const session = await service.startLink();

        await expect(service.pollLink(session.linkSessionId)).resolves.toEqual({
            state: "failed",
            reason: "exchange_invalid",
        });
        await expect(service.pollLink(session.linkSessionId)).rejects.toMatchObject({statusCode: 404});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("refresh 落库失败后吊销新 token、删除旧凭据并阻止重放", async () => {
        const officialCredential = credential();
        prismaMock.passportCredential.findUnique.mockResolvedValue(officialCredential);
        prismaMock.passportCredential.upsert.mockRejectedValue(new Error("sqlite write failed"));
        prismaMock.passportCredential.delete.mockResolvedValue(officialCredential);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(tokenGrant())
            .mockResolvedValueOnce(undefined);
        vi.stubGlobal("$fetch", fetchMock);
        const service = new PassportClientService();

        await expect(service.getAccessToken()).rejects.toMatchObject({name: "PassportUnlinkedError"});
        await expect(service.getAccessToken()).rejects.toMatchObject({name: "PassportUnlinkedError"});

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(prismaMock.passportCredential.delete).toHaveBeenCalledWith({where: {id: officialCredential.id}});
        expect(await service.getStatus()).toEqual({linked: false, account: null, scopes: [], linkedAt: null});
        const logText = JSON.stringify(loggerMock.error.mock.calls);
        expect(logText).not.toContain("access-new");
        expect(logText).not.toContain("refresh-new");
        expect(logText).not.toContain("refresh-old");
    });
});

/** 官方站设备码 fixture。 */
function deviceGrant() {
    return {
        deviceCode: "device-code",
        userCode: "ABCD-EFGH",
        verificationUri: `${OFFICIAL_PASSPORT_SITE_URL}/device`,
        verificationUriComplete: `${OFFICIAL_PASSPORT_SITE_URL}/device?code=ABCD-EFGH`,
        expiresIn: 600,
        interval: 5,
    };
}

/** 构造默认槽位的官网凭据。 */
function credential(): PassportCredential {
    return {
        id: 1,
        slotId: "default",
        accountId: 7,
        accountUsername: "writer",
        accountDisplayName: "写作者",
        scopesJson: JSON.stringify(["backup:read", "backup:write"]),
        refreshToken: "refresh-old",
        linkedAt: new Date("2026-07-27T00:00:00.000Z"),
        updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    };
}

/** 官方站 token grant fixture。 */
function tokenGrant() {
    return {
        accessToken: "access-new",
        expiresIn: 3600,
        refreshToken: "refresh-new",
        scopes: ["backup:read", "backup:write"],
        account: {id: 7, username: "writer", displayName: "写作者"},
    };
}
