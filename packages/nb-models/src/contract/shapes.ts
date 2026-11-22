/**
 * 设置页经远程合同看到的形状（docs/specs/models/service.md 输出 10、12）：快照、目录、发现的候选与检测结果。任何响应与事件
 * 里都没有密钥；请求头的值是设置里写的原样（设置文件本来就对所有已声明项可读），`env:` 不解析。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {CompactionSettingSchema} from "../config/compaction";
import {ProviderApiSchema, ProviderIconSchema, RoleEffort} from "../config/shapes";

/** 包内几个形状共用的小块；不从入口导出。 */
export const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);
export const Headers = Type.Record(Type.String(), Type.String());
const Price = Nullable(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]));
export const Api = ProviderApiSchema;
export const Auth = Type.Union([Type.Literal("default"), Type.Literal("bearer"), Type.Literal("none")]);

/** 这家的密钥从哪来、有没有：`env` 写出变量名与启动环境里有没有值；值本身从不出插件。 */
export const KeyStatusSchema = Type.Union([
    Type.Object({kind: Type.Literal("none")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("stored")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("keyless")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("env"), name: Type.String(), found: Type.Boolean()}, {additionalProperties: false}),
]);
export type KeyStatus = Static<typeof KeyStatusSchema>;

/** 模型的推理能力（nb-harness 的 `ModelReasoning`）：界面按它画哪几档、“关闭”叫什么。 */
export const ReasoningSchema = Type.Union([
    Type.Object({kind: Type.Literal("none")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("fixed")}, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("levels"),
        levels: Type.Array(Type.String()),
        off: Type.Union([Type.Literal("disable"), Type.Literal("lowest"), Type.Literal("none")]),
        unset: Nullable(Type.String()),
        verified: Type.Boolean(),
    }, {additionalProperties: false}),
]);

/**
 * 一个模型行：模板目录的字段已与用户的覆盖合好。`status`：`unsupported` 目录里有、但不能当对话模型发（不是对话类或传输不走 HTTP
 * 请求）；`missing` 设置里引用了、目录里已经没有（目录漂移，输出 9）；
 * `incomplete` 上下文窗口不明（目录没给、用户也没填）。`usable`：启用、状态 ok、这家有凭据，服务端按解析的同一条件算。
 * `overridden`：用户改过、与来源值不同的字段（界面标“已改”、可恢复来源值）；手加的模型恒为空。`source`：这些字段的来源值（编辑对话框
 * “恢复来源值”时显示）；没有改过的字段时为 null，免得几百行都多带一份。
 */
export const ModelOverrideField = Type.Union([Type.Literal("name"), Type.Literal("contextWindow"), Type.Literal("maxOutput"), Type.Literal("vision"), Type.Literal("reasoning"), Type.Literal("price")]);
export const ModelRowSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    group: Type.String(),
    enabled: Type.Boolean(),
    origin: Type.Union([Type.Literal("source"), Type.Literal("manual")]),
    contextWindow: Nullable(Type.Integer()),
    maxOutput: Nullable(Type.Integer()),
    vision: Type.Boolean(),
    reasoning: Type.Boolean(),
    efforts: Type.Array(Type.String()),
    thinking: ReasoningSchema,
    compaction: Nullable(CompactionSettingSchema),
    price: Price,
    headers: Headers,
    status: Type.Union([Type.Literal("ok"), Type.Literal("missing"), Type.Literal("incomplete"), Type.Literal("unsupported")]),
    usable: Type.Boolean(),
    overridden: Type.Array(ModelOverrideField),
    source: Nullable(Type.Object({
        name: Type.String(),
        contextWindow: Nullable(Type.Integer()),
        maxOutput: Nullable(Type.Integer()),
        vision: Type.Boolean(),
        reasoning: Type.Boolean(),
        price: Price,
    }, {additionalProperties: false})),
}, {additionalProperties: false});
export type ModelRow = Static<typeof ModelRowSchema>;

/** 服务商的模型清单来源；B1 只有打包目录。 */
export const SourceStateSchema = Type.Object({kind: Type.Literal("packaged")}, {additionalProperties: false});

/**
 * 快照里的服务商：不带模型行（几百个模型的服务商会让每次快照都很大），行经 `providerModels` 分页读；`modelsRevision` 是这家
 * 模型行的版本，行变了它就变。
 */
export const SnapshotProviderSchema = Type.Object({
    id: Type.String(),
    template: Type.String(),
    region: Nullable(Type.String()),
    name: Type.String(),
    /** 用户选的图标；null 是跟随模板的图标。 */
    icon: Nullable(ProviderIconSchema),
    /** 实际发请求的地址（覆盖或模板的；混合协议模板各协议地址不同，取默认协议那条）；不明时为 null。 */
    baseUrl: Nullable(Type.String()),
    /** 模板给的地址（改回去的参照）；空白模板为 null。 */
    templateBaseUrl: Nullable(Type.String()),
    api: Nullable(Type.String()),
    /** 模板给的协议；空白模板是它的缺省协议。 */
    templateApi: Nullable(Type.String()),
    auth: Auth,
    headers: Headers,
    key: KeyStatusSchema,
    followSource: Type.Boolean(),
    source: SourceStateSchema,
    modelCount: Type.Integer(),
    enabledCount: Type.Integer(),
    /** 被移出的来源模型数。 */
    excludedCount: Type.Integer(),
    modelsRevision: Type.String(),
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
    /** 角色的默认思考档；null 是跟随模型。 */
    effort: Nullable(RoleEffort),
    /** 角色图标的键；null 是用内置角色的默认图标或通用图标。 */
    icon: Nullable(Type.String()),
    status: RoleStatusSchema,
}, {additionalProperties: false});

export const ModelsSnapshotSchema = Type.Object({providers: Type.Array(SnapshotProviderSchema), roles: Type.Array(SnapshotRoleSchema)}, {additionalProperties: false});
export type ModelsSnapshot = Static<typeof ModelsSnapshotSchema>;
export type SnapshotProvider = Static<typeof SnapshotProviderSchema>;
export type SnapshotRole = Static<typeof SnapshotRoleSchema>;

/** 模板的分组：添加服务商的对话框按它分组。 */
export const TemplateGroupSchema = Type.Union([Type.Literal("international"), Type.Literal("china"), Type.Literal("gateway"), Type.Literal("other"), Type.Literal("custom")]);

/** 为什么不能用这个模板添加：要登录、传输不走 HTTP 请求、认证方式不支持、地址要用户自己给（带占位）。 */
export const TemplateReasonSchema = Type.Union([Type.Literal("login"), Type.Literal("transport"), Type.Literal("unsupported-auth"), Type.Literal("needs-address")]);

export const TemplateSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    group: TemplateGroupSchema,
    /** 图标表里的键；空白模板为 null（用首字母）。 */
    logo: Nullable(Type.String()),
    blank: Type.Boolean(),
    addable: Type.Boolean(),
    reason: Nullable(TemplateReasonSchema),
    /** 打包目录里这家的对话模型数。 */
    modelCount: Type.Integer(),
    regions: Type.Array(Type.Object({id: Type.String(), baseUrl: Type.String()}, {additionalProperties: false})),
    routes: Type.Array(Type.Object({api: Api, baseUrl: Type.String()}, {additionalProperties: false})),
    /** 这家的密钥怎么来：不要密钥、要 API Key、要登录。 */
    access: Type.Union([Type.Literal("keyless"), Type.Literal("key"), Type.Literal("login")]),
}, {additionalProperties: false});
export type Template = Static<typeof TemplateSchema>;

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
