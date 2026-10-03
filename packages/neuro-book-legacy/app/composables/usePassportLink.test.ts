import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createPassportLink,
    type PassportLinkTransport,
} from "nbook/app/composables/usePassportLink";
import type {
    PassportLinkPollDto,
    PassportLinkSessionDto,
    PassportStatusDto,
} from "nbook/shared/dto/passport.dto";

afterEach(() => {
    vi.useRealTimers();
});

describe("usePassportLink", () => {
    it("只在 pending 后按服务端新 interval 安排下一次轮询", async () => {
        vi.useFakeTimers();
        const transport = createTransport();
        vi.mocked(transport.poll)
            .mockResolvedValueOnce({state: "pending", interval: 7})
            .mockResolvedValueOnce({state: "denied"});
        const link = createPassportLink({transport, onLinked: vi.fn(), onStartError: vi.fn()});

        await link.start();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(transport.poll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(6_999);
        expect(transport.poll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(transport.poll).toHaveBeenCalledTimes(2);
        expect(link.phase.value).toBe("denied");
    });

    it("凭据提交失败进入终态并停止 timer", async () => {
        vi.useFakeTimers();
        const transport = createTransport();
        vi.mocked(transport.poll).mockResolvedValue({
            state: "failed",
            reason: "credential_persist_failed",
            remoteAuthorization: "unknown",
        });
        const link = createPassportLink({transport, onLinked: vi.fn(), onStartError: vi.fn()});

        await link.start();
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(transport.poll).toHaveBeenCalledOnce();
        expect(link.phase.value).toBe("failed");
        expect(link.failure.value).toMatchObject({reason: "credential_persist_failed"});
    });

    it("网络错误暂停自动请求并允许手动重新检查", async () => {
        vi.useFakeTimers();
        const transport = createTransport();
        vi.mocked(transport.poll)
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce({state: "linked", status: linkedStatus()});
        const onLinked = vi.fn();
        const link = createPassportLink({transport, onLinked, onStartError: vi.fn()});

        await link.start();
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.poll).toHaveBeenCalledOnce();
        expect(link.phase.value).toBe("retryable_error");

        await link.retry();
        expect(transport.poll).toHaveBeenCalledTimes(2);
        expect(onLinked).toHaveBeenCalledWith(linkedStatus());
        expect(link.session.value).toBeNull();
    });

    it("404 时先对账，本地已保存凭据则恢复为成功", async () => {
        vi.useFakeTimers();
        const transport = createTransport();
        vi.mocked(transport.poll).mockRejectedValue({statusCode: 404});
        vi.mocked(transport.status).mockResolvedValue(linkedStatus());
        const onLinked = vi.fn();
        const link = createPassportLink({transport, onLinked, onStartError: vi.fn()});

        await link.start();
        await vi.advanceTimersByTimeAsync(5_000);

        expect(transport.status).toHaveBeenCalledOnce();
        expect(onLinked).toHaveBeenCalledWith(linkedStatus());
        expect(link.phase.value).toBe("idle");
    });

    it("404 对账仍未关联时显示失效，取消会清理 timer", async () => {
        vi.useFakeTimers();
        const transport = createTransport();
        vi.mocked(transport.poll).mockRejectedValue({status: 404});
        vi.mocked(transport.status).mockResolvedValue(unlinkedStatus());
        const link = createPassportLink({transport, onLinked: vi.fn(), onStartError: vi.fn()});

        await link.start();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(link.phase.value).toBe("expired");

        await link.start();
        link.cancel();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(transport.poll).toHaveBeenCalledOnce();
        expect(link.phase.value).toBe("idle");
    });
});

function createTransport(): PassportLinkTransport {
    return {
        start: vi.fn(async () => linkSession()),
        poll: vi.fn(async (): Promise<PassportLinkPollDto> => ({state: "pending", interval: 5})),
        status: vi.fn(async () => unlinkedStatus()),
    };
}

function linkSession(): PassportLinkSessionDto {
    return {
        linkSessionId: "session-1",
        userCode: "ABCD-EFGH",
        verificationUri: "https://nbook.notnotype.com/device",
        verificationUriComplete: "https://nbook.notnotype.com/device?code=ABCD-EFGH",
        expiresIn: 600,
        interval: 5,
    };
}

function linkedStatus(): PassportStatusDto {
    return {
        linked: true,
        account: {id: 7, username: "writer", displayName: "写作者"},
        scopes: ["backup:read"],
        linkedAt: "2026-07-28T00:00:00.000Z",
    };
}

function unlinkedStatus(): PassportStatusDto {
    return {linked: false, account: null, scopes: [], linkedAt: null};
}
