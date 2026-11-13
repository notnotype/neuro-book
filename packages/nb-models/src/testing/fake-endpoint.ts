/**
 * 本机的 OpenAI 兼容假端点：`/models` 列出模型，聊天补全回一段流（内容“好”、正常结束）。可以让下一次补全回 401 或 503，
 * 用来测检测与重发。只给测试用，发往它的密钥都是假的。
 */

export interface FakeOpenAiEndpoint {
    /** 带 `/v1` 的地址，填进服务商的 `baseUrl`。 */
    readonly baseUrl: string;
    /** 收到的每个请求的路径与 `authorization` 头。 */
    readonly seen: ReadonlyArray<{readonly path: string; readonly authorization: string | null}>;
    /** 下一次补全请求回 401（密钥不对）或 503（服务过载）。 */
    failNext(kind: "unauthorized" | "overloaded"): void;
    stop(): Promise<void>;
}

export function startFakeOpenAiEndpoint(options: {readonly models?: ReadonlyArray<string>} = {}): FakeOpenAiEndpoint {
    const models = options.models ?? ["qwen3:8b", "gemma3:12b"];
    const seen: Array<{readonly path: string; readonly authorization: string | null}> = [];
    let next: "unauthorized" | "overloaded" | null = null;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const path = new URL(request.url).pathname;
            const authorization = request.headers.get("authorization");
            seen.push({path, authorization});
            if (path.endsWith("/models")) return Response.json({object: "list", data: models.map((id) => ({id, object: "model"}))});
            await request.text();
            const failure = next;
            next = null;
            if (failure === "overloaded") return Response.json({error: {message: "Service overloaded"}}, {status: 503});
            if (failure === "unauthorized") return Response.json({error: {message: `invalid key ${authorization ?? ""}`}}, {status: 401});
            const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
            return new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]}) + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${String(server.port)}/v1`,
        seen,
        failNext: (kind) => {
            next = kind;
        },
        stop: () => server.stop(true),
    };
}
