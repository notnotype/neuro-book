/**
 * 模型服务的合同：设置页看到的快照与结果形状、远程合同的定义（缺 id）、进程内服务的接口。浏览器与服务端共用；值导入只有
 * `typebox`，nb-runtime 与 nb-harness 只取类型。
 */

export {
    CatalogModelSchema,
    CatalogProviderSchema,
    CheckResultSchema,
    DiscoveredSchema,
    KeyStatusSchema,
    ModelsSnapshotSchema,
    RoleStatusSchema,
    SnapshotModelSchema,
    SnapshotProviderSchema,
    SnapshotRoleSchema,
} from "./shapes";
export type {CatalogProvider, CheckResult, KeyStatus, ModelsSnapshot, RoleStatus, SnapshotModel, SnapshotProvider, SnapshotRole} from "./shapes";
export {modelsSettingsSpec} from "./settings-spec";
export type {ModelsSettingsContract} from "./settings-spec";
export {hasCredentials} from "./service";
export type {ModelsService, ProfileModelDefaults} from "./service";
