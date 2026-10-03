import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {appLogger} from "nbook/server/app-logs/logger";
import {
    OFFICIAL_SITE_TIMEOUT_MS,
    officialSiteFetch,
    officialSiteResponse,
} from "nbook/server/passport/official-site-transport";
import {OFFICIAL_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";

describe("official site transport", () => {
    beforeEach(() => {
        vi.spyOn(appLogger, "warn").mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("固定官网 origin 并为控制面请求设置 10 秒超时", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ok: true});
        vi.stubGlobal("$fetch", fetchMock);

        await officialSiteFetch("backup.list", "/api/v1/backups", {
            headers: {authorization: "Bearer hidden"},
        });

        expect(fetchMock).toHaveBeenCalledWith(`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/backups`, expect.objectContaining({
            timeout: OFFICIAL_SITE_TIMEOUT_MS,
            headers: {authorization: "Bearer hidden"},
        }));
    });

    it("大文件上传可关闭整请求超时", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ok: true});
        vi.stubGlobal("$fetch", fetchMock);

        await officialSiteFetch("backup.upload", "/api/v1/backups", {method: "POST"}, null);

        expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("timeout");
    });

    it.each(["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED"])("把 %s 转为稳定的 502 unreachable", async (code) => {
        const cause = Object.assign(new Error("network failed token=hidden"), {code});
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), {cause})));

        await expect(officialSiteFetch("passport.device.create", "/api/v1/passport/device/code"))
            .rejects.toMatchObject({
                statusCode: 502,
                data: {error: "passport_site_unreachable"},
            });
        expect(appLogger.warn).toHaveBeenCalledWith(
            "passport.officialSite.requestFailed",
            expect.objectContaining({
                operation: "passport.device.create",
                endpoint: "/api/v1/passport/device/code",
                failure: "network",
                causeCode: code,
            }),
            "NeuroBook 官方站请求失败",
        );
        expect(JSON.stringify(vi.mocked(appLogger.warn).mock.calls)).not.toContain("hidden");
    });

    it("把超时转为稳定的 502 unreachable", async () => {
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), {name: "TimeoutError"})));

        await expect(officialSiteFetch("passport.token.refresh", "/api/v1/passport/token"))
            .rejects.toMatchObject({statusCode: 502, data: {error: "passport_site_unreachable"}});
        expect(appLogger.warn).toHaveBeenCalledWith(
            "passport.officialSite.requestFailed",
            expect.objectContaining({failure: "timeout"}),
            expect.any(String),
        );
    });

    it("把官方站 5xx 转为稳定的 502 unavailable", async () => {
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(Object.assign(new Error("upstream"), {
            response: {status: 503},
        })));

        await expect(officialSiteFetch("backup.list", "/api/v1/backups"))
            .rejects.toMatchObject({statusCode: 502, data: {error: "passport_site_unavailable"}});
    });

    it("保留 OAuth 与配额等有响应 4xx 原始错误", async () => {
        const upstreamError = Object.assign(new Error("authorization pending"), {
            response: {status: 400},
            data: {data: {error: "authorization_pending"}},
        });
        vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(upstreamError));

        await expect(officialSiteFetch("passport.token.exchange", "/api/v1/passport/token"))
            .rejects.toBe(upstreamError);
        expect(appLogger.warn).not.toHaveBeenCalled();
    });

    it("流式下载只在取得响应头前应用超时", async () => {
        const waitingFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {once: true});
        }));

        await expect(officialSiteResponse(
            "backup.download",
            "/api/v1/backups/1/download",
            {},
            waitingFetch,
            5,
        )).rejects.toMatchObject({statusCode: 502, data: {error: "passport_site_unreachable"}});
        expect(appLogger.warn).toHaveBeenCalledWith(
            "passport.officialSite.requestFailed",
            expect.objectContaining({failure: "timeout"}),
            expect.any(String),
        );
    });

    it("拒绝绝对 URL、query 和非 API endpoint", async () => {
        vi.stubGlobal("$fetch", vi.fn());

        await expect(officialSiteFetch("backup.list", "https://evil.example/api/v1/backups")).rejects.toThrow("endpoint 非法");
        await expect(officialSiteFetch("backup.list", "/api/v1/backups?token=hidden")).rejects.toThrow("endpoint 非法");
        expect(appLogger.warn).not.toHaveBeenCalled();
    });
});
