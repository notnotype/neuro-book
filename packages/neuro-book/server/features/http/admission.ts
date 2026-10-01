import {createError} from "h3";
import type {H3Event} from "h3";

export interface DrainClock {
    schedule(task: () => void, milliseconds: number): () => void;
}

const clock: DrainClock = {
    schedule(task, milliseconds) {
        const timer = setTimeout(task, milliseconds);
        return () => clearTimeout(timer);
    },
};

type Readiness = {status: "ready"} | {status: "failed"; error: unknown} | {status: "stopping"};
type RequestLease = {
    release(): void;
    stream(close: () => void | Promise<void>): void;
};
const requests = new WeakMap<object, RequestLease>();

/** SSE 的关闭仍由路由拥有；这里只把它移出普通请求等待，并登记排空时的终止动作。 */
export function registerHttpEventStream(event: H3Event, close: () => void | Promise<void>): void {
    const response = event.node?.res;
    if (response) requests.get(response)?.stream(close);
}

export class ProductHttpAdmission {
    readonly #ready = Promise.withResolvers<Readiness>();
    readonly #clock: DrainClock;
    readonly #streams = new Set<() => void | Promise<void>>();
    #draining = false;
    #active = 0;
    #empty: (() => void) | null = null;
    #drain: Promise<void> | null = null;
    #failure: unknown;
    readonly #closing: Array<Promise<void>> = [];
    readonly #drainFailures: unknown[] = [];

    constructor(options: {clock?: DrainClock} = {}) {
        this.#clock = options.clock ?? clock;
    }

    ready(): void {
        this.#ready.resolve({status: "ready"});
    }

    failed(error: unknown): void {
        this.#failure = error;
        this.#ready.resolve({status: "failed", error});
    }

    async admit(event: H3Event): Promise<void> {
        if (this.#failure !== undefined) throw this.#startupError(this.#failure);
        if (this.#draining) throw this.#closingError();
        this.#active += 1;
        const response = event.node.res;
        let released = false;
        let closeStream: (() => void | Promise<void>) | undefined;
        const release = (): void => {
            if (released) return;
            released = true;
            this.#active -= 1;
            if (this.#active === 0) this.#empty?.();
        };
        const finish = (): void => {
            release();
            if (closeStream) this.#streams.delete(closeStream);
            requests.delete(response);
            response.off("finish", finish);
            response.off("close", finish);
        };
        requests.set(response, {
            release,
            stream: (close) => {
                closeStream = close;
                if (this.#draining) this.#closeStream(close);
                else this.#streams.add(close);
                release();
            },
        });
        response.once("finish", finish);
        response.once("close", finish);
        const readiness = await this.#ready.promise;
        if (readiness.status === "failed") throw this.#startupError(readiness.error);
        if (this.#draining || readiness.status === "stopping") throw this.#closingError();
    }

    /** 先同步关准入；监听由插件持有，直到此步骤结算仍能返回 503。 */
    drain(): Promise<void> {
        if (this.#drain) return this.#drain;
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
        const cancel = this.#clock.schedule(() => deadline.reject(new Error("HTTP drain 超过 20000ms")), 20_000);
        try {
            await Promise.race([
                empty.promise.then(() => Promise.all(this.#closing)),
                deadline.promise,
            ]);
        } catch (error) {
            this.#drainFailures.push(error);
        } finally {
            cancel();
            this.#empty = null;
        }
        if (this.#drainFailures.length > 0) throw new AggregateError(this.#drainFailures, "HTTP 排空未完成");
    }

    #closingError(): Error {
        return createError({statusCode: 503, message: "NeuroBook 正在关闭。"});
    }

    #closeStream(close: () => void | Promise<void>): void {
        const closing = (async () => {
            try {
                await close();
            } catch (error) {
                this.#drainFailures.push(error);
            }
        })();
        this.#closing.push(closing);
    }
    #startupError(error: unknown): Error {
        return createError({statusCode: 503, message: "NeuroBook 启动失败。", data: {code: "PRODUCT_STARTUP_FAILED"}, cause: error});
    }
}
