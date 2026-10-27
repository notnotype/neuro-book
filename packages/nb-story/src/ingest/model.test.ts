/**
 * 抽取的模型调用（docs/specs/story/ingest.md 输出 9、13）：真实的 OpenAI SDK、真实的 HTTP，等待由注入的函数记下。
 * 这里锁的是传输层自己的几件事：真实断流与卡住的流按渠道失败重发，SDK 的日志里没有密钥，结束之后才被中止的请求
 * 算中止。按步骤的重试与不成形回复在 chapter.test.ts。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {createServer, type Server, type Socket} from "node:net";
import {join} from "node:path";

import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {callModel, ModelAborted, ModelError, type Attempt} from "./model";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function endpointOf(replies: EndpointReply[]): Endpoint {
    const endpoint = startEndpoint(replies);
    cleanups.push(() => endpoint.stop());
    return endpoint;
}

const ok: EndpointReply = {kind: "text", text: '{"ok":true}'};
const call = (url: string, extra: Partial<Parameters<typeof callModel>[1]> = {}) => {
    const waits: number[] = [];
    const attempts: Attempt[] = [];
    const promise = callModel({baseUrl: url, model: "m", apiKey: "model-test-credential", maxTokens: 100}, {
        system: "s", user: "u", effort: "minimal",
        sleep: async ms => {
            waits.push(ms);
        },
        onAttempt: attempt => attempts.push(attempt),
        ...extra,
    });
    return {promise, waits, attempts};
};

describe("渠道失败按表重发（输出 9）", () => {
    test("读流时 TCP 连接断了（响应头已到、流没结束）：按网络失败重发", async () => {
        // 真实的 TCP 服务：第一个连接回响应头与一个片段后直接断开，之后的连接正常回完。
        let connections = 0;
        const sockets = new Set<Socket>();
        const server: Server = createServer(socket => {
            sockets.add(socket);
            connections += 1;
            const first = connections === 1;
            socket.once("data", () => {
                const chunk = (data: string) => `${Buffer.byteLength(data).toString(16)}\r\n${data}\r\n`;
                const delta = `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{index: 0, delta: {role: "assistant", content: '{"ok":'}, finish_reason: null}]})}\n\n`;
                socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n");
                socket.write(chunk(delta));
                if (first) {
                    socket.destroy();
                    return;
                }
                const rest = `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{index: 0, delta: {content: "true}"}, finish_reason: "stop"}]})}\n\ndata: [DONE]\n\n`;
                socket.end(`${chunk(rest)}0\r\n\r\n`);
            });
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        cleanups.push(() => {
            for (const socket of sockets) socket.destroy();
            return new Promise(resolve => server.close(resolve));
        });
        const address = server.address() as {port: number};
        const run = call(`http://127.0.0.1:${address.port}/v1`);
        const reply = await run.promise;
        expect(reply.json).toEqual({ok: true});
        expect(connections).toBe(2);
        expect(run.waits).toEqual([30_000]);
        expect(run.attempts.map(attempt => attempt.error?.kind ?? "ok")).toEqual(["network", "ok"]);
    });

    test("流开始之后卡住不动：超过时限按网络失败重发（SDK 的超时只管到响应头）", async () => {
        const endpoint = endpointOf([{kind: "stall", text: '{"ok":'}, ok]);
        const run = call(endpoint.url, {timeoutMs: 300});
        expect((await run.promise).json).toEqual({ok: true});
        expect(run.waits).toEqual([30_000]);
        expect(run.attempts.map(attempt => [attempt.error?.kind ?? "ok", attempt.usage.complete])).toEqual([["network", false], ["ok", true]]);
    });
});

describe("推理档被端点拒绝（输出 9）", () => {
    test("400 列出合法档位：minimal 改到 low 重发一次，不等待", async () => {
        const endpoint = endpointOf([
            {kind: "status", status: 400, message: "Unsupported value: 'minimal' is not supported with the 'm' model. Supported values are: 'none', 'low', 'medium', 'high'."},
            ok,
        ]);
        const run = call(endpoint.url);
        expect((await run.promise).json).toEqual({ok: true});
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["minimal", "low"]);
        expect(run.waits).toEqual([]);
        expect(run.attempts.map(attempt => attempt.error?.kind ?? "ok")).toEqual(["provider", "ok"]);
    });

    test("400 没有列出档位：不换档，按 provider 失败抛出", async () => {
        const endpoint = endpointOf([{kind: "status", status: 400, message: "bad request"}]);
        const run = call(endpoint.url);
        await expect(run.promise).rejects.toMatchObject({kind: "provider", status: 400});
        expect(endpoint.bodies.length).toBe(1);
    });
});

describe("密钥（ingest 副作用与数据）", () => {
    test("流数据坏了、里面回显了密钥：进程的全部输出（含 SDK 自己的日志）里都没有密钥", async () => {
        const key = "model-child-credential-0042";
        const endpoint = endpointOf([{kind: "raw", body: `data: {坏的 ${key}\n\n`}]);
        const child = Bun.spawn(["bun", join(import.meta.dir, "..", "..", "testing", "model-child.ts"), endpoint.url], {stdout: "pipe", stderr: "pipe", env: {...process.env, MODEL_CHILD_KEY: key}});
        cleanups.push(async () => {
            child.kill("SIGKILL");
            await child.exited;
        });
        const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
        await child.exited;
        expect(stdout).toContain("outcome ");
        expect(`${stdout}${stderr}`).not.toContain(key);
    });
});

describe("停止（输出 11、13）", () => {
    test("已经收到结束原因与用量、连接还没关时停止：算中止，这次的用量标不完整", async () => {
        const endpoint = endpointOf([{kind: "finish-then-hang", text: '{"ok":true}'}]);
        const controller = new AbortController();
        // 真实的 fetch，只在看到结束原因那批字节到了之后，下一轮再停止。
        const watching = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const response = await fetch(input, init);
            const reader = response.body!.getReader();
            const body = new ReadableStream<Uint8Array>({
                async pull(stream) {
                    const {done, value} = await reader.read();
                    if (done) {
                        stream.close();
                        return;
                    }
                    stream.enqueue(value);
                    if (new TextDecoder().decode(value).includes('"finish_reason":"stop"')) setTimeout(() => controller.abort(), 0);
                },
                cancel: reason => reader.cancel(reason),
            });
            return new Response(body, {status: response.status, headers: response.headers});
        }) as typeof fetch;
        const run = call(endpoint.url, {signal: controller.signal, fetch: watching});
        const outcome = await run.promise.then(() => "ok", (error: unknown) => (error instanceof ModelAborted ? "aborted" : error instanceof ModelError ? error.kind : "other"));
        expect(outcome).toBe("aborted");
        expect(run.attempts.map(attempt => attempt.usage.complete)).toEqual([false]);
    });
});
