/**
 * t04 实测：服务商接不接受“历史里调用过、本次 tools 里没有的工具”，以及工具名长度上限。
 *
 * 从仓库根运行：bun .agents/works/w00032-agent-integration/tasks/t04-tool-registry/scripts/probe-tool-history.ts
 * 密钥取仓库根 .env（Bun 自动加载），只打印状态码与错误正文的前 300 字，不打印密钥。
 *
 * 每个端点四种情况：
 * - unlisted：历史里有 `old__lookup` 的调用与结果，本次 tools 只有 `new__search`；
 * - no-tools：同样的历史，本次请求不带 tools；
 * - name-65、name-128：只带一个名字为 65、128 个字符（含 `__`）的工具，问一句普通的话。
 */

type Endpoint = {label: string; kind: "chat" | "responses" | "anthropic"; base: string; key: string | undefined; model: string};

const or = "https://openrouter.ai/api/v1";
const endpoints: Endpoint[] = [
    {label: "deepseek chat", kind: "chat", base: "https://api.deepseek.com/v1", key: process.env.DEEPSEEK_API_KEY, model: "deepseek-flash"},
    // DeepSeek 的 Anthropic 兼容接口：校验是 DeepSeek 自己做的，不等于 Anthropic 官方的行为。
    {label: "deepseek anthropic-compat messages", kind: "anthropic", base: "https://api.deepseek.com/anthropic/v1", key: process.env.DEEPSEEK_API_KEY, model: "deepseek-flash"},
    {label: "luna chat", kind: "chat", base: process.env.NBOOK_LLM_BASE_URL ?? "", key: process.env.NBOOK_LLM_API_KEY, model: "gpt-6-luna"},
    {label: "luna responses", kind: "responses", base: process.env.NBOOK_LLM_BASE_URL ?? "", key: process.env.NBOOK_LLM_API_KEY, model: "gpt-6-luna"},
    {label: "gemini openai-compat chat", kind: "chat", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: process.env.GOOGLE_API_KEY, model: "gemini-3.5-flash-lite"},
    {label: "openrouter openai chat", kind: "chat", base: or, key: process.env.OPENROUTER_API_KEY, model: "openai/gpt-5.4-nano"},
    {label: "openrouter openai responses", kind: "responses", base: or, key: process.env.OPENROUTER_API_KEY, model: "openai/gpt-5.4-nano"},
    {label: "openrouter anthropic chat", kind: "chat", base: or, key: process.env.OPENROUTER_API_KEY, model: "anthropic/claude-haiku-5.5"},
    {label: "openrouter anthropic messages", kind: "anthropic", base: or, key: process.env.OPENROUTER_API_KEY, model: "anthropic/claude-haiku-5.5"},
];

const params = {type: "object", properties: {q: {type: "string"}}, required: ["q"]};
const tool = (name: string) => ({name, description: "Look something up.", parameters: params});
const longName = (n: number) => `plugin__${"x".repeat(n - "plugin__".length)}`;

type Case = {label: string; tools: ReturnType<typeof tool>[] | null; history: boolean};
const cases: Case[] = [
    {label: "unlisted", tools: [tool("new__search")], history: true},
    {label: "no-tools", tools: null, history: true},
    {label: "name-65", tools: [tool(longName(65))], history: false},
    {label: "name-128", tools: [tool(longName(128))], history: false},
];

const ask = "Reply with one short sentence: what was the weather?";
const plain = "Say hello in one word.";

function body(ep: Endpoint, c: Case): {path: string; json: unknown} {
    const callArgs = JSON.stringify({q: "weather"});
    if (ep.kind === "chat") {
        const messages: unknown[] = c.history
            ? [
                {role: "user", content: "Look up the weather."},
                {role: "assistant", content: null, tool_calls: [{id: "call_1", type: "function", function: {name: "old__lookup", arguments: callArgs}}]},
                {role: "tool", tool_call_id: "call_1", content: "Sunny, 21C."},
                {role: "user", content: ask},
            ]
            : [{role: "user", content: plain}];
        return {path: "/chat/completions", json: {model: ep.model, messages, max_tokens: 200, ...(c.tools ? {tools: c.tools.map((t) => ({type: "function", function: t}))} : {})}};
    }
    if (ep.kind === "responses") {
        const input: unknown[] = c.history
            ? [
                {role: "user", content: "Look up the weather."},
                {type: "function_call", call_id: "call_1", name: "old__lookup", arguments: callArgs},
                {type: "function_call_output", call_id: "call_1", output: "Sunny, 21C."},
                {role: "user", content: ask},
            ]
            : [{role: "user", content: plain}];
        return {path: "/responses", json: {model: ep.model, input, max_output_tokens: 200, store: false, ...(c.tools ? {tools: c.tools.map((t) => ({type: "function", ...t}))} : {})}};
    }
    const messages: unknown[] = c.history
        ? [
            {role: "user", content: "Look up the weather."},
            {role: "assistant", content: [{type: "tool_use", id: "toolu_1", name: "old__lookup", input: {q: "weather"}}]},
            {role: "user", content: [{type: "tool_result", tool_use_id: "toolu_1", content: "Sunny, 21C."}, {type: "text", text: ask}]},
        ]
        : [{role: "user", content: plain}];
    return {path: "/messages", json: {model: ep.model, messages, max_tokens: 200, ...(c.tools ? {tools: c.tools.map((t) => ({name: t.name, description: t.description, input_schema: t.parameters}))} : {})}};
}

function headers(ep: Endpoint): Record<string, string> {
    const h: Record<string, string> = {"content-type": "application/json", authorization: `Bearer ${ep.key}`};
    if (ep.kind === "anthropic") {
        h["anthropic-version"] = "2023-06-01";
        h["x-api-key"] = ep.key ?? "";
    }
    return h;
}

function replyText(ep: Endpoint, j: any): string {
    if (ep.kind === "chat") {
        const m = j.choices?.[0]?.message;
        return m?.content ?? (m?.tool_calls ? `tool_calls:${m.tool_calls.map((t: any) => t.function?.name).join(",")}` : "");
    }
    if (ep.kind === "responses") return (j.output ?? []).map((o: any) => o.type === "message" ? o.content?.map((c: any) => c.text).join("") : o.type === "function_call" ? `function_call:${o.name}` : "").join(" ");
    return (j.content ?? []).map((c: any) => c.type === "text" ? c.text : c.type === "tool_use" ? `tool_use:${c.name}` : "").join(" ");
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

// PROBE_ONLY=luna 只跑标签里含该词的端点（重试限流的那家时用）。
const only = process.env.PROBE_ONLY;
console.log(`# 工具历史与名字长度实测 ${new Date().toISOString()}${only ? `（只跑 ${only}）` : ""}`);
for (const ep of endpoints.filter((e) => !only || e.label.includes(only))) {
    if (!ep.key || !ep.base) {
        console.log(`${ep.label}\t-\tskipped: 缺少密钥或地址`);
        continue;
    }
    for (const c of cases) {
        const {path, json} = body(ep, c);
        try {
            const r = await fetch(`${ep.base}${path}`, {method: "POST", headers: headers(ep), body: JSON.stringify(json), signal: AbortSignal.timeout(90_000)});
            const text = await r.text();
            let detail = text;
            try {
                const j = JSON.parse(text);
                detail = r.ok ? `reply: ${replyText(ep, j)}` : JSON.stringify(j.error ?? j);
            } catch {}
            console.log(`${ep.label}\t${c.label}\t${r.status}\t${oneLine(detail)}`);
        } catch (error) {
            console.log(`${ep.label}\t${c.label}\tERR\t${oneLine(String(error))}`);
        }
    }
}
