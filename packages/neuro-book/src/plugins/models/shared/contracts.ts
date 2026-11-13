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

export {roleOfReference, roleReference} from "@notnotype/nb-models/config";
export {hasCredentials} from "@notnotype/nb-models/contract";
export type {ModelsService, ModelsSnapshot, SnapshotModel, SnapshotProvider, SnapshotRole} from "@notnotype/nb-models/contract";
export {builtinRoleNameKey, modelsText} from "./text";

/** 别的服务端插件依赖它取模型端口；只在服务端提供。 */
export const modelsKey: ServiceKey<ModelsService> = defineServiceKey<ModelsService>("nbook.models/models");

export const modelsSettingsContract = defineRemoteService({id: "nbook.models/settings", ...modelsSettingsSpec});
