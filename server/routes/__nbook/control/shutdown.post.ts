import {timingSafeEqual} from "node:crypto";
import {createError, defineEventHandler, getHeader, setResponseStatus} from "h3";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";
import {PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT} from "nbook/shared/product-runtime-contract";

/** 只接受内核报告的本机地址，不信任任何代理转发头。 */
function isLoopbackAddress(address: string | undefined): boolean {
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Nuxt dev 的 Node adapter 可能不暴露 socket.remoteAddress。
 * 只有进程明确绑定 loopback 时才能使用该 fallback；0.0.0.0、:: 或缺省监听仍拒绝。
 */
function isLoopbackRequest(address: string | undefined): boolean {
    if (isLoopbackAddress(address)) return true;
    if (address !== undefined) return false;
    const configuredHost = (process.env.NITRO_HOST?.trim() || process.env.HOST?.trim() || "")
        .toLowerCase()
        .replace(/^\[|\]$/gu, "");
    return configuredHost === "127.0.0.1" || configuredHost === "localhost" || configuredHost === "::1";
}

/** 使用恒定时间比较 Manager 为本次 Product launch 生成的 bearer token。 */
function matchesShutdownToken(authorization: string | undefined, expectedToken: string): boolean {
    if (!authorization) return false;
    const parts = authorization.trim().split(/\s+/u);
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") return false;
    const actual = Buffer.from(parts[1] ?? "", "utf8");
    const expected = Buffer.from(expectedToken, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Manager 专用 loopback shutdown 控制面；正常用户鉴权不能访问此入口。 */
export default defineEventHandler((event): {accepted: true} => {
    const remoteAddress = event.node.req.socket.remoteAddress;
    if (!isLoopbackRequest(remoteAddress)) {
        throw createError({statusCode: 403, message: "Product shutdown 只接受 loopback 请求。"});
    }
    const expectedToken = process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]?.trim();
    if (!expectedToken) {
        throw createError({statusCode: 503, message: "Product shutdown 控制面未启用。"});
    }
    if (!matchesShutdownToken(getHeader(event, "authorization"), expectedToken)) {
        throw createError({statusCode: 401, message: "Product shutdown token 无效。"});
    }
    setResponseStatus(event, 202);
    let exitRequested = false;
    const requestExit = (): void => {
        if (exitRequested) return;
        exitRequested = true;
        productShutdownController.requestProcessExit();
    };
    event.node.res.once("finish", requestExit);
    event.node.res.once("close", requestExit);
    return {accepted: true};
});
