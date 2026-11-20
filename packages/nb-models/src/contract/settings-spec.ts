/**
 * 设置页用的远程合同（docs/specs/models/service.md 输出 10、12）：方法、事件、版本、提供方与调用方。合同 id 带应用的插件 id，
 * 由应用给：`defineRemoteService({id: "<插件 id>/settings", ...modelsSettingsSpec})`，推出的合同类型就是
 * `ModelsSettingsContract`。
 */

import type {RemoteContract} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";

import {ModelConfigSchema, RoleEffort} from "../config/shapes";
import {Api, Auth, CatalogModelSchema, CatalogProviderSchema, CheckResultSchema, DiscoveredSchema, Headers, KeyStatusSchema, ModelsSnapshotSchema, Nullable} from "./shapes";

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

/** 设置页用的远程合同的定义，缺 id。 */
export const modelsSettingsSpec = {version: 2, provider: "server", callers: ["browser"], methods, events} as const;

/** 应用以 `modelsSettingsSpec` 定义出的合同的类型；服务核心的远程实现按它写。 */
export type ModelsSettingsContract = RemoteContract<typeof methods, typeof events, typeof modelsSettingsSpec.provider>;
