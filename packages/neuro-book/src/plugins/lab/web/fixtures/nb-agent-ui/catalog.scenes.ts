import type {AgentModelCatalog} from "@notnotype/nb-agent-ui/vue";
import type {CatalogModelView, CatalogProviderView} from "@notnotype/nb-agent-ui";
import type {LabFixtureDefinition} from "../define";

type Scene = LabFixtureDefinition<typeof AgentModelCatalog>["scenes"][number];

const model = (id: string, name: string, fields: Partial<CatalogModelView> = {}): CatalogModelView => ({id, name, api: "openai-completions", contextWindow: 128_000, reasoning: false, images: false, price: null, ...fields});

/** OpenRouter 这类一家几百个模型的：凑够两百多个，看“还有 N 个”。 */
const MANY = Array.from({length: 240}, (_, index) => model(`vendor-${index % 12}/model-${index}`, `第三方模型 ${index}`, {contextWindow: 32_000 * (1 + (index % 8))}));

/** 样例目录：自定义服务商、密钥有值与没值的、要登录的、云凭据链的。数字取自 OMP 18.2.5 的目录。 */
export const LAB_CATALOG: CatalogProviderView[] = [
    {id: "relay", name: "中转网关", source: "custom", access: "key", keyEnvs: ["RELAY_KEY"], keySet: true, models: [model("gpt-5.6-sol", "gpt-5.6-sol", {api: "openai-responses", contextWindow: 1_050_000, reasoning: true, images: true})]},
    {id: "deepseek", name: "DeepSeek", source: "catalog", access: "key", keyEnvs: ["DEEPSEEK_API_KEY"], keySet: true, models: [model("deepseek-flash", "DeepSeek Flash", {contextWindow: 1_000_000, reasoning: true, price: {input: 0.14, output: 0.56, currency: "USD"}}), model("deepseek-pro", "DeepSeek Pro", {contextWindow: 1_000_000, reasoning: true, price: {input: 0.55, output: 2.19, currency: "USD"}})]},
    {
        id: "openai", name: "OpenAI", source: "catalog", access: "key", keyEnvs: ["OPENAI_API_KEY"], keySet: false,
        models: [model("gpt-5.6-sol", "GPT-5.6 Sol", {api: "openai-responses", contextWindow: 1_050_000, reasoning: true, images: true, price: {input: 1.5, output: 6, currency: "USD"}}), model("gpt-4.1", "GPT-4.1", {api: "openai-responses", contextWindow: 1_047_576, images: true, price: {input: 2, output: 8, currency: "USD"}})],
    },
    {id: "openrouter", name: "OpenRouter", source: "catalog", access: "key", keyEnvs: ["OPENROUTER_API_KEY"], keySet: false, models: [model("anthropic/claude-sonnet-5", "Anthropic: Claude Sonnet 5", {contextWindow: 1_000_000, reasoning: true, images: true, price: {input: 3, output: 15, currency: "USD"}}), ...MANY]},
    {id: "moonshot", name: "Moonshot (Kimi API)", source: "catalog", access: "key", keyEnvs: ["MOONSHOT_API_KEY", "KIMI_API_KEY"], keySet: false, models: [model("kimi-k3", "Kimi K3", {contextWindow: 256_000, reasoning: true})]},
    {id: "anthropic", name: "Anthropic (Claude Pro/Max)", source: "catalog", access: "login", keyEnvs: ["ANTHROPIC_API_KEY"], keySet: false, models: [model("claude-sonnet-5", "Claude Sonnet 5", {api: "anthropic-messages", contextWindow: 1_000_000, reasoning: true, images: true, price: {input: 3, output: 15, currency: "USD"}})]},
    {id: "google-gemini-cli", name: "Google Cloud Code Assist (Gemini CLI)", source: "catalog", access: "login", keyEnvs: [], keySet: false, models: [model("gemini-3-pro", "Gemini 3 Pro", {api: "google-gemini-cli", contextWindow: 1_048_576})]},
    {id: "amazon-bedrock", name: "Amazon Bedrock", source: "catalog", access: "unsupported", keyEnvs: [], keySet: false, models: [model("anthropic.claude-sonnet-5", "Claude Sonnet 5", {api: "bedrock-converse-stream"})]},
];

export const agentModelCatalogScenes: Scene[] = [
    {id: "default", label: "目录（自定义、有值、没值、要登录、云凭据链）", input: {props: {providers: LAB_CATALOG, chosen: ["relay/gpt-5.6-sol"], locale: "zh-CN"}, model: {open: true}}},
    {id: "empty", label: "空目录", input: {props: {providers: [], chosen: [], locale: "zh-CN"}, model: {open: true}}},
    {id: "english", label: "英文界面", input: {props: {providers: LAB_CATALOG, chosen: [], locale: "en-US"}, model: {open: true}}},
];
