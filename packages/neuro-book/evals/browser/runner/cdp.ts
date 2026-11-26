/**
 * 薄 CDP 客户端（Bun 自带的 WebSocket，扁平会话）：评测的观察者与 Chrome 的启动检查只用到几个方法，
 * 不引入 Playwright（它连上去会对所有目标开自动挂接、在新目标上等调试器，改变执行者看到的时序）。
 *
 * 每次请求都有时限：页面上有没处理的 JS 对话框时 `Page.captureScreenshot` 会一直不返回，没有时限会卡住收尾。
 */

export class CdpError extends Error {
    /** `timeout` 超时没回，`closed` 连接断了，`protocol` Chrome 回了错误。 */
    readonly kind: "timeout" | "closed" | "protocol";

    constructor(kind: CdpError["kind"], message: string) {
        super(message);
        this.name = "CdpError";
        this.kind = kind;
    }
}

interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

type Listener = (params: Record<string, unknown>, sessionId: string | undefined) => void;

export class CdpClient {
    private readonly socket: WebSocket;
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private readonly listeners = new Map<string, Set<Listener>>();
    private closed = false;

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.addEventListener("message", (event) => this.receive(String(event.data)));
        socket.addEventListener("close", () => this.fail(new CdpError("closed", "CDP connection closed")));
    }

    static async connect(url: string, timeoutMs = 5_000): Promise<CdpClient> {
        const socket = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                socket.close();
                reject(new CdpError("timeout", `CDP connect to ${url} timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            socket.addEventListener("open", () => {
                clearTimeout(timer);
                resolve();
            }, {once: true});
            socket.addEventListener("error", () => {
                clearTimeout(timer);
                reject(new CdpError("closed", `CDP connect to ${url} failed`));
            }, {once: true});
        });
        return new CdpClient(socket);
    }

    send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, options: {sessionId?: string; timeoutMs?: number} = {}): Promise<T> {
        if (this.closed) return Promise.reject(new CdpError("closed", `CDP connection closed before ${method}`));
        const id = this.nextId++;
        const timeoutMs = options.timeoutMs ?? 5_000;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new CdpError("timeout", `${method} timed out after ${timeoutMs} ms`));
            }, timeoutMs);
            this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject, timer});
            this.socket.send(JSON.stringify({id, method, params, ...(options.sessionId === undefined ? {} : {sessionId: options.sessionId})}));
        });
    }

    /** 订阅事件；交回取消订阅的函数。 */
    on(method: string, listener: Listener): () => void {
        let set = this.listeners.get(method);
        if (set === undefined) {
            set = new Set();
            this.listeners.set(method, set);
        }
        set.add(listener);
        return () => set.delete(listener);
    }

    close(): void {
        if (this.closed) return;
        this.socket.close();
        this.fail(new CdpError("closed", "CDP connection closed by the client"));
    }

    private receive(text: string): void {
        const message = JSON.parse(text) as {id?: number; result?: unknown; error?: {message?: string}; method?: string; params?: Record<string, unknown>; sessionId?: string};
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (pending === undefined) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error !== undefined) pending.reject(new CdpError("protocol", message.error.message ?? "CDP error"));
            else pending.resolve(message.result ?? {});
            return;
        }
        if (message.method !== undefined) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {}, message.sessionId);
    }

    private fail(error: CdpError): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
