/**
 * 本机起的假搜索服务的公共部分：记下收到的每个请求，按测试排好的回复作答，没排的交给每家自己的缺省回复。各家的路径与缺省回复
 * 在 `fake-deepseek.ts`、`fake-tavily.ts`。只由测试使用。
 */

export interface SeenRequest {
    readonly path: string;
    readonly authorization: string | null;
    readonly body: unknown;
}

/** 一个排好的回复：JSON 体与状态码，或自己造的 `Response`（例如不带长度的流式大响应），或一直挂着。 */
export type ScriptedReply = {readonly status?: number; readonly json: unknown; readonly headers?: Readonly<Record<string, string>>} | {readonly response: () => Response} | {readonly hang: true};

export interface FakeService<Path extends string> {
    readonly baseUrl: string;
    readonly requests: readonly SeenRequest[];
    /** 给某个路径排回复，按先后各用一次。 */
    script(path: Path, ...replies: readonly ScriptedReply[]): void;
    /** 按请求体挑回复（几个请求同时到、先后不定时用）：交回 `undefined` 的照排好的或缺省的回复。在 `reset` 之前一直有效。 */
    route(path: Path, choose: (body: unknown) => ScriptedReply | undefined): void;
    /** 从现在起先把请求挂住，直到又收到 `count` 个请求才一起放行（断言几个请求同时在途时用）。 */
    holdUntil(count: number): void;
    /** 放开挂着的请求（以 500 作答），不清记录：断言要数这一轮实际收到了几次请求时用它。 */
    release(): void;
    /** 清掉记录、排好的回复与挑选规则，放开挂着的请求。 */
    reset(): void;
    stop(): void;
}

export function fakeService<Path extends string>(defaults: (path: string, body: unknown) => Response): FakeService<Path> {
    const requests: SeenRequest[] = [];
    const queues = new Map<string, ScriptedReply[]>();
    const routes = new Map<string, (body: unknown) => ScriptedReply | undefined>();
    const hanging: Array<() => void> = [];
    let gate: {readonly count: number; readonly base: number; readonly waiting: Array<() => void>} | null = null;
    const openGate = (): void => {
        const waiting = gate?.waiting.splice(0) ?? [];
        gate = null;
        for (const resume of waiting) resume();
    };
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
            const held = gate;
            if (held !== null) {
                if (requests.length - held.base < held.count) await new Promise<void>((resume) => held.waiting.push(resume));
                else openGate();
            }
            const reply = routes.get(path)?.(body) ?? queues.get(path)?.shift();
            if (reply !== undefined) {
                if ("hang" in reply) return new Promise<Response>((resolve) => hanging.push(() => resolve(new Response("gone", {status: 500}))));
                if ("response" in reply) return reply.response();
                return Response.json(reply.json, {status: reply.status ?? 200, ...(reply.headers === undefined ? {} : {headers: reply.headers})});
            }
            return defaults(path, body);
        },
    });
    const releaseAll = (): void => {
        openGate();
        for (const release of hanging.splice(0)) release();
    };
    return {
        baseUrl: `http://127.0.0.1:${String(server.port)}`,
        requests,
        script(path, ...replies) {
            queues.set(path, [...(queues.get(path) ?? []), ...replies]);
        },
        route(path, choose) {
            routes.set(path, choose);
        },
        holdUntil(count) {
            gate = {count, base: requests.length, waiting: []};
        },
        release: releaseAll,
        reset() {
            requests.length = 0;
            queues.clear();
            routes.clear();
            releaseAll();
        },
        stop() {
            releaseAll();
            server.stop(true);
        },
    };
}
