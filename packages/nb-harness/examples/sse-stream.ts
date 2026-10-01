/**
 * 把一轮对话的 Agent 事件经 SSE 推给 HTTP 客户端。
 * 订阅源（帧从哪来、何时结束）由宿主实现；writeSseStream 只负责背压与收尾。
 *
 * 运行：bun examples/sse-stream.ts
 */
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {createHarness, serializeAgentEvent, serializeSseComment, writeSseStream, type SseFrame, type SseSubscription} from "@notnotype/nb-harness";
import {scriptedStreamFn} from "@notnotype/nb-harness/testing";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createMemorySessionLog} from "@notnotype/nb-session";

const toFrame = (text: string): SseFrame => ({frame: Buffer.from(text, "utf-8")});

/** 把 push 式的事件回调转成写出器需要的异步可迭代订阅。 */
function createFrameSubscription(): SseSubscription<SseFrame> & {push(frame: SseFrame): void; finish(): void} {
    const controller = new AbortController();
    const queue: SseFrame[] = [];
    let finished = false;
    let wake: (() => void) | undefined;
    const notify = (): void => {
        wake?.();
        wake = undefined;
    };
    controller.signal.addEventListener("abort", notify);

    return {
        connected: toFrame(`${serializeSseComment("connected")}\n`),
        signal: controller.signal,
        close() {
            controller.abort();
        },
        push(frame) {
            queue.push(frame);
            notify();
        },
        finish() {
            finished = true;
            notify();
        },
        async *[Symbol.asyncIterator]() {
            while (true) {
                const next = queue.shift();
                if (next !== undefined) {
                    yield next;
                    continue;
                }
                if (finished || controller.signal.aborted) return;
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
        },
    };
}

const harness = await createHarness({
    model: "deepseek/deepseek-flash",
    cwd: process.cwd(),
    sessionLog: createMemorySessionLog({sessionId: "sse-demo"}),
    node: ProfilePrompt({children: [System({children: ["你是一名写作助手。"]})]}),
    streamFn: scriptedStreamFn("这是经 SSE 推送的回复。"),
    apiKey: () => "offline",
});

const server = createServer((request, response) => {
    const subscription = createFrameSubscription();
    const unsubscribe = harness.subscribe((event) => {
        subscription.push(toFrame(serializeAgentEvent(event)));
        if (event.type === "agent_end") subscription.finish();
    });
    void writeSseStream(response, subscription).finally(unsubscribe);
    void harness.turn(new URL(request.url ?? "/", "http://localhost").searchParams.get("q") ?? "你好");
});

try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/?q=${encodeURIComponent("讲个开头")}`);
    console.log("content-type：", response.headers.get("content-type"));

    const body = await response.text();
    const agentEvents = body
        .split("\n\n")
        .filter((block) => block.startsWith("event: agent"))
        .map((block) => (JSON.parse(block.slice(block.indexOf("data: ") + "data: ".length)) as {type: string}).type);
    console.log("客户端收到的 agent 事件：", agentEvents);
} finally {
    server.close();
    await harness.close();
}
