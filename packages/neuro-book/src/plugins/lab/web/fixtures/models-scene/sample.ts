/** 模型服务夹具的示例数据：快照的服务商与角色、目录、拉取结果。数字是示意，不是目录的真实值。 */

import type {CatalogProvider, ModelsSnapshot, SnapshotModel, SnapshotProvider, SnapshotRole} from "nbook/plugins/models/shared/contracts";

export const sampleModel = (id: string, patch: Partial<SnapshotModel> = {}): SnapshotModel => ({
    id, name: id, group: id.replace(/[-:][\w.]+$/u, ""), enabled: true, contextWindow: 128_000, maxOutput: 8_192, vision: false, reasoning: false, efforts: [], compactAt: null, price: null, headers: {}, status: "ok", ...patch,
});

export const SAMPLE_PROVIDERS: SnapshotProvider[] = [
    {
        id: "deepseek", kind: "catalog", name: "DeepSeek", baseUrl: "https://api.deepseek.com", catalogBaseUrl: "https://api.deepseek.com", api: "openai-completions", auth: "default", headers: {}, key: {kind: "stored"},
        models: [
            sampleModel("deepseek-flash", {name: "DeepSeek Flash", group: "deepseek", price: [0.27, 1.1, 0.07, 0]}),
            sampleModel("deepseek-pro", {name: "DeepSeek Pro", group: "deepseek", reasoning: true, efforts: ["high"], maxOutput: 32_768, price: [0.55, 2.19, 0.14, 0]}),
        ],
    },
    {
        id: "anthropic", kind: "catalog", name: "Anthropic", baseUrl: "https://relay.example.com/anthropic", catalogBaseUrl: "https://api.anthropic.com", api: "anthropic-messages", auth: "default", headers: {}, key: {kind: "env", name: "ANTHROPIC_API_KEY", found: false},
        models: [
            sampleModel("claude-sonnet-4-5", {name: "Claude Sonnet 4.5", group: "Claude Sonnet", contextWindow: 200_000, maxOutput: 64_000, vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [3, 15, 0.3, 3.75]}),
            sampleModel("claude-3-opus", {name: "claude-3-opus", group: "Claude Opus", status: "missing", contextWindow: null, maxOutput: null}),
        ],
    },
    {
        id: "volcengine", kind: "custom", name: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", catalogBaseUrl: null, api: "openai-completions", auth: "default", headers: {"X-Team": "writing"}, key: {kind: "stored"},
        models: [
            sampleModel("doubao-seed-2-0-pro", {name: "Doubao Seed 2.0 Pro", group: "doubao-seed-2.0", contextWindow: 256_000, vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [0.47, 2.37, 0.09, 0]}),
            sampleModel("doubao-seed-2-0-lite", {name: "Doubao Seed 2.0 Lite", group: "doubao-seed-2.0", contextWindow: 256_000, price: [0.09, 0.53, 0.02, 0]}),
            sampleModel("doubao-embedding", {group: "doubao", enabled: false, contextWindow: null, status: "incomplete"}),
        ],
    },
    {
        id: "openai", kind: "catalog", name: "OpenAI", baseUrl: "https://api.openai.com/v1", catalogBaseUrl: "https://api.openai.com/v1", api: "openai-responses", auth: "default", headers: {}, key: {kind: "none"},
        models: [sampleModel("gpt-5-mini", {name: "GPT-5 mini", group: "gpt-5", vision: true, reasoning: true, efforts: ["low", "medium", "high"], price: [0.25, 2, 0.025, 0]})],
    },
    {
        id: "moonshot", kind: "catalog", name: "Moonshot（Kimi）", baseUrl: "https://api.moonshot.cn/v1", catalogBaseUrl: "https://api.moonshot.cn/v1", api: "openai-completions", auth: "default", headers: {}, key: {kind: "env", name: "MOONSHOT_API_KEY", found: true},
        models: [sampleModel("kimi-k2", {name: "Kimi K2", group: "kimi", contextWindow: 256_000, price: [0.6, 2.5, 0.15, 0]})],
    },
    {
        id: "ollama", kind: "custom", name: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", catalogBaseUrl: null, api: "openai-completions", auth: "none", headers: {}, key: {kind: "keyless"},
        models: [sampleModel("qwen3:8b", {group: "qwen3", contextWindow: 32_768, reasoning: true, efforts: ["medium"], price: [0, 0, 0, 0], compactAt: 24_000})],
    },
];

const role = (id: string, axis: SnapshotRole["axis"], model: string | null, status: SnapshotRole["status"], extra: Partial<SnapshotRole> = {}): SnapshotRole => ({id, axis, builtin: true, name: "", description: "", model, status, ...extra});

export const SAMPLE_ROLES: SnapshotRole[] = [
    role("tiny", "gradient", null, "unbound"),
    role("fast", "gradient", "deepseek/deepseek-flash", "ok"),
    role("main", "gradient", "anthropic/claude-sonnet-4-5", "no-credentials"),
    role("deep", "gradient", "deepseek/deepseek-legacy", "unknown-model"),
    role("compaction", "specialist", "deepseek/deepseek-flash", "ok"),
    role("polish", "specialist", null, "unbound", {builtin: false, name: "润色", description: "改写段落的措辞"}),
];

export const SAMPLE_SNAPSHOT: ModelsSnapshot = {providers: SAMPLE_PROVIDERS, roles: SAMPLE_ROLES};

export const SAMPLE_CATALOG: CatalogProvider[] = [
    {id: "anthropic", name: "Anthropic", access: "key", added: true},
    {id: "deepseek", name: "DeepSeek", access: "key", added: true},
    {id: "openai", name: "OpenAI", access: "key", added: false},
    {id: "google", name: "Google Gemini", access: "key", added: false},
    {id: "moonshot", name: "Moonshot（Kimi）", access: "key", added: false},
    {id: "ollama", name: "Ollama（本机）", access: "keyless", added: false},
    {id: "openai-codex", name: "ChatGPT 订阅（Codex）", access: "login", added: false},
];

export const SAMPLE_CANDIDATES = [
    {id: "doubao-seed-2-0-pro", name: "Doubao Seed 2.0 Pro", vision: true, reasoning: true, incomplete: false},
    {id: "doubao-seed-2-0-lite", name: "Doubao Seed 2.0 Lite", vision: false, reasoning: false, incomplete: false},
    {id: "doubao-seed-2-0-mini", name: "Doubao Seed 2.0 Mini", vision: false, reasoning: true, incomplete: false},
    {id: "doubao-embedding", name: "doubao-embedding", vision: false, reasoning: false, incomplete: true},
];
