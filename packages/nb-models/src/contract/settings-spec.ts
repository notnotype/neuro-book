/**
 * 设置页用的远程合同（docs/specs/models/service.md 输出 10、12）：方法、事件、版本、提供方与调用方。合同 id 带应用的插件 id，
 * 由应用给：`defineRemoteService({id: "<插件 id>/settings", ...modelsSettingsSpec})`，推出的合同类型就是
 * `ModelsSettingsContract`。
 */

import type {RemoteContract} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";

import {ModelConfigSchema, RoleEffort} from "../config/shapes";
import {Api, ApiDetectionSchema, Auth, CheckResultSchema, Headers, KeyStatusSchema, ModelRowSchema, ModelsSnapshotSchema, Nullable, TemplateSchema} from "./shapes";

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const SettingsDetail = Type.Object({code: Type.String(), detail: Type.String()}, {additionalProperties: false});
/**
 * 写入类方法共有的失败：值不合法、设置一直在变（串行写入重试用尽）、设置层不可写（`code` 是存储给的原因）。服务核心按这张表
 * 推出写入步骤的失败类型。
 */
const writeErrors = {"invalid-value": Detail, "write-conflict": Detail, "settings-unavailable": SettingsDetail} as const;
const providerWriteErrors = {...writeErrors, "unknown-provider": Detail} as const;

const ProviderInput = Type.Object({provider: Type.String()}, {additionalProperties: false});
const IdInput = Type.Object({id: Type.String()}, {additionalProperties: false});
const None = Type.Null();

/** 模型行分页：页大小上限，调用方按它一页页读完一家。 */
export const MODEL_PAGE_SIZE = 200;
/** `modelsByReference` 一次最多取的引用数。 */
export const MODEL_REFERENCES_MAX = 50;

const PageInput = {offset: Type.Integer({minimum: 0}), limit: Type.Integer({minimum: 1, maximum: MODEL_PAGE_SIZE}), revision: Type.Optional(Type.String())} as const;
const PageOutput = {revision: Type.String(), nextOffset: Nullable(Type.Integer()), total: Type.Integer()} as const;
/** 分页读的后续页带首页的 `revision`；中间这家的行变了就换代，调用方重读。 */
const pageErrors = {"revision-changed": Detail} as const;
const ReferencedRow = Type.Object({provider: Type.String(), ...ModelRowSchema.properties}, {additionalProperties: false});

const methods = {
    templates: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(TemplateSchema), effect: "read"},
    snapshot: {input: Type.Object({}, {additionalProperties: false}), output: ModelsSnapshotSchema, effect: "read"},
    /** 按模板建一份服务商：空白模板必须给名称与地址；有地区的模板给地区。id 由名称生成，同模板可以建多份。 */
    addProvider: {
        input: Type.Object({template: Type.String(), region: Type.Optional(Type.String()), name: Type.Optional(Type.String({minLength: 1})), baseUrl: Type.Optional(Type.String({minLength: 1})), api: Type.Optional(Api)}, {additionalProperties: false}),
        output: Type.Object({id: Type.String()}, {additionalProperties: false}),
        effect: "write",
        errors: {...writeErrors, "unknown-template": Detail, "template-unavailable": Detail, "credentials-unavailable": Detail},
    },
    /** 复制配置（新 uid）；密钥只复制有效的方式。第二步失败时 `partially-applied` 带副本 id 与实际密钥状态。 */
    duplicateProvider: {
        input: IdInput,
        output: Type.Object({id: Type.String()}, {additionalProperties: false}),
        effect: "write",
        errors: {...providerWriteErrors, "credentials-unavailable": Detail, "partially-applied": Type.Object({id: Type.String(), key: KeyStatusSchema, detail: Type.String()}, {additionalProperties: false})},
    },
    /** 省略的不改，`null` 清除（`region`、`api`、`baseUrl`）；改名重名返回 `invalid-value`。 */
    updateProvider: {
        input: Type.Object({id: Type.String(), patch: Type.Object({
            name: Type.Optional(Type.String({minLength: 1})),
            region: Type.Optional(Nullable(Type.String({minLength: 1}))),
            baseUrl: Type.Optional(Nullable(Type.String({minLength: 1}))),
            api: Type.Optional(Nullable(Api)),
            auth: Type.Optional(Auth),
            headers: Type.Optional(Headers),
            followSource: Type.Optional(Type.Boolean()),
        }, {additionalProperties: false})}, {additionalProperties: false}),
        output: None,
        effect: "write",
        errors: providerWriteErrors,
    },
    /**
     * 图标：上传的是客户端缩好的 PNG（base64，≤ 90 KB 的编码串，解码后 ≤ 64 KB、≤ 256 × 256、不是动图）；`null` 恢复模板的图标。
     * 失败的 `reason` 是 `not-png`、`too-large`、`animated`、`undecodable`、`write-failed`。
     */
    setIcon: {
        input: Type.Object({provider: Type.String(), icon: Nullable(Type.Union([
            Type.Object({kind: Type.Literal("upload"), png: Type.String({maxLength: 90_000})}, {additionalProperties: false}),
            Type.Object({kind: Type.Literal("builtin"), key: Type.String({pattern: "^[a-z0-9][a-z0-9._-]*$", maxLength: 60})}, {additionalProperties: false}),
            Type.Object({kind: Type.Literal("initial")}, {additionalProperties: false}),
        ]))}, {additionalProperties: false}),
        output: None,
        effect: "write",
        errors: {...providerWriteErrors, "icon-rejected": Type.Object({reason: Type.String(), detail: Type.String()}, {additionalProperties: false})},
    },
    /**
     * 一家的模型行，按稳定顺序（系列、名称、id）分页。`scope`：`listed` 是在列表里的，`available` 是来源里有、没在列表里的（已移出、
     * 没加过，或类型不明、不自动加入的）。
     */
    providerModels: {
        input: Type.Object({provider: Type.String(), scope: Type.Optional(Type.Union([Type.Literal("listed"), Type.Literal("available")])), ...PageInput}, {additionalProperties: false}),
        output: Type.Object({rows: Type.Array(ModelRowSchema), ...PageOutput}, {additionalProperties: false}),
        effect: "read",
        errors: {"unknown-provider": Detail, ...pageErrors},
    },
    /** 启用的模型（跨服务商）；`usable` 只要有凭据且可用的（选择器、agent 标签用）。 */
    enabledModels: {
        input: Type.Object({providers: Type.Optional(Type.Array(Type.String())), usable: Type.Optional(Type.Boolean()), ...PageInput}, {additionalProperties: false}),
        output: Type.Object({rows: Type.Array(ReferencedRow), ...PageOutput}, {additionalProperties: false}),
        effect: "read",
        errors: pageErrors,
    },
    /** 按 `<服务商>/<模型>` 引用取行（含未启用的），一次不超过 `MODEL_REFERENCES_MAX` 个；找不到的 `row` 为 null。 */
    modelsByReference: {
        input: Type.Object({references: Type.Array(Type.String(), {maxItems: MODEL_REFERENCES_MAX})}, {additionalProperties: false}),
        output: Type.Array(Type.Object({reference: Type.String(), provider: Nullable(Type.String()), row: Nullable(ModelRowSchema)}, {additionalProperties: false})),
        effect: "read",
    },
    /** 连同凭据库里这家的密钥一起删。 */
    removeProvider: {input: IdInput, output: None, effect: "write", errors: {...providerWriteErrors, "credentials-unavailable": Detail}},
    /** 按 id 加入或整条替换一个模型。 */
    upsertModel: {input: Type.Object({provider: Type.String(), model: ModelConfigSchema}, {additionalProperties: false}), output: None, effect: "write", errors: {...providerWriteErrors, "model-incomplete": Detail}},
    removeModel: {input: Type.Object({provider: Type.String(), id: Type.String()}, {additionalProperties: false}), output: None, effect: "write", errors: providerWriteErrors},
    /**
     * “管理模型”的“完成”：一次写加入与移出的全部。`add`：来源模型取消移出（没开“自动加入”时补一条），手加的新建或整条替换；
     * `remove`：来源模型移出（进 `excluded`，覆盖不保留），手加的删除；被角色用着的先解除绑定（输出 15）。
     */
    setModels: {input: Type.Object({provider: Type.String(), add: Type.Array(ModelConfigSchema), remove: Type.Array(Type.String())}, {additionalProperties: false}), output: None, effect: "write", errors: {...providerWriteErrors, "model-incomplete": Detail}},
    /** 按字段打补丁：省略的不改，`null` 清除（`model: null` 是解除绑定，`effort: null` 是跟随模型，`icon: null` 是默认图标）。 */
    setRole: {input: Type.Object({id: Type.String(), model: Type.Optional(Nullable(Type.String())), effort: Type.Optional(Nullable(RoleEffort)), icon: Type.Optional(Nullable(Type.String({pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 40})))}, {additionalProperties: false}), output: None, effect: "write", errors: {...writeErrors, "unknown-role": Detail}},
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
    /**
     * 重新拉取这家的模型列表：受理即交回，结果经 `changed` 的快照交（`source.refreshing` 先为真，完成后 `state`、`error` 更新）。
     * 同一部署与凭据的在途拉取合并；没有可用凭据为 `no-credentials`；设置读不到时不出站，为 `settings-unavailable`。会写缓存，所以是
     * `write`：链路断在返回之前时，调用方按快照核对受理没有，不当成没执行。
     */
    refreshSource: {input: ProviderInput, output: None, effect: "write", errors: {"unknown-provider": Detail, "no-credentials": Detail, "settings-unavailable": SettingsDetail}},
    /** 检测一个模型（输出 11）。“检测全部”由调用方逐个调它、自己限并发。 */
    check: {input: Type.Object({provider: Type.String(), model: Type.String()}, {additionalProperties: false}), output: CheckResultSchema, effect: "read", errors: {"unknown-provider": Detail, "unknown-model": Detail}},
    /**
     * 协议检测（输出 26）：四种协议各发一次。`model` 不给时用第一个启用的、再用来源里第一个对话模型，都没有为 `no-model`；要密钥却
     * 没有为 `no-credentials`。不写入。
     */
    detectApi: {
        input: Type.Object({provider: Type.String(), model: Type.Optional(Type.String({minLength: 1, maxLength: 256}))}, {additionalProperties: false}),
        output: ApiDetectionSchema,
        effect: "read",
        errors: {"unknown-provider": Detail, "no-credentials": Detail, "no-model": Detail},
    },
    /**
     * 采用检测出的协议：`connection` 是那一行带回的（改用它之后的连接版本）。现在的配置改用 `api` 后算出来的不等于它（地址、凭据此后
     * 变过）为 `connection-changed`，不写：写进去的总是检测试过的那份。
     */
    adoptApi: {
        input: Type.Object({provider: Type.String(), api: Api, connection: Type.String()}, {additionalProperties: false}),
        output: None,
        effect: "write",
        errors: {...providerWriteErrors, "connection-changed": Detail},
    },
} as const;

/** 订阅先推一次当前快照，之后快照每变一次推一次。 */
const events = {changed: {filter: Type.Object({}, {additionalProperties: false}), payload: ModelsSnapshotSchema}} as const;

/** 设置页用的远程合同的定义，缺 id。 */
export const modelsSettingsSpec = {version: 5, provider: "server", callers: ["browser"], methods, events} as const;

/** 应用以 `modelsSettingsSpec` 定义出的合同的类型；服务核心的远程实现按它写。 */
export type ModelsSettingsContract = RemoteContract<typeof methods, typeof events, typeof modelsSettingsSpec.provider>;
