/**
 * 测试用的本机 OpenAI 兼容端点：按脚本一次请求回一条（文字或工具调用），记下每次请求的工具名与消息。`hold()` 让下一次
 * 请求挂着、直到测试放行，看运行中的行为。只由测试使用。
 */

export type Scripted = string | {readonly tool: string; readonly args?: Readonly<Record<string, unknown>>};

export interface SeenRequest {
    readonly tools: readonly string[];
    readonly messages: readonly {readonly role: string; readonly content?: unknown}[];
    readonly system: string;
}

export interface FakeEndpoint {
    readonly baseUrl: string;
    readonly requests: readonly SeenRequest[];
    script(...replies: Scripted[]): void;
    /** 下一次请求到达后挂住，交回放行函数与“已到达”的 Promise。 */
    hold(): {readonly arrived: Promise<void>; release(): void};
    stop(): void;
}

const chunk = (payload: object): string => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...payload})}\n\n`;

export function fakeEndpoint(): FakeEndpoint {
    const queue: Scripted[] = [];
    const requests: SeenRequest[] = [];
    const holds: {arrived: () => void; released: Promise<void>}[] = [];
    let calls = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const body = await request.json() as {tools?: {function: {name: string}}[]; messages?: {role: string; content?: unknown}[]};
            const messages = body.messages ?? [];
            requests.push({
                tools: (body.tools ?? []).map((tool) => tool.function.name),
                messages,
                system: messages.filter((message) => message.role === "system").map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n"),
            });
            const hold = holds.shift();
            if (hold !== undefined) {
                hold.arrived();
                await hold.released;
            }
            const reply = queue.shift() ?? "好";
            calls += 1;
            const parts = typeof reply === "string"
                ? [chunk({choices: [{index: 0, delta: {role: "assistant", content: reply}, finish_reason: null}]}), chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})]
                : [
                    chunk({choices: [{index: 0, delta: {role: "assistant", tool_calls: [{index: 0, id: `call-${String(calls)}`, type: "function", function: {name: reply.tool, arguments: JSON.stringify(reply.args ?? {})}}]}, finish_reason: null}]}),
                    chunk({choices: [{index: 0, delta: {}, finish_reason: "tool_calls"}]}),
                ];
            return new Response(`${parts.join("")}data: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${String(server.port)}/v1`,
        requests,
        script: (...replies) => {
            queue.push(...replies);
        },
        hold: () => {
            let arrived!: () => void;
            let release!: () => void;
            const arrivedPromise = new Promise<void>((resolve) => {
                arrived = resolve;
            });
            const released = new Promise<void>((resolve) => {
                release = resolve;
            });
            holds.push({arrived, released});
            return {arrived: arrivedPromise, release};
        },
        stop: () => {
            void server.stop(true);
        },
    };
}

/** 把一个不要密钥的本机服务商与它的模型写进用户层设置，并把 `main` 角色绑到它（`nbook.models` 的设置项形状）。 */
export function localModelSettings(baseUrl: string): Record<string, unknown> {
    return {
        "nbook.models/providers": [{id: "local", kind: "custom", name: "本机", baseUrl, api: "openai-completions", auth: "none", models: [{id: "m", enabled: true, contextWindow: 32_000}]}],
        "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? "local/m" : null})).concat([{id: "compaction", axis: "specialist", name: "", description: "", model: null}])},
    };
}
