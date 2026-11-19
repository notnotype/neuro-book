// Minimal client for the relay-a channel. Credentials come only from the environment (.env), never from arguments.
/** Retries only transport failures (connection reset, timeout). A retried request may already have been billed; the count is logged as an outcome-unknown attempt. */
// The limit covers reading a streamed body too. A max-effort second review over many long answers can stream past
// 10 minutes (t31 B04), so LUNA_TIMEOUT_MS may raise it for such runs; the default is unchanged.
const REQUEST_TIMEOUT_MS = Number(process.env.LUNA_TIMEOUT_MS ?? 600_000);
export async function postWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await fetch(url, {...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
            // 429 means the gateway rejected the request before processing it, so waiting and resending cannot double-bill.
            if (response.status === 429 && attempt < 8) {
                console.error(JSON.stringify({rateLimitRetry: attempt + 1}));
                await new Promise(resolve => setTimeout(resolve, 20_000 * (attempt + 1)));
                continue;
            }
            return response;
        }
        catch (error) {
            if (attempt >= 3) throw error;
            console.error(JSON.stringify({transportRetry: attempt + 1, error: String(error)}));
            await new Promise(resolve => setTimeout(resolve, 5_000 * (attempt + 1)));
        }
    }
}

export interface LunaResult { status: number; content: string | null; usage: unknown; ms: number; error: string | null }

export async function callLuna(messages: {role: "system" | "user"; content: string}[], options: {maxTokens: number; json?: boolean}): Promise<LunaResult> {
    const base = process.env.NBOOK_LLM_BASE_URL, key = process.env.NBOOK_LLM_API_KEY, model = process.env.NBOOK_LLM_MODEL;
    if (!base || !key || !model) throw new Error("NBOOK_LLM_BASE_URL / NBOOK_LLM_API_KEY / NBOOK_LLM_MODEL are not set");
    const started = Date.now();
    const response = await postWithRetry(`${base}/chat/completions`, {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${key}`},
        body: JSON.stringify({model, messages, max_tokens: options.maxTokens, ...(options.json ? {response_format: {type: "json_object"}} : {})}),
    });
    const body: any = await response.json().catch(() => null);
    return {status: response.status, content: body?.choices?.[0]?.message?.content ?? null, usage: body?.usage ?? null, ms: Date.now() - started,
        error: response.ok ? null : String(body?.error?.message ?? `HTTP ${response.status}`)};
}

export function parseJsonObject(text: string): any {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("no JSON object in reply");
    return JSON.parse(text.slice(start, end + 1));
}

export interface LunaChat { status: number; message: any; usage: any; ms: number; error: string | null }

/** Raw chat call for tool use; the caller owns the message list and tool schema. */
export async function chatLuna(body: Record<string, unknown>): Promise<LunaChat> {
    const base = process.env.NBOOK_LLM_BASE_URL, key = process.env.NBOOK_LLM_API_KEY, model = process.env.NBOOK_LLM_MODEL;
    if (!base || !key || !model) throw new Error("NBOOK_LLM_BASE_URL / NBOOK_LLM_API_KEY / NBOOK_LLM_MODEL are not set");
    const started = Date.now();
    const response = await postWithRetry(`${base}/chat/completions`, {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${key}`},
        body: JSON.stringify({model, ...body}),
    });
    const parsed: any = await response.json().catch(() => null);
    return {status: response.status, message: parsed?.choices?.[0]?.message ?? null, usage: parsed?.usage ?? null, ms: Date.now() - started,
        error: response.ok ? null : String(parsed?.error?.message ?? `HTTP ${response.status}`)};
}

export interface LunaStream { status: number; content: string; finishReason: string | null; usage: any; ms: number; error: string | null }

/** Streamed completion for long calls; the gateway cuts non-streamed requests that run past about 100 s (HTTP 524).
 * A stream that ends without finish_reason is resent up to twice; each resend may already have been billed upstream.
 * `runawayWhitespace` (chars, default 2000): the model occasionally corrupts a JSON token and then emits nothing but
 * whitespace until max_tokens (t33, 2026-10-11: 128k output tokens, 12 minutes, about 0.5 yuan per occurrence). Once that many
 * consecutive whitespace characters arrive the stream is cancelled and the result carries finishReason "runaway"; the
 * usage field is then missing because the gateway sends it only with the final chunk. */
export async function streamLuna(messages: {role: "system" | "user"; content: string}[], options: {maxTokens: number; effort?: string; json?: boolean; runawayWhitespace?: number}): Promise<LunaStream & {resends: number}> {
    const base = process.env.NBOOK_LLM_BASE_URL, key = process.env.NBOOK_LLM_API_KEY, model = process.env.NBOOK_LLM_MODEL;
    if (!base || !key || !model) throw new Error("NBOOK_LLM_BASE_URL / NBOOK_LLM_API_KEY / NBOOK_LLM_MODEL are not set");
    const runawayLimit = options.runawayWhitespace ?? 2000;
    for (let resends = 0; ; resends++) {
        const started = Date.now();
        const response = await postWithRetry(`${base}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key}`},
            body: JSON.stringify({model, messages, max_tokens: options.maxTokens, stream: true, stream_options: {include_usage: true},
                ...(options.effort ? {reasoning_effort: options.effort} : {}), ...(options.json ? {response_format: {type: "json_object"}} : {})})});
        if (!response.ok) {
            const body: any = await response.json().catch(() => null);
            return {status: response.status, content: "", finishReason: null, usage: null, ms: Date.now() - started, error: String(body?.error?.message ?? `HTTP ${response.status}`), resends};
        }
        const decoder = new TextDecoder(); let buffer = "", content = "", finish: string | null = null, usage: any = null, trailingWhitespace = 0;
        try {
            reading: for await (const chunk of response.body as any) {
                buffer += decoder.decode(chunk, {stream: true});
                let newline: number;
                while ((newline = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
                    if (!line.startsWith("data:") || line === "data: [DONE]") continue;
                    const event = JSON.parse(line.slice(5).trim());
                    if (event.usage) usage = event.usage;
                    const choice = event.choices?.[0];
                    const delta: string = choice?.delta?.content ?? "";
                    if (delta) {
                        content += delta;
                        const tail = delta.length - delta.trimEnd().length;
                        trailingWhitespace = tail === delta.length ? trailingWhitespace + tail : tail;
                        // Leaving the for-await cancels the body, which is what stops the gateway from streaming on to max_tokens.
                        if (trailingWhitespace >= runawayLimit) { finish = "runaway"; break reading; }
                    }
                    if (choice?.finish_reason) finish = choice.finish_reason;
                }
            }
        } catch { finish = null; }
        if (finish === "runaway") return {status: response.status, content, finishReason: finish, usage, ms: Date.now() - started, error: `runaway: ${trailingWhitespace} whitespace characters after ${content.length - trailingWhitespace} characters of content`, resends};
        if (finish || resends >= 2) return {status: response.status, content, finishReason: finish, usage, ms: Date.now() - started, error: finish ? null : "stream ended without finish_reason", resends};
    }
}
