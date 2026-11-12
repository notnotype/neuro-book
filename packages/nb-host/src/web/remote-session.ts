/**
 * 窗口与服务端之间的远程服务链路：首连，以及断线后的退避重连（runtime.browser-host 的“断线与重连”）。
 *
 * 每次重连先经应用的 `refreshEndpoint` 重新取端点：服务端重启后 RPC 端口可能变了。连回同一服务端进程（绑定了项目时还是
 * 同一项目代次）时内核节点重建订阅并调用 `onResync`；服务端已换进程、绑定的项目代次已结束、wire 版本不一致，或应用判定
 * 不兼容时停止重连，由应用丢弃这个窗口实例重建。退避按注入时钟计时。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteLink, RemoteNode} from "@notnotype/nb-runtime/remote";

import type {RpcEndpoint} from "./rpc-socket";

/** 断线后第 1–5 次重连前的等待；之后每次等 `STEADY_RETRY_MS`。 */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const STEADY_RETRY_MS = 10_000;

/** 窗口可用之后链路的状态；`server-restarted`、`project-gone` 与 `incompatible` 是终态，不再重连。 */
export type RemoteSessionState = "online" | "offline" | "server-restarted" | "project-gone" | "incompatible";

/** 首连失败：`project-unavailable` 是握手时打不开要绑定的项目，与连接失败一样可以原地重试。 */
export type FirstConnectResult = {readonly ok: true} | {readonly ok: false; readonly failure: "connection-failed" | "incompatible" | "project-unavailable"; readonly reason: string};

/**
 * 一次重取端点的结果：端点、应用判定的不兼容（终态，原因由应用写），或这次没取到、下一次再试（原因交 `onRetryFailed`）。
 */
export type EndpointRefresh = RpcEndpoint | {readonly incompatible: string} | {readonly retry: string};

export interface RemoteSessionOptions {
    /** 打开 RPC 端口的链路；没能打开时拒绝。浏览器里是绑定了页面地址的 `openRpcSocket`。 */
    readonly openRemote: (endpoint: RpcEndpoint) => Promise<RemoteLink>;
    /**
     * 应用实现：取引导、核协议版本与结构。不得抛错；中止或失败交回 `retry`。`close()` 时 `signal` 中止，之后的结果被丢弃。
     */
    readonly refreshEndpoint: (signal: AbortSignal) => Promise<EndpointRefresh>;
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
    | {readonly kind: "server-restarted" | "project-gone" | "project-unavailable" | "incompatible" | "failed"; readonly reason: string};

export function createRemoteSession(options: RemoteSessionOptions): RemoteSession {
    let closed = false;
    let link: RemoteLink | null = null;
    let retries = 0;
    let cancelRetry: () => void = () => undefined;
    /** 在途的重取端点；`close()` 中止它。 */
    let refreshing: AbortController | null = null;

    const connectOnce = async (endpoint: RpcEndpoint): Promise<Attempt> => {
        let opened: RemoteLink;
        try {
            opened = await options.openRemote(endpoint);
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
        if (result.reason === "project-gone") return {kind: "project-gone", reason: result.message};
        if (result.reason === "project-unavailable") return {kind: "project-unavailable", reason: result.message};
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
                // 重连里的意外异常（例如 refreshEndpoint 违约抛错）同样按一次失败处理，记下原因后继续退避；关闭之后不再记。
                if (closed) return;
                options.onRetryFailed?.(`重连出错：${describe(error)}`);
                scheduleRetry();
            });
        }, delay);
    };

    const retry = async (): Promise<void> => {
        if (closed) return;
        const controller = new AbortController();
        refreshing = controller;
        let refreshed: EndpointRefresh;
        try {
            refreshed = await options.refreshEndpoint(controller.signal);
        } finally {
            if (refreshing === controller) refreshing = null;
        }
        if (closed) return;
        if ("incompatible" in refreshed) {
            options.onState("incompatible", refreshed.incompatible);
            return;
        }
        if ("retry" in refreshed) {
            // 服务端暂时不可达（正在重启、网络中断）或响应不对，正是重连要等的情况，下一次再取。
            options.onRetryFailed?.(refreshed.retry);
            scheduleRetry();
            return;
        }
        const attempt = await connectOnce(refreshed);
        if (closed) return;
        switch (attempt.kind) {
            case "online":
                retries = 0;
                options.onState("online", null);
                return;
            case "server-restarted":
            case "project-gone":
            case "incompatible":
                options.onState(attempt.kind, attempt.reason);
                return;
            // 重连时打不开项目只会是服务端正在停止这类暂时情形（原代次已结束是 project-gone），照常退避。
            case "project-unavailable":
            case "failed":
                options.onRetryFailed?.(attempt.reason);
                scheduleRetry();
                return;
        }
    };

    return {
        async start(endpoint) {
            const attempt = await connectOnce(endpoint);
            switch (attempt.kind) {
                case "online":
                    return {ok: true};
                case "incompatible":
                    return {ok: false, failure: "incompatible", reason: attempt.reason};
                case "project-unavailable":
                    return {ok: false, failure: "project-unavailable", reason: attempt.reason};
                case "server-restarted":
                case "project-gone":
                case "failed":
                    // 首连不会是 server-restarted 或 project-gone（节点还没见过服务端、还没有绑定）；都按连接失败处理，
                    // 窗口可原地重试。
                    return {ok: false, failure: "connection-failed", reason: attempt.reason};
            }
        },
        close() {
            if (closed) return;
            closed = true;
            cancelRetry();
            refreshing?.abort();
            refreshing = null;
            link?.close();
            link = null;
        },
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
