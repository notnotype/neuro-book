import {describe, expect, it, vi} from "vitest";
import {readSseStream} from "nbook/app/utils/http/read-sse";
import {PUBLIC_EVENT_MAX_BYTES} from "nbook/shared/agent/public-event-limits";

describe("readSseStream", () => {
    it("按帧顺序等待异步事件处理完成", async () => {
        let releaseFirst!: () => void;
        let resolveFirstStarted!: () => void;
        const order: string[] = [];
        const firstStarted = new Promise<void>((resolve) => {
            resolveFirstStarted = resolve;
        });
        const response = sseResponse([
            "data: {\"seq\":1}\n\n",
            "data: {\"seq\":2}\n\n",
        ].join(""));

        const reading = readSseStream<{seq: number}>(response, async (event) => {
            order.push(`start-${String(event.seq)}`);
            if (event.seq === 1) {
                resolveFirstStarted();
                await new Promise<void>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            order.push(`end-${String(event.seq)}`);
        });

        await firstStarted;
        expect(order).toEqual(["start-1"]);

        releaseFirst();
        await reading;

        expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    });

    it("事件处理器失败时取消 reader，释放底层 SSE 流", async () => {
        let cancelCalls = 0;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("data: {\"seq\":1}\n\n"));
            },
            cancel() {
                cancelCalls += 1;
            },
        });
        const response = sseResponse(stream);

        await expect(readSseStream(response, () => {
            throw new Error("consumer failed");
        })).rejects.toThrow("consumer failed");

        expect(cancelCalls).toBe(1);
    });

    it("拒绝超过公开事件预算的完整 SSE frame", async () => {
        const payload = JSON.stringify({text: "x".repeat(140 * 1024)});
        const response = sseResponse(`data: ${payload}\n\n`);

        await expect(readSseStream(response, () => {})).rejects.toThrow("SSE frame 超过最大字节数");
    });

    it("frameBytes 包含末尾 SSE delimiter", async () => {
        const prefix = "data: {\"text\":\"";
        const suffix = "\"}";
        const delimiter = "\n\n";
        const fixedBytes = new TextEncoder().encode(prefix + suffix + delimiter).byteLength;
        const response = sseResponse(prefix + "x".repeat(PUBLIC_EVENT_MAX_BYTES - fixedBytes + 1) + suffix + delimiter);

        await expect(readSseStream(response, () => {})).rejects.toThrow(`SSE frame 超过最大字节数：${String(PUBLIC_EVENT_MAX_BYTES + 1)}`);
    });

    it("未闭合 SSE buffer 超限时立即失败并取消 reader", async () => {
        let cancelCalls = 0;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(140 * 1024)}`));
            },
            cancel() {
                cancelCalls += 1;
            },
        });

        await expect(readSseStream(sseResponse(stream), () => {})).rejects.toThrow("SSE frame 超过最大字节数");
        expect(cancelCalls).toBe(1);
    });

    it("支持标准 CRLF SSE frame 分隔符", async () => {
        const events: Array<{seq: number}> = [];
        const response = sseResponse("event: update\r\ndata: {\"seq\":1}\r\n\r\n");

        await readSseStream(response, (event: {seq: number}) => {
            events.push(event);
        });

        expect(events).toEqual([{seq: 1}]);
    });

    it("200 非 SSE 响应不会触发 onOpen 或事件处理", async () => {
        const onOpen = vi.fn();
        const onEvent = vi.fn();
        let cancelCalls = 0;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("<html>proxy error</html>"));
            },
            cancel() {
                cancelCalls += 1;
            },
        });
        const response = new Response(body, {
            headers: {"content-type": "text/html; charset=utf-8"},
        });

        await expect(readSseStream(response, onEvent, {onOpen})).rejects.toThrow("响应不是 SSE");
        expect(cancelCalls).toBe(1);
        expect(onOpen).not.toHaveBeenCalled();
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("非 2xx streaming body 在抛出 HTTP 错误前被取消", async () => {
        let cancelCalls = 0;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("gateway unavailable"));
            },
            cancel() {
                cancelCalls += 1;
            },
        });
        const response = new Response(body, {status: 502});

        await expect(readSseStream(response, () => {})).rejects.toMatchObject({name: "SseHttpError", status: 502});
        expect(cancelCalls).toBe(1);
    });

    it("缺失 Content-Type 时拒绝建立 SSE 连接", async () => {
        const response = new Response(new Uint8Array([1]));

        await expect(readSseStream(response, () => {})).rejects.toThrow("响应不是 SSE：缺少 Content-Type");
    });
});

function sseResponse(body: BodyInit): Response {
    return new Response(body, {headers: {"content-type": "text/event-stream; charset=utf-8"}});
}
