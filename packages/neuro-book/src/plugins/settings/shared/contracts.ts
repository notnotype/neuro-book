/**
 * `nbook.settings` 的服务键与远程服务合同（docs/specs/settings/configuration.md）。
 *
 * 两份远程合同的方法与事件相同，只是层不同：`nbook.settings/user` 由服务端实例提供，`nbook.settings/project` 由项目
 * 实例提供。写入的调用方身份由内核填写，输入里没有插件字段。拥有者一侧的失败统一以业务失败码 `settings-failed`
 * 返回，详情里带配置的失败码：配置的 `denied`、`unavailable`、`unknown-outcome` 与路由层失败码同名，不能直接声明为
 * 业务失败码。别的插件只依赖 `settingsKey`，不直接调用这两份合同。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import {SETTINGS_FAILURES, SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingsService} from "nbook/shared/settings";

export {SETTINGS_POINT};

/** 插件依赖它取得按调用方生成的配置服务。 */
export const settingsKey: ServiceKey<SettingsService> = defineServiceKey<SettingsService>("nbook.settings/settings");

const RevisionSchema = Type.Object({boot: Type.String(), seq: Type.Integer({minimum: 0})}, {additionalProperties: false});
const ProblemSchema = Type.Object({key: Type.String(), reason: Type.Union([Type.Literal("invalid-value"), Type.Literal("layer-not-allowed")])}, {additionalProperties: false});
const ValuesSchema = Type.Record(Type.String(), Type.Unknown());

export const LayerSnapshotSchema = Type.Union([
    Type.Object({status: Type.Literal("ok"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema)}, {additionalProperties: false}),
    Type.Object({status: Type.Literal("invalid"), revision: RevisionSchema, values: ValuesSchema, problems: Type.Array(ProblemSchema), detail: Type.String()}, {additionalProperties: false}),
]);

const SettingsFailedDetail = Type.Object({code: Type.Enum(SETTINGS_FAILURES), detail: Type.String()}, {additionalProperties: false});
const Written = Type.Object({snapshot: LayerSnapshotSchema}, {additionalProperties: false});
const failures = {"settings-failed": SettingsFailedDetail};

/**
 * 只写调用方插件自己声明的项；成功时带回写后的层快照，调用方据此先更新本实例再结算。删除是单独的方法，不靠 JSON
 * 保留 undefined。
 */
const methods = {
    set: {input: Type.Object({key: Type.String(), value: Type.Unknown()}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
    remove: {input: Type.Object({key: Type.String()}, {additionalProperties: false}), output: Written, effect: "write", errors: failures},
} as const;

/** 订阅先推一次当前快照，之后层的状态、键值、被丢弃的键或无效原因变化时推送。 */
const events = {layer: {filter: Type.Object({}, {additionalProperties: false}), payload: LayerSnapshotSchema}} as const;

export const userSettingsContract = defineRemoteService({id: "nbook.settings/user", version: 1, provider: "server", callers: ["browser", "tui", "project"], methods, events});

export const projectSettingsContract = defineRemoteService({id: "nbook.settings/project", version: 1, provider: "project", callers: ["browser", "tui"], methods, events});

export type SettingsContract = typeof userSettingsContract | typeof projectSettingsContract;
