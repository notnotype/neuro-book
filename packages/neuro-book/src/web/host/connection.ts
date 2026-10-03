/**
 * 连接对象：窗口与服务端之间唯一的通信出口（runtime.browser-host 可分离的边界 1）。目前只有引导请求；
 * 插件通道与事件流随 runtime.plugin-channel 加入。服务端地址由装配方给出，页面里是 `location.origin`。
 */

import {BROWSER_BOOTSTRAP_PATH} from "nbook/shared/browser-bootstrap";

/** 引导请求没有拿到可解析的响应：网络失败、非 2xx 或正文不是 JSON。窗口据此显示带重试的连接失败页。 */
export class ConnectionError extends Error {
    /** HTTP 状态码；网络失败为 null。 */
    readonly status: number | null;

    constructor(message: string, status: number | null, options?: ErrorOptions) {
        super(message, options);
        this.name = "ConnectionError";
        this.status = status;
    }
}

export interface Connection {
    /** 取引导响应的原始 JSON；协议版本与结构由窗口判定。失败时抛 ConnectionError。 */
    bootstrap(): Promise<unknown>;
}

export function createConnection(baseUrl: string): Connection {
    const url = new URL(BROWSER_BOOTSTRAP_PATH, baseUrl);
    return {
        async bootstrap() {
            let response: Response;
            try {
                response = await fetch(url, {cache: "no-store", headers: {accept: "application/json"}});
            } catch (error) {
                throw new ConnectionError("无法连接服务端", null, {cause: error});
            }
            if (!response.ok) throw new ConnectionError(`服务端暂不可用（HTTP ${String(response.status)}${await errorCode(response)}）`, response.status);
            try {
                return (await response.json()) as unknown;
            } catch (error) {
                throw new ConnectionError("服务端返回的引导响应不是 JSON", response.status, {cause: error});
            }
        },
    };
}

/** 服务端错误响应 `{error: {code}}` 里的错误码，便于区分启动失败、关闭中与开发模式下的后端重启。 */
async function errorCode(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as {error?: {code?: unknown}};
        return typeof body.error?.code === "string" ? `，${body.error.code}` : "";
    } catch {
        // 错误正文不是 JSON（例如中间代理的 HTML 错误页）时只报状态码。
        return "";
    }
}
