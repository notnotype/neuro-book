/**
 * 测试用的本机 OpenAI 兼容端点：按脚本一次请求回一条（文字、工具调用或错误状态码），记下每次请求的工具名与消息。`hold()` 让下一次
 * 请求挂着、直到测试放行，看运行中的行为。只由测试使用。
 *
 * 几个会话同时发请求时（父会话与子代理），请求到达的先后由 I/O 决定，一条全局队列会被交错着取走。`scriptFor(text, …)` 给第一条
 * 用户消息含 `text` 的会话单开一条队列：子代理的第一条用户消息就是派它时的 `prompt`，各子代理给不同的 `prompt` 就各取各的。
 * 挂起同理：`hold()` 挂的是下一个到达的请求，不管是谁的；`holdFor(text, n)` 只挂这个会话从现在起的第 n 个请求。
 * 会话压缩之后，请求的第一条用户消息是摘要、不再含派它时的 `prompt`：之后的请求按 `text` 认不出，取全局队列、`holdFor` 也挂不住，
 * 改用 `script` 与 `hold()`（w00043 t14）。
 */

/** 一条回复：一段文字、分几块流出的文字、一次或几次工具调用（`chunked`：参数分块流出），或一个错误状态码。 */
export type Scripted = string | {readonly status: number} | {readonly chunks: readonly string[]} | {readonly tools: ReadonlyArray<{readonly tool: string; readonly args?: Readonly<Record<string, unknown>>}>; readonly chunked?: boolean} | {readonly tool: string; readonly args?: Readonly<Record<string, unknown>>};

export interface SeenRequest {
    readonly model: string;
    readonly tools: readonly string[];
    /** 每个工具交给模型的说明，按名字。 */
    readonly descriptions: Readonly<Record<string, string>>;
    readonly messages: readonly {readonly role: string; readonly content?: unknown}[];
    readonly system: string;
    /** 请求体里压缩要看的字段：`tool_choice`、输出上限、推理档。 */
    readonly options: {readonly toolChoice?: unknown; readonly maxTokens?: number; readonly reasoningEffort?: string};
}

export interface FakeEndpoint {
    readonly baseUrl: string;
    readonly requests: readonly SeenRequest[];
    script(...replies: Scripted[]): void;
    /** 第一条用户消息含 `text` 的请求从这条队列取（先于全局队列）；用完之后落到全局队列。 */
    scriptFor(text: string, ...replies: Scripted[]): void;
    /** 下一次请求到达后挂住，交回放行函数与“已到达”的 Promise。 */
    hold(): {readonly arrived: Promise<void>; release(): void};
    /** 从现在起第一条用户消息含 `text` 的第 `nth` 个请求（缺省 1）到达后挂住；它不占 `hold()` 的挂起。 */
    holdFor(text: string, nth?: number): {readonly arrived: Promise<void>; release(): void};
    /** 丢掉没用完的脚本与挂起（每个测试之后调，免得上一个测试剩下的回复串到下一个）。 */
    reset(): void;
    stop(): void;
}

const chunk = (payload: object): string => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...payload})}\n\n`;

function holdGate(): {readonly arrived: () => void; readonly released: Promise<void>; readonly handle: {readonly arrived: Promise<void>; release(): void}} {
    let arrived!: () => void;
    let release!: () => void;
    const arrivedPromise = new Promise<void>((resolve) => {
        arrived = resolve;
    });
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {arrived, released, handle: {arrived: arrivedPromise, release}};
}

export function fakeEndpoint(): FakeEndpoint {
    const queue: Scripted[] = [];
    const routes: {readonly text: string; readonly replies: Scripted[]}[] = [];
    const requests: SeenRequest[] = [];
    const holds: {arrived: () => void; released: Promise<void>}[] = [];
    const routeHolds: {readonly text: string; skip: number; readonly arrived: () => void; readonly released: Promise<void>}[] = [];
    let calls = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const body = await request.json() as {tool_choice?: unknown; max_completion_tokens?: number; max_tokens?: number; reasoning_effort?: string; model: string; tools?: {function: {name: string; description?: string}}[]; messages?: {role: string; content?: unknown}[]};
            const messages = body.messages ?? [];
            requests.push({
                model: body.model,
                tools: (body.tools ?? []).map((tool) => tool.function.name),
                descriptions: Object.fromEntries((body.tools ?? []).map((tool) => [tool.function.name, tool.function.description ?? ""])),
                messages,
                options: {toolChoice: body.tool_choice, maxTokens: body.max_completion_tokens ?? body.max_tokens, reasoningEffort: body.reasoning_effort},
                system: messages.filter((message) => message.role === "system").map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n"),
            });
            const firstUser = messages.find((message) => message.role === "user");
            const firstText = firstUser === undefined ? "" : typeof firstUser.content === "string" ? firstUser.content : JSON.stringify(firstUser.content);
            const matching = routeHolds.filter((item) => firstText.includes(item.text));
            const routeHold = matching.find((item) => item.skip === 0);
            for (const item of matching) if (item.skip > 0) item.skip -= 1;
            const hold = routeHold ?? (matching.length === 0 ? holds.shift() : undefined);
            if (routeHold !== undefined) routeHolds.splice(routeHolds.indexOf(routeHold), 1);
            if (hold !== undefined) {
                hold.arrived();
                await hold.released;
            }
            const route = routes.find((item) => item.replies.length > 0 && firstText.includes(item.text));
            const reply = route?.replies.shift() ?? queue.shift() ?? "好";
            calls += 1;
            if (typeof reply === "object" && "status" in reply) return Response.json({error: {message: "Service overloaded"}}, {status: reply.status});
            const texts = typeof reply === "string" ? [reply] : "chunks" in reply ? reply.chunks : null;
            const toolCalls = (scripted: {readonly tool: string; readonly args?: unknown}, index: number, chunked: boolean): string[] => {
                const id = `call-${String(calls)}-${String(index)}`;
                const args = JSON.stringify(scripted.args ?? {});
                // 分块时第一块只带名字，参数切成几段：服务商给长参数就是这样流式的。
                const pieces = chunked ? ["", args.slice(0, Math.ceil(args.length / 2)), args.slice(Math.ceil(args.length / 2))] : [args];
                return pieces.map((piece, position) => chunk({choices: [{index: 0, delta: {role: "assistant", tool_calls: [{index, ...(position === 0 ? {id, type: "function"} : {}), function: {...(position === 0 ? {name: scripted.tool} : {}), arguments: piece}}]}, finish_reason: null}]}));
            };
            const scriptedCalls = typeof reply === "object" && "tools" in reply ? reply.tools : typeof reply === "object" && "tool" in reply ? [reply] : [];
            const chunked = typeof reply === "object" && "chunked" in reply && reply.chunked === true;
            const parts = texts !== null
                ? [...texts.map((text) => chunk({choices: [{index: 0, delta: {role: "assistant", content: text}, finish_reason: null}]})), chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})]
                : [
                    ...scriptedCalls.flatMap((call, index) => toolCalls(call, index, chunked)),
                    chunk({choices: [{index: 0, delta: {}, finish_reason: "tool_calls"}]}),
                ];
            parts.push(chunk({choices: [], usage: {prompt_tokens: 12, completion_tokens: 3, total_tokens: 15}}));
            return new Response(`${parts.join("")}data: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${String(server.port)}/v1`,
        requests,
        script: (...replies) => {
            queue.push(...replies);
        },
        scriptFor: (text, ...replies) => {
            const existing = routes.find((item) => item.text === text);
            if (existing === undefined) routes.push({text, replies: [...replies]});
            else existing.replies.push(...replies);
        },
        hold: () => {
            const gate = holdGate();
            holds.push(gate);
            return gate.handle;
        },
        holdFor: (text, nth = 1) => {
            const gate = holdGate();
            routeHolds.push({text, skip: nth - 1, arrived: gate.arrived, released: gate.released});
            return gate.handle;
        },
        reset: () => {
            queue.length = 0;
            routes.length = 0;
            holds.length = 0;
            routeHolds.length = 0;
        },
        stop: () => {
            void server.stop(true);
        },
    };
}

/** 把一个不要密钥的本机服务商与它的模型写进用户层设置，并把 `main` 角色绑到它（`nbook.models` 的设置项形状）。 */
export function localModelSettings(baseUrl: string, options: {readonly compactionRole?: boolean} = {}): Record<string, unknown> {
    return {
        "nbook.models/providers": [{id: "local", kind: "custom", name: "本机", baseUrl, api: "openai-completions", auth: "none", models: [{id: "m", enabled: true, contextWindow: 32_000}]}],
        "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? "local/m" : null})).concat([{id: "compaction", axis: "specialist", name: "", description: "", model: options.compactionRole === true ? "local/m" : null}])},
    };
}
