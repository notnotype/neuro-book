import {afterEach, beforeEach} from "bun:test";

/**
 * 前端宿主测试（`tests/web-*.test.ts`）用的浏览器环境：假的 `fetch`、`WebSocket`、`document`、`window`、`location`、`localStorage`。
 * 被测的是页面运行时调用的组合函数与它真实导入的 `api.ts`、`panel-data.ts`、`terminal-socket.ts`；这里只换掉浏览器的全局对象与服务端。
 *
 * 装的顺序：vue 的 runtime-dom 在模块求值时就碰 `document`，所以测试文件先静态导入 vue 与被测模块，环境只在用例里装（`useWebEnv()` 注册
 * beforeEach 与 afterEach，失败时也拆）。`panel-data.ts` 是模块级单例，测试文件要用 `--isolate` 跑（包的 test 脚本已带），同一文件的
 * 用例之间由用例自己在结束时调 `stopPanelData()` 收口。
 */

export type FetchCall = {url: string; method: string; body: unknown; aborted: () => boolean};
/** 一次回应：外壳由 `data` 或 `errors` 拼；`raw` 给了就原样回（不是 JSON 的回应）；`wait` 给了就等它兑现再回。 */
export type Reply = {status?: number; data?: unknown; errors?: Array<{code: string; message: string; details?: Record<string, unknown>}>; instance?: string; revisions?: Record<string, number>; raw?: string; wait?: Promise<unknown>};
type Handler = (call: FetchCall) => Reply | undefined;

const REVISIONS = {records: 1, activity: 1, sessions: 1, notify: 1, github: 1};

type Listener = (event: {type: string; data?: unknown; code?: number; reason?: string}) => void;

/** 假的 WebSocket：记下每个实例；用例用 `open()`、`push()`、`serverClose()` 扮演服务端。 */
export class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeSocket[] = [];
    readyState = FakeSocket.CONNECTING;
    readonly sent: string[] = [];
    closedWith: {code?: number; reason?: string} | null = null;
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(readonly url: string) {
        FakeSocket.instances.push(this);
    }

    addEventListener(type: string, listener: Listener): void {
        const set = this.listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    send(data: string): void {
        if (this.readyState !== FakeSocket.OPEN) throw new Error(`假 WebSocket 还没打开就 send：${data}`);
        this.sent.push(data);
    }

    /** 页面主动关：记下关闭码，派发 close。 */
    close(code?: number, reason?: string): void {
        if (this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        this.closedWith = {code, reason};
        this.emit("close", {type: "close", code: code ?? 1005, reason: reason ?? ""});
    }

    open(): void {
        this.readyState = FakeSocket.OPEN;
        this.emit("open", {type: "open"});
    }

    push(message: unknown): void {
        this.emit("message", {type: "message", data: JSON.stringify(message)});
    }

    serverClose(code = 1006, reason = ""): void {
        this.readyState = FakeSocket.CLOSED;
        this.emit("close", {type: "close", code, reason});
    }

    private emit(type: string, event: {type: string; data?: unknown; code?: number; reason?: string}): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    }
}

export type WebEnv = {
    calls: FetchCall[];
    /** 按调用顺序找第一条能回应的处理函数；都不回应时回 404 外壳。 */
    respond(handler: Handler): void;
    sockets: () => FakeSocket[];
    document: EventTarget & {visibilityState: "visible" | "hidden"};
    window: EventTarget;
    setVisibility(state: "visible" | "hidden"): void;
};

export function envelope(reply: Reply): Response {
    if (reply.raw !== undefined) return new Response(reply.raw, {status: reply.status ?? 200});
    const status = reply.status ?? 200;
    const errors = reply.errors ?? (status >= 400 ? [{code: status === 401 ? "unauthorized" : "http_error", message: `HTTP ${status}`}] : []);
    const body = {schema: "nbdev.test/v1", ok: errors.length === 0, data: reply.data ?? null, warnings: [], errors, instance: reply.instance ?? "i1", revisions: reply.revisions ?? REVISIONS};
    return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
}

const GLOBALS = ["fetch", "WebSocket", "document", "window", "location", "localStorage"] as const;

function install(): WebEnv {
    const saved = new Map<string, PropertyDescriptor | undefined>(GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const handlers: Handler[] = [];
    const calls: FetchCall[] = [];
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const signal = init.signal ?? null;
        const call: FetchCall = {url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null, aborted: () => signal?.aborted === true};
        calls.push(call);
        const reply = handlers.map((handler) => handler(call)).find((entry) => entry !== undefined) ?? {status: 404, errors: [{code: "not_found", message: `测试没有给 ${url} 回应`}]};
        const wait = reply.wait;
        if (wait) {
            // 挂起期间被中止：与浏览器一样以 AbortError 拒绝。
            await new Promise<void>((resolve, reject) => {
                const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
                if (signal?.aborted) return fail();
                signal?.addEventListener("abort", fail, {once: true});
                wait.then(() => resolve(), reject);
            });
        }
        if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        return envelope(reply);
    };
    const doc = Object.assign(new EventTarget(), {
        visibilityState: "visible" as "visible" | "hidden",
        querySelector: (selector: string) => (selector.includes("nbdev-csrf") ? {content: "test-csrf"} : null),
    });
    const storage = new Map<string, string>();
    const localStorage = {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key)};
    // `host/prefs.ts` 经 `window.localStorage` 读写，与全局的 `localStorage` 是同一份。
    const win = Object.assign(new EventTarget(), {localStorage});
    const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
    FakeSocket.instances = [];
    define("fetch", fakeFetch);
    define("WebSocket", FakeSocket);
    define("document", doc);
    define("window", win);
    define("location", {protocol: "http:", host: "127.0.0.1:4490", origin: "http://127.0.0.1:4490"});
    define("localStorage", localStorage);
    current = {saved};
    return {
        calls,
        respond: (handler) => void handlers.push(handler),
        sockets: () => FakeSocket.instances,
        document: doc,
        window: win,
        setVisibility(state) {
            doc.visibilityState = state;
            doc.dispatchEvent(new Event("visibilitychange"));
        },
    };
}

let current: {saved: Map<string, PropertyDescriptor | undefined>} | null = null;

function uninstall(): void {
    if (!current) return;
    for (const [name, descriptor] of current.saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
    current = null;
}

/**
 * 每个用例前装一份新环境、后拆掉；返回的对象总指向当前用例的那一份。
 * `teardown` 在拆环境之前跑（用例中途失败也跑）：停掉用例建的 scope、收口数据宿主，它们的清理还要碰 `document`、`WebSocket`。
 * 不另写 afterEach：bun 按注册顺序跑 afterEach，写在 `useWebEnv()` 之后的会在环境拆掉之后才跑。
 */
export function useWebEnv(teardown: () => void = () => {}): {readonly env: WebEnv} {
    const holder: {env: WebEnv | null} = {env: null};
    beforeEach(() => {
        holder.env = install();
    });
    afterEach(() => {
        try {
            teardown();
        } finally {
            uninstall();
            holder.env = null;
        }
    });
    return {
        get env(): WebEnv {
            if (!holder.env) throw new Error("web-env 只在用例里可用");
            return holder.env;
        },
    };
}

/** 等到条件成立（轮询 5 毫秒一次），超时报错并带上最后的值。 */
export async function until<T>(read: () => T, ok: (value: T) => boolean, ms = 2_000, what = "条件"): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = read();
        if (ok(value)) return value;
        if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}（最后 ${JSON.stringify(value)}）`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/** 一个可以手动放行的 Promise（挂起回应用）。 */
export function gate(): {promise: Promise<void>; open: () => void} {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}
