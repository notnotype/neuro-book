/**
 * 模型服务的配置形状（docs/specs/models/service.md“输入与前置条件”）：服务商与模型、模型角色。应用把它们登记成自己的设置项
 * （分区、文字、允许的层由应用定），服务核心经存储接口读写整份值。密钥不在这里；`apiKeyEnv` 与请求头里的 `env:` 只是变量名。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {MODEL_ROLES} from "@notnotype/nb-harness/kit/shapes";

import {CompactionSettingSchema} from "./compaction";

/** 服务商 id：由名字生成，同一个模板可以建多份。不含 `/`：模型引用 `<服务商>/<模型>` 按第一个 `/` 切。 */
export const PROVIDER_ID = "^[a-z0-9][a-z0-9._-]*$";
const ENV_NAME = "^[A-Za-z_][A-Za-z0-9_]*$";
const ROLE_ID = "^[a-z0-9][a-z0-9-]*$";

/** 空白模板：没有目录，协议与地址都由用户给。 */
export const BLANK_TEMPLATES = ["blank-openai", "blank-anthropic", "blank-gemini"] as const;
export type BlankTemplate = (typeof BLANK_TEMPLATES)[number];
/** 空白模板建出来时的协议。 */
export const BLANK_API: Readonly<Record<BlankTemplate, ProviderApi>> = {"blank-openai": "openai-completions", "blank-anthropic": "anthropic-messages", "blank-gemini": "google-generative-ai"};
export const isBlankTemplate = (template: string): template is BlankTemplate => (BLANK_TEMPLATES as readonly string[]).includes(template);

/** 角色图标键：小写字母、数字与连字符。 */
const ICON_KEY = "^[a-z0-9][a-z0-9-]*$";
/** 角色的思考档：`off` 是关闭，其余是档位；模型没有这一档时请求时按模型夹取。 */
export const RoleEffort = Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max")]);
export const ProviderApiSchema = Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses"), Type.Literal("anthropic-messages"), Type.Literal("google-generative-ai")]);
export type ProviderApi = Static<typeof ProviderApiSchema>;
const Headers = Type.Record(Type.String({minLength: 1}), Type.String());
const Price = Type.Union([Type.Tuple([Type.Number({minimum: 0}), Type.Number({minimum: 0}), Type.Number({minimum: 0}), Type.Number({minimum: 0})]), Type.Null()]);

export const ModelConfigSchema = Type.Object({
    id: Type.String({minLength: 1}),
    name: Type.Optional(Type.String()),
    group: Type.Optional(Type.String()),
    enabled: Type.Boolean(),
    contextWindow: Type.Optional(Type.Integer({minimum: 1})),
    maxOutput: Type.Optional(Type.Integer({minimum: 1})),
    vision: Type.Optional(Type.Boolean()),
    reasoning: Type.Optional(Type.Boolean()),
    efforts: Type.Optional(Type.Array(Type.String())),
    /** 旧的固定触发点：读作 `compaction: {mode: "tokens"}`，保存时换成新的。 */
    compactAt: Type.Optional(Type.Integer({minimum: 1})),
    compaction: Type.Optional(CompactionSettingSchema),
    price: Type.Optional(Price),
    headers: Type.Optional(Headers),
    /** 来历：`source` 是模板目录里的模型（只记用户改过的字段），`manual` 是手加的。v1 的条目没有这个字段，读的时候按服务商种类补。 */
    origin: Type.Optional(Type.Union([Type.Literal("source"), Type.Literal("manual")])),
    /** 关掉“服务商新出的模型自动加入”时给当时有效的来源模型补的条目；重新打开时只删仍带这个标记、没有别的覆盖的。 */
    frozen: Type.Optional(Type.Literal(true)),
}, {additionalProperties: false});

/** 服务商图标：内置的（键到图标的表在应用里）、上传的（状态根里的文件名）、首字母块。不写是跟随模板的图标。 */
export const ProviderIconSchema = Type.Union([
    Type.Object({kind: Type.Literal("builtin"), key: Type.String({pattern: "^[a-z0-9][a-z0-9._-]*$", maxLength: 60})}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("file"), name: Type.String({pattern: "^[a-f0-9]{64}\\.png$"})}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("initial")}, {additionalProperties: false}),
]);
export type ProviderIcon = Static<typeof ProviderIconSchema>;

/**
 * 服务商自己的代理，盖过应用级的（docs/specs/network/egress.md）：跟随系统、自定义地址（http 或 https，不带用户名密码）、直连。
 * 不写是跟随应用。
 */
export const ProviderProxySchema = Type.Union([
    Type.Object({mode: Type.Literal("system")}, {additionalProperties: false}),
    Type.Object({mode: Type.Literal("direct")}, {additionalProperties: false}),
    Type.Object({mode: Type.Literal("custom"), url: Type.String({minLength: 1, maxLength: 2048})}, {additionalProperties: false}),
]);
export type ProviderProxy = Static<typeof ProviderProxySchema>;

/**
 * 服务商（模板的一个实例）。`template` 建后不变：模板只决定初始值和去哪查模型元数据；协议、地址、图标、代理都能改。
 */
export const ProviderConfigSchema = Type.Object({
    id: Type.String({pattern: PROVIDER_ID}),
    /** 创建时生成的随机标识，永不复用：会话日志里的部署身份与（以后）来源缓存的有效性只认它，同名重建不继承旧的。 */
    uid: Type.String({minLength: 1, maxLength: 80}),
    template: Type.String({minLength: 1}),
    region: Type.Optional(Type.String({minLength: 1})),
    name: Type.String(),
    icon: Type.Optional(ProviderIconSchema),
    /** 覆盖模板的协议；不写跟随模板（空白模板由建立时写入）。 */
    api: Type.Optional(ProviderApiSchema),
    baseUrl: Type.Optional(Type.String({minLength: 1})),
    apiKeyEnv: Type.Optional(Type.String({pattern: ENV_NAME})),
    auth: Type.Union([Type.Literal("default"), Type.Literal("bearer"), Type.Literal("none")]),
    headers: Type.Optional(Headers),
    proxy: Type.Optional(ProviderProxySchema),
    /** 服务商新出的模型自动加入（B1：打包目录里新增的）。 */
    followSource: Type.Boolean(),
    /** 用户移出的来源模型 id。 */
    excluded: Type.Array(Type.String()),
    models: Type.Array(ModelConfigSchema),
}, {additionalProperties: false});

/** v1 的服务商形状：目录服务商（id 即目录 id）与自定义服务商；读进来时归一成 `ProviderConfig`，见 `normalizeProviders`。 */
export const LegacyProviderConfigSchema = Type.Object({
    id: Type.String({pattern: PROVIDER_ID}),
    kind: Type.Union([Type.Literal("catalog"), Type.Literal("custom")]),
    name: Type.String(),
    baseUrl: Type.Optional(Type.String({minLength: 1})),
    api: Type.Optional(Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses"), Type.Literal("anthropic-messages")])),
    apiKeyEnv: Type.Optional(Type.String({pattern: ENV_NAME})),
    auth: Type.Union([Type.Literal("default"), Type.Literal("bearer"), Type.Literal("none")]),
    headers: Type.Optional(Headers),
    models: Type.Array(ModelConfigSchema),
}, {additionalProperties: false});

export const RoleConfigSchema = Type.Object({
    id: Type.String({pattern: ROLE_ID}),
    axis: Type.Union([Type.Literal("gradient"), Type.Literal("specialist")]),
    /** 内置角色写空串，界面按 id 取应用本地化的名字与说明；自建角色是用户写的。 */
    name: Type.String(),
    description: Type.String(),
    /** `<服务商>/<模型>`；null 是未绑定。 */
    model: Type.Union([Type.String({minLength: 3}), Type.Null()]),
    /** 这个角色的默认思考档；不写是跟随模型。会话里明确选的档优先（docs/specs/models/service.md“角色的思考档”）。 */
    effort: Type.Optional(RoleEffort),
    /** 角色图标的键，键到图标的表在应用里；不认识的键应用画默认图标。 */
    icon: Type.Optional(Type.String({pattern: ICON_KEY, maxLength: 40})),
}, {additionalProperties: false});

/** 设置里存的服务商：每个元素新旧两种形状都接受，读的时候归一，第一次写入才换成新形状。 */
export const ProvidersSchema = Type.Array(Type.Union([ProviderConfigSchema, LegacyProviderConfigSchema]));
export const RolesSchema = Type.Object({items: Type.Array(RoleConfigSchema)}, {additionalProperties: false});

export type ModelConfig = Static<typeof ModelConfigSchema>;
export type ProviderConfig = Static<typeof ProviderConfigSchema>;
export type LegacyProviderConfig = Static<typeof LegacyProviderConfigSchema>;
/** 设置里存着的服务商：新形状或 v1 形状。 */
export type StoredProvider = ProviderConfig | LegacyProviderConfig;
export type RoleConfig = Static<typeof RoleConfigSchema>;
export type RolesConfig = Static<typeof RolesSchema>;

/** 内置角色：梯度四档与专精“压缩”；不能删、不能改 id 与轴（模型角色合同）。用这个包的应用共用同一组。 */
export const BUILTIN_ROLES: ReadonlyArray<Pick<RoleConfig, "id" | "axis">> = [
    {id: "tiny", axis: "gradient"},
    {id: "fast", axis: "gradient"},
    {id: "main", axis: "gradient"},
    {id: "deep", axis: "gradient"},
    {id: "compaction", axis: "specialist"},
];

export const DEFAULT_ROLES: RolesConfig = {items: BUILTIN_ROLES.map((role) => ({...role, name: "", description: "", model: null}))};

/**
 * 服务自己按 id 取的内置角色：没有指定角色时用 `main`，审批用 `fast`，压缩用 nb-harness 的 kit 按角色取模型时的那个 id。
 * `BUILTIN_ROLES` 必须含这里的每个 id（`roles.test.ts`）。
 */
export const MODEL_ROLE_IDS = {main: "main", fast: "fast", compaction: MODEL_ROLES.compaction} as const;
