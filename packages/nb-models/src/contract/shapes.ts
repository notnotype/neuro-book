/**
 * 设置页经远程合同看到的形状（docs/specs/models/service.md 输出 10、12）：快照、目录、发现的候选与检测结果。任何响应与事件
 * 里都没有密钥；请求头的值是设置里写的原样（设置文件本来就对所有已声明项可读），`env:` 不解析。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {CompactionSettingSchema} from "../config/compaction";

/** 包内几个形状共用的小块；不从入口导出。 */
export const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);
export const Headers = Type.Record(Type.String(), Type.String());
const Price = Nullable(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]));
export const Api = Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses"), Type.Literal("anthropic-messages")]);
export const Auth = Type.Union([Type.Literal("default"), Type.Literal("bearer"), Type.Literal("none")]);

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
    compaction: Nullable(CompactionSettingSchema),
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
export type SnapshotRole = Static<typeof SnapshotRoleSchema>;

export const CatalogProviderSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    access: Type.Union([Type.Literal("keyless"), Type.Literal("login"), Type.Literal("key"), Type.Literal("unsupported")]),
    added: Type.Boolean(),
}, {additionalProperties: false});
export type CatalogProvider = Static<typeof CatalogProviderSchema>;

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
