/**
 * `nbook.models` 的两个设置项（docs/specs/models/service.md“输入与前置条件”）：服务商与模型、模型角色。都只允许用户层
 * （指定网络地址与凭据来源的项不让项目层改，configuration.md 的作者规则），只由本插件的服务端写（service.md 输出 6）。
 * 密钥不在这里；`apiKeyEnv` 与请求头里的 `env:` 只是变量名。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineSettings} from "nbook/shared/settings";

import {CompactionSettingSchema, DEFAULT_COMPACTION} from "./compaction";
import {modelsText} from "./text";

/** 两个 page 分区的 id（界面在浏览器入口交付）。 */
export const PROVIDERS_SECTION = "nbook.models.providers";
export const ROLES_SECTION = "nbook.models.roles";

/** 服务商 id：目录服务商即目录 id；自定义的由名字生成。不含 `/`：模型引用 `<服务商>/<模型>` 按第一个 `/` 切。 */
export const PROVIDER_ID = "^[a-z0-9][a-z0-9._-]*$";
const ENV_NAME = "^[A-Za-z_][A-Za-z0-9_]*$";
const ROLE_ID = "^[a-z0-9][a-z0-9-]*$";

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
}, {additionalProperties: false});

export const ProviderConfigSchema = Type.Object({
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
    /** 内置角色写空串，界面按 id 取本地化的名字与说明；自建角色是用户写的。 */
    name: Type.String(),
    description: Type.String(),
    /** `<服务商>/<模型>`；null 是未绑定。 */
    model: Type.Union([Type.String({minLength: 3}), Type.Null()]),
}, {additionalProperties: false});

export const ProvidersSchema = Type.Array(ProviderConfigSchema);
export const RolesSchema = Type.Object({items: Type.Array(RoleConfigSchema)}, {additionalProperties: false});

export type ModelConfig = Static<typeof ModelConfigSchema>;
export type ProviderConfig = Static<typeof ProviderConfigSchema>;
export type RoleConfig = Static<typeof RoleConfigSchema>;
export type RolesConfig = Static<typeof RolesSchema>;

/** 内置角色：梯度四档与专精“压缩”；不能删、不能改 id 与轴（模型角色合同）。 */
export const BUILTIN_ROLES: ReadonlyArray<Pick<RoleConfig, "id" | "axis">> = [
    {id: "tiny", axis: "gradient"},
    {id: "fast", axis: "gradient"},
    {id: "main", axis: "gradient"},
    {id: "deep", axis: "gradient"},
    {id: "compaction", axis: "specialist"},
];

export const DEFAULT_ROLES: RolesConfig = {items: BUILTIN_ROLES.map((role) => ({...role, name: "", description: "", model: null}))};

/** `nbook.agent` 的分区（docs/specs/agent/run-guards.md）。Agent 依赖模型服务，反过来引用会成环，所以按 id 写。 */
const RUN_GUARDS_SECTION = "nbook.agent.reliability";

export const modelsSettings = defineSettings("nbook.models", {
    compaction: {
        schema: CompactionSettingSchema,
        default: DEFAULT_COMPACTION,
        title: modelsText("settings.compaction.title"),
        description: modelsText("settings.compaction.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "compaction",
        order: 10,
    },
    providers: {
        schema: ProvidersSchema,
        default: [],
        title: modelsText("settings.providers.title"),
        description: modelsText("settings.providers.description"),
        layers: ["user"],
        section: PROVIDERS_SECTION,
    },
    roles: {
        schema: RolesSchema,
        default: DEFAULT_ROLES,
        title: modelsText("settings.roles.title"),
        description: modelsText("settings.roles.description"),
        layers: ["user"],
        section: ROLES_SECTION,
    },
    streamFirstEventTimeoutSeconds: {
        schema: Type.Integer({minimum: 0, maximum: 3600}),
        default: 300,
        title: modelsText("settings.streamFirstEventTimeoutSeconds.title"),
        description: modelsText("settings.streamFirstEventTimeoutSeconds.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "requests",
        order: 20,
    },
    streamIdleTimeoutSeconds: {
        schema: Type.Integer({minimum: 0, maximum: 3600}),
        default: 300,
        title: modelsText("settings.streamIdleTimeoutSeconds.title"),
        description: modelsText("settings.streamIdleTimeoutSeconds.description"),
        layers: ["user"],
        section: RUN_GUARDS_SECTION,
        group: "requests",
        order: 30,
    },
});
