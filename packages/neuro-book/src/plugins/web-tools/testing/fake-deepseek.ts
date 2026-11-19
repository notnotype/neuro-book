/**
 * 本机起的假 DeepSeek 接口（`/v1/tools/search`、`/v1/tools/fetch`）：记下收到的每个请求，按测试排好的回复作答；没排的搜索
 * 按缺省回一条结果，没排的读取回一页短正文。缺省回复的形状取自 2026-11-19 实测的真实响应（字段名与类型，值是编的；
 * 见 w00052 Work README“已知情况”），真实接口与它的对照在 `web.llm.test.ts`。只由测试使用。
 */

export interface SeenRequest {
    readonly path: string;
    readonly authorization: string | null;
    readonly body: unknown;
}

/** 一个排好的回复：JSON 体与状态码，或自己造的 `Response`（例如不带长度的流式大响应）。 */
export type ScriptedReply = {readonly status?: number; readonly json: unknown; readonly headers?: Readonly<Record<string, string>>} | {readonly response: () => Response} | {readonly hang: true};

export interface FakeDeepSeek {
    readonly baseUrl: string;
    readonly requests: readonly SeenRequest[];
    /** 给某个路径排回复，按先后各用一次。 */
    script(path: "/v1/tools/search" | "/v1/tools/fetch", ...replies: readonly ScriptedReply[]): void;
    /** 放开挂着的请求（以 500 作答），不清记录：断言要数这一轮实际收到了几次请求时用它。 */
    release(): void;
    /** 清掉记录与排好的回复，放开挂着的请求。 */
    reset(): void;
    stop(): void;
}

export const sampleHit = (index: number): Record<string, unknown> => ({
    rerank_score: 1.8 - index / 10,
    title: `网文写作技巧 ${String(index + 1)}`,
    url: `https://example.com/article-${String(index + 1)}`,
    snippet: `片段 ${String(index + 1)}`,
    summary: `摘要 ${String(index + 1)}：黄金三章怎么写。`,
    content: "",
    site_name: "示例站",
    site_icon: null,
    date: "2026-08-02T16:00:00+00:00",
    authority: 3,
});

export function fakeDeepSeek(): FakeDeepSeek {
    const requests: SeenRequest[] = [];
    const queues = new Map<string, ScriptedReply[]>();
    const hanging: Array<() => void> = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const path = new URL(request.url).pathname;
            const text = await request.text();
            let body: unknown = text;
            try {
                body = JSON.parse(text);
            } catch {
                // 原样记下：测试会断言请求体是 JSON。
            }
            requests.push({path, authorization: request.headers.get("authorization"), body});
            const reply = queues.get(path)?.shift();
            if (reply !== undefined) {
                if ("hang" in reply) return new Promise<Response>((resolve) => hanging.push(() => resolve(new Response("gone", {status: 500}))));
                if ("response" in reply) return reply.response();
                return Response.json(reply.json, {status: reply.status ?? 200, ...(reply.headers === undefined ? {} : {headers: reply.headers})});
            }
            if (path === "/v1/tools/search") return Response.json({results: [sampleHit(0), sampleHit(1), sampleHit(2)]});
            if (path === "/v1/tools/fetch") return Response.json({title: "示例页", content: "# 示例\n\n正文第一段。"});
            return Response.json({error: {message: "not found"}}, {status: 404});
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${String(server.port)}`,
        requests,
        script(path, ...replies) {
            queues.set(path, [...(queues.get(path) ?? []), ...replies]);
        },
        release() {
            for (const release of hanging.splice(0)) release();
        },
        reset() {
            requests.length = 0;
            queues.clear();
            for (const release of hanging.splice(0)) release();
        },
        stop() {
            for (const release of hanging.splice(0)) release();
            server.stop(true);
        },
    };
}
