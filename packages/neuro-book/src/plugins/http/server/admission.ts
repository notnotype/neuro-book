/**
 * HTTP 准入与排空：就绪前让请求等待，启动失败与排空期间拒绝，排空时等在途请求结束。
 *
 * 一个请求从进入处理到响应体发送完毕（或被客户端取消）都算在途；事件流在登记后移出等待，
 * 排空开始即执行它的关闭动作。排空有 20 秒上限，超时后交给宿主继续关闭并记为未完成。
 */

export const HTTP_DRAIN_LIMIT_MS = 20_000;

export interface DrainClock {
    schedule(task: () => void, milliseconds: number): () => void;
}

const systemClock: DrainClock = {
    schedule(task, milliseconds) {
        const timer = setTimeout(task, milliseconds);
        return () => clearTimeout(timer);
    },
};

export type HttpRejectionCode = "startup-failed" | "stopping";

/** 准入拒绝；调用方按 `code` 映射为 503 响应。 */
export class HttpAdmissionRejected extends Error {
    readonly code: HttpRejectionCode;

    constructor(code: HttpRejectionCode, options?: ErrorOptions) {
        super(code === "stopping" ? "NeuroBook 正在关闭。" : "NeuroBook 启动失败。", options);
        this.name = "HttpAdmissionRejected";
        this.code = code;
    }
}

/** 一个被接纳请求的票据：响应结束时 `release`；事件流用 `stream` 登记关闭动作并移出等待。 */
export interface RequestTicket {
    release(): void;
    stream(close: () => void | Promise<void>): void;
}

type Readiness = {readonly status: "ready"} | {readonly status: "failed"; readonly error: unknown} | {readonly status: "stopping"};

export class HttpAdmission {
    readonly #ready = Promise.withResolvers<Readiness>();
    readonly #clock: DrainClock;
    readonly #streams = new Set<() => void | Promise<void>>();
    readonly #closing: Array<Promise<void>> = [];
    readonly #drainFailures: unknown[] = [];
    #draining = false;
    #active = 0;
    #empty: (() => void) | null = null;
    #drain: Promise<void> | null = null;
    #failure: {readonly error: unknown} | null = null;

    constructor(options: {readonly clock?: DrainClock} = {}) {
        this.#clock = options.clock ?? systemClock;
    }

    /** 运行实例可用：放行等待中的请求。 */
    ready(): void {
        this.#ready.resolve({status: "ready"});
    }

    /** 启动失败：等待中与之后的请求都得到 `startup-failed`。 */
    failed(error: unknown): void {
        this.#failure ??= {error};
        this.#ready.resolve({status: "failed", error});
    }

    /** 在途请求数（含尚在等待就绪的请求，不含已登记的事件流）。 */
    get active(): number {
        return this.#active;
    }

    /**
     * 接纳一个请求：先计入在途，再等待就绪结果。拒绝时抛 `HttpAdmissionRejected`，
     * 此前计入的在途已撤回，调用方不需要再 release。
     */
    async admit(): Promise<RequestTicket> {
        if (this.#failure !== null) throw new HttpAdmissionRejected("startup-failed", {cause: this.#failure.error});
        if (this.#draining) throw new HttpAdmissionRejected("stopping");
        this.#active += 1;
        let released = false;
        let streamClose: (() => void | Promise<void>) | null = null;
        const release = (): void => {
            if (released) return;
            released = true;
            this.#active -= 1;
            if (this.#active === 0) this.#empty?.();
        };
        const ticket: RequestTicket = {
            release: () => {
                release();
                if (streamClose !== null) this.#streams.delete(streamClose);
            },
            stream: (close) => {
                if (streamClose !== null) throw new Error("一个请求只能登记一个事件流");
                streamClose = close;
                if (this.#draining) this.#closeStream(close);
                else this.#streams.add(close);
                release();
            },
        };
        const readiness = await this.#ready.promise;
        if (readiness.status === "failed") {
            ticket.release();
            throw new HttpAdmissionRejected("startup-failed", {cause: readiness.error});
        }
        if (readiness.status === "stopping") {
            ticket.release();
            throw new HttpAdmissionRejected("stopping");
        }
        return ticket;
    }

    /** 同步关闭准入后等待在途请求；重复调用共享同一结果。超时或事件流关闭失败时拒绝。 */
    drain(): Promise<void> {
        if (this.#drain !== null) return this.#drain;
        this.#draining = true;
        this.#ready.resolve({status: "stopping"});
        this.#drain = this.#finishDrain();
        return this.#drain;
    }

    async #finishDrain(): Promise<void> {
        for (const close of this.#streams) this.#closeStream(close);
        this.#streams.clear();
        const empty = Promise.withResolvers<void>();
        if (this.#active === 0) empty.resolve();
        else this.#empty = empty.resolve;
        const deadline = Promise.withResolvers<never>();
        const cancel = this.#clock.schedule(() => deadline.reject(new Error(`HTTP 排空超过 ${String(HTTP_DRAIN_LIMIT_MS)}ms`)), HTTP_DRAIN_LIMIT_MS);
        try {
            await Promise.race([empty.promise.then(() => Promise.all(this.#closing)), deadline.promise]);
        } catch (error) {
            this.#drainFailures.push(error);
        } finally {
            cancel();
            this.#empty = null;
        }
        if (this.#drainFailures.length > 0) throw new AggregateError(this.#drainFailures, "HTTP 排空未完成");
    }

    #closeStream(close: () => void | Promise<void>): void {
        this.#closing.push((async () => {
            try {
                await close();
            } catch (error) {
                this.#drainFailures.push(error);
            }
        })());
    }
}
