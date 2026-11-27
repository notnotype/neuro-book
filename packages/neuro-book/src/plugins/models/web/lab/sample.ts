/** 模型服务夹具的示例数据：快照的服务商与角色、模型行、模板表、拉取结果。数字是示意，不是目录的真实值。 */

import type {ApiDetection, ModelRow, ModelsSnapshot, SnapshotProvider, SnapshotRole, Template} from "@notnotype/nb-models/contract";

/** 场景里“列表更新于”的固定时刻（2026-11-22 09:30 UTC），截图不随运行时间变。 */
export const SOURCE_AT = Date.UTC(2026, 10, 22, 9, 30);

/**
 * 一次协议检测（中转站：两种 OpenAI 通过，Anthropic 404，Gemini 400）。连接版本：检测时是 `c1`（即 Chat Completions 那一行），
 * 改用 Responses 之后是 `c-responses`。
 */
export const SAMPLE_DETECTION: ApiDetection = {
    model: "doubao-seed-1-6",
    connection: "c1",
    results: [
        {api: "openai-completions", baseUrl: "https://relay.example/v1", connection: "c1", url: "https://relay.example/v1/chat/completions", ok: true, status: 200, ms: 312, code: null, message: ""},
        {api: "openai-responses", baseUrl: "https://relay.example/v1", connection: "c-responses", url: "https://relay.example/v1/responses", ok: true, status: 200, ms: 418, code: null, message: ""},
        {api: "anthropic-messages", baseUrl: "https://relay.example/v1", connection: "c-anthropic", url: "https://relay.example/v1/messages", ok: false, status: 404, ms: 96, code: "http", message: "{\"error\":{\"message\":\"Not Found: /v1/messages\",\"type\":\"invalid_request_error\"}}"},
        {api: "google-generative-ai", baseUrl: "https://relay.example/v1", connection: "c-gemini", url: "https://relay.example/v1/models/doubao-seed-1-6:streamGenerateContent", ok: false, status: 400, ms: 120, code: "http", message: "{\"error\":{\"code\":400,\"message\":\"API key not valid. Please pass a valid API key.\",\"status\":\"INVALID_ARGUMENT\"}}"},
    ],
};

/** 还没有服务商列表、用内置目录的来源状态。 */
export const SOURCE_CATALOG: SnapshotProvider["source"] = {state: "none", refreshing: false, checkedAt: null, error: null};

/** 没单独给 `thinking` 时按 `reasoning` 与 `efforts` 推：没档位的是“会推理但不能调档”，有档位的可调、能真关。 */
export const sampleRow = (id: string, patch: Partial<ModelRow> = {}): ModelRow => {
    const model = {id, name: id, group: id.replace(/[-:][\w.]+$/u, ""), enabled: true, origin: "source" as const, kind: "chat" as ModelRow["kind"], contextWindow: 128_000 as number | null, maxOutput: 8_192 as number | null, vision: false, reasoning: false, efforts: [] as string[], compaction: null, price: null, headers: {}, status: "ok" as const, usable: true, unlisted: false, overridden: [] as ModelRow["overridden"], source: null as ModelRow["source"], ...patch};
    const thinking: ModelRow["thinking"] = patch.thinking ?? (!model.reasoning ? {kind: "none"} : model.efforts.length === 0 ? {kind: "fixed"} : {kind: "levels", levels: model.efforts, off: "disable", unset: null, verified: true});
    return {...model, thinking};
};

const provider = (patch: Partial<SnapshotProvider> & Pick<SnapshotProvider, "id" | "template" | "name" | "key">, rows: readonly ModelRow[]): SnapshotProvider => ({
    region: null, icon: null, baseUrl: null, templateBaseUrl: null, api: "openai-completions", templateApi: "openai-completions", auth: "default", headers: {}, proxy: null, followSource: true, source: SOURCE_CATALOG,
    modelCount: rows.length, enabledCount: rows.filter((row) => row.enabled).length, excludedCount: 0, modelsRevision: "r1", connection: "c1", ...patch,
});

/** 各家的模型行（`providerModels` 的 `listed`）。 */
export const SAMPLE_ROWS: Record<string, ModelRow[]> = {
    deepseek: [
        sampleRow("deepseek-flash", {name: "DeepSeek Flash", group: "deepseek", price: [0.27, 1.1, 0.07, 0]}),
        sampleRow("deepseek-pro", {name: "DeepSeek Pro", group: "deepseek", reasoning: true, efforts: ["high"], maxOutput: 32_768, price: [0.55, 2.19, 0.14, 0], overridden: ["maxOutput"], source: {name: "DeepSeek Pro", contextWindow: 128_000, maxOutput: 16_384, vision: false, reasoning: true, price: [0.55, 2.19, 0.14, 0]}}),
    ],
    anthropic: [
        sampleRow("claude-sonnet-4-5", {name: "Claude Sonnet 4.5", group: "Claude Sonnet", contextWindow: 200_000, maxOutput: 64_000, vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [3, 15, 0.3, 3.75]}),
        sampleRow("claude-3-opus", {name: "claude-3-opus", group: "Claude Opus", status: "missing", contextWindow: null, maxOutput: null, usable: false}),
    ],
    volcengine: [
        sampleRow("doubao-seed-2-0-pro", {name: "Doubao Seed 2.0 Pro", group: "doubao-seed-2.0", origin: "manual", contextWindow: 256_000, vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [0.47, 2.37, 0.09, 0]}),
        sampleRow("doubao-seed-2-0-lite", {name: "Doubao Seed 2.0 Lite", group: "doubao-seed-2.0", origin: "manual", contextWindow: 256_000, price: [0.09, 0.53, 0.02, 0]}),
        sampleRow("doubao-embedding", {group: "doubao", origin: "manual", enabled: false, contextWindow: null, status: "incomplete", usable: false}),
    ],
    openai: [sampleRow("gpt-5-mini", {name: "GPT-5 mini", group: "gpt-5", vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [0.25, 2, 0.025, 0], usable: false})],
    moonshot: [sampleRow("kimi-k2", {name: "Kimi K2", group: "kimi", contextWindow: 256_000, price: [0.6, 2.5, 0.15, 0]})],
    ollama: [sampleRow("qwen3:8b", {group: "qwen3", origin: "manual", contextWindow: 32_768, reasoning: true, efforts: ["medium"], price: [0, 0, 0, 0], compaction: {mode: "tokens", value: 24_000}})],
};

/** 一批示意的模型行，给“几百个模型”的场景（OpenRouter 那样的量）。 */
export function generatedRows(count: number): ModelRow[] {
    const families = ["claude", "gpt", "gemini", "llama", "qwen", "mistral", "deepseek", "grok"];
    return Array.from({length: count}, (_, index) => {
        const family = families[index % families.length]!;
        return sampleRow(`${family}/${family}-model-${String(index + 1)}`, {name: `${family} model ${String(index + 1)}`, group: family, contextWindow: 32_000 + (index % 8) * 16_000, price: [0.1 + (index % 5), 0.4 + (index % 7), 0, 0], vision: index % 3 === 0, reasoning: index % 4 === 0, efforts: index % 4 === 0 ? ["low", "high"] : []});
    });
}

export const SAMPLE_PROVIDERS: SnapshotProvider[] = [
    provider({id: "deepseek", template: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", templateBaseUrl: "https://api.deepseek.com", key: {kind: "stored"}}, SAMPLE_ROWS.deepseek!),
    provider({id: "anthropic", template: "anthropic", name: "Anthropic", baseUrl: "https://relay.example.com/anthropic", templateBaseUrl: "https://api.anthropic.com", api: "anthropic-messages", templateApi: "anthropic-messages", key: {kind: "env", name: "ANTHROPIC_API_KEY", found: false}}, SAMPLE_ROWS.anthropic!),
    provider({id: "volcengine", template: "blank-openai", name: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", headers: {"X-Team": "writing"}, key: {kind: "stored"}, followSource: false}, SAMPLE_ROWS.volcengine!),
    provider({id: "openai", template: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", templateBaseUrl: "https://api.openai.com/v1", api: "openai-responses", templateApi: "openai-responses", key: {kind: "none"}}, SAMPLE_ROWS.openai!),
    provider({id: "moonshot", template: "moonshot", name: "Moonshot（Kimi）", region: "cn", baseUrl: "https://api.moonshot.cn/v1", templateBaseUrl: "https://api.moonshot.ai/v1", key: {kind: "env", name: "MOONSHOT_API_KEY", found: true}}, SAMPLE_ROWS.moonshot!),
    provider({id: "ollama", template: "blank-openai", name: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: "none", key: {kind: "keyless"}, followSource: false}, SAMPLE_ROWS.ollama!),
];

const role = (id: string, axis: SnapshotRole["axis"], model: string | null, status: SnapshotRole["status"], extra: Partial<SnapshotRole> = {}): SnapshotRole => ({id, axis, builtin: true, name: "", description: "", model, effort: null, icon: null, status, ...extra});

export const SAMPLE_ROLES: SnapshotRole[] = [
    role("tiny", "gradient", null, "unbound"),
    // fast 绑的模型不推理，存着的档位仍显示、能清除；main 设了默认档；自建的 polish 有自己的图标。
    role("fast", "gradient", "deepseek/deepseek-flash", "ok", {effort: "low"}),
    role("main", "gradient", "anthropic/claude-sonnet-4-5", "no-credentials", {effort: "high"}),
    role("deep", "gradient", "deepseek/deepseek-legacy", "unknown-model"),
    role("compaction", "specialist", "deepseek/deepseek-flash", "ok"),
    role("polish", "specialist", null, "unbound", {builtin: false, name: "润色", description: "改写段落的措辞"}),
];

/** 在线目录：三小时前取过一份。 */
export const SAMPLE_CATALOG: ModelsSnapshot["catalog"] = {enabled: true, refreshing: false, checkedAt: Date.UTC(2026, 10, 20, 9, 30), modelCount: 1104, error: null};

export const SAMPLE_SNAPSHOT: ModelsSnapshot = {providers: SAMPLE_PROVIDERS, roles: SAMPLE_ROLES, catalog: SAMPLE_CATALOG};

const template = (id: string, name: string, group: Template["group"], patch: Partial<Template> = {}): Template => ({id, name, group, logo: id, blank: false, addable: true, reason: null, modelCount: 12, regions: [], routes: [], access: "key", ...patch});

export const SAMPLE_TEMPLATES: Template[] = [
    template("openai", "OpenAI", "international", {modelCount: 66}),
    template("anthropic", "Anthropic", "international", {addable: false, reason: "login", modelCount: 19, access: "login"}),
    template("google", "Google Gemini", "international", {modelCount: 51}),
    template("mistral", "Mistral", "international", {modelCount: 43}),
    template("deepseek", "DeepSeek", "china", {modelCount: 4}),
    template("moonshot", "Moonshot（Kimi）", "china", {modelCount: 17, regions: [{id: "global", baseUrl: "https://api.moonshot.ai/v1"}, {id: "cn", baseUrl: "https://api.moonshot.cn/v1"}]}),
    template("zai", "Z.AI", "china", {modelCount: 18}),
    template("openrouter", "OpenRouter", "gateway", {modelCount: 587}),
    template("opencode-zen", "OpenCode Zen", "gateway", {modelCount: 123}),
    template("cloudflare-ai-gateway", "Cloudflare AI Gateway", "gateway", {addable: false, reason: "needs-address", modelCount: 124}),
    template("ollama", "Ollama", "other", {modelCount: 3, access: "keyless"}),
    template("cursor", "Cursor", "other", {addable: false, reason: "login", modelCount: 123, access: "login"}),
    template("blank-openai", "blank-openai", "custom", {blank: true, logo: null, modelCount: 0}),
    template("blank-anthropic", "blank-anthropic", "custom", {blank: true, logo: null, modelCount: 0}),
    template("blank-gemini", "blank-gemini", "custom", {blank: true, logo: null, modelCount: 0}),
];

export const SAMPLE_CANDIDATES = [
    {id: "doubao-seed-2-0-pro", name: "Doubao Seed 2.0 Pro", vision: true, reasoning: true, incomplete: false, unknown: false},
    {id: "doubao-seed-2-0-lite", name: "Doubao Seed 2.0 Lite", vision: false, reasoning: false, incomplete: false, unknown: false},
    {id: "doubao-seed-2-0-mini", name: "Doubao Seed 2.0 Mini", vision: false, reasoning: true, incomplete: false, unknown: false},
    {id: "doubao-embedding", name: "doubao-embedding", vision: false, reasoning: false, incomplete: true, unknown: true},
    {id: "house-router", name: "house-router", vision: false, reasoning: false, incomplete: true, unknown: true},
];
