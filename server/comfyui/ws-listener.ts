import WebSocket from "ws";

/**
 * ComfyUI WebSocket 进度监听（进程级单例）。
 *
 * 懒连接：首个任务提交时建立 ws://<host>/ws?clientId=<id>；
 * 断线时指数退避重连（1s → 30s cap），job-manager 另有 history 轮询兜底；
 * 无在途任务空闲 60 秒后主动关闭；二进制帧（实时预览图）直接丢弃。
 */

/** 我们关心的 ComfyUI WS 事件（原始 JSON 已按 type 拆开）。 */
export type ComfyUiWsEvent =
    | {type: "progress"; promptId: string; value: number; max: number}
    | {type: "executing"; promptId: string; nodeId: string | null}
    | {type: "executed"; promptId: string}
    | {type: "execution_success"; promptId: string}
    | {type: "execution_error"; promptId: string; message: string};

type ListenerState = {
    socket: WebSocket | null;
    baseURL: string;
    clientId: string;
    onEvent: (event: ComfyUiWsEvent) => void;
    reconnectAttempts: number;
    reconnectTimer: NodeJS.Timeout | null;
    idleTimer: NodeJS.Timeout | null;
    /** 显式关闭后不再重连。 */
    closed: boolean;
};

let state: ListenerState | null = null;

const IDLE_CLOSE_MS = 60_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** http(s) baseURL → ws(s) URL。 */
function toWsUrl(baseURL: string, clientId: string): string {
    const url = new URL(baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/ws`;
    url.search = `?clientId=${encodeURIComponent(clientId)}`;
    return url.toString();
}

/**
 * 确保 WS 已连接（或正在连接）。baseURL / clientId 变化时重建连接。
 * onEvent 每次调用都更新为最新回调（job-manager 是唯一消费者）。
 */
export function ensureComfyUiSocket(baseURL: string, clientId: string, onEvent: (event: ComfyUiWsEvent) => void): void {
    if (state && (state.baseURL !== baseURL || state.clientId !== clientId)) {
        closeComfyUiSocket();
    }
    if (state) {
        state.onEvent = onEvent;
        cancelIdleClose();
        return;
    }
    state = {
        socket: null,
        baseURL,
        clientId,
        onEvent,
        reconnectAttempts: 0,
        reconnectTimer: null,
        idleTimer: null,
        closed: false,
    };
    connect();
}

/** 通知监听器当前没有在途任务：启动空闲关闭计时。 */
export function markComfyUiSocketIdle(): void {
    if (!state || state.idleTimer) {
        return;
    }
    state.idleTimer = setTimeout(() => {
        closeComfyUiSocket();
    }, IDLE_CLOSE_MS);
}

function cancelIdleClose(): void {
    if (state?.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }
}

/** 显式关闭连接并清理全部计时器。 */
export function closeComfyUiSocket(): void {
    const current = state;
    state = null;
    if (!current) {
        return;
    }
    current.closed = true;
    if (current.reconnectTimer) {
        clearTimeout(current.reconnectTimer);
    }
    if (current.idleTimer) {
        clearTimeout(current.idleTimer);
    }
    try {
        current.socket?.close();
    } catch {
        // 关闭失败无需处理。
    }
}

function connect(): void {
    const current = state;
    if (!current || current.closed) {
        return;
    }
    let socket: WebSocket;
    try {
        socket = new WebSocket(toWsUrl(current.baseURL, current.clientId));
    } catch {
        scheduleReconnect();
        return;
    }
    current.socket = socket;
    socket.on("open", () => {
        if (state === current) {
            current.reconnectAttempts = 0;
        }
    });
    socket.on("message", (data, isBinary) => {
        if (state !== current || isBinary) {
            // 二进制帧是实时预览图，直接丢弃。
            return;
        }
        const event = parseWsMessage(String(data));
        if (event) {
            current.onEvent(event);
        }
    });
    socket.on("error", () => {
        // close 事件随后触发，重连统一在 close 里安排。
    });
    socket.on("close", () => {
        if (state === current && !current.closed) {
            scheduleReconnect();
        }
    });
}

function scheduleReconnect(): void {
    const current = state;
    if (!current || current.closed || current.reconnectTimer) {
        return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** current.reconnectAttempts, RECONNECT_MAX_MS);
    current.reconnectAttempts += 1;
    current.reconnectTimer = setTimeout(() => {
        current.reconnectTimer = null;
        connect();
    }, delay);
}

/**
 * 解析 ComfyUI WS JSON 帧。不认识的类型返回 null。
 */
function parseWsMessage(raw: string): ComfyUiWsEvent | null {
    let parsed: {type?: string; data?: Record<string, unknown>};
    try {
        parsed = JSON.parse(raw) as {type?: string; data?: Record<string, unknown>};
    } catch {
        return null;
    }
    const data = parsed.data ?? {};
    const promptId = typeof data.prompt_id === "string" ? data.prompt_id : null;
    if (!promptId) {
        return null;
    }
    switch (parsed.type) {
        case "progress": {
            const value = typeof data.value === "number" ? data.value : 0;
            const max = typeof data.max === "number" && data.max > 0 ? data.max : 1;
            return {type: "progress", promptId, value, max};
        }
        case "executing":
            return {type: "executing", promptId, nodeId: typeof data.node === "string" ? data.node : null};
        case "executed":
            return {type: "executed", promptId};
        case "execution_success":
            return {type: "execution_success", promptId};
        case "execution_error": {
            const message = typeof data.exception_message === "string" ? data.exception_message : "ComfyUI 执行失败";
            return {type: "execution_error", promptId, message};
        }
        default:
            return null;
    }
}
