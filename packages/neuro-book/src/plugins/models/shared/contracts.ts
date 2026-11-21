/**
 * `nbook.models` 对其它插件公开的合同（docs/specs/models/service.md 输出 10、12）：进程内服务 `modelsKey`（给 Agent 插件的
 * 模型端口）与远程合同 `nbook.models/settings`（给设置页）。形状、方法与事件表在 `@notnotype/nb-models/contract`，这里只给
 * 带本插件 id 的服务键与合同 id，并转出别的插件在用的形状与函数（跨插件只引 contracts，ADR 0025）。
 */

import {modelsSettingsSpec} from "@notnotype/nb-models/contract";
import type {ModelsService} from "@notnotype/nb-models/contract";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export {roleOfReference, roleReference, splitReference} from "@notnotype/nb-models/config";
/** 一次请求用的档位（纯函数，浏览器也用）：角色页据此告诉用户“当前模型没有这一档，实际用哪一档”。 */
export {requestEffort} from "@notnotype/nb-harness/kernel/contracts";
export {hasCredentials} from "@notnotype/nb-models/contract";
export type {ModelRow, ModelsService, ModelsSnapshot, SnapshotProvider, SnapshotRole, Template} from "@notnotype/nb-models/contract";
export {builtinRoleNameKey, modelsText} from "./text";
/** 两页的分区 id：对话的提示卡按它们打开设置并定位（docs/specs/agent/conversation.md 输出 42）。 */
export {PROVIDERS_SECTION, ROLES_SECTION} from "./settings";

/** 别的服务端插件依赖它取模型端口；只在服务端提供。 */
export const modelsKey: ServiceKey<ModelsService> = defineServiceKey<ModelsService>("nbook.models/models");

export const modelsSettingsContract = defineRemoteService({id: "nbook.models/settings", ...modelsSettingsSpec});
