/**
 * `nbook.models` 对其它插件公开的合同（docs/specs/models/service.md 输出 10、12）：进程内服务 `modelsKey`（给 Agent 插件的
 * 模型端口）与远程合同 `nbook.models/settings`（给设置页）。任何响应与事件里都没有密钥；请求头的值是设置里写的原样
 * （设置文件本来就对所有已声明项可读），`env:` 不解析。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import type {Static} from "typebox";

import type {ModelPort} from "@notnotype/nb-harness/kernel/contracts";

import {ModelConfigSchema} from "./settings";

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);
const Headers = Type.Record(Type.String(), Type.String());
const Price = Nullable(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]));
const Api = Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses"), Type.Literal("anthropic-messages")]);
const Auth = Type.Union([Type.Literal("default"), Type.Literal("bearer"), Type.Literal("none")]);

/** 这家的密钥从哪来、有没有：`env` 写出变量名与启动环境里有没有值；值本身从不出插件。 */
export const KeyStatusSchema = Type.Union([
    Type.Object({kind: Type.Literal("none")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("stored")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("keyless")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("env"), name: Type.String(), found: Type.Boolean()}, {additionalProperties: false}),
]);
export type KeyStatus = Static<typeof KeyStatusSchema>;

/**
 * 快照里的一个模型：目录模型的字段已与目录合好。`status`：`missing` 设置里引用了、目录里已经没有（目录漂移，输出 9）；
 * `incomplete` 自定义模型缺上下文窗口。
 */
export const SnapshotModelSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    group: Type.String(),
    enabled: Type.Boolean(),
    contextWindow: Nullable(Type.Integer()),
    maxOutput: Nullable(Type.Integer()),
    vision: Type.Boolean(),
    reasoning: Type.Boolean(),
    efforts: Type.Array(Type.String()),
    compactAt: Nullable(Type.Integer()),
    price: Price,
    headers: Headers,
    status: Type.Union([Type.Literal("ok"), Type.Literal("missing"), Type.Literal("incomplete")]),
}, {additionalProperties: false});

export const SnapshotProviderSchema = Type.Object({
    id: Type.String(),
    kind: Type.Union([Type.Literal("catalog"), Type.Literal("custom")]),
    name: Type.String(),
    /** 实际发请求的地址（目录服务商没覆盖时是目录的）。 */
    baseUrl: Nullable(Type.String()),
    /** 目录服务商在目录里的地址；自定义服务商为 null。 */
    catalogBaseUrl: Nullable(Type.String()),
    api: Nullable(Type.String()),
    auth: Auth,
    headers: Headers,
    key: KeyStatusSchema,
    models: Type.Array(SnapshotModelSchema),
}, {additionalProperties: false});

/** 角色的有效性，与解析的结论一致（输出 8）。 */
export const RoleStatusSchema = Type.Union([Type.Literal("ok"), Type.Literal("unbound"), Type.Literal("unknown-model"), Type.Literal("no-credentials")]);
export type RoleStatus = Static<typeof RoleStatusSchema>;

export const SnapshotRoleSchema = Type.Object({
    id: Type.String(),
    axis: Type.Union([Type.Literal("gradient"), Type.Literal("specialist")]),
    builtin: Type.Boolean(),
    name: Type.String(),
    description: Type.String(),
    model: Nullable(Type.String()),
    status: RoleStatusSchema,
}, {additionalProperties: false});

export const ModelsSnapshotSchema = Type.Object({providers: Type.Array(SnapshotProviderSchema), roles: Type.Array(SnapshotRoleSchema)}, {additionalProperties: false});
export type ModelsSnapshot = Static<typeof ModelsSnapshotSchema>;
export type SnapshotProvider = Static<typeof SnapshotProviderSchema>;
export type SnapshotModel = Static<typeof SnapshotModelSchema>;

/** Profile 设置里的模型或角色（t05、t10 交来）。 */
export interface ProfileModelDefaults {
    readonly model?: string;
    readonly role?: string;
}

export interface ModelsService {
    /**
     * 模型端口，所有会话共用一个。`profileDefaults` 每次解析都调（换 Profile、改 Profile 设置即时生效）；不给时没有
     * Profile 默认。解析表见 service.md 输出 8。
     */
    port(profileDefaults?: (profile: string) => ProfileModelDefaults): ModelPort;
    snapshot(): ModelsSnapshot;
    onChange(listener: () => void): () => void;
}

/** 别的服务端插件依赖它取模型端口；只在服务端提供。 */
export const modelsKey: ServiceKey<ModelsService> = defineServiceKey<ModelsService>("nbook.models/models");

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const SettingsDetail = Type.Object({code: Type.String(), detail: Type.String()}, {additionalProperties: false});
const writeErrors = {"invalid-value": Detail, "write-conflict": Detail, "settings-unavailable": SettingsDetail} as const;
const providerWriteErrors = {...writeErrors, "unknown-provider": Detail} as const;

export const CatalogProviderSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    access: Type.Union([Type.Literal("keyless"), Type.Literal("login"), Type.Literal("key"), Type.Literal("unsupported")]),
    added: Type.Boolean(),
}, {additionalProperties: false});

export const CatalogModelSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    contextWindow: Nullable(Type.Integer()),
    maxOutput: Nullable(Type.Integer()),
    vision: Type.Boolean(),
    reasoning: Type.Boolean(),
    efforts: Type.Array(Type.String()),
    price: Price,
}, {additionalProperties: false});

/** 发现的候选：按名字在目录里找到参照时带建议值（只是建议，用户加入后可改）。 */
export const DiscoveredSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    suggested: Nullable(Type.Object({contextWindow: Nullable(Type.Integer()), maxOutput: Nullable(Type.Integer()), vision: Type.Boolean(), reasoning: Type.Boolean()}, {additionalProperties: false})),
}, {additionalProperties: false});

/** 检测结果：失败时 `kind` 是模型失败的类别，`raw` 是遮盖、截断过的服务商原文。 */
export const CheckResultSchema = Type.Union([
    Type.Object({ok: Type.Literal(true)}, {additionalProperties: false}),
    Type.Object({ok: Type.Literal(false), kind: Type.String(), code: Nullable(Type.String()), raw: Type.String()}, {additionalProperties: false}),
]);
export type CheckResult = Static<typeof CheckResultSchema>;

const ProviderInput = Type.Object({provider: Type.String()}, {additionalProperties: false});
const IdInput = Type.Object({id: Type.String()}, {additionalProperties: false});
const None = Type.Null();

const methods = {
    catalogProviders: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(CatalogProviderSchema), effect: "read"},
    catalogModels: {input: ProviderInput, output: Type.Array(CatalogModelSchema), effect: "read", errors: {"unknown-provider": Detail}},
    snapshot: {input: Type.Object({}, {additionalProperties: false}), output: ModelsSnapshotSchema, effect: "read"},
    /** 目录服务商给目录 id；自定义服务商给名字、地址与接口格式，id 由名字生成。 */
    addProvider: {
        input: Type.Object({source: Type.Union([
            Type.Object({kind: Type.Literal("catalog"), id: Type.String()}, {additionalProperties: false}),
            Type.Object({kind: Type.Literal("custom"), name: Type.String({minLength: 1}), baseUrl: Type.String({minLength: 1}), api: Api}, {additionalProperties: false}),
        ])}, {additionalProperties: false}),
        output: Type.Object({id: Type.String()}, {additionalProperties: false}),
        effect: "write",
        errors: {...writeErrors, "unknown-provider": Detail},
    },
    /** `baseUrl: null` 去掉目录服务商的地址覆盖。 */
    updateProvider: {
        input: Type.Object({id: Type.String(), patch: Type.Object({
            name: Type.Optional(Type.String()),
            baseUrl: Type.Optional(Nullable(Type.String({minLength: 1}))),
            api: Type.Optional(Api),
            auth: Type.Optional(Auth),
            headers: Type.Optional(Headers),
        }, {additionalProperties: false})}, {additionalProperties: false}),
        output: None,
        effect: "write",
        errors: providerWriteErrors,
    },
    /** 连同凭据库里这家的密钥一起删。 */
    removeProvider: {input: IdInput, output: None, effect: "write", errors: {...providerWriteErrors, "credentials-unavailable": Detail}},
    /** 按 id 加入或整条替换一个模型。 */
    upsertModel: {input: Type.Object({provider: Type.String(), model: ModelConfigSchema}, {additionalProperties: false}), output: None, effect: "write", errors: {...providerWriteErrors, "model-incomplete": Detail}},
    removeModel: {input: Type.Object({provider: Type.String(), id: Type.String()}, {additionalProperties: false}), output: None, effect: "write", errors: providerWriteErrors},
    /** “管理模型”的“完成”：一次写加入与移出的全部。 */
    setModels: {input: Type.Object({provider: Type.String(), add: Type.Array(ModelConfigSchema), remove: Type.Array(Type.String())}, {additionalProperties: false}), output: None, effect: "write", errors: {...providerWriteErrors, "model-incomplete": Detail}},
    setRole: {input: Type.Object({id: Type.String(), model: Nullable(Type.String())}, {additionalProperties: false}), output: None, effect: "write", errors: {...writeErrors, "unknown-role": Detail}},
    addRole: {input: Type.Object({name: Type.String({minLength: 1}), description: Type.String()}, {additionalProperties: false}), output: Type.Object({id: Type.String()}, {additionalProperties: false}), effect: "write", errors: writeErrors},
    updateRole: {input: Type.Object({id: Type.String(), name: Type.String({minLength: 1}), description: Type.String()}, {additionalProperties: false}), output: None, effect: "write", errors: {...writeErrors, "unknown-role": Detail, "builtin-role": Detail}},
    removeRole: {input: IdInput, output: None, effect: "write", errors: {...writeErrors, "unknown-role": Detail, "builtin-role": Detail}},
    /** `value` 以 `env:` 开头时存成 `apiKeyEnv`，否则写凭据库（service.md 输出 13）。返回写后的状态。 */
    setKey: {
        input: Type.Object({provider: Type.String(), value: Type.String({minLength: 1})}, {additionalProperties: false}),
        output: KeyStatusSchema,
        effect: "write",
        errors: {...providerWriteErrors, "credentials-unavailable": Detail, "partially-applied": Type.Object({key: KeyStatusSchema, detail: Type.String()}, {additionalProperties: false})},
    },
    clearKey: {
        input: ProviderInput,
        output: KeyStatusSchema,
        effect: "write",
        errors: {...providerWriteErrors, "credentials-unavailable": Detail, "partially-applied": Type.Object({key: KeyStatusSchema, detail: Type.String()}, {additionalProperties: false})},
    },
    discover: {
        input: ProviderInput,
        output: Type.Array(DiscoveredSchema),
        effect: "read",
        errors: {"unknown-provider": Detail, "no-credentials": Detail, "not-supported": Detail, "auth": Detail, "unreachable": Detail, "failed": Detail},
    },
    check: {input: Type.Object({provider: Type.String(), model: Type.String()}, {additionalProperties: false}), output: CheckResultSchema, effect: "read", errors: {"unknown-provider": Detail, "unknown-model": Detail}},
    checkAll: {input: ProviderInput, output: Type.Array(Type.Object({model: Type.String(), result: CheckResultSchema}, {additionalProperties: false})), effect: "read", errors: {"unknown-provider": Detail}},
} as const;

/** 订阅先推一次当前快照，之后快照每变一次推一次。 */
const events = {changed: {filter: Type.Object({}, {additionalProperties: false}), payload: ModelsSnapshotSchema}} as const;

export const modelsSettingsContract = defineRemoteService({id: "nbook.models/settings", version: 1, provider: "server", callers: ["browser"], methods, events});
