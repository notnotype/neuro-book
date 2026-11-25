/**
 * 包内测试用的读密码来源：用例自己送字节。行为照进程的标准输入（`processPasswordSource`）：没有订阅时送来的字节先存着，
 * 订阅后再送（暂停的流就是这样）；流结束与出错同样等到有订阅才送。另记下终端模式的每次切换与写出的提示，给断言用。不含断言。
 */

import type {PasswordSource} from "../commands/read-password";

type Item = {readonly kind: "data"; readonly chunk: Uint8Array} | {readonly kind: "end"} | {readonly kind: "error"; readonly error: unknown};

export class TestPasswordSource implements PasswordSource {
    /** 终端模式的每次切换，按先后。 */
    readonly rawModes: boolean[] = [];
    readonly prompts: string[] = [];
    /** `subscribe` 被调用的次数。 */
    subscriptions = 0;
    #buffered: Item[] = [];
    #handlers: Parameters<PasswordSource["subscribe"]>[0] | undefined;
    #scheduled = false;

    constructor(readonly isTerminal: boolean) {}

    /** 现在是否在原始模式里。 */
    get rawMode(): boolean {
        return this.rawModes.at(-1) ?? false;
    }

    get subscribed(): boolean {
        return this.#handlers !== undefined;
    }

    setRawMode(on: boolean): void {
        this.rawModes.push(on);
    }

    prompt(text: string): void {
        this.prompts.push(text);
    }

    subscribe(handlers: Parameters<PasswordSource["subscribe"]>[0]): () => void {
        this.subscriptions += 1;
        this.#handlers = handlers;
        this.#flush();
        return () => {
            if (this.#handlers === handlers) this.#handlers = undefined;
        };
    }

    /** 送一块字节；字符串按 UTF-8 编码。 */
    send(chunk: string | Uint8Array | readonly number[]): this {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk);
        this.#buffered.push({kind: "data", chunk: bytes});
        this.#flush();
        return this;
    }

    /** 流结束（管道写端关了，或终端被关掉）。 */
    end(): this {
        this.#buffered.push({kind: "end"});
        this.#flush();
        return this;
    }

    /** 流出错（例如终端的读失败）。 */
    fail(error: unknown): this {
        this.#buffered.push({kind: "error", error});
        this.#flush();
        return this;
    }

    /**
     * 像真实的流一样异步送：`resume` 之后数据在后面的回合里到（Node 用 `process.nextTick`），一次一块，每块之前看订阅还在不在。
     * 同步送会让读密码的那一侧还没拿到停止函数就收到下一块，测出真实的流不会有的丢字节。
     */
    #flush(): void {
        if (this.#scheduled || this.#handlers === undefined || this.#buffered.length === 0) return;
        this.#scheduled = true;
        queueMicrotask(() => {
            this.#scheduled = false;
            const handlers = this.#handlers;
            const item = handlers === undefined ? undefined : this.#buffered.shift();
            if (handlers === undefined || item === undefined) return;
            if (item.kind === "data") handlers.data(item.chunk);
            else if (item.kind === "end") handlers.end();
            else handlers.error(item.error);
            this.#flush();
        });
    }
}
