/**
 * 模型服务的合同：设置页看到的快照与结果形状、远程合同的定义（缺 id）、进程内服务的接口。浏览器与服务端共用；值导入只有
 * `typebox`，nb-runtime 与 nb-harness 只取类型。
 */

export {
    CheckResultSchema,
    DiscoveredSchema,
    KeyStatusSchema,
    ModelRowSchema,
    ModelsSnapshotSchema,
    RoleStatusSchema,
    SnapshotProviderSchema,
    SnapshotRoleSchema,
    TemplateSchema,
} from "./shapes";
export type {CheckResult, KeyStatus, ModelRow, ModelsSnapshot, RoleStatus, SnapshotProvider, SnapshotRole, Template} from "./shapes";
export {MODEL_PAGE_SIZE, MODEL_REFERENCES_MAX, modelsSettingsSpec} from "./settings-spec";
export type {ModelsSettingsContract} from "./settings-spec";
export {hasCredentials} from "./service";
export type {ModelsService, ProfileModelDefaults} from "./service";
