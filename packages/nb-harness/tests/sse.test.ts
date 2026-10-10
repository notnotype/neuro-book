import {describe, expect, test} from "bun:test";
import {EventEmitter} from "node:events";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {
    serializeAgentEvent,
    serializeSseComment,
    serializeSseEvent,
    serializeSseJsonEvent,
    writeSseStream,
    type SseFrame,
    type SseResponse,
    type SseSubscription,
} from "../src";

describe("SSE 序列化", () => {
    test("字段顺序固定为 event/id/retry/data，多行 data 拆成多行，以空行结束", () => {
        expect(serializeSseEvent({data: "第一行\n第二行", event: "delta", id: "7", retry: 1000})).toBe(
            "event: delta\nid: 7\nretry: 1000\ndata: 第一行\ndata: 第二行\n\n",
        );
        expect(serializeSseEvent({data: ""})).toBe("data: \n\n");
    });

    test("拒绝会破坏帧边界的输入", () => {
        expect(() => serializeSseEvent({data: "a\rb"})).toThrow(/CR/u);
        expect(() => serializeSseEvent({data: "x", event: "a\nb"})).toThrow(/event/u);
        expect(() => serializeSseEvent({data: "x", id: "1\r"})).toThrow(/id/u);
        expect(() => serializeSseEvent({data: "x", retry: -1})).toThrow(/retry/u);
        expect(() => serializeSseEvent({data: "x", retry: 1.5})).toThrow(/retry/u);
        expect(() => serializeSseComment("a\nb")).toThrow(/comment/u);
    });

    test("注释、JSON 与 agent 事件的便捷形式", () => {
        expect(serializeSseComment("keep-alive")).toBe(": keep-alive\n");
        expect(serializeSseJsonEvent({event: "state", data: {text: "多\n行"}})).toBe('event: state\ndata: {"text":"多\\n行"}\n\n');
        expect(serializeAgentEvent({type: "agent_end"})).toBe('event: agent\ndata: {"type":"agent_end"}\n\n');
    });
});

/** 带 backpressure 开关的最小 response 替身：记录写入、按需返回 false 并在测试中手动触发 drain。 */
class FakeResponse extends EventEmitter implements SseResponse {
    destroyed = false;
    writableEnded = false;
    readonly headers = new Map<string, string>();
    readonly written: string[] = [];
    destroyError: Error | undefined;
    backpressure = false;

    setHeader(name: string, value: string): void {
        this.headers.set(name, value);
    }

    write(frame: Buffer): boolean {
        this.written.push(frame.toString("utf-8"));
        return !this.backpressure;
    }

    end(): void {
        this.writableEnded = true;
    }

    destroy(error?: Error): unknown {
        this.destroyed = true;
        this.destroyError = error;
        return this;
    }
}

function frame(text: string): SseFrame {
    return {frame: Buffer.from(text, "utf-8")};
}

/** 由测试推送事件的订阅：`push` 入队、`finish` 结束迭代、`close` 记录原因并中止 signal。 */
function createSubscription(connected: SseFrame) {
    const controller = new AbortController();
    const queue: SseFrame[] = [];
    let finished = false;
    let wake: (() => void) | undefined;
    const closeReasons: string[] = [];

    const subscription: SseSubscription<SseFrame> = {
        connected,
        signal: controller.signal,
        close(reason) {
            closeReasons.push(reason ?? "<none>");
            controller.abort();
            wake?.();
        },
        async *[Symbol.asyncIterator]() {
            while (true) {
                if (queue.length > 0) {
                    yield queue.shift() as SseFrame;
                    continue;
                }
                if (finished || controller.signal.aborted) return;
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
        },
    };
    return {
        subscription,
        closeReasons,
        abort() {
            controller.abort();
            wake?.();
        },
        push(item: SseFrame) {
            queue.push(item);
            wake?.();
        },
        finish() {
            finished = true;
            wake?.();
        },
    };
}

describe("writeSseStream", () => {
    test("先写 connected 帧再按顺序写事件，迭代结束后正常收尾", async () => {
        const response = new FakeResponse();
        const source = createSubscription(frame(": connected\n"));
        const done = writeSseStream(response, source.subscription);

        source.push(frame("data: 1\n\n"));
        source.push(frame("data: 2\n\n"));
        source.finish();
        await done;

        expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
        expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
        expect(response.written).toEqual([": connected\n", "data: 1\n\n", "data: 2\n\n"]);
        expect(response.writableEnded).toBe(true);
        expect(source.closeReasons).toEqual(["consumer_closed"]);
    });

    test("write 返回 false 后等待 drain，之前不写下一帧", async () => {
        const response = new FakeResponse();
        response.backpressure = true;
        const source = createSubscription(frame("c\n"));
        const done = writeSseStream(response, source.subscription);

        source.push(frame("e1\n"));
        // 写出器挂上 drain 监听即表示它停在背压等待上；此刻 e1 已在队列里却不能被写出。
        await waitUntil("写出器等待 drain", () => response.listenerCount("drain") > 0);
        expect(response.written).toEqual(["c\n"]);

        response.backpressure = false;
        response.emit("drain");
        source.finish();
        await done;
        expect(response.written).toEqual(["c\n", "e1\n"]);
    });

    test("response 关闭时以 consumer_closed 关闭订阅，writer 正常结束", async () => {
        const response = new FakeResponse();
        const source = createSubscription(frame("c\n"));
        const done = writeSseStream(response, source.subscription);

        await waitUntil("connected 帧已写出", () => response.written.length === 1);
        response.destroyed = true;
        response.emit("close");
        await done;

        expect(source.closeReasons[0]).toBe("consumer_closed");
        expect(response.writableEnded).toBe(false);
    });

    test("订阅方中止时销毁 response", async () => {
        const response = new FakeResponse();
        const source = createSubscription(frame("c\n"));
        const done = writeSseStream(response, source.subscription);

        await waitUntil("connected 帧已写出", () => response.written.length === 1);
        source.abort();
        await done;

        expect(response.destroyed).toBe(true);
        expect(response.destroyError).toBeUndefined();
    });
});
