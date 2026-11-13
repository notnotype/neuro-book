/**
 * 重连时重取 RPC 端点：nb-host 远程会话的 `refreshEndpoint` 由应用实现（runtime.browser-host 的“断线与重连”）。服务端
 * 重启后端口可能变了，所以每次重连都重新取一次引导，读出其中的 `rpc`。
 *
 * 首连的引导由窗口自己判定（版本不同、插件版本对不上都要刷新）；这里只管重连：协议版本变了说明服务端已换成别的构建，本页
 * 再连也用不了，交回终态 `incompatible`；取不到、结构不对是服务端正在重启这类暂时情形，交回 `retry` 下一次再试。
 */

import type {EndpointRefresh} from "@notnotype/nb-host/web";
import {Value} from "typebox/value";

import {BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema, declaredProtocolVersion} from "nbook/shared/browser-bootstrap";

import type {Connection} from "./connection";

/** 不抛错：取引导失败（含 `signal` 中止）也交回 `retry`，原因给诊断。 */
export async function refreshEndpoint(connection: Connection, signal: AbortSignal): Promise<EndpointRefresh> {
    let raw: unknown;
    try {
        raw = await connection.bootstrap(null, signal);
    } catch (error) {
        return {retry: error instanceof Error ? error.message : String(error)};
    }
    const version = declaredProtocolVersion(raw);
    if (version !== null && version !== BROWSER_PROTOCOL_VERSION) return {incompatible: `服务端的引导协议版本已不是 ${String(BROWSER_PROTOCOL_VERSION)}`};
    if (Value.Check(BrowserBootstrapSchema, raw)) return raw.rpc;
    return {retry: "引导响应的结构不符合协议"};
}
