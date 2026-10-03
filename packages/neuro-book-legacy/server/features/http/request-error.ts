import type {H3Event} from "h3";
import {appLogger} from "nbook/server/app-logs/logger";

/** 请求 URL 的 query 不进入日志；错误摘要与栈中的同一 URL 一并清理。 */
export function logRequestError(error: unknown, event: H3Event | undefined): void {
    const method = event?.method ?? "UNKNOWN";
    const rawPath = event?.path;
    const path = rawPath?.split("?")[0] || "UNKNOWN";
    const object = typeof error === "object" && error !== null ? error : undefined;
    const statusCode = object && "statusCode" in object && typeof object.statusCode === "number" ? object.statusCode : 500;
    const errorMessage = object && "message" in object && typeof object.message === "string" && object.message
        ? object.message
        : object && "statusMessage" in object && typeof object.statusMessage === "string"
            ? object.statusMessage
            : "Unknown server error";
    const message = rawPath?.includes("?") ? errorMessage.replaceAll(rawPath, path) : errorMessage;
    let loggedError = error;
    if (rawPath?.includes("?")) {
        if (error instanceof Error) {
            loggedError = {
                name: error.name,
                message: error.message.replaceAll(rawPath, path),
                stack: error.stack?.replaceAll(rawPath, path),
            };
        } else if (typeof error === "string") {
            loggedError = error.replaceAll(rawPath, path);
        }
    }
    void appLogger.error("server.request.error", {method, path, statusCode, message}, loggedError, `服务端请求失败: ${method} ${path}`);
}
