/**
 * 没有连上服务端：网络失败、非 2xx、正文不是期望的形状，或 RPC 端口的 WebSocket 没能打开。窗口据此显示带重试的连接失败页。
 * 宿主的 RPC 套接字与应用自己的请求（引导、消息目录）共用这一个类型。
 */
export class ConnectionError extends Error {
    /** HTTP 状态码；网络失败为 null。 */
    readonly status: number | null;

    constructor(message: string, status: number | null, options?: ErrorOptions) {
        super(message, options);
        this.name = "ConnectionError";
        this.status = status;
    }
}
