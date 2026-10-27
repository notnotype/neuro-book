/**
 * 本机的 OpenAI 兼容端点：按顺序给出脚本里的回复（或由一个函数按请求内容决定回复），记下每次请求带的认证头与正文。
 * 命令行测试用它代替真实模型服务，请求经真实的 OMP provider 或 OpenAI SDK 与 HTTP 发出（写法同 nb-harness 的
 * tests/provider.test.ts）。
 *
 * 发到 `/responses` 的请求按 Responses 接口的流式事件回复（只支持 `text`、`tools`、`status`，`text` 不支持自定的结束原因与用量，事件形状照 OMP
 * `openai-responses` 解析的那些），别的路径按 Chat Completions 回复。`thinking` 在 Responses 里是思考摘要，在
 * Chat Completions 里是 `reasoning_content`（deepseek 一类服务的写法）。
 */

export type EndpointReply =
    | {kind: "tools"; calls: {name: string; args: Record<string, unknown>}[]; thinking?: string}
    /** 正常的文字回复；`finishReason` 默认 `stop`，`usage` 默认一组固定的小数。 */
    | {kind: "text"; text: string; finishReason?: string; usage?: Record<string, unknown>; thinking?: string}
    /** 先给这段文字，然后一直输出空白，直到请求被取消（“跑飞”）。 */
    | {kind: "runaway"; text: string}
    /** 给这段文字后直接结束，没有结束原因也没有用量（流中断）。 */
    | {kind: "cut"; text: string}
    /** HTTP 200 开始流，流到一半发一个错误事件（luna 渠道的 upstream_error 就是这样）。 */
    | {kind: "stream-error"; message: string}
    /** 先给这段文字，然后不再输出也不结束，直到请求被取消（卡住的流）。 */
    | {kind: "stall"; text: string}
    /** 已经发了文字、结束原因与用量，但不发结束标记、不关连接，直到请求被取消。 */
    | {kind: "finish-then-hang"; text: string}
    /** 原样发这段流正文（用来发坏的流数据）。 */
    | {kind: "raw"; body: string}
    /** 回错误状态码；`echoKey` 时错误正文里原样带上收到的认证头，`message` 优先作为错误正文。 */
    | {kind: "status"; status: number; echoKey?: boolean; message?: string}
    /** 不回应，直到请求被取消。 */
    | {kind: "hang"}
    /** 等 `ready` 完成后照 `reply` 回复；等的时候请求被取消就结束。 */
    | {kind: "after"; ready: Promise<void>; reply: EndpointReply};

export interface Endpoint {
    readonly url: string;
    /** 每次请求的认证头。 */
    readonly authorizations: (string | null)[];
    /** 每次请求的 JSON 正文。 */
    readonly bodies: Record<string, unknown>[];
    /** 第一次收到请求时 resolve。 */
    readonly firstRequest: Promise<void>;
    stop(): void;
}

function sse(chunks: object[]): string {
    return `${chunks.map(chunk => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...chunk})}\n\n`).join("")}data: [DONE]\n\n`;
}

/** Responses 接口的一串流式事件。 */
function responsesSse(events: Record<string, unknown>[]): string {
    return events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/** `text`、`tools` 回复按 Responses 接口的事件写出：思考摘要（有时）、文字或工具调用、`response.completed`。 */
function responsesReply(reply: Extract<EndpointReply, {kind: "text" | "tools"}>, nextCall: () => number): string {
    const events: Record<string, unknown>[] = [{type: "response.created", response: {id: "resp_1", status: "in_progress", output: []}}];
    let index = 0;
    if (reply.thinking !== undefined) {
        const id = "rs_1";
        const at = {item_id: id, output_index: index, summary_index: 0};
        const part = {type: "summary_text", text: reply.thinking};
        events.push(
            {type: "response.output_item.added", output_index: index, item: {type: "reasoning", id, summary: []}},
            {type: "response.reasoning_summary_part.added", ...at, part: {type: "summary_text", text: ""}},
            {type: "response.reasoning_summary_text.delta", ...at, delta: reply.thinking},
            {type: "response.reasoning_summary_text.done", ...at, text: reply.thinking},
            {type: "response.reasoning_summary_part.done", ...at, part},
            {type: "response.output_item.done", output_index: index, item: {type: "reasoning", id, summary: [part]}},
        );
        index += 1;
    }
    if (reply.kind === "text") {
        const id = "msg_1";
        const at = {item_id: id, output_index: index, content_index: 0};
        const content = {type: "output_text", text: reply.text, annotations: []};
        events.push(
            {type: "response.output_item.added", output_index: index, item: {type: "message", id, role: "assistant", status: "in_progress", content: []}},
            {type: "response.content_part.added", ...at, part: {type: "output_text", text: "", annotations: []}},
            {type: "response.output_text.delta", ...at, delta: reply.text},
            {type: "response.output_text.done", ...at, text: reply.text},
            {type: "response.output_item.done", output_index: index, item: {type: "message", id, role: "assistant", status: "completed", content: [content]}},
        );
    } else {
        for (const call of reply.calls) {
            const number = nextCall();
            const item = {type: "function_call", id: `fc_${number}`, call_id: `call_${number}`, name: call.name};
            const args = JSON.stringify(call.args);
            events.push(
                {type: "response.output_item.added", output_index: index, item: {...item, arguments: "", status: "in_progress"}},
                {type: "response.function_call_arguments.delta", item_id: item.id, output_index: index, delta: args},
                {type: "response.function_call_arguments.done", item_id: item.id, output_index: index, arguments: args},
                {type: "response.output_item.done", output_index: index, item: {...item, arguments: args, status: "completed"}},
            );
            index += 1;
        }
    }
    const usage = {input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}};
    events.push({type: "response.completed", response: {id: "resp_1", status: "completed", output: [], usage}});
    return responsesSse(events);
}

/** 按请求决定回复；`index` 是这是第几次请求（从 0 起）。 */
export type Responder = (body: Record<string, unknown>, index: number, headers: Headers) => EndpointReply;

/** `GET <地址>/models` 的回应：`models` 列出模型名，`status` 回这个状态码。不给时是空列表。“连不上”用关掉的端口测。 */
export type ModelsReply = {kind: "models"; ids: string[]} | {kind: "status"; status: number};

/**
 * `idleTimeoutSeconds` 是端点自己的空闲超时（Bun 默认 10 秒没有收发就断开）：要让请求挂得比这更久时给 0。`models`
 * 决定 `GET /models` 怎么回（设置页读服务的模型列表）；这类请求不算进 `bodies` 与脚本。
 */
export function startEndpoint(replies: EndpointReply[] | Responder, options: {idleTimeoutSeconds?: number; models?: () => ModelsReply} = {}): Endpoint {
    const authorizations: (string | null)[] = [];
    const bodies: Record<string, unknown>[] = [];
    let signalFirst!: () => void;
    const firstRequest = new Promise<void>(resolve => (signalFirst = resolve));
    let calls = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...(options.idleTimeoutSeconds === undefined ? {} : {idleTimeout: options.idleTimeoutSeconds}),
        async fetch(request) {
            if (request.method === "GET" && new URL(request.url).pathname.endsWith("/models")) {
                const models = options.models?.() ?? {kind: "models", ids: []};
                return models.kind === "status" ? new Response("no", {status: models.status}) : Response.json({object: "list", data: models.ids.map(id => ({id, object: "model"}))});
            }
            authorizations.push(request.headers.get("authorization"));
            signalFirst();
            const body = JSON.parse(await request.text()) as Record<string, unknown>;
            bodies.push(body);
            let reply = typeof replies === "function" ? replies(body, bodies.length - 1, request.headers) : replies.shift() ?? {kind: "text", text: "脚本用完了"};
            while (reply.kind === "after") {
                const aborted = new Promise<"aborted">(resolve => request.signal.addEventListener("abort", () => resolve("aborted"), {once: true}));
                if ((await Promise.race([reply.ready.then(() => "ready" as const), aborted])) === "aborted") return new Response(null, {status: 499});
                reply = reply.reply;
            }
            const usage = {choices: [], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
            const encoder = new TextEncoder();
            if (new URL(request.url).pathname.endsWith("/responses") && reply.kind !== "status") {
                if (reply.kind !== "text" && reply.kind !== "tools") throw new Error(`测试端点的 Responses 接口不支持 ${reply.kind} 回复`);
                // 截断与自定的用量在 Responses 里是另一套事件（response.incomplete 等），这里没写：明确拒绝，免得照 Chat 写的脚本悄悄测成普通成功。
                if (reply.kind === "text" && (reply.finishReason !== undefined || reply.usage !== undefined)) throw new Error("测试端点的 Responses 接口不支持自定的 finishReason 与 usage");
                return new Response(responsesReply(reply, () => (calls += 1)), {headers: {"content-type": "text/event-stream"}});
            }
            // Chat Completions 的思考内容：在正文之前单独一块。
            const reasoning = (reply.kind === "text" || reply.kind === "tools") && reply.thinking !== undefined ? [{choices: [{index: 0, delta: {role: "assistant", reasoning_content: reply.thinking}, finish_reason: null}]}] : [];
            switch (reply.kind) {
                case "status": {
                    const message = reply.message ?? (reply.echoKey ? `invalid api key: ${request.headers.get("authorization") ?? ""}` : "error");
                    return new Response(JSON.stringify({error: {message}}), {status: reply.status, headers: {"content-type": "application/json"}});
                }
                case "hang":
                    return new Promise<Response>(resolve => request.signal.addEventListener("abort", () => resolve(new Response(null, {status: 499}))));
                case "text":
                    return new Response(
                        sse([
                            ...reasoning,
                            {choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]},
                            {choices: [{index: 0, delta: {}, finish_reason: reply.finishReason ?? "stop"}]},
                            reply.usage ? {choices: [], usage: reply.usage} : usage,
                        ]),
                        {headers: {"content-type": "text/event-stream"}},
                    );
                case "stall":
                case "finish-then-hang": {
                    const chunks = [{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}];
                    if (reply.kind === "finish-then-hang") chunks.push({choices: [{index: 0, delta: {}, finish_reason: "stop"}]} as never, usage as never);
                    const head = sse(chunks).replace("data: [DONE]\n\n", "");
                    // 写完这些就不再写，也不关：直到客户端取消读取或请求被中止。
                    const stream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(encoder.encode(head));
                            request.signal.addEventListener("abort", () => controller.close(), {once: true});
                        },
                    });
                    return new Response(stream, {headers: {"content-type": "text/event-stream"}});
                }
                case "raw":
                    return new Response(reply.body, {headers: {"content-type": "text/event-stream"}});
                case "stream-error": {
                    const first = sse([{choices: [{index: 0, delta: {role: "assistant", content: "{"}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    return new Response(`${first}data: ${JSON.stringify({error: {message: reply.message, type: "upstream_error"}})}\n\n`, {headers: {"content-type": "text/event-stream"}});
                }
                case "cut": {
                    const chunk = sse([{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    return new Response(chunk, {headers: {"content-type": "text/event-stream"}});
                }
                case "runaway": {
                    const first = sse([{choices: [{index: 0, delta: {role: "assistant", content: reply.text}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    const blank = sse([{choices: [{index: 0, delta: {content: " ".repeat(500)}, finish_reason: null}]}]).replace("data: [DONE]\n\n", "");
                    // 一直写空白，直到客户端取消读取（cancel）或请求被中止。
                    const stream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(encoder.encode(first));
                        },
                        pull(controller) {
                            if (request.signal.aborted) {
                                controller.close();
                                return;
                            }
                            controller.enqueue(encoder.encode(blank));
                        },
                    });
                    return new Response(stream, {headers: {"content-type": "text/event-stream"}});
                }
                case "tools": {
                    const toolCalls = reply.calls.map((call, index) => {
                        calls += 1;
                        return {index, id: `call_${calls}`, type: "function", function: {name: call.name, arguments: JSON.stringify(call.args)}};
                    });
                    return new Response(sse([...reasoning, {choices: [{index: 0, delta: {role: "assistant", tool_calls: toolCalls}, finish_reason: null}]}, {choices: [{index: 0, delta: {}, finish_reason: "tool_calls"}]}, usage]), {
                        headers: {"content-type": "text/event-stream"},
                    });
                }
            }
        },
    });
    return {url: `http://127.0.0.1:${server.port}/v1`, authorizations, bodies, firstRequest, stop: () => server.stop(true)};
}
