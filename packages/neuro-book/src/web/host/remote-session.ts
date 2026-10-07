/**
 * 窗口与服务端之间的远程服务链路：首连，以及断线后的退避重连（runtime.browser-host 的“断线与重连”）。
 *
 * 每次重连先重新取引导：服务端重启后 RPC 端口可能变了。连回同一服务端进程时内核节点重建订阅并调用 `onResync`；
 * 服务端已换进程或 wire 版本不一致时停止重连，由窗口要求刷新。退避按注入时钟计时。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteLink, RemoteNode} from "@notnotype/nb-runtime/remote";
import {Value} from "typebox/value";

import {BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema, declaredProtocolVersion} from "nbook/shared/browser-bootstrap";

import type {Connection, RpcEndpoint} from "./connection";

/** 断线后第 1–5 次重连前的等待；之后每次等 `STEADY_RETRY_MS`。 */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const STEADY_RETRY_MS = 10_000;

/** 窗口可用之后链路的状态；`server-restarted` 与 `incompatible` 是终态，不再重连。 */
export type RemoteSessionState = "online" | "offline" | "server-restarted" | "incompatible";

export type FirstConnectResult = {readonly ok: true} | {readonly ok: false; readonly failure: "connection-failed" | "incompatible"; readonly reason: string};

export interface RemoteSessionOptions {
    readonly connection: Connection;
    readonly node: RemoteNode;
    readonly clock: RuntimeClock;
    /** 首连成功之后的状态变化；每次变化调用一次。 */
    readonly onState: (state: RemoteSessionState, reason: string | null) => void;
    /** 一次重连没有成功、将再次退避；给诊断用。 */
    readonly onRetryFailed?: (reason: string) => void;
}

export interface RemoteSession {
    /** 首连：用本次引导给出的端点连接并握手。只调用一次。 */
    start(endpoint: RpcEndpoint): Promise<FirstConnectResult>;
    /** 关闭链路、取消重连；幂等。 */
    close(): void;
}

type Attempt =
    | {readonly kind: "online"}
    | {readonly kind: "server-restarted" | "incompatible" | "failed"; readonly reason: string};

export function createRemoteSession(options: RemoteSessionOptions): RemoteSession {
    let closed = false;
    let link: RemoteLink | null = null;
    let retries = 0;
    let cancelRetry: () => void = () => undefined;

    const connectOnce = async (endpoint: RpcEndpoint): Promise<Attempt> => {
        let opened: RemoteLink;
        try {
            opened = await options.connection.openRemote(endpoint);
        } catch (error) {
            return {kind: "failed", reason: describe(error)};
        }
        if (closed) {
            opened.close();
            return {kind: "failed", reason: "窗口已关闭"};
        }
        let result: Awaited<ReturnType<RemoteNode["connect"]>>;
        try {
            result = await options.node.connect(opened);
        } catch (error) {
            // 节点的握手不应抛错；万一抛了，按这一次连接失败处理，退避照常继续，不让重连循环静默停下。
            opened.close();
            return {kind: "failed", reason: `握手出错：${describe(error)}`};
        }
        if (result.ok) {
            if (closed) {
                opened.close();
                return {kind: "failed", reason: "窗口已关闭"};
            }
            link = opened;
            opened.onClose(() => onLinkClosed(opened));
            return {kind: "online"};
        }
        if (result.reason === "server-restarted") return {kind: "server-restarted", reason: result.message};
        if (result.reason === "wire-version") return {kind: "incompatible", reason: result.message};
        return {kind: "failed", reason: `${result.reason}：${result.message}`};
    };

    const onLinkClosed = (closedLink: RemoteLink): void => {
        if (closed || closedLink !== link) return;
        link = null;
        options.onState("offline", "与服务端的连接已断开");
        scheduleRetry();
    };

    const scheduleRetry = (): void => {
        if (closed) return;
        const delay = RETRY_DELAYS_MS[retries] ?? STEADY_RETRY_MS;
        retries += 1;
        cancelRetry = options.clock.schedule(() => {
            void retry().catch((error: unknown) => {
                // 重连里的意外异常同样按一次失败处理，记下原因后继续退避。
                options.onRetryFailed?.(`重连出错：${describe(error)}`);
                scheduleRetry();
            });
        }, delay);
    };

    const retry = async (): Promise<void> => {
        if (closed) return;
        const endpoint = await refreshEndpoint();
        if (closed) return;
        if (endpoint === "incompatible") {
            options.onState("incompatible", `服务端的引导协议版本已不是 ${String(BROWSER_PROTOCOL_VERSION)}`);
            return;
        }
        if (endpoint === null) {
            scheduleRetry();
            return;
        }
        const attempt = await connectOnce(endpoint);
        if (closed) return;
        switch (attempt.kind) {
            case "online":
                retries = 0;
                options.onState("online", null);
                return;
            case "server-restarted":
            case "incompatible":
                options.onState(attempt.kind, attempt.reason);
                return;
            case "failed":
                options.onRetryFailed?.(attempt.reason);
                scheduleRetry();
                return;
        }
    };

    /** 重新取引导，读出 RPC 端点；服务端还没起来或响应不对时返回 null，下一次再试。 */
    const refreshEndpoint = async (): Promise<RpcEndpoint | "incompatible" | null> => {
        let raw: unknown;
        try {
            raw = await options.connection.bootstrap();
        } catch (error) {
            // 服务端暂时不可达（正在重启、网络中断）正是重连要等的情况，下一次再取。
            options.onRetryFailed?.(describe(error));
            return null;
        }
        const version = declaredProtocolVersion(raw);
        if (version !== null && version !== BROWSER_PROTOCOL_VERSION) return "incompatible";
        if (Value.Check(BrowserBootstrapSchema, raw)) return raw.rpc;
        options.onRetryFailed?.("引导响应的结构不符合协议");
        return null;
    };

    return {
        async start(endpoint) {
            const attempt = await connectOnce(endpoint);
            switch (attempt.kind) {
                case "online":
                    return {ok: true};
                case "incompatible":
                    return {ok: false, failure: "incompatible", reason: attempt.reason};
                case "server-restarted":
                case "failed":
                    // 首连不会是 server-restarted（节点还没见过服务端）；两者都按连接失败处理，窗口可原地重试。
                    return {ok: false, failure: "connection-failed", reason: attempt.reason};
            }
        },
        close() {
            if (closed) return;
            closed = true;
            cancelRetry();
            link?.close();
            link = null;
        },
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
