/**
 * 问答与抽取共用的配置文件的格式（docs/specs/story/qa.md 的“配置”、docs/specs/story/ingest.md 的“抽取模型”）。单独成
 * 文件、不碰 node：读写配置的 `qa/config.ts`（命令行与服务端）和网页的设置页（`SchemaForm` 按它画表单）用同一份。
 * `x-form` 是设置页的界面提示（docs/specs/ui/forms.md），校验不看它。
 *
 * 校验在这里就拦住两类错：
 * - 存密钥的环境变量名只能是变量名的写法：把密钥本身贴进来，密钥就落进配置文件、又被读回显示（qa 输出 19、20）。命令行
 *   的字段编辑另有一条给人看的说明（`config-edit.ts` 的 `envNameProblem`），整份写入（网页设置页）靠这里；
 * - 不认识的字段一律不收，免得把别的东西（包括贴错位置的密钥）原样存下来。
 */

import {Type, type Static} from "typebox";

/**
 * 环境变量名的写法（`qa/config-edit.ts` 的字段编辑也用它）。只靠“字母、数字、下划线”挡不住下划线形状的密钥
 * （`sk_…`），所以另外拒绝两种像密钥的写法：常见密钥前缀（`sk_`、`gsk_`、`ghp_` 等，大小写都算），以及 32 个字符
 * 以上、中间没有下划线的一整串。这只能挡住已知形状：随机得像变量名的密钥仍会被当作变量名（qa.md 的“配置”）。
 */
export const ENV_NAME_PATTERN = "^(?![Ss][Kk]_|[Gg][Ss][Kk]_|[Gg][Hh][PpOoSsUu]_|[Xx][Aa][Ii]_|[Pp][Kk]_|[Rr][Kk]_)(?![A-Za-z0-9]{32,}$)[A-Za-z_][A-Za-z0-9_]*$";

const apiKeyEnv = () => Type.String({minLength: 1, pattern: ENV_NAME_PATTERN, "x-form": {label: "密钥环境变量", help: "存密钥的环境变量名（例如 OPENAI_API_KEY），不是密钥本身；服务启动时读它"}});
const baseUrl = () => Type.String({minLength: 1, "x-form": {label: "服务地址", placeholder: "https://api.example.com/v1"}});
const modelId = () => Type.String({minLength: 1, "x-form": {label: "模型名"}});

export const PriceSchema = Type.Object(
    {
        input: Type.Number({minimum: 0, "x-form": {label: "输入单价", unit: "每百万 token"}}),
        output: Type.Number({minimum: 0, "x-form": {label: "输出单价", unit: "每百万 token"}}),
        cacheRead: Type.Optional(Type.Number({minimum: 0, "x-form": {label: "缓存读单价", unit: "每百万 token"}})),
        currency: Type.String({minLength: 1, "x-form": {label: "币种"}}),
    },
    {additionalProperties: false, "x-form": {label: "单价"}},
);

/** 抽取用的一个模型。推理档由程序按步骤固定，所以不收 `thinking`（写了就是配置不对，而不是悄悄不用）。 */
const ingestModelSchema = (form?: {label: string; help: string}) =>
    Type.Object(
        {
            baseUrl: baseUrl(),
            id: modelId(),
            apiKeyEnv: apiKeyEnv(),
            contextWindow: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "上下文窗口", unit: "token"}})),
            maxTokens: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "单次输出上限", unit: "token"}})),
            price: Type.Optional(PriceSchema),
        },
        {additionalProperties: false, ...(form === undefined ? {} : {"x-form": form})},
    );

export const IngestModelSchema = ingestModelSchema();

/** 推理档，同 OMP 的六档（nb-harness 的 `ThinkingEffort`）。这里不导入 nb-harness：网页也用这份 schema。 */
export const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const EffortSchema = Type.Union(
    [Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max")],
    {"x-form": {label: "推理档"}},
);

/** 自定义服务商的接口，名字同 OMP。 */
export const PROVIDER_APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

/** 自定义服务商的 id：小写字母、数字与连字符。不能有 `/`（引用写成 `服务商/模型名`）与 `.`（命令行的字段路径）。 */
export const PROVIDER_ID_PATTERN = "^[a-z0-9][a-z0-9-]*$";

/** 自定义服务商的一个模型。没写的上下文、最大输出、推理与图片在运行时按模型名从 OMP 目录补（qa.md 的“配置”）。 */
export const CustomModelSchema = Type.Object(
    {
        id: modelId(),
        name: Type.Optional(Type.String({minLength: 1, "x-form": {label: "显示名"}})),
        contextWindow: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "上下文窗口", unit: "token"}})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "单次输出上限", unit: "token"}})),
        reasoning: Type.Optional(Type.Boolean({"x-form": {label: "支持推理"}})),
        images: Type.Optional(Type.Boolean({"x-form": {label: "收图片"}})),
        price: Type.Optional(PriceSchema),
    },
    {additionalProperties: false},
);

export const ProviderSchema = Type.Object(
    {
        name: Type.Optional(Type.String({minLength: 1, "x-form": {label: "名称", help: "只用来显示与区分，例如公司网关、本机端点"}})),
        api: Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses"), Type.Literal("anthropic-messages"), Type.Literal("google-generative-ai")], {"x-form": {label: "接口"}}),
        baseUrl: baseUrl(),
        apiKeyEnv: apiKeyEnv(),
        models: Type.Array(CustomModelSchema),
    },
    {additionalProperties: false},
);

/** 模型引用：`服务商/模型名`。服务商是自定义服务商的 id 或 OMP 目录的 id；模型名里可以再有 `/`（OpenRouter 的写法）。 */
export const MODEL_REF_PATTERN = "^[^/\\s]+/\\S.*$";
const modelRef = () => Type.String({pattern: MODEL_REF_PATTERN});

export const ConfigSchema = Type.Object(
    {
        // 键的写法（PROVIDER_ID_PATTERN）在语义校验里查：TypeBox 的 Record 不按键的 pattern 校验。
        providers: Type.Optional(Type.Record(Type.String(), ProviderSchema)),
        /** 输入框里能换的候选，至少一个、不重复（语义校验，见 `qa/config.ts`）。 */
        models: Type.Array(modelRef()),
        model: Type.Object(
            {
                /** 默认模型，必须在候选里。 */
                use: modelRef(),
                /** 默认模型的推理档；不写就不发。模型不支持这一档时运行时往下夹。 */
                thinking: Type.Optional(EffortSchema),
            },
            {additionalProperties: false},
        ),
        ingest: Type.Optional(
            Type.Object(
                {
                    model: Type.Optional(ingestModelSchema({label: "抽取模型", help: "不写时用问答的默认模型（只在它是 OpenAI Chat 接口的自定义服务商时可以）"})),
                    // 挑选相关说法（docs/specs/story/ingest.md 输出 4）：默认关；开着时用 `model`，没写就用抽取的模型。
                    recall: Type.Optional(
                        Type.Object(
                            {
                                enabled: Type.Optional(Type.Boolean({"x-form": {label: "挑选相关说法"}})),
                                model: Type.Optional(ingestModelSchema({label: "挑选用的模型", help: "不写时用抽取模型"})),
                            },
                            {additionalProperties: false, "x-form": {label: "挑选相关说法"}},
                        ),
                    ),
                    // 马甲核对（docs/specs/story/ingest.md 输出 20）：默认开，写 false 关；用抽取的模型。
                    personaCheck: Type.Optional(
                        Type.Object(
                            {enabled: Type.Optional(Type.Boolean({"x-form": {label: "核对马甲", help: "每章抽完后，问一下还没连上任何人的马甲（网名、代号）是不是已有的哪个人；默认开"}}))},
                            {additionalProperties: false, "x-form": {label: "核对马甲"}},
                        ),
                    ),
                },
                {additionalProperties: false, "x-form": {label: "抽取"}},
            ),
        ),
        qa: Type.Optional(
            Type.Object(
                {
                    maxChapters: Type.Optional(Type.Integer({minimum: 1, maximum: 20, "x-form": {label: "一问最多读的章数", help: "图当目录做法下，一问新读的不同章数上限（最多 20）"}})),
                    fullReadMaxChars: Type.Optional(Type.Integer({minimum: 1, "x-form": {label: "全读的原文上限", unit: "字"}})),
                    answer: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("structured")], {"x-form": {label: "作答方式", help: "新对话用 Markdown 文字回答，还是用 answer 工具交结构化的卷；不写是 Markdown"}})),
                },
                {additionalProperties: false, "x-form": {label: "问答"}},
            ),
        ),
    },
    {additionalProperties: false},
);

/**
 * 第 1 版的问答模型（t16 之前）：只有一个 OpenAI 兼容的地址。只用来认出第 1 版并升级（`qa/config.ts` 的
 * `upgradeQaConfig`），不再写出。
 */
export const LegacyModelSchema = Type.Object(
    {
        baseUrl: baseUrl(),
        id: modelId(),
        apiKeyEnv: apiKeyEnv(),
        api: Type.Optional(Type.Union([Type.Literal("chat"), Type.Literal("responses")])),
        contextWindow: Type.Optional(Type.Integer({minimum: 1})),
        maxTokens: Type.Optional(Type.Integer({minimum: 1})),
        thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")])),
        price: Type.Optional(PriceSchema),
    },
    {additionalProperties: false},
);

export type QaConfig = Static<typeof ConfigSchema>;
export type ProviderConfig = Static<typeof ProviderSchema>;
export type CustomModelConfig = Static<typeof CustomModelSchema>;
export type Effort = (typeof EFFORTS)[number];
export type ProviderApi = (typeof PROVIDER_APIS)[number];
